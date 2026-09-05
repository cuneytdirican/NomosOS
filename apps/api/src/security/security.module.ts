import { Module } from "@nestjs/common";
import { SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";

/**
 * Büro güvenlik politikası + denetim izi (Enterprise++). Bağımlılık yok:
 * PrismaModule/AuditModule @Global'dir.
 */
@Module({
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
