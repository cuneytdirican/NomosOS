import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@nomosos/ai";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../common/types";
import { NoopEInvoiceAdapter } from "./noop-e-invoice.adapter";
import { RestEInvoiceAdapter } from "./rest-e-invoice.adapter";
import type { EInvoiceAdapter } from "./e-invoice.types";

/**
 * ADAPTÖR ÇÖZÜCÜ — Faz 3: TENANT BAŞINA ayar.
 *
 * Çözüm sırası:
 *   1. `EInvoiceSettings` (tenant, aktif, providerKey ≠ noop) → kayıtlı fabrika
 *      (`rest` → RestEInvoiceAdapter; kimlik bilgisi AES-256-GCM'den çözülür).
 *   2. `EINVOICE_PROVIDER` ortam değişkeni (süreç geneli, eski davranış).
 *   3. NoopEInvoiceAdapter (hiçbir şey göndermez, dürüst 503).
 *
 * Kimlik bilgisi ASLA API yanıtına/denetim kaydına yazılmaz; `describe()` yalnız
 * anahtar + yapılandırılmış mı + maskeli özet döner.
 */
export const eInvoiceSettingsSchema = z.object({
  providerKey: z.enum(["noop", "rest"]),
  baseUrl: z.string().trim().url("Geçerli bir URL girin.").max(300).nullable().optional(),
  /** Boş bırakılırsa mevcut kimlik bilgisi korunur. */
  apiKey: z.string().trim().min(8).max(500).nullable().optional(),
  senderAlias: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type EInvoiceSettingsInput = z.infer<typeof eInvoiceSettingsSchema>;

type AdapterFactory = (cfg: { baseUrl: string | null; apiKey: string | null; senderAlias: string | null }) => EInvoiceAdapter | null;

@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);
  private readonly adapters = new Map<string, EInvoiceAdapter>();
  private readonly factories = new Map<string, AdapterFactory>();
  private readonly noop = new NoopEInvoiceAdapter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.adapters.set(this.noop.key, this.noop);
    this.factories.set("rest", (cfg) => (cfg.baseUrl && cfg.apiKey ? new RestEInvoiceAdapter({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, senderAlias: cfg.senderAlias }) : null));
  }

  /** Süreç geneli entegratör implementasyonları (ortam değişkeniyle seçilir). */
  register(adapter: EInvoiceAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  /** Tenant başına fabrika (kimlik bilgisi ayarlardan gelir). */
  registerFactory(key: string, factory: AdapterFactory): void {
    this.factories.set(key, factory);
  }

  /** Tenant için etkin adaptör. */
  async resolve(tenantId: string): Promise<EInvoiceAdapter> {
    const settings = await this.prisma.client.eInvoiceSettings.findUnique({ where: { tenantId } }).catch(() => null);
    if (settings && settings.isActive && settings.providerKey !== "noop") {
      const factory = this.factories.get(settings.providerKey);
      if (factory) {
        let apiKey: string | null = null;
        try {
          apiKey = settings.credentialsEncrypted ? decryptSecret(settings.credentialsEncrypted) : null;
        } catch (err) {
          this.logger.warn(`e-Fatura kimlik bilgisi çözülemedi (${tenantId}): ${(err as Error).message}`);
        }
        const adapter = factory({ baseUrl: settings.baseUrl, apiKey, senderAlias: settings.senderAlias });
        if (adapter) return adapter;
      }
    }
    const key = process.env.EINVOICE_PROVIDER?.trim().toLowerCase();
    if (!key || key === "noop") return this.noop;
    const adapter = this.adapters.get(key);
    if (!adapter) {
      this.logger.warn(`EINVOICE_PROVIDER="${key}" için kayıtlı adaptör yok; yapılandırılmamış (noop) adaptöre düşüldü. Hiçbir belge gönderilmeyecek.`);
      return this.noop;
    }
    return adapter;
  }

  /** Ayar ekranı için güvenli özet — kimlik bilgisi İÇERMEZ. */
  async describe(tenantId: string): Promise<{ providerKey: string; configured: boolean; note: string; settings: { providerKey: string; baseUrl: string | null; senderAlias: string | null; isActive: boolean; hasCredentials: boolean; updatedAt: Date } | null }> {
    const adapter = await this.resolve(tenantId);
    const settings = await this.prisma.client.eInvoiceSettings.findUnique({ where: { tenantId } }).catch(() => null);
    return {
      providerKey: adapter.key,
      configured: adapter.isConfigured,
      note: adapter.isConfigured
        ? "Özel entegratör bağlı; faturalar GİB'e entegratör üzerinden gönderilir."
        : "e-Fatura entegratörü yapılandırılmamış. Faturalar NomosOS içinde kesilebilir ve PDF dökümü alınabilir ancak GİB'e gönderilemez; e-Fatura durumu YOK olarak kalır.",
      settings: settings
        ? { providerKey: settings.providerKey, baseUrl: settings.baseUrl, senderAlias: settings.senderAlias, isActive: settings.isActive, hasCredentials: Boolean(settings.credentialsEncrypted), updatedAt: settings.updatedAt }
        : null,
    };
  }

  /** PUT /billing/e-invoice/settings — ADMIN/PARTNER; kimlik bilgisi şifrelenir. */
  async saveSettings(user: AuthUser, input: EInvoiceSettingsInput) {
    if (input.providerKey === "rest" && !input.baseUrl) throw new BadRequestException("REST entegratörü için baseUrl zorunludur.");
    const existing = await this.prisma.client.eInvoiceSettings.findUnique({ where: { tenantId: user.tenantId } });
    if (input.providerKey === "rest" && !input.apiKey && !existing?.credentialsEncrypted) {
      throw new BadRequestException("REST entegratörü için API anahtarı zorunludur.");
    }
    const credentialsEncrypted = input.apiKey ? encryptSecret(input.apiKey) : (existing?.credentialsEncrypted ?? null);
    const row = await this.prisma.client.eInvoiceSettings.upsert({
      where: { tenantId: user.tenantId },
      create: {
        tenantId: user.tenantId,
        providerKey: input.providerKey,
        baseUrl: input.baseUrl ?? null,
        credentialsEncrypted,
        senderAlias: input.senderAlias ?? null,
        isActive: input.isActive,
        updatedBy: user.userId,
      },
      update: {
        providerKey: input.providerKey,
        baseUrl: input.baseUrl ?? null,
        credentialsEncrypted,
        senderAlias: input.senderAlias ?? null,
        isActive: input.isActive,
        updatedBy: user.userId,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EFATURA_AYAR",
      entity: "EInvoiceSettings",
      entityId: row.id,
      detail: `Entegratör ${row.providerKey}${row.baseUrl ? ` (${row.baseUrl})` : ""}, aktif=${row.isActive}, kimlik bilgisi ${input.apiKey ? "güncellendi" : "korundu"}.`,
    });
    return this.describe(user.tenantId);
  }
}
