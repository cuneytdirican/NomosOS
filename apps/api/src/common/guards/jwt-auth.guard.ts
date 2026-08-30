import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser, JwtPayload } from "../types";

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
  expiresAt: number;
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
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.");
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
      } else {
        return cached.user;
      }
    }

    const record = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, tenantId: true, role: true, isActive: true },
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

    const user: AuthUser = {
      userId: record.id,
      tenantId: record.tenantId,
      role: record.role as AuthUser["role"],
    };
    this.cache.set(payload.sub, { user, expiresAt: now + USER_CACHE_TTL_MS });
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
