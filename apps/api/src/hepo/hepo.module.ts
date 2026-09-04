/**
 * HEPO modülü (Modül 28) — İSG/Çevre/Sağlık uyum hukuku takibi.
 */

import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { HepoController } from "./hepo.controller";
import { HepoService } from "./hepo.service";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [HepoController],
  providers: [HepoService],
  exports: [HepoService],
})
export class HepoModule {}
