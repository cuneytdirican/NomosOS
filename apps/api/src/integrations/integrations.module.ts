import { Module } from "@nestjs/common";
import { ApiKeysService } from "./api-keys.service";
import { IntegrationsController } from "./integrations.controller";
import { WebhooksService } from "./webhooks.service";

/**
 * Entegrasyonlar (Enterprise++): API anahtarları + webhook'lar.
 * WebhooksService açılışta AuditService'e abone olur (olay kaynağı denetim izi).
 * PrismaModule/AuditModule @Global'dir.
 */
@Module({
  controllers: [IntegrationsController],
  providers: [ApiKeysService, WebhooksService],
  // WebhooksService: dağıtım işi (SchedulerModule).
  exports: [ApiKeysService, WebhooksService],
})
export class IntegrationsModule {}
