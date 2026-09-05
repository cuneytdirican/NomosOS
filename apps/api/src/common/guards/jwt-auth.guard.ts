import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser, JwtPayload } from "../types";
import { TENANT_JWT_AUDIENCE } from "../jwt-audience";
import { AUTH_COOKIE_NAME } from "../auth-cookie";
import { createHash } from "node:crypto";
import { pathAllowedByScopes } from "../../integrations/webhook-events";
import { API_KEY_HEADER } from "../../integrations/api-keys.service";

/**
 * Kullanıcı doğrulama önbelleği ömrü (ms).
 *
 * Token 12 saat geçerlidir; rol düşürme / pasifleştirme işleminin en geç bu
 * süre içinde etkili olması beklenir. Değer küçüldükçe güvenlik artar,
 * veritabanı yükü artar.
 */
const USER_CACHE_TTL_MS = 30_000;

/** jti → oturum kaydı (kısa ömürlü) — iptal denetimi her istekte DB'ye gitmesin. */
interface CachedSession {
  id: string;
  revoked: boolean;
  lastSeenAt: number;
  expiresAt: number;
}
/** lastSeenAt en fazla bu sıklıkla yazılır. */
const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

interface CachedUser {
  user: AuthUser;
  /** Oturum iptal damgası — önbellekte de taşınır (bkz. `isRevoked`). */
  sessionsValidFrom: Date | null;
  expiresAt: number;
}

/**
 * Faz 7C — kullanıcı çözümleme önbelleği modül düzeyindedir ki `users.service` rol/ek yetki/aktiflik
 * değiştirdiğinde aynı süreçteki guard'ı anında düşürebilsin; aksi hâlde yeni jeton bile 30 sn
 * eski yetkilerle çalışırdı (Faz 7D dumanında görüldü). Çok örnekli kurulumda diğer süreçler
 * TTL (30 sn) sonunda tazelenir.
 */
export const USER_RESOLUTION_CACHE = new Map<string, CachedUser>();
export function invalidateUserCache(userId: string): void {
  USER_RESOLUTION_CACHE.delete(userId);
}

const SESSION_REVOKED_MESSAGE =
  "Oturumunuz sonlandırılmış (çıkış yapıldı veya parola değiştirildi). Lütfen tekrar giriş yapın.";

/**
 * İ-46: `Cookie` başlığından adlandırılmış çerezi okur (cookie-parser
 * bağımlılığı EKLENMEZ — ayrıştırma açık ve küçük tutulur).
 */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return undefined;
}

/**
 * Token, oturum iptal damgasından ÖNCE mi üretilmiş?
 *
 * JWT `iat` SANİYE hassasiyetindedir; damga milisaniye. Aynı saniye içinde
 * üretilmiş bir token'ın yanlışlıkla iptal sayılmaması için damga saniyeye
 * YUVARLANIR (aşağı) ve karşılaştırma `iat < damga` biçiminde yapılır.
 */
