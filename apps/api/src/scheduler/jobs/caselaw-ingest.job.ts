import { Injectable } from "@nestjs/common";
import { CaselawIngestService } from "../../platform/caselaw-ingest/caselaw-ingest.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * İÇTİHAT TOPLAMA İŞİ (`caselaw-ingest-daily`).
 *
 * İŞİN KENDİSİ platform modülündedir (CaselawIngestService.runAllSources):
 * beslemeleri çeker, kayıtları ONAY KUYRUĞUNA yazar. Bu sınıf yalnız
 * zamanlayıcı sarmalayıcısıdır — hangi kaynağa gidileceği YAPILANDIRMADADIR
 * (CaselawSourceConfig), kodda sabit kaynak İSTEMCİSİ YOKTUR.
 *
 * HAVUZA YAZIM BU İŞTE YAPILMAZ: çekilen kayıt kuyrukta BEKLER; platform
 * görevlisi künyeyi görüp onayladığında CaselawPoolService'in künye
 * doğrulamasından geçerek havuza girer. Otomatik yayın yok — uydurma/bozuk
 * künyeli kaydın havuza kendiliğinden girmesi yapısal olarak olanaksızdır.
 *
 * İDEMPOTENTLİK: CaseLawIngestItem'ta @@unique(sourceKey, court, caseNumber,
 * decisionNumber) vardır ve çekim createMany + skipDuplicates ile yazar; aynı
 * koşu ikinci kez çalıştığında yeniden kuyruğa ALINAN kayıt sayısı 0'dır.
 */
@Injectable()
export class CaselawIngestJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.CASELAW_INGEST;
  readonly name = "İçtihat besleme çekimi";
  readonly defaultCron = "0 6 * * *";
  readonly description =
    "Her sabah 06:00'da tanımlı veri kaynaklarından (ör. lisanslı içtihat servisi) yeni Yargıtay " +
    "kararlarını çeker. Çekilen kararlar doğrudan havuza GİRMEZ; İçtihat Onay Masası'nda " +
    "bekleyen kayıt olarak listelenir ve yönetici karar metnini okuyup onayladığında havuza yazılır.";

  constructor(private readonly ingest: CaselawIngestService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const summaries = await this.ingest.runAllSources(ctx.now, ctx.triggeredBy);

    const created = summaries.reduce((sum, s) => sum + s.queued, 0);
    const skipped = summaries.reduce((sum, s) => sum + s.skippedDuplicate + s.rejected, 0);
    const failedSources = summaries.filter((s) => !s.ok);

    return {
      created,
      skipped,
      // Kaynak çekişi başarısızsa iş BAŞARISIZ işaretlenir ki panelde görünsün;
      // ama tek kaynağın hatası ÖTEKİ kaynakların çekimini engellemez.
      failed: failedSources.length,
      detail: {
        kaynakSayisi: summaries.length,
        kaynaklar: summaries.map((s) => ({
          kaynak: s.key,
          cekilen: s.fetched,
          kuyrukta: s.queued,
          mukerrer: s.skippedDuplicate,
          reddedilen: s.rejected,
          ...(s.ok ? {} : { hata: s.note ?? "bilinmeyen hata" }),
        })),
      },
      errors: failedSources.map((s) => `${s.key}: ${s.note ?? "bilinmeyen hata"}`),
    };
  }
}
