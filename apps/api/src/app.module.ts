import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
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
import { PetitionsModule } from "./petitions/petitions.module";
import { AssistantModule } from "./assistant/assistant.module";
import { EnforcementModule } from "./enforcement/enforcement.module";
import { FinanceModule } from "./finance/finance.module";
import { BillingModule } from "./billing/billing.module";
import { PlatformModule } from "./platform/platform.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { TenantStatusGuard } from "./common/guards/tenant-status.guard";

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
    // --- Faz 3 modülleri ---
    // İcra (Modül 05). CaselawModule'den SONRA: ortak BYO-LLM koşu
    // yürütücüsünü (AiRunnerService) oradan alır.
    EnforcementModule,
    // Finans (Modül 08) → AssistantModule (LLM rota çözümü + KVKK kapısı).
    FinanceModule,
    // Faturalama (Modül 09) → FinanceModule. Sıra bu yüzden bağlayıcıdır.
    BillingModule,
    // Platform yönetim paneli (Modül 25).
    // AYRI DÜNYA: kendi kimlik tablosu (PlatformUser), kendi imza anahtarı,
    // kendi audience'ı (`aud: "platform"`) ve kendi yol öneki (/api/admin/v1).
    // Kiracı JwtAuthGuard'ı bu uçlarda @Public() ile atlanır; yerine
    // PlatformJwtGuard + PlatformPermissionGuard devreye girer.
    PlatformModule,
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantStatusGuard },
  ],
})
export class AppModule {}
