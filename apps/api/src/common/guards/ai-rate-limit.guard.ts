/**
 * PAHALI AI UÇLARI İÇİN HIZ SINIRI.
 *
 * NEDEN: `/assistant/chat`, `/caselaw/ai-search`, `/petitions/:id/generate` gibi
 * uçlarda rol kontrolü de hız sınırı da yoktu; her rol (STAJYER dâhil) sınırsız
 * çağrı yapabiliyordu. `ai-search` tek istekte 1 + `summarizeTop` kadar LLM
 * çağrısı üretir ve maliyet BYO-LLM olduğu için doğrudan büroya yazılır.
 *
 * TASARIM: yeni bağımlılık (@nestjs/throttler) eklemek yerine süreç-içi kayan
 * pencere. Faz 2'de API tek süreçtir; çok örnekli dağıtımda (Faz 3) sayaç
 * Redis'e taşınacak — bu sınıfın dışa bakan sözleşmesi değişmez.
 *
 * Sınırlar kullanıcı + uç bazındadır ve env ile ayarlanır:
 *   AI_RATE_LIMIT_PER_MINUTE (varsayılan 20)
 *   AI_RATE_LIMIT_PER_DAY    (varsayılan 300)
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

const COST_KEY = "ai-rate-limit-cost";

/** Bir isteğin kaç "çağrı" saydığı (ai-search gibi çok çağrılı uçlar için >1). */
export const AiCost = (cost: number) => SetMetadata(COST_KEY, cost);

interface Bucket {
  minuteWindowStart: number;
  minuteCount: number;
  dayWindowStart: number;
  dayCount: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function limitPerMinute(): number {
  const v = Number.parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

function limitPerDay(): number {
  const v = Number.parseInt(process.env.AI_RATE_LIMIT_PER_DAY ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 300;
}

@Injectable()
export class AiRateLimitGuard implements CanActivate {
  /** userId|route → sayaç. Süreç ömrü boyunca yaşar; periyodik olarak budanır. */
  private static readonly buckets = new Map<string, Bucket>();
  private static lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser; route?: { path?: string }; url?: string }>();
    const user = request.user;
    // Kimlik yoksa JwtAuthGuard zaten reddeder; burada sayaç tutmanın anlamı yok.
    if (!user?.userId) return true;

    const cost = this.reflector.getAllAndOverride<number>(COST_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 1;

    const routeKey = request.route?.path ?? request.url ?? "ai";
    const key = `${user.userId}|${routeKey}`;
    const now = Date.now();

    AiRateLimitGuard.sweep(now);

    const bucket =
      AiRateLimitGuard.buckets.get(key) ??
      { minuteWindowStart: now, minuteCount: 0, dayWindowStart: now, dayCount: 0 };

    if (now - bucket.minuteWindowStart >= MINUTE_MS) {
      bucket.minuteWindowStart = now;
      bucket.minuteCount = 0;
    }
    if (now - bucket.dayWindowStart >= DAY_MS) {
      bucket.dayWindowStart = now;
      bucket.dayCount = 0;
    }

    const perMinute = limitPerMinute();
    const perDay = limitPerDay();

    if (bucket.minuteCount + cost > perMinute) {
      AiRateLimitGuard.buckets.set(key, bucket);
      const waitSeconds = Math.ceil((MINUTE_MS - (now - bucket.minuteWindowStart)) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            `AI istek sınırına ulaşıldı (dakikada en fazla ${perMinute} çağrı). ` +
            `${waitSeconds} saniye sonra tekrar deneyin. Bu sınır, büronuzun AI sağlayıcı ` +
            "maliyetini korumak içindir.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (bucket.dayCount + cost > perDay) {
      AiRateLimitGuard.buckets.set(key, bucket);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            `Günlük AI istek tavanına ulaşıldı (${perDay} çağrı). Tavanı yükseltmek için ` +
            "sistem yöneticinizle görüşün (AI_RATE_LIMIT_PER_DAY).",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.minuteCount += cost;
    bucket.dayCount += cost;
    AiRateLimitGuard.buckets.set(key, bucket);
    return true;
  }

  /** Bellekte sonsuza dek anahtar biriktirmemek için saatte bir budama. */
  private static sweep(now: number): void {
    if (now - AiRateLimitGuard.lastSweep < 60 * 60 * 1000) return;
    AiRateLimitGuard.lastSweep = now;
    for (const [key, bucket] of AiRateLimitGuard.buckets) {
      if (now - bucket.dayWindowStart >= DAY_MS) AiRateLimitGuard.buckets.delete(key);
    }
  }

  /** Testler ve yeniden başlatma senaryoları için. */
  static reset(): void {
    AiRateLimitGuard.buckets.clear();
  }
}

/** Uç dekoratörü: `@AiThrottle()` veya çok çağrılı uçlarda `@AiThrottle(6)`. */
export function AiThrottle(cost = 1) {
  return applyDecorators(AiCost(cost), UseGuards(AiRateLimitGuard));
}
