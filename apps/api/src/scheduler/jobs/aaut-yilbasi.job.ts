import { Injectable } from "@nestjs/common";
import { PlatformAuditService } from "../../platform/platform-audit.service";
import { VekaletUcretiService } from "../../vekalet-ucreti/vekalet-ucreti.service";
import { JOB_KEYS, SCHEDULER_TZ_OFFSET_MINUTES } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * AAÜT YIL BAŞI DENETİMİ (`aaut-tarife-yilbasi`) — açılış öncesi hazır veri
 * planı Aşama 2/6: "yıl başı kontrolü + platform panelinde uyarı".
 *
 * NE YAPMAZ: tarife rakamı ÜRETMEZ, RG'den ÇEKMEZ, hesap yapmaz. AAÜT her
 * yıl Resmî Gazete'de yayımlanır ve platform görevlisi rakamları elle girer
 * (sistem rakam uydurmaz — motorun veri sözleşmesi).
 *
 * NE YAPAR: içinde bulunulan yılın (Aralık'ta ayrıca gelecek yılın) PLATFORM
 * tarifesi girilmiş mi bakar. Girilmemişse iş BAŞARISIZ raporlanır ve
 * platform denetim izine düşer — panelde (Zamanlanmış İşler) görünür uyarı.
 * Girilmişse RG künyesiyle SAĞLIKLI raporlanır.
 */
@Injectable()
export class AautYilbasiJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.AAUT_YILBASI;
  readonly name = "AAÜT platform tarifesi yıl başı denetimi";
  /** 2 Ocak 07:00 (TR) — yeni yılın tarifesi çoğu yıl Aralık sonunda yayımlanır. */
  readonly defaultCron = "0 7 2 1 *";
  readonly description =
    "Yeni yılın AAÜT (avukatlık asgari ücret tarifesi) platform kaydı Resmî Gazete'den girilmiş mi " +
    "denetler; girilmemişse BAŞARISIZ raporlayıp uyarır. Rakam üretmez, tarife çekmez — girişi platform " +
    "görevlisi yapar (Yargı & Noter → AAÜT Tarifesi).";

  constructor(
    private readonly vekalet: VekaletUcretiService,
    private readonly audit: PlatformAuditService,
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    // TR takvim yılı (sunucu saat dilimi ne olursa olsun).
    const tr = new Date(ctx.now.getTime() + SCHEDULER_TZ_OFFSET_MINUTES * 60_000);
    const yil = tr.getUTCFullYear();
    const yillar = tr.getUTCMonth() === 11 ? [yil, yil + 1] : [yil];

    const eksik: number[] = [];
    const mevcut: Record<string, string> = {};
    for (const y of yillar) {
      const durum = await this.vekalet.platformTarifeVarMi(y);
      if (durum.var) mevcut[String(y)] = durum.rgKunye ?? "künye yok";
      else eksik.push(y);
    }

    if (eksik.length > 0) {
      const mesaj =
        `AAÜT platform tarifesi EKSİK: ${eksik.join(", ")}. Resmî Gazete'deki yıl tarifesini ` +
        "platform panelinden (Yargı & Noter → AAÜT Tarifesi) girin; girilene kadar kendi tarifesini " +
        "girmemiş bürolarda hesap aracı çalışmaz.";
      await this.audit.log({
        actor: { id: ctx.triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
        action: "AAUT_TARIFE_EKSIK",
        entity: "PlatformVekaletTarife",
        detail: mesaj,
      });
      return {
        created: 0,
        skipped: 0,
        failed: eksik.length,
        detail: { denetlenenYillar: yillar, eksik, mevcut },
        errors: [mesaj],
      };
    }

    return {
      created: 0,
      skipped: yillar.length,
      failed: 0,
      detail: { denetlenenYillar: yillar, mevcut },
      errors: [],
    };
  }
}
