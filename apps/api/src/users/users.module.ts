import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { AuthModule } from "../auth/auth.module";

/**
 * PrismaModule ve AuditModule @Global olduğu için ayrıca import edilmez.
 * AuthModule: yönetici 2FA sıfırlaması (TwoFactorService.adminReset).
 */
@Module({ imports: [AuthModule], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
