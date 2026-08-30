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
}

/** Guard'ın request.user'a koyduğu kimlik bilgisi. */
export interface AuthUser {
  userId: string;
  tenantId: string;
  role: UserRole;
}
