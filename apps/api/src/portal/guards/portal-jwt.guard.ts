import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { PORTAL_ANON_KEY } from "../decorators/portal-anonymous.decorator";
import { PORTAL_JWT_AUDIENCE, portalJwtSecret } from "../portal.constants";
import type { PortalAuthUser, PortalJwtPayload } from "../portal.types";

/** Abonelik durumu önbelleği — büro tarafındaki `TenantStatusGuard` ile aynı ömür. */
const SUBSCRIPTION_CACHE_TTL_MS = 30_000;

/** Erişimi kesilen abonelik durumları (büro tarafıyla birebir aynı liste). */
const BLOCKED_SUBSCRIPTION_STATUSES: readonly string[] = ["SUSPENDED", "CANCELED"];

/**
 * PORTAL KİMLİK GUARD'I — üçüncü kimlik evreninin kapısı.
 *
 * BEŞ AYRI KAPI aynı anda kapalıdır (birinin kaçırılması yetmez):
 *
 *   1. **Ayrı imza anahtarı** — büro `JWT_SECRET`'i veya platform anahtarıyla
 *      imzalanmış token burada imza doğrulamasında düşer.
 *   2. **Audience** — `aud !== "portal"` ise reddedilir. Büro token'ı
 *      `aud: "tenant"`, panel token'ı `aud: "platform"` taşır.
 *   3. **Ayrı tablo** — `sub` PortalUser'da aranır; büro User kimliğinin
 *      burada karşılığı yoktur (iki tablo arasında FK/ortak uzay yok).
 *   4. **Hesap ve müvekkil durumu** — PortalUser pasifse VEYA bağlı Client
 *      pasifse (azil / vekalet ilişkisinin bitmesi) oturum ANINDA düşer.
 *      Spec §İş Kuralları 8: "Client INACTIVE olduğunda tüm bağlı
 *      PortalUser'lar otomatik SUSPENDED olur" — yaptırım burada uygulanır,
 *      toplu bir güncelleme işine bırakılmaz.
 *   5. **Kiracı/müvekkil tutarlılığı** — token'daki `tenantId`/`clientId`
 *      veritabanındaki değerle uyuşmuyorsa oturum geçersizdir.
 *
 * ÖNBELLEK YOKTUR. Büro tarafındaki `JwtAuthGuard` 30 saniyelik bir kullanıcı
 * önbelleği tutar; portalda bu bilinçli olarak yapılmaz: "erişimi anında kes"
 * (spec §Kullanıcı Hikâyesi 11) 30 saniyelik bir pencereyle uyuşmaz ve portal
 * istek hacmi büro tarafının yanında ihmal edilebilir düzeydedir.
 */
@Injectable()
export class PortalJwtGuard implements CanActivate {
  /** tenantId → abonelik durumu (30 sn). */
  private readonly subscriptionCache = new Map<string, { status: string | null; expiresAt: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const anonymous = this.reflector.getAllAndOverride<boolean>(PORTAL_ANON_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (anonymous) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { portalUser?: PortalAuthUser }>();

    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException("Portal oturumu bulunamadı. Lütfen giriş yapın.");
    }

    let payload: PortalJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PortalJwtPayload>(token, {
        secret: portalJwtSecret(),
        audience: PORTAL_JWT_AUDIENCE,
      });
    } catch {
      // Büro token'ı, panel token'ı ve süresi dolmuş portal token'ı buraya düşer.
      throw new UnauthorizedException(
        "Portal oturumu geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın."
      );
    }

    // Kütüphane audience'ı doğrulasa da açık kontrol bırakılır: doğrulama
    // seçeneği ileride yapılandırmadan düşerse kapı yine kapalı kalsın.
    if (payload.aud !== PORTAL_JWT_AUDIENCE) {
      throw new UnauthorizedException("Bu oturum müvekkil portalı için geçerli değil.");
    }

