import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { ReadinessService } from "./readiness.service";

/** Faz 4: readiness yoklaması (DB/Redis/S3). Storage ve Prisma modülleri @Global. */
@Module({
  controllers: [HealthController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class HealthModule {}
