import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/** PrismaModule ve AuditModule @Global olduğu için ayrıca import edilmez. */
@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
