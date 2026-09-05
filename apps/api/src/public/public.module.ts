import { Module } from "@nestjs/common";
import { HealthModule } from "../health/health.module";
import { PublicController } from "./public.controller";

/** FAZ 8A — kimliksiz kamusal uçlar (plan kataloğu, durum). */
@Module({
  imports: [HealthModule],
  controllers: [PublicController],
})
export class PublicModule {}
