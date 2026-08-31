import { Module, forwardRef } from "@nestjs/common";
import { CaselawModule } from "../caselaw/caselaw.module";
import { PortalModule } from "../portal/portal.module";
import { ChannelProviderRegistry } from "./channel-providers";
import {
  CommunicationsController,
  InboundMessagesController,
  MessageTemplatesController,
  OutboundMessagesController,
} from "./communication.controller";
import { CommunicationService } from "./communication.service";
import { InboundService } from "./inbound.service";
import { MessageTemplateService } from "./message-templates.service";
import { OutboundAiService } from "./outbound-ai.service";
import { OutboundService } from "./outbound.service";

/**
 * Müvekkil İletişim Merkezi (Modül 19).
 *
 * BAĞIMLILIK: `CaselawModule` → ortak BYO-LLM koşu yürütücüsü `AiRunnerService`
 * (KVKK kapısı + output-guard + AiUsageLog). Modülün ÇEKİRDEĞİ AI'sız çalışır:
 * iletişim kaydı, şablon çözümü, onay hattı, gönderim ve deterministik
 * eşleştirme için hiçbir sağlayıcıya ihtiyaç yoktur. AI iki noktada,
 * OPSİYONEL olarak devreye girer (MESSAGE_DRAFT, MESSAGE_CASE_MATCH).
 *
 * ENTEGRASYON NOTLARI (app.module.ts — Entegrasyon ajanının işi):
 *   - Bu modül `CaselawModule`'den SONRA import edilmelidir.
 *   - `packages/shared/src/ai-task-types.ts`'e MESSAGE_DRAFT ve
 *     MESSAGE_CASE_MATCH eklendi (kredi dekoratörü tipli olduğu için zorunluydu);
 *     `AiTaskCost` satırları seed'de zaten mevcuttu.
 *   - Yeni npm bağımlılığı YOKTUR: gerçek kanal entegrasyonu (SMTP/SMS/WhatsApp)
 *     eklenene kadar hiçbir istemci kütüphanesi gerekmez.
 */
@Module({
  /**
   * `PortalModule` — PORTAL kanalından gönderilen mesajın portal görünürlüğü
   * `PortalPublicationService` üzerinden yazılır. Görünürlük kuralı İKİ YERDE
   * yorumlanmamalıdır: bu modül kayıt üretir, görünürlüğe portal karar verir
   * (bkz. channel-providers.ts sözleşmesi). Modül grafiği döngüseldir
   * (portal → iletişim bağı da vardır), sağlayıcılar döngüsel DEĞİLDİR.
   */
  imports: [CaselawModule, forwardRef(() => PortalModule)],
  controllers: [
    CommunicationsController,
    MessageTemplatesController,
    OutboundMessagesController,
    InboundMessagesController,
  ],
  providers: [
    CommunicationService,
    MessageTemplateService,
    OutboundService,
    OutboundAiService,
    InboundService,
    ChannelProviderRegistry,
  ],
  // `CommunicationService` dışa aktarılır: Müvekkil Portalı modülü, portaldan
  // gelen mesajı `InboundMessage`/`CommunicationLog` olarak düşürebilsin
  // (ortak karar: portal yazar, iletişim merkezi okur/işler).
  exports: [CommunicationService, InboundService],
})
export class CommunicationModule {}
