import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";

/** PrismaModule @Global olduğu için ayrıca import edilmez. */
@Module({ controllers: [UsersController] })
export class UsersModule {}
