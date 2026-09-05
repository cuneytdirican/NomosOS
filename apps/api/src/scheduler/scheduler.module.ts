import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module";
import { PlatformJwtGuard } from "../platform/guards/platform-jwt.guard";
import { PlatformPermissionGuard } from "../platform/guards/platform-permission.guard";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { CreditsModule } from "../credits/credits.module";
import { RiskModule } from "../risk/risk.module";

import { JobRegistryService } from "./job-registry.service";
import { JobRunnerService } from "./job-runner.service";
import { SchedulerService } from "./scheduler.service";
import { NotificationOutboxService } from "./notification-outbox.service";
import { TenantRecipientsService } from "./tenant-recipients";
import { IoredisProbe, REDIS_PROBE } from "./redis-connection";
import { NoopPushProvider, PUSH_PROVIDER } from "./push/push-provider";

import { UsageSnapshotJob } from "./jobs/usage-snapshot.job";
import { DeadlineReminderJob } from "./jobs/deadline-reminder.job";
import { HearingReminderJob } from "./jobs/hearing-reminder.job";
import { SubscriptionRenewalJob } from "./jobs/subscription-renewal.job";
import { CreditPeriodRenewalJob } from "./jobs/credit-period-renewal.job";
import { CreditLowWarningJob } from "./jobs/credit-low-warning.job";
import { RiskNightlyJob } from "./jobs/risk-nightly.job";
import { HepoReminderJob } from "./jobs/hepo-reminder.job";
import { CaselawIngestJob } from "./jobs/caselaw-ingest.job";
import { KvkkKurulJob, MevzuatTohumJob, RekabetKurulJob, ResmiGazeteJob } from "./jobs/resmi-gazete.job";

import { PlatformJobsController } from "./platform-jobs.controller";
import { PlatformJobsService } from "./platform-jobs.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { DeviceTokensController } from "./device-tokens.controller";
import { DeviceTokensService } from "./device-tokens.service";

/**
 * FAZ 6 — ZAMANLANMIŞ İŞLER, BİLDİRİM KUYRUĞU VE CİHAZ JETONLARI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * BAĞIMLILIK YÖNÜ (döngü YOKTUR)
 *
 *   SchedulerModule ──▶ PlatformModule   (UsageSnapshotService — dışa açık)
 *                   └─▶ CreditsModule    (CreditService — dışa açık)
 *                   └─▶ RiskModule      (RiskNightlyService — dışa açık; F2 · E2)
 *
 *   CreditsModule ──▶ PlatformModule
 *
 * Ters yönde hiçbir ok yoktur: ne platform ne kredi modülü zamanlayıcıyı
 * tanır. Bu, "gece işi kredi tüketimini tetikler, kredi modülü de gece işini
 * çağırır" gibi bir sarmalın yapısal olarak imkânsız olması demektir.
 *
 * İŞLERİN HESAP MANTIĞI BURADA YAZILMAZ: kullanım fotoğrafı
 * `UsageSnapshotService`e, kredi dönemi `CreditService.renewPeriod`e, abonelik
 * geçiş kuralları `subscription-state.ts`e delege edilir. Zamanlayıcı yalnız
 * NE ZAMAN sorusunu yanıtlar; NE sorusunun cevabı sahibi olan modüldedir.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `PlatformJwtGuard`, `PlatformPermissionGuard` ve `PlatformAuditService`
 * burada AYRI ÖRNEK olarak sağlanır — `CreditsModule` ile birebir aynı desen.
 * Üçü de durumsuzdur (Reflector + JwtService + Prisma + AuditService, hepsi
 * global); ikinci bir örnek davranışı değiştirmez ve PlatformModule'ün dışa
 * açık yüzeyi genişletilmemiş olur.
 *
 * ENTEGRASYON: `app.module.ts` içinde CreditsModule'den SONRA eklenmelidir
 * (`imports: [..., CreditsModule, ..., SchedulerModule]`).
 * `app.module.ts` bu ajanın dosya sahipliğinde değildir; kayıt Entegrasyon
 * ajanının işidir.
 */
@Module({
  imports: [PlatformModule, CreditsModule, RiskModule],
  controllers: [
    // Platform (/api/admin/v1/jobs) — PlatformJwtGuard + yetki matrisi.
    PlatformJobsController,
    // Kiracı (/api/v1/...) — global JwtAuthGuard zinciri.
    NotificationsController,
    DeviceTokensController,
  ],
  providers: [
    // --- altyapı ---
    SchedulerService,
    JobRegistryService,
    JobRunnerService,
    NotificationOutboxService,
    TenantRecipientsService,
    /**
     * Redis yoklayıcısı ARAYÜZ ÜZERİNDEN sağlanır: birim testinde "Redis yok"
     * senaryosu, gerçek bir Redis kapatmadan reddeden bir sahte ile kurulur.
     */
    { provide: REDIS_PROBE, useClass: IoredisProbe },
    /**
     * Push sağlayıcısı: bu fazda NOOP. Gerçek FCM/APNs eklendiğinde YALNIZ bu
     * satır değişir; bildirim üreten işler ve uçlar aynı kalır.
     */
    { provide: PUSH_PROVIDER, useClass: NoopPushProvider },

    // --- işler ---
    UsageSnapshotJob,
    DeadlineReminderJob,
    HearingReminderJob,
    SubscriptionRenewalJob,
    CreditPeriodRenewalJob,
    // denetim bulgusu Ö-29: %80 kredi uyarısı üreten iş.
    CreditLowWarningJob,
    // F2 · E2: gece risk tazeleme + panel fotoğrafı.
    RiskNightlyJob,
    // Modül 28 (Faz 3): HEPO müvekkil yükümlülüğü vade hatırlatmaları.
    HepoReminderJob,
    // İçtihat toplama hattı: beslemeler → onay kuyruğu (havuza yazım onayla).
    CaselawIngestJob,
    // Mevzuat besleme hattı (Faz 1): RG izleyici + çekirdek kanun tohumu —
    // yalnızca onay kuyruğuna yazar, LegislationPoolService tek kapıdır.
    ResmiGazeteJob,
    MevzuatTohumJob,
    KvkkKurulJob,
    RekabetKurulJob,

    // --- uç servisleri ---
    PlatformJobsService,
    NotificationsService,
    DeviceTokensService,

    // --- platform kimlik/yetki zinciri (ayrı örnek) ---
    PlatformJwtGuard,
    PlatformPermissionGuard,
    PlatformAuditService,
  ],
  /**
   * `NotificationOutboxService` dışa açılır: başka modüller (görev atama,
   * onay kuyruğu, sözleşme yenileme) kendi olayları için bildirim yazarken
   * AYNI idempotentlik kapısını kullanmalıdır — ikinci bir yazım yolu,
   * `dedupeKey` sözleşmesini delen ilk yer olurdu.
   */
  exports: [NotificationOutboxService],
})
export class SchedulerModule {}
