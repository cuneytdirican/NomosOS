import { Module, forwardRef } from "@nestjs/common";
import { CommunicationModule } from "../communication/communication.module";
import { PortalAdminController } from "./portal-admin.controller";
import { PortalAdminService } from "./portal-admin.service";
import { PortalAuditService } from "./portal-audit.service";
import { PortalAuthController } from "./portal-auth.controller";
import { PortalAuthService } from "./portal-auth.service";
import { PortalDataController } from "./portal.controller";
import { PortalPublicationService } from "./portal-publication.service";
import { PortalService } from "./portal.service";
import { PortalJwtGuard } from "./guards/portal-jwt.guard";
import { PortalRateLimitGuard } from "./guards/portal-rate-limit.guard";
import { PortalAuditInterceptor } from "./interceptors/portal-audit.interceptor";
import { RandevuModule } from "../randevu/randevu.module";

/**
 * MÜVEKKİL PORTALI (Modül 10) — İKİ YÜZLÜ TEK MODÜL.
 *
 * ┌── Portal yüzü ────────────────────────────────────────────────────────┐
 * │ /api/v1/portal/**        PortalUser kimliği (aud: "portal")           │
 * │ PortalAuthController · PortalDataController                           │
 * │ Büro guard'ı @Public() ile atlanır, yerine PortalJwtGuard gelir.      │
 * └───────────────────────────────────────────────────────────────────────┘
 * ┌── Büro yüzü ──────────────────────────────────────────────────────────┐
 * │ /api/v1/portal-admin/**  Büro User kimliği (aud: "tenant")            │
 * │ PortalAdminController — global büro zinciri aynen uygulanır.          │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * İki yüz aynı modülde yaşar çünkü ORTAK BİR DOĞRUYU paylaşırlar:
 * `PortalPublicationService`. Avukatın "yayınla" kararıyla müvekkilin
 * "görebilir mi?" sorusu aynı kodu okur; iki ayrı modülde iki ayrı görünürlük
 * yorumu doğması, portalın en tehlikeli hata sınıfı olurdu.
 *
 * BAĞIMLILIKLAR: PrismaModule, AuditModule ve StorageModule @Global'dir;
 * ayrıca import edilmezler. JwtModule `app.module.ts` içinde `global: true`
 * kayıtlıdır — portal kendi imza anahtarını her çağrıda `secret` seçeneğiyle
 * geçirir, yani global anahtarı KULLANMAZ.
 *
 * ENTEGRASYON: bu modülün çalışması için `app.module.ts`'in `imports`
 * dizisine `PortalModule` eklenmesi yeterlidir. `main.ts`'e dokunulmaz —
 * portal uçları global önekin (`api/v1`) ALTINDA yaşar.
 */
@Module({
  /**
   * İKİ YÖNLÜ BAĞ — bilinçli ve dar.
   *
   *   portal → iletişim : müvekkilin portaldan yazdığı mesaj `InboundService`
   *                       üzerinden açılır (mükerrerlik + deterministik
   *                       eşleştirme tek yerde kalsın).
   *   iletişim → portal : PORTAL kanalından gönderilen mesaj için allow-list
   *                       satırı `PortalPublicationService` üzerinden açılır
   *                       (görünürlük kararı tek yerde kalsın).
   *
   * Sağlayıcılar arasında döngü YOKTUR (`PortalPublicationService` iletişimi,
   * `InboundService` portalı bilmez); yalnız modül grafiği döngüseldir ve
   * `forwardRef` tam olarak bunun içindir.
   */
  imports: [forwardRef(() => CommunicationModule), RandevuModule],
  controllers: [PortalAuthController, PortalDataController, PortalAdminController],
  providers: [
    PortalAuthService,
    PortalService,
    PortalAdminService,
    PortalPublicationService,
    PortalAuditService,
    // Guard ve interceptor'lar PROVIDER olarak kaydedilir: `@UseGuards(Class)`
    // ile kullanıldıklarında Nest bunları modül enjektöründen çözer ve
    // TEK ÖRNEK olarak paylaşır. Hız sınırlayıcının sayaç tablosu bu yüzden
    // controller'lar arasında ortaktır (her istekte yeni örnek yaratılsaydı
    // sınırlama hiç çalışmazdı) ve controller içinden `reset()` çağrılabilir.
    PortalRateLimitGuard,
    PortalJwtGuard,
    PortalAuditInterceptor,
  ],
  exports: [PortalPublicationService],
})
export class PortalModule {}
