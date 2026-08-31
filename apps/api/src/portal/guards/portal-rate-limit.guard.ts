import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { PortalAuthUser } from "../portal.types";

export const PORTAL_RATE_LIMIT_KEY = "portalRateLimit";

export interface PortalRateLimitOptions {
  /** Pencere başına izin verilen istek sayısı. */
  limit: number;
  /** Pencere uzunluğu (ms). */
  windowMs: number;
  /** Sayaç adı — farklı uçların kovaları karışmasın. */
  bucket: string;
}

/**
 * Uç bazlı hız sınırı: `@PortalRateLimit({ limit: 5, windowMs: 60_000, bucket: "login" })`
 */
export const PortalRateLimit = (options: PortalRateLimitOptions) =>
  SetMetadata(PORTAL_RATE_LIMIT_KEY, options);

/** Sayaç tablosunun sınırsız büyümesini önleyen üst sınır. */
const MAX_TRACKED_KEYS = 20_000;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * PORTAL HIZ SINIRLAYICI — bellek içi, bağımlılıksız.
 *
 * İki yüzeyi korur:
 *   - **Giriş** (`/portal/auth/*`): kimliksizdir, `bcrypt.compare` kasten
 *     maliyetlidir; sınırsız deneme hem parola denemesi hem ucuz bir DoS
 *     yüzeyidir. Anahtar = IP + e-posta.
 *   - **Mesaj yazma** (`POST /portal/messages`): kimliklidir ama her istek
 *     büro tarafında bir kuyruk satırı (InboundMessage) doğurur; sınırsız
 *     gönderim avukatın gelen kutusunu boğardı. Anahtar = IP + portalUserId.
 *
 * KAPSAM: sayaç SÜREÇ BELLEĞİNDEDİR. Çok örnekli dağıtımda Redis'e taşınmalıdır
 * (görev tanımı bunu bu fazda zorunlu tutmuyor). Bellek içi sayaç, tek örnekli
 * kurulumda gerçek koruma sağlar; çok örnekli kurulumda korumayı örnek sayısı
 * kadar zayıflatır — ama hiç sınır olmamasından iyidir.
 *
 * BU, HESAP KİLİDİNİN YERİNE GEÇMEZ: dağıtık bir deneme farklı IP'lerden
 * gelirse ayrı kovalara düşer. Hesap düzeyindeki kilit `PortalAuthService`
 * içindedir (5 hata → 15 dakika).
 */
@Injectable()
export class PortalRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<PortalRateLimitOptions>(
      PORTAL_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()]
    );
    // Sınır tanımlanmamış uçlar bu guard'dan etkilenmez.
    if (!options) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { portalUser?: PortalAuthUser }>();
    const key = `${options.bucket}|${this.identity(request)}`;
    const now = Date.now();

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      this.prune(now);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > options.limit) {
      const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new HttpException(
        `Çok fazla istek gönderildi. Lütfen ${seconds} saniye sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    return true;
  }

  /** Başarılı girişte sayacı sıfırlar — meşru kullanıcı cezalandırılmasın. */
  reset(request: Request, bucket: string): void {
    this.buckets.delete(`${bucket}|${this.identity(request)}`);
  }

  /**
   * Sayaç kimliği: IP + (oturum varsa portal kullanıcısı, yoksa gövdedeki
   * e-posta/token). Kimlik hiç bulunamazsa yalnız IP kullanılır — en sıkı
   * davranıştır, çünkü aynı IP'den gelen her şey tek kovada toplanır.
   */
  private identity(request: Request & { portalUser?: PortalAuthUser }): string {
    const ip = request.ip ?? request.socket?.remoteAddress ?? "bilinmeyen";
    if (request.portalUser) return `${ip}|u:${request.portalUser.portalUserId}`;
    const body = request.body as { email?: unknown; token?: unknown } | undefined;
    if (typeof body?.email === "string") {
      return `${ip}|e:${body.email.toLowerCase().slice(0, 200)}`;
    }
    // Token'ın KENDİSİ anahtara girmez (uzun ve gizli); yalnız uzunluğu
    // kadar bir ayrım yeterlidir — asıl sınır IP üzerindedir.
    if (typeof body?.token === "string") return `${ip}|t`;
    return `${ip}|-`;
  }

  private prune(now: number): void {
    if (this.buckets.size < MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
