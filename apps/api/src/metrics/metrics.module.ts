/** İzleme metrikleri modülü (D3 / C6) — Prometheus metin biçimi. */

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MetricsController } from "./metrics.controller";
import { PipelineModule } from "../pipeline/pipeline.module";

@Module({
  // Faz 4: kuyruk derinliği için PipelineQueueService (opsiyonel enjeksiyon).
  imports: [PrismaModule, PipelineModule],
  controllers: [MetricsController],
})
export class MetricsModule {}
