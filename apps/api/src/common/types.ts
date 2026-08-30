import type { UserRole } from "@nomosos/shared";

/** JWT payload — { sub, tenantId, role }. */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
}

/** Guard'ın request.user'a koyduğu kimlik bilgisi. */
export interface AuthUser {
  userId: string;
  tenantId: string;
  role: UserRole;
}
