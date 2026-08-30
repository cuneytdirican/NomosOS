/**
 * TENANT AI EKONOMİSİ — hangi büroda kredi kapısı çalışır?
 *
 * docs/moduller/26 iki ekonomi tanımlar:
 *   BYO-LLM        → AI maliyeti BÜRODA, sınır YOK, kredi kapısı hiç çalışmaz.
 *   Yönetilen AI   → AI maliyeti NOMOSOS'ta, kredi kapısı ZORUNLU.
 *
 * ŞEMA NOTU (bilinçli sınır): `AiProviderConfig`'te "bu anahtar bürodan mı,
 * NomosOS'tan mı geldi" ayrımını taşıyan bir alan YOKTUR ve şema bu turda
 * dondurulmuştur. "Aktif sağlayıcısı olan tenant muaftır" kuralı burada
 * yazıldığı gibi uygulansaydı KAPI HİÇ ÇALIŞMAZDI: bir AI çağrısı yapabilmek
 * için zaten aktif bir `AiProviderConfig` ŞARTTIR (AiRunnerService.resolveRoute
 * yoksa 400 döner). Yani "sağlayıcısı var mı" sorusu her yönetilen tenant'ta da
 * "evet"tir ve ayırt edici değildir.
 *
 * BUNUN YERİNE muafiyet AÇIK ve DENETLENEBİLİR bir karardır:
 *   1. `SystemSetting["credits.byo_llm_tenants"]` listesindeki tenant → BYO_LLM.
 *      Liste platform panelinden, DÖRT-GÖZ onayıyla değişir ve PlatformAuditLog'a
 *      yazılır. Muafiyet "bir sağlayıcı eklemiş olmanın" yan etkisi değil,
 *      kaydedilmiş bir ticari karardır.
 *   2. `CreditWallet` satırı olmayan tenant → SINIRSIZ. Sayaç yoksa ölçüm de
 *      yoktur; hiç sağlanmamış bir kotayı "sıfır" sayıp bürodaki bütün AI'ı
 *      kilitlemek, spec'in "asla engellenmeyecekler" ilkesine aykırıdır.
 *   3. Diğer herkes → YONETILEN.
 *
 * Şemaya `Tenant.aiBilling` alanı eklendiğinde DEĞİŞECEK TEK YER bu dosyadır.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { CreditWallet } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";

export type BillingMode = "YONETILEN" | "BYO_LLM" | "SINIRSIZ";

export const BYO_LLM_SETTING_KEY = "credits.byo_llm_tenants";

export interface ResolvedBilling {
  mode: BillingMode;
  /** Kredi kapısı bu istekte çalışacak mı? */
  metered: boolean;
  wallet: CreditWallet | null;
  /** Arayüzde gösterilecek Türkçe açıklama. */
  note: string;
}

/** Muafiyet listesi her AI çağrısında sorgulanmasın diye kısa ömürlü önbellek. */
const EXEMPT_CACHE_TTL_MS = 30_000;

@Injectable()
export class BillingModeService {
  private readonly logger = new Logger(BillingModeService.name);
  private exemptCache: { at: number; ids: Set<string> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Muafiyet listesini okur (30 sn önbellekli). Ayar bozuksa BOŞ küme döner. */
  async exemptTenantIds(): Promise<Set<string>> {
    const now = Date.now();
    if (this.exemptCache && now - this.exemptCache.at < EXEMPT_CACHE_TTL_MS) {
      return this.exemptCache.ids;
    }
    let ids = new Set<string>();
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: BYO_LLM_SETTING_KEY },
      });
      if (row) {
        const parsed = JSON.parse(row.valueJson) as { tenantIds?: unknown };
        if (Array.isArray(parsed?.tenantIds)) {
          ids = new Set(parsed.tenantIds.filter((v): v is string => typeof v === "string"));
        }
      }
    } catch (err) {
      // FAIL-CLOSED: ayar okunamıyorsa kimse muaf sayılmaz. Bozuk bir JSON'un
      // bütün platformu ücretsiz AI'ya açmasındansa kapının kapalı kalması yeğdir.
      this.logger.warn(`BYO-LLM muafiyet listesi okunamadı: ${(err as Error).message}`);
    }
    this.exemptCache = { at: now, ids };
    return ids;
  }

  /** Önbelleği düşürür — muafiyet listesi değiştiğinde çağrılır. */
  invalidate(): void {
    this.exemptCache = null;
  }

  async resolve(tenantId: string): Promise<ResolvedBilling> {
    const [exempt, wallet] = await Promise.all([
      this.exemptTenantIds(),
      this.prisma.client.creditWallet.findUnique({ where: { tenantId } }),
    ]);

    if (exempt.has(tenantId)) {
      return {
        mode: "BYO_LLM",
        metered: false,
        wallet,
        note:
          "Limitsiz mod aktif — büronuz kendi AI anahtarını kullanıyor. Kredi kotası " +
          "uygulanmaz; kullanım kaydı (AiUsageLog) yine tutulur.",
      };
    }
    if (!wallet) {
      return {
        mode: "SINIRSIZ",
        metered: false,
        wallet: null,
        note:
          "Bu büro için kredi cüzdanı tanımlanmamış; AI işlemleri kotasız çalışır. " +
          "Kullanım kaydı tutulur.",
      };
    }
    return {
      mode: "YONETILEN",
      metered: true,
      wallet,
      note: "Yönetilen AI modu — kredili işlemler cüzdandan düşer.",
    };
  }

  /** Muafiyet listesini yazar (platform tarafı, dört-göz onayından SONRA). */
  async setExempt(tenantId: string, exempt: boolean, updatedBy?: string): Promise<string[]> {
    const current = await this.exemptTenantIds();
    const next = new Set(current);
    if (exempt) next.add(tenantId);
    else next.delete(tenantId);
    const tenantIds = [...next].sort();

    await this.prisma.client.systemSetting.upsert({
      where: { key: BYO_LLM_SETTING_KEY },
      create: {
        key: BYO_LLM_SETTING_KEY,
        valueJson: JSON.stringify({ tenantIds }),
        description:
          "Kredi kapısından MUAF tenant'lar (BYO-LLM). Bu listedeki bürolarda AI maliyeti " +
          "kendi sağlayıcı hesaplarındadır; kota uygulanmaz.",
        updatedBy,
      },
      update: { valueJson: JSON.stringify({ tenantIds }), updatedBy },
    });
    this.invalidate();
    return tenantIds;
  }
}
