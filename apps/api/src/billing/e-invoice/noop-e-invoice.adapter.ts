import { ServiceUnavailableException } from "@nestjs/common";
import type {
  EInvoiceAdapter,
  GibStatus,
  SendInvoiceResult,
  TaxpayerCheckResult,
  UblInvoicePayload,
} from "./e-invoice.types";

/**
 * YAPILANDIRILMAMIŞ e-FATURA ADAPTÖRÜ.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  BU ADAPTÖR HİÇBİR ŞEY GÖNDERMEZ VE HİÇBİR ŞEY TAKLİT ETMEZ.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * NEDEN SAHTE BİR "BAŞARILI" YANIT DÖNMÜYOR?
 *   Fatura, hukuki ve mali sonuç doğuran bir belgedir. `eInvoiceStatus` alanını
 *   GONDERILDI/KABUL'e çekmek, kullanıcıya "faturanız GİB'e ulaştı" demektir.
 *   Ortada gerçek bir entegratör hesabı yokken bu beyanı yapmak, kullanıcıyı
 *   vergi usul yükümlülüğü konusunda yanıltır. Bu yüzden Noop adaptör:
 *     • faturayı olduğu durumda (TASLAK / eInvoiceStatus = YOK) BIRAKIR,
 *     • hiçbir alanı değiştirmez,
 *     • ne yapılması gerektiğini söyleyen Türkçe bir 503 döndürür.
 *
 * Gerçek entegratör bağlandığında bu sınıf yerine `EInvoiceAdapter`'ı uygulayan
 * sağlayıcı sınıfı `EInvoiceService` üzerinden kaydedilir; çağrı yerleri
 * (invoices.service.ts) değişmez.
 */
export class NoopEInvoiceAdapter implements EInvoiceAdapter {
  readonly key = "noop";
  readonly isConfigured = false;

  private fail(operation: string): never {
    throw new ServiceUnavailableException({
      message:
        `e-Fatura entegratörü yapılandırılmamış; ${operation} yapılamadı. ` +
        "NomosOS GİB'e doğrudan bağlanmaz: her büro kendi özel entegratör " +
        // DOĞRULUK: adaptör faturanın durumunu BİLMEZ (kesinleşmiş bir fatura da
        // buraya düşebilir). Bilmediği bir durumu ("Fatura TASLAK durumunda")
        // beyan etmek yerine yalnızca KENDİ yaptığı şeyi söyler: hiçbir şey.
        "hesabını (Logo, Sovos, Uyumsoft vb.) tanımlamalıdır. Faturanın hiçbir " +
        "alanı değiştirilmedi; e-Fatura durumu olduğu gibi bırakıldı ve GİB'e " +
        "hiçbir belge gönderilmedi.",
      providerKey: this.key,
      configured: false,
      operation,
      remedy: "Ayarlar → e-Fatura ekranından özel entegratör hesabınızı bağlayın.",
    });
  }

  async checkTaxpayer(_vkn: string): Promise<TaxpayerCheckResult> {
    this.fail("mükellef sorgusu");
  }

  async sendInvoice(_payload: UblInvoicePayload): Promise<SendInvoiceResult> {
    this.fail("fatura gönderimi");
  }

  async getStatus(_providerRef: string): Promise<GibStatus> {
    this.fail("durum sorgusu");
  }

  async cancelInvoice(_providerRef: string, _reason: string): Promise<void> {
    this.fail("fatura iptali");
  }

  async downloadPdf(_providerRef: string): Promise<Buffer> {
    this.fail("PDF indirme");
  }
}
