import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module";
import { PlatformJwtGuard } from "../platform/guards/platform-jwt.guard";
import { PlatformPermissionGuard } from "../platform/guards/platform-permission.guard";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { CreditsModule } from "../credits/credits.module";
import { BillingModule } from "../billing/billing.module";
import { CouponService } from "./coupon.service";
import { PlatformCheckoutService } from "./platform-checkout.service";
import { SubscriptionInvoiceService } from "./subscription-invoice.service";
import { SubscriptionController } from "./subscription.controller";
import {
  PlatformCouponsController,
  PlatformInvoiceSettlementController,
  PlatformSubscriptionInvoiceController,
} from "./platform-billing.controller";

/**
 * GELİR HATTI (Faz 3): abonelik faturası, checkout/kesinleştirme, kupon.
 * `SchedulerModule` (dönem faturası + dunning) ve `PlatformModule` executor'ı
 * (pro-rata) bu modülün servislerini kullanır; modül kendisi SchedulerModule'ü
 * İÇE ALMAZ (döngü yok).
 */
@Module({
  imports: [PlatformModule, CreditsModule, BillingModule],
  controllers: [SubscriptionController, PlatformCouponsController, PlatformInvoiceSettlementController, PlatformSubscriptionInvoiceController],
  providers: [CouponService, PlatformCheckoutService, SubscriptionInvoiceService, PlatformJwtGuard, PlatformPermissionGuard, PlatformAuditService],
  exports: [CouponService, PlatformCheckoutService, SubscriptionInvoiceService],
})
export class PlatformBillingModule {}
