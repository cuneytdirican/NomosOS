import { Injectable, Logger } from "@nestjs/common";
import { NoopEInvoiceAdapter } from "./noop-e-invoice.adapter";
import type { EInvoiceAdapter } from "./e-invoice.types";

/**
 * ADAPTÖR ÇÖZÜCÜ.
 *
 * Tenant başına sağlayıcı yapılandırması (`EInvoiceProviderConfig`) henüz
 * şemada YOKTUR — bu faz için kasıtlıdır: kimlik bilgisi saklayacak bir alan
 * uydurmak, şifreleme ve KVKK sözleşmesi olmadan sır saklamak demek olurdu.
 * Bu yüzden çözüm şimdilik süreç düzeyindedir:
 *
 *   EINVOICE_PROVIDER ortam değişkeni → kayıtlı adaptör
 *   tanımsız / bilinmeyen değer       → NoopEInvoiceAdapter
 *
 * Yeni bir sağlayıcı eklemek için `register()` çağrılır; `invoices.service.ts`
 * hiç değişmez. Sağlayıcı kimlik bilgileri ASLA API yanıtına veya denetim
 * kaydına yazılmaz (Modül 09, iş kuralı 10) — bu sınıf yalnızca `key` ve
 * `isConfigured` bilgisini dışa verir.
 */
@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);
  private readonly adapters = new Map<string, EInvoiceAdapter>();
  private readonly noop = new NoopEInvoiceAdapter();

  constructor() {
    this.adapters.set(this.noop.key, this.noop);
  }

  /** Gerçek entegratör implementasyonları burada kaydedilir. */
  register(adapter: EInvoiceAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  /** Tenant için etkin adaptör. Şu an süreç genelinde tektir. */
  resolve(_tenantId: string): EInvoiceAdapter {
    const key = process.env.EINVOICE_PROVIDER?.trim().toLowerCase();
    if (!key || key === "noop") return this.noop;

    const adapter = this.adapters.get(key);
    if (!adapter) {
      this.logger.warn(
        `EINVOICE_PROVIDER="${key}" için kayıtlı adaptör yok; yapılandırılmamış ` +
          "(noop) adaptöre düşüldü. Hiçbir belge gönderilmeyecek.",
      );
      return this.noop;
    }
    return adapter;
  }

  /** Ayar ekranı için güvenli özet — kimlik bilgisi İÇERMEZ. */
  describe(tenantId: string): { providerKey: string; configured: boolean; note: string } {
    const adapter = this.resolve(tenantId);
    return {
      providerKey: adapter.key,
      configured: adapter.isConfigured,
      note: adapter.isConfigured
        ? "Özel entegratör bağlı."
        : "e-Fatura entegratörü yapılandırılmamış. Faturalar NomosOS içinde " +
          "kesilebilir ancak GİB'e gönderilemez; e-Fatura durumu YOK olarak kalır.",
    };
  }
}
