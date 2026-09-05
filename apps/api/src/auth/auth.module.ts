import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { TwoFactorService } from "./two-factor.service";
import { LoginThrottleGuard } from "./login-throttle.guard";
import { SsoController } from "./sso.controller";
import { SsoService } from "./sso.service";
import { SessionsController } from "./sessions.controller";
import { UserSessionsService } from "./user-sessions.service";

@Module({
  controllers: [AuthController, SsoController, SessionsController],
  providers: [AuthService, SessionService, TwoFactorService, LoginThrottleGuard, SsoService, UserSessionsService],
  // UsersModule: yönetici 2FA sıfırlaması (TwoFactorService.adminReset) + kullanıcı
  // oturum listesi (UserSessionsService). SchedulerModule: oturum kaydı temizliği.
  exports: [TwoFactorService, UserSessionsService],
})
export class AuthModule {}
