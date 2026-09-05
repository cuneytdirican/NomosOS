import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { TwoFactorService } from "./two-factor.service";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { SsoController } from "./sso.controller";
import { SsoService } from "./sso.service";

@Module({
  controllers: [AuthController, SsoController],
  providers: [AuthService, SessionService, TwoFactorService, LoginThrottleGuard, SsoService],
  // UsersModule: yönetici 2FA sıfırlaması TwoFactorService.adminReset ile.
  exports: [TwoFactorService],
})
export class AuthModule {}
