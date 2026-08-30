import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { PlatformAuthUser } from "../platform.types";

/**
 * PlatformJwtGuard'ın request.platformUser'a koyduğu kimlik.
 *
 * `request.user` DEĞİL: tenant guard'ının alanı ile aynı yere yazmak, bir
 * yapılandırma hatasında platform kimliğinin tenant zincirine sızmasına
 * (ya da tersine) zemin hazırlardı. İki dünya ayrı alanda durur.
 */
export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAuthUser =>
    ctx.switchToHttp().getRequest<{ platformUser: PlatformAuthUser }>().platformUser
);
