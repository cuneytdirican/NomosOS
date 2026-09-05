import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { MAINTENANCE_SETTING_KEY } from "../../platform/platform.constants";
import { SUBSCRIPTION_GRACE_DAYS } from "../../scheduler/scheduler.constants";
import type { AuthUser } from "../types";

/**
 * ABONELİK DURUMU VE BAKIM KİLİDİ — KİRACI TARAFINDAKİ YAPTIRIM.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ Askı bir ERİŞİM KARARIDIR; kayıt alanı değildir.                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Faz 3'te dört-göz onayıyla `SUSPENDED`'a çekilen bir büronun kullanıcıları
 * `/api/v1/**` uçlarına TAM YETKİYLE erişmeye devam ediyordu; aynı şekilde
 * dört-göz onayıyla açılan "bakım modu tam kilidi" hiçbir isteği kesmiyordu
 * (denetim bulgusu 6). Yani dunning zincirinin son adımı ve panelin en yıkıcı
 * iki işlemi ETKİSİZDİ: panelde "askıya alındı" görünen büro çalışmaya devam
 * ediyordu.
 *
 * ─────────────────────────── NE YAPAR ───────────────────────────
 *
 * 1. **Bakım tam kilidi** açıksa TÜM kiracı uçları 503 döner. Panel
 *    (`/api/admin/v1/**`) etkilenmez — kilidi kapatabilmek için panelin ayakta
 *    kalması ŞARTTIR; kendi kilidine kilitlenen bir sistem kurtarılamaz.
 * 2. **Abonelik SUSPENDED / CANCELED** ise 403. İki istisna açık bırakılır:
 *    - `/auth/*` → kullanıcı giriş yapıp durumu görebilmeli, oturumunu
 *      kapatabilmeli.
 *    - GET istekleri → **VERİ SİLİNMEZ ve REHİN ALINMAZ**. Büro kendi
 *      verisini okuyabilir ve dışa aktarabilir; yazma durur. Askı bir tahsilat
 *      aracıdır, veriye el koyma aracı değil (spec §İş Kuralları 9).
 *
 * ─────────────────────────── MALİYET ───────────────────────────
 *
 * Durum, kiracı başına 30 saniyelik bir önbellekte tutulur — `JwtAuthGuard`'ın
 * kullanıcı önbelleğiyle aynı disiplin ve aynı ömür. Askıya alma kararının en
 * geç 30 saniyede etkili olması yeterlidir; her isteğe ek sorgu maliyeti
 * çıkarmaz.
 */

const STATUS_CACHE_TTL_MS = 30_000;

/** Erişimi kesilen abonelik durumları. */
const BLOCKED_STATUSES = ["SUSPENDED", "CANCELED"] as const;

/**
 * ÖDEME GEREKLİ (402) — Faz 0 gelir kaçağı: süresi dolan TRIAL ve toleransı
 * (`SUBSCRIPTION_GRACE_DAYS`) aşan PAST_DUE büro, iki insan elle askıya alana
 * kadar tam yetkiyle çalışıyordu. Artık YAZMA istekleri 402 döner; okuma,
 * kimlik ve ödeme/kredi uçları açık kalır (veri rehin alınmaz, ödeme yolu
 * kapanmaz). Askı (403) ayrı ve daha sert bir karardır, olduğu gibi durur.
 */
const PAST_DUE_GRACE_DAYS = SUBSCRIPTION_GRACE_DAYS;
const PAYMENT_OPEN_PREFIXES = ["/api/v1/auth/", "/api/v1/billing", "/api/v1/credits"];

interface CachedStatus {
  status: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  expiresAt: number;
}

interface CachedMaintenance {
  fullLock: boolean;
  message: string;
  expiresAt: number;
}

@Injectable()
export class TenantStatusGuard implements CanActivate {
  private readonly tenantCache = new Map<string, CachedStatus>();
  private maintenance: CachedMaintenance = { fullLock: false, message: "", expiresAt: 0 };

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    // Platform paneli bu guard'ın kapsamı DIŞINDADIR: bakım kilidini kapatacak
    // ve askıyı kaldıracak uçlar orada yaşar.
    if (request.path?.startsWith("/api/admin/")) return true;

    // @Public() uçlar (giriş, sağlık) kimlik taşımaz; abonelik kontrolü
    // yapılacak bir kiracı da yoktur.
    //
    // ══════════════════════════════════════════════════════════════════════
    // SIRA KRİTİKTİR (denetim bulgusu K-02): `isPublic` kontrolü BAKIM
    // KİLİDİNDEN ÖNCE gelir.
    //
    // Eskiden kilit önce bakılıyordu ve `/api/v1/health` (@Public) de 503
    // dönüyordu. Zinciri ölçüldü:
    //   1. Kilit açılır → en geç 30 sn içinde /health 503;
    //   2. `docker-compose.prod.yml` healthcheck'i `grep -q '"ok"'` yapıyor,
    //      eşleşmiyor → 15 sn × 5 deneme → api konteyneri `unhealthy`;
    //   3. `web` ve `admin` servisleri `depends_on: api: service_healthy`
    //      taşıyor → bundan sonra herhangi bir yeniden başlatma veya düğüm
    //      taşımasında ADMİN PANELİ HİÇ AYAĞA KALKMAZ;
    //   4. Kilidi kapatabilecek tek arayüz kaybolur; kurtarma yalnız `psql`.
    //
    // Bu guard'ın kendi yorumu (yukarıda) bunun olmamasını taahhüt ediyordu:
    // "kendi kilidine kilitlenen bir sistem kurtarılamaz". API katmanı sözü
    // tutuyordu, dağıtım katmanı deliyordu. Artık söz gerçekten tutuluyor.
    //
    // Bakım kilidi zaten bir İŞ KURALIDIR: giriş ucunu ve sağlık ucunu kapatmak
    // onun amacı değildir. Kilit altında `POST /auth/login` de açık kalır —
    // kullanıcı giriş yapıp "sistem bakımda" mesajını ilk yazma denemesinde
    // görür; kimlik doğrulayamadığı için hiçbir veriye erişemez.
    // ══════════════════════════════════════════════════════════════════════
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const lock = await this.readMaintenance();
    if (lock.fullLock) {
      throw new ServiceUnavailableException(lock.message);
    }

