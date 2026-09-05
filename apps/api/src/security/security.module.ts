import { Module } from "@nestjs/common";
import { SecurityController } from "./security.controller";
import { SecurityService } from "./security.service";
import { KvkkController } from "./kvkk.controller";
import { KvkkService } from "./kvkk.service";

/**
 * Büro güvenlik politikası + denetim izi (Enterprise++). Bağımlılık yok:
 * PrismaModule/AuditModule @Global'dir.
 */
@Module({
  controllers: [SecurityController, KvkkController],
  providers: [SecurityService, KvkkService],
  // KvkkService: aylık saklama denetimi işi (SchedulerModule).
  exports: [SecurityService, KvkkService],
})
export class SecurityModule {}