    const record = await this.prisma.client.portalUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        email: true,
        fullName: true,
        isActive: true,
        sessionsValidFrom: true,
        client: { select: { id: true, name: true, isActive: true } },
      },
    });

    if (!record || !record.isActive) {
      throw new UnauthorizedException(
        "Portal hesabınız pasif durumda veya bulunamadı. Avukatınızla görüşün."
      );
    }

    // KAPI 4 — müvekkil kaydı pasifse (azil, vekalet ilişkisinin sona ermesi)
    // portal erişimi de kapanır. Hesabı tek tek pasifleştirmeyi unutmak,
    // erişimin açık kalmasına yol açmamalıdır.
    if (!record.client.isActive) {
      throw new UnauthorizedException(
        "Portal erişiminiz kapatılmıştır. Bilgi için avukatınızla görüşün."
      );
    }

    // KAPI 5 — token ile kayıt arasındaki tutarlılık. `clientId` her istekte
    // VERİTABANINDAN alınır; token'daki değer yalnızca doğrulanır. Böylece
    // imza anahtarı sızsa bile "clientId'yi değiştir, başka müvekkilin
    // dosyalarını oku" yolu kapalıdır.
    if (record.tenantId !== payload.tenantId || record.clientId !== payload.clientId) {
      throw new UnauthorizedException("Portal oturumu geçersiz. Lütfen tekrar giriş yapın.");
    }

    // KAPI 6 — OTURUM İPTAL DAMGASI (denetim bulgusu 7).
    //
    // Çıkış (POST /portal/auth/logout) ve parola sıfırlama, hesabın
    // `sessionsValidFrom` damgasını tazeler. Bu andan ÖNCE üretilmiş her token
    // ölür. Damga olmadan "çıkış" yalnızca istemcideki localStorage'ı silmekten
    // ibaretti: ortak bilgisayardan çıkan müvekkilin token'ı 8 saat daha
    // geçerliydi ve o aradan kopyalanabilirdi.
    //
    // Karşılaştırma SANİYE hassasiyetindedir: `iat` saniye cinsindendir ve
    // çıkıştan hemen sonra yapılan yeni giriş yanlışlıkla geçersiz sayılmamalıdır.
    if (record.sessionsValidFrom && typeof payload.iat === "number") {
      const cutoffSeconds = Math.floor(record.sessionsValidFrom.getTime() / 1000);
      if (payload.iat < cutoffSeconds) {
        throw new UnauthorizedException(
          "Oturumunuz sonlandırılmış. Lütfen tekrar giriş yapın."
        );
      }
    }

    // KAPI 7 — BÜRONUN ABONELİK DURUMU (denetim bulgusu 6).
    //
    // Portal controller'ları `@Public()` taşıdığı için global `TenantStatusGuard`
    // erken çıkıyor ve askıya alınmış bir büronun müvekkilleri portala YAZMAYA
    // devam edebiliyordu. Büro tarafındaki kuralın AYNISI burada uygulanır:
    // okuma açık kalır (veri rehin alınmaz), yazma durur.
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const status = await this.readSubscriptionStatus(record.tenantId);
      if (status && BLOCKED_SUBSCRIPTION_STATUSES.includes(status)) {
        throw new ForbiddenException(
          "Büronuzun NomosOS aboneliği şu anda etkin değildir; portal üzerinden yeni kayıt " +
            "oluşturulamıyor. Dosyalarınızı görüntülemeye devam edebilirsiniz. Acil bir " +
            "durumda avukatınıza doğrudan ulaşın."
        );
      }
    }

    request.portalUser = {
      portalUserId: record.id,
      tenantId: record.tenantId,
      clientId: record.clientId,
      email: record.email,
      fullName: record.fullName,
      clientName: record.client.name,
      ip: portalClientIp(request),
    };
    return true;
  }

  /**
   * Kiracının abonelik durumu — 30 saniyelik önbellekle.
   *
   * Kullanıcı kaydı için önbellek BİLEREK yoktur ("erişimi anında kes"), ama
   * abonelik durumu bütün büro için ortak ve yavaş değişen bir değerdir; her
   * portal isteğine ikinci bir sorgu eklemek gereksizdir.
   */
  private async readSubscriptionStatus(tenantId: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.subscriptionCache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.status;

    const subscription = await this.prisma.client.subscription.findUnique({
      where: { tenantId },
      select: { status: true },
    });
    // Aboneliği hiç olmayan kiracı ENGELLENMEZ (büro tarafıyla aynı karar).
    const status = subscription?.status ?? null;

    if (this.subscriptionCache.size > 1_000) {
      for (const [key, value] of this.subscriptionCache) {
        if (value.expiresAt <= now) this.subscriptionCache.delete(key);
      }
    }
    this.subscriptionCache.set(tenantId, {
      status,
      expiresAt: now + SUBSCRIPTION_CACHE_TTL_MS,
    });
    return status;
  }
}

/**
 * İstek IP'si — PortalAuditLog'a yazılır (spec §İş Kuralları 7).
 *
 * `X-Forwarded-For` BAŞLIĞI DOĞRUDAN OKUNMAZ; başlığı istemci uydurabilir.
 * `main.ts` içindeki `trust proxy` (TRUSTED_PROXY_HOPS) ayarı ne kadarını
 * çözmeye izin veriyorsa Express o kadarını çözer ve burada yalnızca
 * `request.ip` okunur — hız sınırlayıcı ile denetim kaydı AYNI kaynağı görür.
 */
export function portalClientIp(request: Request): string {
  return (request.ip ?? request.socket?.remoteAddress ?? "bilinmeyen").slice(0, 64);
}
