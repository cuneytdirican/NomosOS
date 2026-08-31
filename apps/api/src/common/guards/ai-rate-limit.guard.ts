/**
 * PAHALI AI UÇLARI İÇİN HIZ SINIRI.
 *
 * NEDEN: `/assistant/chat`, `/caselaw/ai-search`, `/petitions/:id/generate` gibi
 * uçlarda rol kontrolü de hız sınırı da yoktu; her rol (STAJYER dâhil) sınırsız
 * çağrı yapabiliyordu. `ai-search` tek istekte 1 + `summarizeTop` kadar LLM
 * çağrısı üretir ve maliyet BYO-LLM olduğu için doğrudan büroya yazılır.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ İKİ KATLI SINIR — denetim bulgusu Ö-10                                   ║
 * ║                                                                          ║
 * ║ Eski hâlde anahtar YALNIZ `${userId}|${route}` idi. Sınırın kendi ilan   ║
 * ║ ettiği amaç ("büronuzun AI sağlayıcı maliyetini korumak") ile kovanın    ║
 * ║ kapsamı ayrışıyordu: 10 kullanıcılı bir büro, 12 ayrı AI ucu üzerinden   ║
 * ║ 10 × 12 × 300 = 36.000 günlük çağrı yapabiliyordu. Sınır maliyeti        ║
 * ║ korumuyor, yalnız tek kullanıcının hatalı döngüsünü yavaşlatıyordu.      ║
 * ║                                                                          ║
 * ║ Artık her istek DÖRT kovaya birden yazar:                                ║
 * ║   kullanıcı+rota / dakika   AI_RATE_LIMIT_PER_MINUTE          (20)       ║
 * ║   kullanıcı+rota / gün      AI_RATE_LIMIT_PER_DAY             (300)      ║
 * ║   BÜRO (rotadan bağımsız) / dakika  AI_RATE_LIMIT_TENANT_PER_MINUTE (60) ║
 * ║   BÜRO (rotadan bağımsız) / gün     AI_RATE_LIMIT_TENANT_PER_DAY  (2000) ║
 * ║                                                                          ║
 * ║ BÜRO KOVASI ROTADAN BAĞIMSIZDIR — ve asıl düzeltme budur. Rota anahtara  ║
 * ║ girseydi, büro tavanı yine uç sayısıyla çarpılırdı.                      ║
 * ║                                                                          ║
 * ║ KULLANICI KOVASI KORUNUR: büro tavanı tek başına, tek bir kullanıcının   ║
 * ║ bütün büronun kotasını dakikalar içinde yemesini engellemez.             ║
 * ║                                                                          ║
 * ║ REDDEDİLEN İSTEK KOTADAN YEMEZ: dört kovadan biri reddederse ondan       ║
 * ║ öncekilerin artışı GERİ ALINIR (`decrement`). Aksi hâlde büro tavanına   ║
 * ║ takılan kullanıcı, kendi dakikalık kotasını da boşa harcardı.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * SAYAÇ NEREDE (denetim bulgusu Ö-09): süreç-içi `Map` yerine ortak
 * `RateLimitCounterStore`. `REDIS_URL` tanımlıysa sayaç Redis'tedir ve
 * `deploy.replicas` kaç olursa olsun sınır TEKTİR; Redis yoksa (ya da
 * erişilemezse) davranış eski süreç-içi hâline düşer. Bkz.
 * `common/rate-limit/counter-store.ts`.
 */

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  applyDecorators,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthUser } from "../types";
import { getCounterStore, type RateLimitCounterStore } from "../rate-limit/counter-store";

const COST_KEY = "ai-rate-limit-cost";