function isRevoked(payload: JwtPayload, sessionsValidFrom: Date | null): boolean {
  if (!sessionsValidFrom) return false;
  if (typeof payload.iat !== "number") return false;
  return payload.iat < Math.floor(sessionsValidFrom.getTime() / 1000);
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** userId → doğrulanmış kullanıcı (kısa ömürlü). */
  /** Süreç içi kullanıcı önbelleği — rol/yetki/aktiflik değişince `invalidateUserCache` ile düşürülür (Faz 7C). */
  private readonly cache = USER_RESOLUTION_CACHE;
  /** jti → cihaz oturumu (kısa ömürlü). */
  private readonly sessionCache = new Map<string, CachedSession>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    // ENTERPRISE++ API ANAHTARI: `X-Api-Key` → salt-okunur, kapsamlı kiracı kimliği.
    const apiKeyHeader = request.headers[API_KEY_HEADER];
    if (typeof apiKeyHeader === "string" && apiKeyHeader.length > 0) {
      request.user = await this.resolveApiKey(apiKeyHeader, request);
      return true;
    }

    const authHeader = request.headers.authorization;
    // İ-46: öncelik Authorization başlığı (mobil/portal); tarayıcı oturumu
    // httpOnly çerezle taşınır — XSS belirteci okuyamaz, çerezi tarayıcı gönderir.
    const token =
      authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : readCookie(request, AUTH_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException("Oturum bulunamadı. Lütfen giriş yapın.");
    }

    let payload: JwtPayload;
    try {
      // GÜVENLİK: audience ZORUNLU doğrulanır. Platform paneli token'ı
      // (`aud: "platform"`) buraya asla giremez — imza anahtarı da zaten
      // farklıdır, bu ikinci kapıdır (bkz. common/jwt-audience.ts).
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        audience: TENANT_JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException("Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.");
    }

    // Kütüphane audience'ı doğrulasa da açık kontrol bırakılır: doğrulama
    // seçeneği ileride yapılandırmadan düşerse kapı yine kapalı kalsın.
    if (payload.aud !== TENANT_JWT_AUDIENCE) {
      throw new UnauthorizedException("Bu oturum büro uygulaması için geçerli değil.");
    }

    // GÜVENLİK: rol ve tenant TOKEN'DAN DEĞİL veritabanından okunur.
    // Aksi hâlde pasifleştirilen, rolü düşürülen veya bürodan çıkarılan bir
    // kullanıcının elindeki token 12 saat boyunca eski yetkileriyle geçerli
    // kalırdı; token iptal edilemezdi (denetim bulgusu 13).
    const resolved = await this.resolveUser(payload);
    // ENTERPRISE++ CİHAZ OTURUMU: token `jti` taşıyorsa satırı iptal için
    // denetle ve isteğe sessionId iliştir (eski, jti'siz token geriye uyumlu).
    request.user = payload.jti ? { ...resolved, sessionId: await this.resolveSession(payload.jti) } : resolved;
    return true;
  }

  /**
   * API anahtarı doğrulaması: özet eşleşmeli, iptal/süre dolmamış, YALNIZ GET,
   * yol kapsam kümesinde. Kimlik `apikey:<id>` ve rol AVUKAT (gizli dosyalar
   * görünmez; yazma zaten yöntem kapısında kesilir).
   */
  private async resolveApiKey(plain: string, request: Request): Promise<AuthUser> {
    const row = await this.prisma.client.apiKey.findUnique({
      where: { keyHash: createHash("sha256").update(plain).digest("hex") },
      select: { id: true, tenantId: true, scopes: true, revokedAt: true, expiresAt: true, lastUsedAt: true },
    });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() < Date.now())) {
      throw new UnauthorizedException("API anahtarı geçersiz, iptal edilmiş ya da süresi dolmuş.");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new UnauthorizedException("API anahtarları salt-okunurdur; yazma işlemleri için kullanıcı oturumu gerekir.");
    }
    const scopes = row.scopes.split(",").filter(Boolean);
    if (!pathAllowedByScopes(request.path ?? "", scopes)) {
      throw new UnauthorizedException("Bu API anahtarının kapsamı bu uca erişime izin vermiyor.");
    }
    // lastUsedAt: dakikada en fazla bir yazım (yük üretmesin).
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.prisma.client.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { userId: `apikey:${row.id}`, tenantId: row.tenantId, role: "AVUKAT", apiKeyId: row.id };
  }

  /** Cihaz oturumu: iptal edilmiş/eksik kayıt 401; lastSeenAt seyrek tazelenir. */
  private async resolveSession(jti: string): Promise<string> {
    const now = Date.now();
    let cached = this.sessionCache.get(jti);
    if (!cached || cached.expiresAt <= now) {
      const row = await this.prisma.client.userSession.findUnique({
        where: { jti },
        select: { id: true, revokedAt: true, lastSeenAt: true },
      });
      if (!row) throw new UnauthorizedException("Oturum kaydı bulunamadı. Lütfen tekrar giriş yapın.");
      cached = { id: row.id, revoked: row.revokedAt !== null, lastSeenAt: row.lastSeenAt.getTime(), expiresAt: now + USER_CACHE_TTL_MS };
      this.sessionCache.set(jti, cached);
    }
    if (cached.revoked) {
      throw new UnauthorizedException("Bu cihazdaki oturum kapatılmış. Lütfen tekrar giriş yapın.");
    }
    if (now - cached.lastSeenAt > SESSION_TOUCH_INTERVAL_MS) {
      cached.lastSeenAt = now;
      void this.prisma.client.userSession.update({ where: { id: cached.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
    }
    return cached.id;
  }

  /** Kullanıcıyı kısa ömürlü önbellekle doğrular; pasif kullanıcıyı reddeder. */
  private async resolveUser(payload: JwtPayload): Promise<AuthUser> {
    const now = Date.now();
    const cached = this.cache.get(payload.sub);
    if (cached && cached.expiresAt > now) {
      // Token'daki tenant, kayıtlı tenant ile uyuşmuyorsa oturum geçersizdir.
      if (cached.user.tenantId !== payload.tenantId) {
        this.cache.delete(payload.sub);
      } else if (isRevoked(payload, cached.sessionsValidFrom)) {
        // Önbellekten gelen damga da kontrol edilir; aksi hâlde çıkış yapan
        // kullanıcının token'ı önbellek ömrü boyunca (30 sn) yaşamaya devam ederdi.
        this.cache.delete(payload.sub);
        throw new UnauthorizedException(SESSION_REVOKED_MESSAGE);
      } else {
        return cached.user;
      }
    }

    const record = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
        sessionsValidFrom: true,
        extraPermissions: true,
      },
    });

    if (!record || !record.isActive) {
      this.cache.delete(payload.sub);
      throw new UnauthorizedException("Hesabınız pasif durumda veya bulunamadı. Yöneticinize başvurun.");
    }
    if (record.tenantId !== payload.tenantId) {
      // Token başka bir büroya aitmiş gibi görünüyor — kabul edilmez.
      this.cache.delete(payload.sub);
      throw new UnauthorizedException("Oturum geçersiz. Lütfen tekrar giriş yapın.");
    }

    // OTURUM İPTALİ (denetim bulguları K-03 / Ö-34).
    //
    // `sessionsValidFrom` damgasından ÖNCE üretilmiş token'lar geçersizdir.
    // Damgayı tazeleyenler: `POST /auth/logout`, `POST /auth/change-password`,
    // yönetici tarafından parola sıfırlama ve hesabın pasifleştirilmesi.
    // Bu olmadan çıkış düğmesi yalnızca istemcideki `localStorage`ı siliyordu ve
    // token 12 saat daha geçerli kalıyordu.
    if (isRevoked(payload, record.sessionsValidFrom)) {
      this.cache.delete(payload.sub);
      throw new UnauthorizedException(SESSION_REVOKED_MESSAGE);
    }

    const user: AuthUser = {
      userId: record.id,
      tenantId: record.tenantId,
      role: record.role as AuthUser["role"],
      permissions: record.extraPermissions,
    };
    this.cache.set(payload.sub, {
      user,
      sessionsValidFrom: record.sessionsValidFrom,
      expiresAt: now + USER_CACHE_TTL_MS,
    });
    this.pruneCache(now);
    return user;
  }

  /** Önbelleği süresi dolmuş kayıtlardan arındırır (sınırsız büyümeyi önler). */
  private pruneCache(now: number): void {
    if (this.cache.size < 500) return;
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= now) this.cache.delete(key);
    }
  }
}
