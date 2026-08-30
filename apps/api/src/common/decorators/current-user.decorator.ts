import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "../types";

/** Guard'ın request.user'a koyduğu { userId, tenantId, role } bilgisini verir. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return request.user;
});