/** Bir isteğin kaç "çağrı" saydığı (ai-search gibi çok çağrılı uçlar için >1). */
export const AiCost = (cost: number) => SetMetadata(COST_KEY, cost);

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function envLimit(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function limitPerMinute(): number {
  return envLimit("AI_RATE_LIMIT_PER_MINUTE", 20);
}

function limitPerDay(): number {
  return envLimit("AI_RATE_LIMIT_PER_DAY", 300);
}

/**
 * BÜRO TAVANLARI — varsayılanlar kullanıcı sınırının katı olarak seçildi.
 *
 * 60/dk ≈ üç kullanıcının aynı anda tam gaz çalışması; 2000/gün ≈ yedi
 * kullanıcının günlük tavanı. Amaç meşru bir büroyu engellemek DEĞİL, kaçak
 * bir döngünün ya da paylaşılmış hesapların faturayı katlamasını durdurmaktır.
 * Kurumsal büro için env ile yükseltilir.
 */
function tenantLimitPerMinute(): number {
  return envLimit("AI_RATE_LIMIT_TENANT_PER_MINUTE", 60);
}

function tenantLimitPerDay(): number {
  return envLimit("AI_RATE_LIMIT_TENANT_PER_DAY", 2000);
}

interface BucketPlan {
  key: string;
  windowMs: number;
  limit: number;
  /** Sınır aşıldığında kullanıcıya dönecek Türkçe mesaj. */
  message: (waitSeconds: number) => string;
}

@Injectable()
export class AiRateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Testlerde değiştirilebilsin diye ayrı okunur. */
  private get store(): RateLimitCounterStore {
    return getCounterStore();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      route?: { path?: string };
      url?: string;
    }>();
    const user = request.user;
    // Kimlik yoksa JwtAuthGuard zaten reddeder; burada sayaç tutmanın anlamı yok.
    if (!user?.userId) return true;

    const cost =
      this.reflector.getAllAndOverride<number>(COST_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 1;

    const routeKey = request.route?.path ?? request.url ?? "ai";
    const plans: BucketPlan[] = [
      {
        key: `ai:u:${user.userId}|${routeKey}|m`,
        windowMs: MINUTE_MS,
        limit: limitPerMinute(),
        message: (wait) =>
          `AI istek sınırına ulaşıldı (dakikada en fazla ${limitPerMinute()} çağrı). ` +
          `${wait} saniye sonra tekrar deneyin. Bu sınır, büronuzun AI sağlayıcı ` +
          "maliyetini korumak içindir.",
      },
      {
        key: `ai:u:${user.userId}|${routeKey}|d`,
        windowMs: DAY_MS,
        limit: limitPerDay(),
        message: () =>
          `Günlük AI istek tavanına ulaşıldı (${limitPerDay()} çağrı). Tavanı yükseltmek için ` +
          "sistem yöneticinizle görüşün (AI_RATE_LIMIT_PER_DAY).",
      },
    ];

    /**
     * BÜRO KOVASI — rota anahtara GİRMEZ (Ö-10'un düzeltmesi tam olarak budur).
     * `tenantId` yoksa (kimlik alanı kiracı dışıysa) büro kovası kurulmaz;
     * kullanıcı kovası yine çalışır.
     */
    if (user.tenantId) {
      plans.push(
        {
          key: `ai:t:${user.tenantId}|m`,
          windowMs: MINUTE_MS,
          limit: tenantLimitPerMinute(),
          message: (wait) =>
            `Büronuzun dakikalık AI çağrı tavanına ulaşıldı (${tenantLimitPerMinute()} çağrı/dk). ` +
            `Şu anda büroda başka kullanıcılar da AI kullanıyor olabilir; ${wait} saniye sonra ` +
            "tekrar deneyin (AI_RATE_LIMIT_TENANT_PER_MINUTE).",
        },
        {
          key: `ai:t:${user.tenantId}|d`,
          windowMs: DAY_MS,
          limit: tenantLimitPerDay(),
          message: () =>
            `Büronuzun günlük AI çağrı tavanına ulaşıldı (${tenantLimitPerDay()} çağrı/gün). ` +
            "Bu tavan büro genelindedir ve sağlayıcı maliyetini sınırlar; yükseltmek için " +
            "sistem yöneticinizle görüşün (AI_RATE_LIMIT_TENANT_PER_DAY).",
        },
      );
    }

    const store = this.store;
    const applied: BucketPlan[] = [];

    for (const plan of plans) {
      const window = await store.increment(plan.key, plan.windowMs, cost);
      applied.push(plan);
      if (window.count > plan.limit) {
        // REDDEDİLEN İSTEK KOTADAN YEMEZ: bu kova dâhil, o ana kadar
        // artırılmış TÜM kovalar geri alınır.
        for (const done of applied) {
          await store.decrement(done.key, cost);
        }
        const waitSeconds = Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000));
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: plan.message(waitSeconds),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  /** Testler ve yeniden başlatma senaryoları için. */
  static async reset(): Promise<void> {
    await getCounterStore().reset();
  }
}

/** Uç dekoratörü: `@AiThrottle()` veya çok çağrılı uçlarda `@AiThrottle(6)`. */
export function AiThrottle(cost = 1) {
  return applyDecorators(AiCost(cost), UseGuards(AiRateLimitGuard));
}
