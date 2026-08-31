import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser, JwtPayload } from "../types";
import { TENANT_JWT_AUDIENCE } from "../jwt-audience";

/**
 * Kullanıcı doğrulama önbelleği ömrü (ms).
 *
 * Token 12 saat geçerlidir; rol düşürme / pasifleştirme işleminin en geç bu
 * süre içinde etkili olması beklenir. Değer küçüldükçe güvenlik artar,
 * veritabanı yükü artar.
 */
const USER_CACHE_TTL_MS = 30_000;

interface CachedUser {
  user: AuthUser;
  /** Oturum iptal damgası — önbellekte de taşınır (bkz. `isRevoked`). */
  sessionsValidFrom: Date | null;
  expiresAt: number;
}

const SESSION_REVOKED_MESSAGE =
  "Oturumunuz sonlandırılmış (çıkış yapıldı veya parola değiştirildi). Lütfen tekrar giriş yapın.";

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
  private readonly cache = new Map<string, CachedUser>();

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
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
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
    request.user = await this.resolveUser(payload);
    return true;
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
