import { Injectable } from "@nestjs/common";
import { RiskNightlyService } from "../../risk/risk-nightly.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * F2 · E2 — GECE RİSK SKORLAMA İŞİ (`risk-nightly`).
 *
 * Hesap mantığı burada YAZILMAZ: `RiskNightlyService` sahiptir. Bu sınıf
 * yalnız ZAMANLAYICI SARMALAYICISIDIR (usage-snapshot.job.ts deseni).
 *
 * SAAT 02:30 TR: kullanım fotoğrafı (02:00) bittikten SONRA koşar — fotoğraf
 * işi gece risk işinin YAZDIĞI skor satırlarını okumaz, sıralama yine de
 * tek bir gece işlerinin fark edilmesini sağlar.
 *
 * AI ÇAĞRILMAZ (ürün ilkesi): iş yalnızca deterministik kural tabanını tazeler
 * ve kiracı günlük DashboardSnapshot satırını yazar (upsert — idempotent).
 */
@Injectable()
export class RiskNightlyJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.RISK_NIGHTLY;
  readonly name = "Gece risk skoru tazeleme + panel fotoğrafı";
  readonly defaultCron = "30 2 * * *";
  readonly description =
    "Aktif dosyaların DETERMİNİSTİK risk tabanını tazeler (AI çağrılmaz; önceki AI " +
    "düzeltmeleri korunur) ve her kiracı için günlük DashboardSnapshot yazar (upsert).";

  constructor(private readonly nightly: RiskNightlyService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const result = await this.nightly.runNightly(ctx.now);

    return {
      created: result.recomputedCases,
      skipped: 0,
      failed: result.failedCases,
      detail: {
        gun: result.date,
        kiraciSayisi: result.tenantCount,
        yenidenHesaplananDosya: result.recomputedCases,
        basarisizDosya: result.failedCases,
      },
    };
  }
}
