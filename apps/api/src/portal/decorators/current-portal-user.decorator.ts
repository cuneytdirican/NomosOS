import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { PortalAuthUser } from "../portal.types";

/**
 * PortalJwtGuard'ın `request.portalUser`'a koyduğu kimlik.
 *
 * `request.user` DEĞİL: büro guard'ının alanına yazmak, bir yapılandırma
 * hatasında portal kimliğinin büro zincirine (ya da tersine) sızmasına zemin
 * hazırlardı. Üç dünya üç ayrı alanda durur:
 *   request.user · request.platformUser · request.portalUser
 */
export const CurrentPortalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalAuthUser =>
    ctx.switchToHttp().getRequest<{ portalUser: PortalAuthUser }>().portalUser
);
