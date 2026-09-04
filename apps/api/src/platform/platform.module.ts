import { Module } from "@nestjs/common";
import { LoginThrottleGuard } from "../auth/login-throttle.guard";
import { PlatformJwtGuard } from "./guards/platform-jwt.guard";
import { PlatformPermissionGuard } from "./guards/platform-permission.guard";
import { SupportGrantGuard } from "./guards/support-grant.guard";
import { PlatformAuditService } from "./platform-audit.service";
import { FineTuneController } from "./fine-tune/fine-tune.controller";
import { FineTuneService } from "./fine-tune/fine-tune.service";
import { CaselawPoolController } from "./caselaw-pool/caselaw-pool.controller";
import { CaselawPoolService } from "./caselaw-pool/caselaw-pool.service";
import { CaselawIngestController } from "./caselaw-ingest/caselaw-ingest.controller";
import { CaselawIngestService } from "./caselaw-ingest/caselaw-ingest.service";
import { PlatformAuthController } from "./auth/platform-auth.controller";
import { PlatformAuthService } from "./auth/platform-auth.service";
import { PlatformApprovalExecutorService } from "./approvals/platform-approval-executor.service";
import { PlatformApprovalsController } from "./approvals/platform-approvals.controller";
import { PlatformApprovalsService } from "./approvals/platform-approvals.service";
import { PlatformTenantsController } from "./tenants/platform-tenants.controller";
import { PlatformTenantsService } from "./tenants/platform-tenants.service";
import {
  PlatformPlansController,
  PlatformSubscriptionsController,
} from "./subscriptions/platform-subscriptions.controller";
import { PlatformSubscriptionsService } from "./subscriptions/platform-subscriptions.service";
import {
  PlatformInvoicesController,
  PlatformPaymentsController,
} from "./payments/platform-payments.controller";
import { PlatformPaymentsService } from "./payments/platform-payments.service";
import {
  PlatformAnnouncementsController,
  PlatformFlagsController,
  PlatformHealthController,
  PlatformSettingsController,
} from "./system/platform-system.controller";
import { PlatformHealthService } from "./system/platform-health.service";
import { PlatformSystemService } from "./system/platform-system.service";
import { PlatformMetricsController } from "./metrics/platform-metrics.controller";
import { PlatformMetricsService } from "./metrics/platform-metrics.service";
import { UsageSnapshotService } from "./metrics/usage-snapshot.service";
import { PlatformSupportController } from "./support/platform-support.controller";
import { PlatformSupportService } from "./support/platform-support.service";
import { PlatformAuditController } from "./audit/platform-audit.controller";
import { PlatformDemoRequestsController } from "./demo-requests/platform-demo-requests.controller";
import { PlatformDemoRequestsService } from "./demo-requests/platform-demo-requests.service";
import { PlatformAuditQueryService } from "./audit/platform-audit-query.service";
import { PlatformUsersController } from "./users/platform-users.controller";
import { PlatformUsersService } from "./users/platform-users.service";

/**
 * PLATFORM (SİSTEM YÖNETİM PANELİ) MODÜLÜ — docs/moduller/25.
 *
 * NomosOS'u İŞLETEN ŞİRKETİN API'sidir; kiracı uygulamasının değil.
 * Tüm uçlar `@PlatformController` ile kurulur ve şu zinciri kullanır:
 *
 *     (global) JwtAuthGuard  → @Public() ile ATLANIR (tenant zinciri)
 *     PlatformJwtGuard       → ayrı imza anahtarı + aud:"platform" + PlatformUser
 *     PlatformPermissionGuard→ yetki matrisi (apps/admin/src/lib/rbac.ts ikizi)
 *
 * BAĞIMLILIKLAR: PrismaModule, AuditModule ve StorageModule @Global'dir;
 * JwtModule `app.module.ts`'te `global: true` ile kayıtlıdır. Bu yüzden burada
 * hiçbir modül import edilmez ve `app.module.ts`'e dokunulmaz — kayıt işini
 * Entegrasyon ajanı yapar (`imports: [..., PlatformModule]`).
 *
 * NOT: `LoginThrottleGuard` tenant AuthModule'ünden SINIF olarak alınır ama
 * BURADA AYRI BİR ÖRNEK olarak sağlanır; sayaç tablosu panel girişlerine
 * özeldir, tenant girişleriyle karışmaz.
 */
@Module({
  controllers: [
    PlatformAuthController,
    PlatformTenantsController,
    PlatformSubscriptionsController,
    PlatformPlansController,
    PlatformPaymentsController,
    PlatformInvoicesController,
    PlatformApprovalsController,
    PlatformSettingsController,
    PlatformFlagsController,
    PlatformAnnouncementsController,
    PlatformHealthController,
    PlatformMetricsController,
    PlatformSupportController,
    PlatformAuditController,
    PlatformDemoRequestsController,
    PlatformUsersController,
    FineTuneController,
    CaselawPoolController,
    CaselawIngestController,
  ],
  providers: [
    PlatformJwtGuard,
    PlatformPermissionGuard,
    // denetim bulgusu Ö-06: destek erişim penceresini gerçekten kapıya bağlar.
    SupportGrantGuard,
    LoginThrottleGuard,
    PlatformAuditService,
    PlatformAuthService,
    FineTuneService,
    CaselawPoolService,
    CaselawIngestService,
    PlatformApprovalsService,
    PlatformApprovalExecutorService,
    PlatformTenantsService,
    PlatformSubscriptionsService,
    PlatformPaymentsService,
    PlatformSystemService,
    PlatformHealthService,
    PlatformMetricsService,
    UsageSnapshotService,
    PlatformSupportService,
    PlatformAuditQueryService,
    PlatformDemoRequestsService,
    PlatformUsersService,
  ],
  // UsageSnapshotService dışa açılır: Faz 6'da BullMQ repeatable job bu
  // servisi çağıracaktır (kod hazır, zamanlayıcı bağlanacak).
  //
  // PlatformApprovalsService dışa açılır: Modül 26 (CreditsModule) manuel kredi
  // tahsisi için DÖRT-GÖZ talebi açar. Yalnız TALEP açma yönü dışarı verilir;
  // onaylanan talebi uygulayan executor kimseyi geri çağırmadığı için modüller
  // arasında döngü doğmaz.
  //
  // CaselawIngestService dışa açılır: caselaw-ingest-daily zamanlanmış işi
  // (SchedulerModule) çekimi bu servisten yürütür — kaynak adresi
  // yapılandırmada, kodda sabit istemci yoktur.
  exports: [UsageSnapshotService, PlatformApprovalsService, PlatformAuditService, CaselawIngestService],
})
export class PlatformModule {}
