import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginThrottleGuard } from "./login-throttle.guard";

@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginThrottleGuard],
})
export class AuthModule {}
