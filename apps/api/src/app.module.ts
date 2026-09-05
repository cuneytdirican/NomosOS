import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
// Enterprise++: büro güvenlik politikası + denetim izi ekranı.
import { SecurityModule } from "./security/security.module";
// Enterprise++: API anahtarları + webhook'lar.
import { IntegrationsModule } from "./integrations/integrations.module";
import { ClientsModule } from "./clients/clients.module";
import { CasesModule } from "./cases/cases.module";
import { HearingsModule } from "./hearings/hearings.module";
import { DeadlinesModule } from "./deadlines/deadlines.module";
import { DeadlineRulesModule } from "./deadline-rules/deadline-rules.module";
import { TasksModule } from "./tasks/tasks.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { AiModule } from "./ai/ai.module";
import { StorageModule } from "./storage/storage.module";
import { PipelineModule } from "./pipeline/pipeline.module";
import { DocumentsModule } from "./documents/documents.module";
import { CaselawModule } from "./caselaw/caselaw.module";
import { AgentsModule } from "./agents/agents.module";
import { PetitionsModule } from "./petitions/petitions.module";
import { AssistantModule } from "./assistant/assistant.module";
import { EnforcementModule } from "./enforcement/enforcement.module";
import { FinanceModule } from "./finance/finance.module";
import { BillingModule } from "./billing/billing.module";
import { VekaletUcretiModule } from "./vekalet-ucreti/vekalet-ucreti.module";
import { DemoTalepModule } from "./demo-talep/demo-talep.module";
import { MailModule } from "./mail/mail.module";
import { PlatformBillingModule } from "./platform-billing/platform-billing.module";
import { ModuleAccessGuard } from "./common/guards/module-access.guard";
import { GlobalRateLimitGuard } from "./common/guards/global-rate-limit.guard";
import { RandevuModule } from "./randevu/randevu.module";
import { UyapModule } from "./uyap/uyap.module";
import { ChatModule } from "./chat/chat.module";
import { DiskQuotaModule } from "./disk-quota/disk-quota.module";
import { JudicialModule } from "./judicial/judicial.module";
import { AgendaModule } from "./agenda/agenda.module";
import { CaseExpensesModule } from "./case-expenses/case-expenses.module";
import { MediationModule } from "./mediation/mediation.module";
import { AiTrainingModule } from "./ai-training/ai-training.module";
import { LegislationModule } from "./legislation/legislation.module";
// --- Modül 28: HEPO (İSG/Çevre/Sağlık uyum hukuku) ---
import { HepoModule } from "./hepo/hepo.module";
import { MetricsModule } from "./metrics/metrics.module";
import { ConcordatoModule } from "./concordato/concordato.module";
import { PlatformModule } from "./platform/platform.module";
// --- Faz 4 modülleri ---
import { ConflictModule } from "./conflict/conflict.module";
import { ExpertModule } from "./expert/expert.module";
import { EvidenceModule } from "./evidence/evidence.module";
import { StrategyModule } from "./strategy/strategy.module";
import { SimulationModule } from "./simulation/simulation.module";
import { RiskModule } from "./risk/risk.module";
import { CreditsModule } from "./credits/credits.module";
// --- Faz 5 modülleri ---
import { PortalModule } from "./portal/portal.module";
import { CommunicationModule } from "./communication/communication.module";
import { PoaModule } from "./poa/poa.module";
import { ContractsModule } from "./contracts/contracts.module";
// --- Faz 6 modülleri ---
import { ReportsModule } from "./reports/reports.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { TenantStatusGuard } from "./common/guards/tenant-status.guard";
// Enterprise++: gizli dosya kapısı (caseId taşıyan her istekte görünürlük).
import { CaseAccessGuard } from "./common/guards/case-access.guard";

/** JWT imza anahtarı için asgari uzunluk (bayt). */
const JWT_SECRET_MIN_LENGTH = 32;

