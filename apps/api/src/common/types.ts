import type { UserRole } from "@nomosos/shared";

/** JWT payload — { sub, tenantId, role, aud }. */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  /**
   * Audience — kiracı token'ında daima `TENANT_JWT_AUDIENCE` ("tenant").
   * Platform paneli token'ı `aud: "platform"` taşır ve bu guard'a giremez.
   * Alan `?` işaretlidir çünkü imzalama sırasında `signAsync`'in `audience`
   * seçeneğiyle konur, gövdede elle yazılmaz.
   */
  aud?: string;
  /**
   * Token üretim anı (saniye). `jsonwebtoken` otomatik koyar.
   *
   * `JwtAuthGuard` bunu `User.sessionsValidFrom` ile karşılaştırıp oturum
   * iptalini uygular (denetim bulguları K-03 / Ö-34).
   */
  iat?: number;
}

/** Guard'ın request.user'a koyduğu kimlik bilgisi. */
export interface AuthUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  /** Enterprise++: istek API anahtarıyla geldiyse (salt-okunur, kapsamlı). */
  apiKeyId?: string;
}
