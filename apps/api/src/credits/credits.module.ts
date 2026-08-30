import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import { PlatformModule } from "../platform/platform.module";
import { PlatformJwtGuard } from "../platform/guards/platform-jwt.guard";
import { PlatformPermissionGuard } from "../platform/guards/platform-permission.guard";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { BillingModeService } from "./billing-mode.service";
import { CreditService } from "./credit.service";
import { CreditsController } from "./credits.controller";
import { CreditsInterceptor } from "./credits.interceptor";
import { CreditsStartupService } from "./credits-startup.service";
import { ModelPriceService } from "./model-price.service";
import {
  PlatformCreditsController,
  PlatformModelPricesController,
} from "./platform-credits.controller";
import { PlatformCreditsService } from "./platform-credits.service";

/**
 * MODÜL 26 — AI KOTA VE KREDİ SİSTEMİ.
 *
 * NEDEN `APP_INTERCEPTOR`: kredi kapısı bir uç kümesine değil, `@AiCredits()`
 * taşıyan HER uca uygulanmalıdır. Nest'te bir modül `APP_INTERCEPTOR` sağlarsa
 * interceptor GLOBAL olarak devreye girer; böylece `app.module.ts`'e
 * DOKUNULMADAN (yalnız bu modül `imports` listesine eklenerek) bütün AI uçları
 * sarmalanır. Metadata taşımayan uçlarda interceptor hiçbir iş yapmadan geçer.
 *
 * BAĞIMLILIK YÖNÜ: CreditsModule → PlatformModule (dört-göz onay talebi için).
 * TERSİ YOKTUR ve olmamalıdır: onaylanan talebi uygulayan
 * `PlatformApprovalExecutorService` yalnız Prisma'yı tanır, kredi servisini
 * çağırmaz — bu, iki modül arasında döngü doğmasını yapısal olarak engeller.
 *
 * `PlatformJwtGuard`, `PlatformPermissionGuard` ve `PlatformAuditService` burada
 * AYRI ÖRNEK olarak sağlanır: üçü de durumsuzdur (Reflector + JwtService +
 * Prisma + AuditService — hepsi global) ve yalnız satır yazarlar. İkinci bir
 * örnek davranışı değiştirmez; buna karşılık PlatformModule'ün dışa açık
 * yüzeyi tek bir servisle (onay talebi) sınırlı kalır.
 *
 * ENTEGRASYON: `app.module.ts` içinde PlatformModule'den SONRA eklenmelidir.
 */
@Module({
  // `DiscoveryModule`: açılışta `@AiCredits` taşıyan handler'ları tarayıp
  // fiyat satırı olmayan görev tiplerini raporlamak için (bkz.
  // CreditsStartupService). Yalnız okur, hiçbir davranışı değiştirmez.
  imports: [PlatformModule, DiscoveryModule],
  controllers: [CreditsController, PlatformCreditsController, PlatformModelPricesController],
  providers: [
    CreditService,
    CreditsStartupService,
    BillingModeService,
    ModelPriceService,
    PlatformCreditsService,
    PlatformJwtGuard,
    PlatformPermissionGuard,
    PlatformAuditService,
    { provide: APP_INTERCEPTOR, useClass: CreditsInterceptor },
  ],
  exports: [CreditService, BillingModeService, ModelPriceService],
})
export class CreditsModule {}
