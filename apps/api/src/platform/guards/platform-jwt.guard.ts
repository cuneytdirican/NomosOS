import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { PLATFORM_ANON_KEY } from "../decorators/platform-permission.decorator";
import { PLATFORM_JWT_AUDIENCE, platformJwtSecret } from "../platform.constants";
import type { PlatformAuthUser, PlatformJwtPayload } from "../platform.types";
import type { AdminRole } from "../platform-permissions";

/**
 * PLATFORM KİMLİK GUARD'I — iki dünyanın sınırı.
 *
 * ÜÇ AYRI KAPI aynı anda kapalıdır (birinin kaçırılması yetmez):
 *   1. **Ayrı imza anahtarı** — tenant `JWT_SECRET`'i ile imzalanmış bir token
 *      burada imza doğrulamasında düşer.
 *   2. **Audience** — `aud !== "platform"` ise reddedilir. Tenant token'ında
 *      bu alan hiç yoktur.
 *   3. **Ayrı tablo** — `sub` PlatformUser tablosunda aranır; tenant User
 *      kimliği burada karşılık bulamaz (iki tablo arasında FK/ortak uzay yok).
 *
 * ROL TOKEN'DAN DEĞİL VERİTABANINDAN OKUNUR: pasifleştirilen ya da rolü
 * düşürülen bir yöneticinin elindeki token 8 saat boyunca eski yetkisiyle
 * geçerli kalmasın (tenant tarafındaki JwtAuthGuard ile aynı disiplin).
 */
@Injectable()
export class PlatformJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const anonymous = this.reflector.getAllAndOverride<boolean>(PLATFORM_ANON_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (anonymous) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { platformUser?: PlatformAuthUser }>();

    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException("Panel oturumu bulunamadı. Lütfen giriş yapın.");
    }

    let payload: PlatformJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PlatformJwtPayload>(token, {
        secret: platformJwtSecret(),
        audience: PLATFORM_JWT_AUDIENCE,
      });
    } catch {
      // Tenant token'ı da, süresi dolmuş panel token'ı da buraya düşer.
      throw new UnauthorizedException(
        "Panel oturumu geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın."
      );
    }

    // Kütüphane audience'ı doğrulasa da açık kontrol bırakılır: yapılandırma
    // değişirse (audience seçeneğinin düşmesi gibi) kapı yine kapalı kalır.
    if (payload.aud !== PLATFORM_JWT_AUDIENCE) {
      throw new UnauthorizedException("Bu oturum platform paneli için geçerli değil.");
    }

    const record = await this.prisma.client.platformUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        twoFactorSecret: true,
      },
    });

    if (!record || !record.isActive) {
      throw new UnauthorizedException(
        "Panel hesabınız pasif durumda veya bulunamadı. Bir SUPER_ADMIN ile görüşün."
      );
    }

    request.platformUser = {
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      role: record.role as AdminRole,
      ip: clientIp(request),
      twoFactorReady: Boolean(record.twoFactorSecret),
    };
    return true;
  }
}

/** İstek IP'si — PlatformAuditLog'a yazılır (spec §Güvenlik 8). */
export function clientIp(request: Request): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim().slice(0, 64);
  }
  return (request.ip ?? request.socket?.remoteAddress ?? "bilinmeyen").slice(0, 64);
}
