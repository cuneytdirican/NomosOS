/**
 * AÇILIŞ DOĞRULAMASI — "ücretsiz kalmış kredili uç" sessizce yayına çıkmasın.
 *
 * SORUN (denetim bulgusu): `costOfTask` fiyat satırı olmayan görevi ÜCRETSİZ
 * sayar (fail-open). Gerekçesi savunulabilir — kredi muhasebesindeki bir eksik,
 * avukatın işini durdurmamalıdır — ama sonucu şudur: `@AiCredits` ile
 * işaretlenmiş bir uç, `AiTaskCost` satırı yoksa BEDAVA AI olarak çalışır ve
 * bunu yalnız günlüğe bakan biri fark eder.
 *
 * Görev tipini `AiTaskType` olarak tiplemek yazım hatalarını derleme zamanında
 * yakalar; ama katalogda OLUP fiyat satırı OLMAYAN görev hâlâ mümkündür (yeni
 * görev eklenip seed/panel güncellenmediğinde). Bu servis o boşluğu açılışta
 * GÖRÜNÜR kılar.
 *
 * FAIL-OPEN KORUNUR: açılış durdurulmaz. Amaç davranışı değiştirmek değil,
 * eksiği sessiz olmaktan çıkarmaktır — ikisi birbirini dışlamaz.
 */

import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { AI_CREDITS_KEY, type AiCreditsMeta } from "./ai-credits.decorator";
import { CreditService } from "./credit.service";

@Injectable()
export class CreditsStartupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CreditsStartupService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly credits: CreditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Cüzdansız kiracı = ölçülmeyen AI (gelir kaçağı). Açılışta kapatılır.
    try {
      const created = await this.credits.ensureWalletsForAllTenants();
      if (created > 0) this.logger.warn(`${created} kiracının kredi cüzdanı yoktu; açılışta plan kotasıyla açıldı.`);
    } catch (err) {
      this.logger.error(`Cüzdan yedeklemesi başarısız: ${(err as Error).message}`);
    }

    const declared = this.collectDeclaredTaskTypes();
    if (declared.size === 0) return;

    const rows = await this.credits.listCosts();
    const known = new Map(rows.map((r) => [r.taskType, r]));

    const missing: string[] = [];
    const free: string[] = [];
    for (const [taskType, routes] of declared) {
      const row = known.get(taskType);
      if (!row) missing.push(`${taskType} (${routes.join(", ")})`);
      else if (row.isFree) free.push(`${taskType} (${routes.join(", ")})`);
    }

    if (missing.length > 0) {
      this.logger.error(
        `KREDİLİ İŞARETLİ AMA FİYATSIZ ${missing.length} GÖREV TİPİ: ${missing.join(" · ")}. ` +
          "Bu uçlar ÜCRETSİZ çalışıyor (fail-open). Platform panelinden " +
          "(/api/admin/v1/credits/costs) fiyat satırı tanımlayın.",
      );
    }
    if (free.length > 0) {
      this.logger.warn(
        `${free.length} görev tipi @AiCredits taşıyor ama fiyat listesinde ÜCRETSİZ ` +
          `işaretli: ${free.join(" · ")}. Bilinçliyse sorun yok; değilse panelden düzeltin.`,
      );
    }
    if (missing.length === 0 && free.length === 0) {
      this.logger.log(
        `Kredi kapısı: ${declared.size} görev tipinin tamamı fiyatlandırılmış durumda.`,
      );
    }
  }

  /** `@AiCredits` taşıyan tüm handler'ları tarar → görev tipi → rota adları. */
  private collectDeclaredTaskTypes(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const add = (taskType: string, where: string) => {
      const list = found.get(taskType) ?? [];
      list.push(where);
      found.set(taskType, list);
    };

    for (const wrapper of this.discovery.getControllers()) {
      const { instance } = wrapper;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const controllerName = wrapper.metatype?.name ?? "(bilinmeyen controller)";

      this.scanner.getAllMethodNames(proto).forEach((methodName) => {
        const handler = (instance as Record<string, unknown>)[methodName];
        if (typeof handler !== "function") return;
        const meta = Reflect.getMetadata(AI_CREDITS_KEY, handler) as AiCreditsMeta | undefined;
        if (!meta) return;
        add(meta.taskType, `${controllerName}.${methodName}`);
        // `taskTypeFrom` çalışma anında BAŞKA bir tipe geçebilir; statik olarak
        // görülemez. En azından varsayılan tip doğrulanır.
      });
    }
    return found;
  }
}
