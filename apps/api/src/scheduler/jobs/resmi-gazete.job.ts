import { Injectable } from "@nestjs/common";
import { LegislationIngestService } from "../../platform/legislation-ingest/legislation-ingest.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * RESMÎ GAZETE GÜNLÜK İZLEYİCİ (`resmi-gazete-gunluk`).
 *
 * İşin kendisi LegislationIngestService.runRgWatcher'dır: son 3 günün RG
 * sayfalarını tarar (kaçırılan gün telafisi), mevzuat bölümündeki belgeleri
 * ONAY KUYRUĞUNA yazar. Bu sınıf yalnızca zamanlayıcı sarmalayıcısıdır.
 *
 * HAVUZA YAZIM BU İŞTE YAPILMAZ: hiçbir RG belgesi otomatik yayınlanmaz;
 * platform görevlisi önizlemeyi okuyup onayladığında LegislationPoolService
 * (tek kapı) havuza yazar. RG'den gelen KANUN değişikliği onayda, etkilenen
 * kanunların konsolide metnini mevzuat.gov.tr'den çekip madde sürüm zincirini
 * (StatuteArticleVersion) günceller.
 *
 * İDEMPOTENTLİK: LegislationIngestItem'ta @@unique(sourceKey, externalKey)
 * vardır; aynı gün ikinci koşuda kuyruğa alınan kayıt sayısı 0'dır.
 */
@Injectable()
export class ResmiGazeteJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.RG_WATCHER;
  readonly name = "Resmî Gazete izleyici";
  readonly defaultCron = "30 7 * * *";
  readonly description =
    "Her sabah 07:30'da dünün (ve kaçırılan son 3 günün) Resmî Gazete sayfasını tarar; " +
    "mevzuat bölümündeki kanun/yönetmelik/tebliğ kalemlerini Mevzuat Onay Kuyruğu'na yazar. " +
    "Hiçbir belge otomatik yayınlanmaz — yönetici metni okuyup onayladığında platform mevzuat " +
    "havuzuna girer; kanun değişikliklerinde etkilenen kanunun maddeleri sürüm sürüm güncellenir.";

  constructor(private readonly ingest: LegislationIngestService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const summary = await this.ingest.runRgWatcher(ctx.now, ctx.triggeredBy);
    return {
      created: summary.queued,
      skipped: Math.max(0, summary.fetched - summary.queued),
      failed: summary.ok ? 0 : 1,
      detail: {
        kaynak: summary.source,
        taranan: summary.fetched,
        kuyrukta: summary.queued,
        ...(summary.note ? { not: summary.note } : {}),
      },
      errors: summary.ok ? [] : [summary.note ?? "Resmî Gazete sayfaları okunamadı"],
    };
  }
}

/**
 * ÇEKİRDEK KANUN TOHUMU (`mevzuat-tohumu-haftalik`) — haftalık değil, tek seferlik
 * tohum + periyodik tazeleme: çekirdek kanun listesindeki (CORE_STATUTES)
 * kanunlar mevzuat.gov.tr'de künyeyle doğrulanıp kuyruğa yazılır. Havuzda
 * güncel olanlar @@unique ile mükerrer kuyruğa girmez.
 */
@Injectable()
export class MevzuatTohumJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.LEGISLATION_SEED;
  readonly name = "Mevzuat çekirdek kanun tohumu";
  readonly defaultCron = "0 6 * * 1";
  readonly description =
    "Her pazartesi 06:00'da çekirdek kanun listesini (TCK, TMK, HMK, İİK, İş K., TBK, TTK, " +
    "CMK, KVKK…) mevzuat.gov.tr'de künyeyle arar; kuyrukta olmayanları Mevzuat Onay Kuyruğu'na " +
    "yazar. Onay, platform görevlisindendir.";

  constructor(private readonly ingest: LegislationIngestService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const summary = await this.ingest.runCoreSeed(ctx.now, ctx.triggeredBy);
    return {
      created: summary.queued,
      skipped: Math.max(0, summary.fetched - summary.queued),
      failed: 0,
      detail: { kaynak: summary.source, taranan: summary.fetched, kuyrukta: summary.queued },
      errors: [],
    };
  }
}

/**
 * REKABET KURULU KARARLARI İZLEYİCİSİ (`rekabet-kurul-haftalik`) — Faz 3,
 * regülatör kaynak 2: Kurul kararları listesinin ilk sayfalarını tarar,
 * kalemleri (künye + başlık; karar metinleri PDF) Mevzuat Onay Kuyruğu'na yazar.
 */
@Injectable()
export class RekabetKurulJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.REKABET_WATCHER;
  readonly name = "Rekabet Kurulu kararları izleyici";
  readonly defaultCron = "30 8 * * 1";
  readonly description =
    "Her pazartesi 08:30'da Rekabet Kurulu kararları listesinin ilk sayfalarını tarar; yeni kararları " +
    "künyeleriyle (karar sayısı/tarihi/türü) Mevzuat Onay Kuyruğu'na yazar. Karar metinleri PDF'tir; " +
    "hiçbir karar otomatik yayınlanmaz.";

  constructor(private readonly ingest: LegislationIngestService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const summary = await this.ingest.runRekabetWatcher(ctx.now, ctx.triggeredBy);
    return {
      created: summary.queued,
      skipped: Math.max(0, summary.fetched - summary.queued),
      failed: 0,
      detail: { kaynak: summary.source, taranan: summary.fetched, kuyrukta: summary.queued },
      errors: [],
    };
  }
}

/**
 * KVKK KURUL KARARLARI İZLEYİCİSİ (`kvkk-kurul-haftalik`) — Faz 3, regülatör
 * kaynak 1: KVKK Kurul Kararları listesinin ilk sayfalarını tarar, kalemleri
 * Mevzuat Onay Kuyruğu'na yazar. Onay, platform görevlisindendir; onayda karar
 * metni çekilip Legislation platform kaydı olarak girer.
 */
@Injectable()
export class KvkkKurulJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.KVKK_WATCHER;
  readonly name = "KVKK Kurul kararları izleyici";
  readonly defaultCron = "0 8 * * 1";
  readonly description =
    "Her pazartesi 08:00'de KVKK Kurul Kararları listesinin ilk sayfalarını tarar; yeni kararları " +
    "Mevzuat Onay Kuyruğu'na yazar. Hiçbir karar otomatik yayınlanmaz.";

  constructor(private readonly ingest: LegislationIngestService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const summary = await this.ingest.runKvkkWatcher(ctx.now, ctx.triggeredBy);
    return {
      created: summary.queued,
      skipped: Math.max(0, summary.fetched - summary.queued),
      failed: 0,
      detail: { kaynak: summary.source, taranan: summary.fetched, kuyrukta: summary.queued },
      errors: [],
    };
  }
}