/**
 * JWT_SECRET'i zorunlu kılar ve zayıf anahtarı reddeder.
 *
 * Uygulama, anahtar yoksa ya da çok kısaysa AÇILMAZ. Sessizce bilinen bir
 * anahtarla çalışmaktansa hizmet vermemek tercih edilir: bu anahtar tüm
 * çok-kiracılı izolasyonun tek dayanağıdır.
 */
function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>("JWT_SECRET")?.trim();
  if (!secret) {
    throw new Error(
      "JWT_SECRET tanımlı değil. API başlatılamaz: imza anahtarı olmadan oturum güvenliği " +
        "ve büro (tenant) izolasyonu sağlanamaz. .env dosyanıza en az " +
        `${JWT_SECRET_MIN_LENGTH} karakterlik rastgele bir JWT_SECRET ekleyin.`
    );
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET en az ${JWT_SECRET_MIN_LENGTH} karakter olmalıdır (şu an ${secret.length}). ` +
        "Kısa anahtar kaba kuvvetle çözülebilir; tüm büroların verisi risk altına girer."
    );
  }
  return secret;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // GÜVENLİK: sabit yedek anahtar KALDIRILDI.
        // Kaynak koda gömülü bir yedek anahtar, env değişkeni tanımsız kaldığında
        // (eksik .env, hatalı deploy) saldırganın istediği tenantId/role ile token
        // üretmesine ve tüm tenant izolasyonunu geçersiz kılmasına imkân veriyordu.
        secret: requireJwtSecret(config),
        signOptions: { expiresIn: "12h" },
      }),
    }),
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    UsersModule,
    SecurityModule,
    IntegrationsModule,
    ClientsModule,
    CasesModule,
    HearingsModule,
    DeadlineRulesModule,
    DeadlinesModule,
    TasksModule,
    DashboardModule,
    AiModule,
    // --- Faz 2 modülleri ---
    // StorageModule @Global'dir; yine de açıkça kaydedilir ki S3 istemcisi
    // uygulama açılışında (onModuleInit → ensureBucket) kurulsun.
    StorageModule,
    // Hat, belge yüklemesiyle tetiklenir; DocumentsModule zaten import eder,
    // ancak açık kayıt bağımlılık sırasını okunur kılar.
    PipelineModule,
    DocumentsModule,
    // PetitionsModule → CaselawModule (tek yönlü). Caselaw önce gelir.
    CaselawModule,
    PetitionsModule,
    AssistantModule,
    // F2 · E1 — ajan izi. @Global'dir: AiRunnerService ve AssistantLlmService
    // AgentRunService'i modül import etmeden alır; her LLM çağrısı izler.
    AgentsModule,
    // --- Faz 3 modülleri ---
    // İcra (Modül 05). CaselawModule'den SONRA: ortak BYO-LLM koşu
    // yürütücüsünü (AiRunnerService) oradan alır.
    EnforcementModule,
    // Finans (Modül 08) → AssistantModule (LLM rota çözümü + KVKK kapısı).
    FinanceModule,
    // Faturalama (Modül 09) → FinanceModule. Sıra bu yüzden bağlayıcıdır.
    BillingModule,
    // D7 (rakip analizi) — AAÜT vekalet ücreti hesabı. Motor legal-core'tadır.
    VekaletUcretiModule,
    // Demo talepleri (pazarlama formu → DemoRequest kaydı; panel izler).
    DemoTalepModule,
    MailModule,
    RandevuModule,
    // UYAP Köprüsü arka ucu (docs/05-uyap-entegrasyonu.md).
    UyapModule,
    // Büro içi mesajlaşma (WhatsApp tarzı) — presence, ekler, video arama.
    ChatModule,
    // Disk kotası — plan dahil + satın alınan; yükleme kapısı.
    DiskQuotaModule,
    // Yargı organları + noterler — referans katalog (formlarda seçim listesi).
    JudicialModule,
    // Birleşik ajanda — duruşma/randevu/süre/görev tek takvimde.
    AgendaModule,
    // Dosya giderleri (A1) — harç/bilirkişi/tebligat; İİK m.202 iade hesabı.
    CaseExpensesModule,
    // Arabuluculuk süreci (A2) — ANLASMA_YOK'ta 6325 m.18 dava süresi üretir.
    MediationModule,
    // AI eğitim verisi (C3) — opt-in kiracı, maskeli örnekler, JSONL dışa aktarım.
    AiTrainingModule,
    // Mevzuat kütüphanesi (D3 / A4) — büronun kendi yüklediği metinler,
    // tam metin arama; RG otomatik senkron YOKTUR (vaat kısıtı).
    LegislationModule,
    HepoModule,
    // İzleme metrikleri (D3 / C6) — GET /metrics, Prometheus metin biçimi.
    MetricsModule,
    // Konkordato/iflas süreç takibi (D4 / A6) — şerit denetimli aşamalar.
    ConcordatoModule,
    // Platform yönetim paneli (Modül 25).
    // AYRI DÜNYA: kendi kimlik tablosu (PlatformUser), kendi imza anahtarı,
    // kendi audience'ı (`aud: "platform"`) ve kendi yol öneki (/api/admin/v1).
    // Kiracı JwtAuthGuard'ı bu uçlarda @Public() ile atlanır; yerine
    // PlatformJwtGuard + PlatformPermissionGuard devreye girer.
    PlatformModule,
    // --- Faz 4 modülleri ---
    // Altısı da CaselawModule'den SONRA gelir: ortak BYO-LLM koşu yürütücüsünü
    // (AiRunnerService) + CitationVerifyService'i oradan alırlar.
    // Çıkar çatışması (Modül 11) — çekirdeği deterministik, AI opsiyonel.
    ConflictModule,
    // Bilirkişi (Modül 13) → CaselawModule + DeadlineRulesModule (HMK m.281).
    ExpertModule,
    // Delil yönetimi (Modül 14). EvidenceMatrixService'i dışa aktarır; risk ve
    // strateji aynı deterministik "desteksiz iddia" hesabını okur.
    EvidenceModule,
    // Strateji motoru (Modül 15).
    StrategyModule,
    // Simülasyon modları (Modül 16) → StrategyModule. Sıra bağlayıcıdır.
    SimulationModule,
    // Risk motoru (Modül 17). Strateji/simülasyon verisini Prisma'dan SAYAR,
    // o modülleri import ETMEZ — böylece döngü oluşmaz.
    RiskModule,
    // AI kota ve kredi sistemi (Modül 26).
    // PlatformModule'den SONRA: elle kredi düzeltmesi dört-göz onayı ister.
    // Kredi kapısı (CreditsInterceptor) bu modül tarafından APP_INTERCEPTOR
    // olarak sağlanır; yani GLOBAL'dir ama yalnız @AiCredits() metadata'sı
    // taşıyan uçlarda iş yapar. Modül bazlı kurulum yanlış olurdu: sarmalanan
    // 18 uç sekiz ayrı modüle dağılmış durumda ve her birine ayrı ayrı
    // interceptor bağlamak, yeni bir AI ucu eklendiğinde sessizce ücretsiz
    // kalmasına yol açardı. Global kapı + açık dekoratör, "unutulursa
    // ücretlendirilmez" hatasını tek bir görünür satıra indirger.
    CreditsModule,
    // Faz 3 — gelir hattı (abonelik faturası, checkout, kupon). CreditsModule ve
    // BillingModule'den SONRA.
    PlatformBillingModule,
    // --- Faz 5 modülleri ---
    // İletişim merkezi (Modül 19). CaselawModule'den SONRA: MESSAGE_DRAFT ve
    // MESSAGE_CASE_MATCH koşuları ortak AiRunnerService üzerinden gider.
    CommunicationModule,
    // Vekaletname (Modül 12) — POA_SCOPE_ANALYSIS. CaselawModule'den SONRA.
    PoaModule,
    // Sözleşme + e-imza (Modül 20) — CONTRACT_REVIEW. CaselawModule'den SONRA.
    ContractsModule,
    // Müvekkil portalı (Modül 10) — ÜÇÜNCÜ KİMLİK EVRENİ.
    // Büro (`aud: "tenant"`) ve platform (`aud: "platform"`) dünyalarından
    // ayrıdır: kendi tablosu (PortalUser), kendi türetilmiş imza anahtarı ve
    // kendi audience'ı (`aud: "portal"`) vardır. Uçları `@Public()` olduğu için
    // global JwtAuthGuard zincirini atlar; yerine controller düzeyinde
    // PortalJwtGuard + PortalRateLimitGuard çalışır (bkz.
    // portal/decorators/portal-controller.decorator.ts).
    //
    // EN SONA konur: portalda AI çağrısı yoktur, bu yüzden kredi kapısına
    // bağımlı değildir; sırası yalnızca okunabilirlik içindir.
    PortalModule,
    // --- Faz 6 modülleri ---
    // Kurumsal raporlama (Modül 18/25 kesişimi).
    // AssistantModule'den SONRA: rapor yorumu (REPORT_INTERPRET) ortak
    // AssistantLlmService üzerinden gider; CreditsModule'den SONRA: uç
    // @AiCredits("REPORT_INTERPRET") ile sarmalanmıştır ve global kredi
    // interceptor'ı zaten kurulu olmalıdır.
    ReportsModule,
    // Zamanlanmış işler + bildirim giden kutusu + cihaz jetonları.
    // CreditsModule ve PlatformModule'den SONRA gelmek ZORUNDADIR:
    // kredi dönemi yenilemesi CreditService'i, kullanım fotoğrafı
    // UsageSnapshotService'i (PlatformModule) enjekte eder.
    //
    // NOT: `@nestjs/schedule` (ScheduleModule.forRoot) KULLANILMAZ ve
    // BİLEREK eklenmemiştir. Zamanlama BullMQ'nun tekrarlayan iş
    // planlayıcısıyla (Redis) yapılır; @nestjs/schedule süreç-içi bir
    // zamanlayıcıdır ve API birden fazla örnekle (replica) çalıştığında
    // AYNI gece işi her örnekte bir kez tetiklenir — bildirimler ve kredi
    // dönemi yenilemesi çoğa katlanırdı. BullMQ'da iş tek kuyruğa yazılır,
    // tek worker alır. Redis yoksa SchedulerService zarifçe devre dışı
    // kalır (API yine açılır), bkz. scheduler.service.ts.
    SchedulerModule,
  ],
  /**
   * GUARD SIRASI ÖNEMLİDİR — dizideki sıra çalışma sırasıdır.
   *
   * 1. `JwtAuthGuard`   → kimliği doğrular ve `request.user`'ı KURAR.
   * 2. `TenantStatusGuard` → o kimliğin bürosunun aboneliği askıda/iptal mi,
   *    bakım tam kilidi açık mı diye bakar. `request.user`'a ihtiyaç duyduğu
   *    için kimlik guard'ından SONRA gelmek zorundadır.
   */
  providers: [
    // 0. Faz 4: kaba global oran sınırı (IP/kullanıcı, dakikalık) — kimlikten önce.
    { provide: APP_GUARD, useClass: GlobalRateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantStatusGuard },
    // 2b. Faz 3: plan modülü kapısı (@RequiresModule) — abonelik durumundan sonra.
    { provide: APP_GUARD, useClass: ModuleAccessGuard },
    // 3. `CaseAccessGuard` → istek bir dosyaya işaret ediyorsa (rota/sorgu/gövde
    //    caseId, /cases/:id) kullanıcının o dosyayı GÖREBİLDİĞİNİ doğrular
    //    (gizli dosya). `request.user` gerektiği için kimlik guard'ından sonra.
    { provide: APP_GUARD, useClass: CaseAccessGuard },
  ],
})
export class AppModule {}
