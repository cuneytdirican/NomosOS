import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module";
import { BillingController } from "./billing.controller";
import { OdemeLinkiController } from "./odeme-linki.controller";
import { OdemeLinkiService } from "./odeme-linki.service";
import { OdemeSaglayici } from "./odeme-saglayici";
import { FeeAgreementsService } from "./fee-agreements.service";
import { TimeEntriesService } from "./time-entries.service";
import { InvoicesService } from "./invoices.service";
import { PaymentsService } from "./payments.service";
import { InvoiceNumberService } from "./invoice-number.service";
import { EInvoiceService } from "./e-invoice/e-invoice.service";
import { TimeTimerService } from "./time-timer.service";

/**
 * Modül 09 — Faturalama, e-Fatura / e-Arşiv.
 *
 * ENTEGRASYON: bu modülü `AppModule.imports` listesine, `FinanceModule`'den
 * SONRA ekleyin (kaydı Entegrasyon ajanı yapar).
 *
 * `FinanceModule` yalnızca ortak para/rol yardımcıları ve finans servisinin
 * yeniden kullanımı içindir; faturalama, finans hareketlerini doğrudan Prisma
 * üzerinden ve daima aynı işlem (transaction) içinde yazar.
 *
 * `EInvoiceService` süreç düzeyinde adaptör çözer; varsayılan
 * `NoopEInvoiceAdapter`'dır ve GİB'e hiçbir bağlantı kurmaz.
 */
@Module({
  imports: [FinanceModule],
  controllers: [BillingController, OdemeLinkiController],
  providers: [
    FeeAgreementsService,
    TimeEntriesService,
    InvoicesService,
    PaymentsService,
    InvoiceNumberService,
    EInvoiceService,
    // E8 (rakip analizi) — portal ödeme bağlantısı.
    OdemeSaglayici,
    OdemeLinkiService,
    // Faz 6: kronometre.
    TimeTimerService,
  ],
  // Faz 3: PlatformBillingModule (checkout) OdemeSaglayici'yi kullanır.
  exports: [FeeAgreementsService, InvoicesService, TimeEntriesService, EInvoiceService, OdemeLinkiService, OdemeSaglayici],
})
export class BillingModule {}
