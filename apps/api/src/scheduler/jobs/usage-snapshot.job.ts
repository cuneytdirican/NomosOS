import { Injectable } from "@nestjs/common";
import { UsageSnapshotService } from "../../platform/metrics/usage-snapshot.service";
import { addDays, trCalendarDay } from "../../common/dates";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * GÜNLÜK KULLANIM FOTOĞRAFI (`usage-snapshot-daily`).
 *
 * İŞİN KENDİSİ FAZ 5'TE YAZILMIŞTI: `UsageSnapshotService.collectDaily()`.
 * Bu sınıf yalnız ZAMANLAYICI SARMALAYICISIDIR; hesap mantığı KOPYALANMAZ.
 * Platform paneli aynı servisi `POST /metrics/snapshot/run` ile elle de
 * çağırır ve iki yol aynı kodu çalıştırır — iki farklı "doğru" olmaz.
 *
 * İDEMPOTENTLİK: `UsageSnapshot`ta `@@unique([tenantId, date])` vardır ve
 * servis `upsert` kullanır. Aynı gün için ikinci koşu YENİ SATIR ÜRETMEZ,
 * mevcut satırı günceller. Bu yüzden `skipped` değil `created` sayılır:
 * ortada atlanan bir kayıt yoktur, yalnız aynı hücreye aynı değer yazılır.
 *
 * NEDEN "DÜN": bugünün günü henüz kapanmamıştır; yarım günün fotoğrafı
 * grafiklerde yanıltıcı bir düşüş gibi görünür.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ "DÜN" TÜRKİYE TAKVİMİNE GÖREDİR (denetim bulgusu 5).                     ║
 * ║                                                                          ║
 * ║ Bu iş VARSAYILAN olarak "0 2 * * *" ile çalışır ve cron TR saatiyle      ║
 * ║ yorumlanır: 02:00 TR = 23:00 UTC, yani BİR ÖNCEKİ UTC günü. Eski hesap   ║
 * ║ (`ctx.now − 1 gün` → UTC gün) bu yüzden "dün"ü değil ÖNCEKİ GÜNÜ         ║
 * ║ hedefliyordu; fotoğraf kalıcı olarak bir gün gerideydi ve yukarıdaki     ║
 * ║ "NEDEN DÜN" gerekçesi fiilen yanlıştı. Örnek: 02.09.2026 02:00 TR =      ║
 * ║ 01.09.2026T23:00Z; eski hesap 31.08'i, doğrusu 01.09'u hedefler.         ║
 * ║                                                                          ║
 * ║ Toplama PENCERESİ (UTC 00:00–24:00) değişmedi — o, sistemin baştan sona  ║
 * ║ UTC olan sözleşmesidir; düzeltilen HANGİ GÜNÜN seçildiğidir.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
@Injectable()
export class UsageSnapshotJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.USAGE_SNAPSHOT;
  readonly name = "Günlük kullanım/kota anlık görüntüsü";
  readonly defaultCron = "0 2 * * *";
  readonly description =
    "Dün için kiracı başına aktif kullanıcı, dosya, belge, AI çağrısı ve token " +
    "sayılarını UsageSnapshot tablosuna yazar (upsert — aynı gün yeniden çalışabilir).";

  constructor(private readonly snapshots: UsageSnapshotService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const target = ctx.targetDate ?? addDays(trCalendarDay(ctx.now), -1);
    const result = await this.snapshots.collectDaily(target);

    return {
      created: result.written,
      skipped: 0,
      failed: 0,
      detail: {
        gun: result.date,
        kiraciSayisi: result.tenantCount,
        yazilanSatir: result.written,
        toplamaSuresiMs: result.durationMs,
      },
    };
  }
}