    const user = request.user;
    if (!user?.tenantId) return true;

    const sub = await this.readSubscriptionStatus(user.tenantId);
    const status = sub.status;
    if (!status) return true;

    // Kimlik uçları ve salt-okur erişim açık kalır (veri rehin alınmaz).
    const method = (request.method ?? "GET").toUpperCase();
    const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";
    const path = request.path ?? "";

    if (!(BLOCKED_STATUSES as readonly string[]).includes(status)) {
      const paymentDue = this.paymentDueMessage(sub, Date.now());
      if (!paymentDue || readOnly || PAYMENT_OPEN_PREFIXES.some((p) => path.startsWith(p))) return true;
      throw new HttpException(paymentDue, HttpStatus.PAYMENT_REQUIRED);
    }

    if (readOnly) return true;
    if (path.startsWith("/api/v1/auth/")) return true;

    throw new ForbiddenException(
      status === "CANCELED"
        ? "Büronuzun NomosOS aboneliği iptal edilmiştir. Kayıtlarınız SİLİNMEMİŞTİR ve " +
          "görüntülenebilir/dışa aktarılabilir; yeni kayıt oluşturma ve değişiklik yapma " +
          "kapalıdır. Aboneliği yeniden başlatmak için bizimle iletişime geçin."
        : "Büronuzun NomosOS aboneliği askıya alınmıştır. Kayıtlarınız SİLİNMEMİŞTİR ve " +
          "görüntülenebilir/dışa aktarılabilir; yeni kayıt oluşturma ve değişiklik yapma " +
          "kapalıdır. Askının kaldırılması için ödeme durumunuzu kontrol edip bizimle " +
          "iletişime geçin."
    );
  }

  /** Süresi dolmuş TRIAL / toleransı aşmış PAST_DUE için kullanıcı mesajı; yoksa null. */
  private paymentDueMessage(sub: CachedStatus, nowMs: number): string | null {
    if (sub.status === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt.getTime() < nowMs) {
      return (
        "Deneme süreniz sona erdi. Kayıtlarınız SİLİNMEMİŞTİR ve görüntülenebilir; yeni kayıt " +
        "oluşturmak ve değişiklik yapmak için aboneliğinizi başlatın (Ayarlar → Abonelik)."
      );
    }
    if (sub.status === "PAST_DUE" && sub.currentPeriodEnd) {
      const graceEnd = sub.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * 24 * 3_600_000;
      if (graceEnd < nowMs) {
        return (
          `Abonelik ödemeniz ${PAST_DUE_GRACE_DAYS} günü aşkın süredir gecikmiş. Kayıtlarınız ` +
          "SİLİNMEMİŞTİR ve görüntülenebilir; yazma işlemleri ödeme tamamlanana kadar kapalıdır."
        );
      }
    }
    return null;
  }

  /** Kiracının abonelik durumu (+ tarihler) — kısa ömürlü önbellekle. */
  private async readSubscriptionStatus(tenantId: string): Promise<CachedStatus> {
    const now = Date.now();
    const cached = this.tenantCache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached;

    const subscription = await this.prisma.client.subscription.findUnique({
      where: { tenantId },
      select: { status: true, trialEndsAt: true, currentPeriodEnd: true },
    });
    // Aboneliği hiç olmayan kiracı ENGELLENMEZ: kayıt eksikliği bir erişim
    // kararı değildir ve bütün büroyu kilitlemek orantısız olurdu.
    const entry: CachedStatus = {
      status: subscription?.status ?? null,
      trialEndsAt: subscription?.trialEndsAt ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      expiresAt: now + STATUS_CACHE_TTL_MS,
    };

    if (this.tenantCache.size > 1_000) {
      for (const [key, value] of this.tenantCache) {
        if (value.expiresAt <= now) this.tenantCache.delete(key);
      }
    }
    this.tenantCache.set(tenantId, entry);
    return entry;
  }

  /** Bakım modu tam kilidi — dört-göz onayıyla açılır/kapanır. */
  private async readMaintenance(): Promise<{ fullLock: boolean; message: string }> {
    const now = Date.now();
    if (this.maintenance.expiresAt > now) return this.maintenance;

    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: MAINTENANCE_SETTING_KEY },
    });

    let fullLock = false;
    let message = "Sistem bakımdadır. Kısa süre sonra tekrar deneyin.";
    if (setting) {
      try {
        const parsed = JSON.parse(setting.valueJson) as {
          fullLock?: unknown;
          message?: unknown;
        };
        fullLock = parsed.fullLock === true;
        if (typeof parsed.message === "string" && parsed.message.trim()) {
          message = parsed.message;
        }
      } catch {
        // Bozuk ayar kilit SAYILMAZ: okunamayan bir JSON yüzünden bütün
        // platformu kapatmak, korumanın kendisinden daha yıkıcı olurdu.
        fullLock = false;
      }
    }

    this.maintenance = { fullLock, message, expiresAt: now + STATUS_CACHE_TTL_MS };
    return this.maintenance;
  }
}
