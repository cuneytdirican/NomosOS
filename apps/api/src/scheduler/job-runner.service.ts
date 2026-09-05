import { ConflictException, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { schedulerFailures } from "../metrics/metrics.registry";
import { safeNextRun } from "./cron-expression";
import {
  resolveJobStatus,
  type JobExecutionContext,
  type JobResult,
  type JobRunSummary,
  type ScheduledJobHandler,
} from "./scheduler.types";

/** `JobRun.errorMessage` üst sınırı — tek satır günlüğü şişirmesin. */
const MAX_ERROR_LENGTH = 2000;
/** `JobRun.detailJson` üst sınırı. */
const MAX_DETAIL_LENGTH = 8000;

/**
 * Bir koşu bu süreden uzundur "çalışıyor" görünüyorsa panelde AYRICA belirtilir.
 * Sonsuza kadar çalışan bir iş, çalışmayan bir işten daha tehlikelidir: operatör
 * "iş sürüyor" sanıp beklemeye devam eder.
 */
const LONG_RUNNING_WARN_MS = 30 * 60 * 1000;

/**
 * Açılışta bu yaştan eski `CALISIYOR` satırları KAPATILIR.
 *
 * Süreç iş ortasında ölürse satırın kanıt olarak kalması doğru bir karardır —
 * ama onu KAPATAN hiçbir mekanizma yoktu (denetim bulgusu 13): satır sonsuza
 * kadar `CALISIYOR` kalıyor, `finishedAt` null olduğu için `durationMs` de
 * null dönüyordu. Panelde geçmişe bakan operatör, bir yıl önceki bir deploy'un
 * bıraktığı satırla dünkü gerçek bir takılmayı ayırt edemiyordu. Süpürücü
 * satırı SİLMEZ; `BASARISIZ` + "kesilmiş koşu" ile kapatır — kanıt durur,
 * belirsizlik biter. (`CreditService.sweepStaleReservations` ile aynı desen.)
 */
const STALE_RUN_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * İŞ YÜRÜTÜCÜ — HER KOŞU BİR `JobRun` SATIRIDIR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN KOŞU ÖNCE `CALISIYOR` OLARAK YAZILIR:
 *   Süreç iş ortasında ölürse (deploy, OOM, kill) hiçbir satır yazılmasaydı,
 *   panelde o gece "iş hiç çalışmadı" görünürdü — oysa yarısı çalışmıştı.
 *   Askıda kalmış `CALISIYOR` satırı, tam da bu durumun kanıtıdır ve
 *   operatöre "kesilmiş koşu" olarak görünür.
 *
 * NEDEN HATA FIRLATILMAZ:
 *   Cron tarafında fırlatılan hata BullMQ'da yeniden denemeye ve gürültüye
 *   dönüşür; elle tetiklemede ise operatör 500 görür ama NE OLDUĞUNU göremez.
 *   Bunun yerine koşu `BASARISIZ` durumuyla KAPATILIR ve özet döner: hata
 *   metni hem yanıtta hem `JobRun.errorMessage` içinde durur.
 *
 * AYNI İŞİN EŞ ZAMANLI İKİ KOŞUSU ENGELLENİR:
 *   Elle tetikleme cron ile çakışabilir. Bildirimler `dedupeKey` sayesinde
 *   zaten çiftlenmez, ama iki koşu aynı `ScheduledJob.last*` alanlarını
 *   yarıştırır ve `JobRun` günlüğünü okunmaz hâle getirir. Kilit SÜREÇ
 *   İÇİDİR; çok örnekli dağıtımda dağıtık kilit gerekir (BullMQ tarafında
 *   `concurrency: 1` cron yolunu zaten tekilleştirir).
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class JobRunnerService implements OnModuleInit {
  private readonly logger = new Logger(JobRunnerService.name);
  /** anahtar → koşunun başladığı an (yaş damgası panelde görünür). */
  private readonly running = new Map<string, Date>();

  constructor(private readonly prisma: PrismaService) {}

  /** Açılışta bir kez: çöken sürecin bıraktığı `CALISIYOR` satırlarını kapat. */
  async onModuleInit(): Promise<void> {
    await this.sweepStaleRuns();
  }

  /**
   * Askıda kalmış koşuları kapatır. Hata AÇILIŞI DÜŞÜRMEZ: temizlik bir yan
   * işlemdir, zamanlayıcının kendisi değildir.
   */
  async sweepStaleRuns(now: Date = new Date()): Promise<number> {
    try {
      const cutoff = new Date(now.getTime() - STALE_RUN_AGE_MS);
      const result = await this.prisma.client.jobRun.updateMany({
        where: { status: "CALISIYOR", startedAt: { lt: cutoff } },
        data: {
          status: "BASARISIZ",
          finishedAt: now,
          errorMessage:
            "Kesilmiş koşu: süreç iş ortasında sonlandı (deploy, OOM ya da yeniden başlatma). " +
            "Koşu sonucu bilinmiyor; üretilen bildirimler dedupeKey sayesinde çiftlenmez, " +
            "işi elle yeniden tetiklemek güvenlidir.",
        },
      });
      if (result.count > 0) {
        this.logger.warn(
          `${result.count} askıda kalmış koşu "kesilmiş koşu" olarak kapatıldı ` +
            `(${STALE_RUN_AGE_MS / 3_600_000} saatten eski).`
        );
      }
      return result.count;
    } catch (err) {
      this.logger.warn(`Askıda kalmış koşular süpürülemedi: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Şu an bu süreçte çalışan iş anahtarları — panel bilgisi. */
  runningKeys(): string[] {
    return [...this.running.keys()];
  }

  /**
   * Çalışan işler ve ne kadardır çalıştıkları.
   * Süre BİLİNÇLİ olarak dışarı verilir: kilit süreç içidir ve bir arıza
   * durumunda anahtarın asılı kaldığı ancak yaşına bakılarak anlaşılır.
   */
  runningDetails(now: Date = new Date()): Array<{ key: string; startedAt: Date; ageMs: number; stalled: boolean }> {
    return [...this.running.entries()].map(([key, startedAt]) => {
      const ageMs = now.getTime() - startedAt.getTime();
      return { key, startedAt, ageMs, stalled: ageMs > LONG_RUNNING_WARN_MS };
    });
  }

  async run(handler: ScheduledJobHandler, ctx: JobExecutionContext): Promise<JobRunSummary> {
    if (this.running.has(handler.key)) {
      throw new ConflictException(
        `"${handler.key}" işi şu anda zaten çalışıyor. Bitmesini bekleyip yeniden deneyin.`
      );
    }

    const startedAt = new Date();
    /**
     * ╔══════════════════════════════════════════════════════════════════════╗
     * ║ KİLİT `try` İÇİNDE ALINIR — `finally` HER KOŞULDA ÇALIŞSIN.          ║
     * ║                                                                      ║
     * ║ Eskiden `running.add(...)` ile `try/finally` arasında `await` edilen  ║
     * ║ bir DB yazımı vardı (`jobRun.create`). O yazım fırlatırsa (bağlantı   ║
     * ║ havuzu tükenmesi, saniyelik kesinti, Prisma yeniden bağlanması)       ║
     * ║ `finally` HİÇ çalışmıyor ve anahtar kümede KALICI olarak asılı        ║
     * ║ kalıyordu. O andan sonra hem cron hem elle tetikleme                  ║
     * ║ `ConflictException`a düşer; süre hatırlatmaları API yeniden           ║
     * ║ başlatılana kadar HİÇ üretilmez. Panel de yardımcı olmaz: iş          ║
     * ║ "çalışıyor" görünür, `lastError` boş kalır. Bir hukuk ürününde bu, en ║
     * ║ pahalı sessiz arızadır — kimse fark etmeden süre kaçırılır.          ║
     * ╚══════════════════════════════════════════════════════════════════════╝
     */
    this.running.set(handler.key, startedAt);
    try {
      const run = await this.prisma.client.jobRun
        .create({
          data: {
            jobKey: handler.key,
            status: "CALISIYOR",
            startedAt,
            // Kiracı bazlı işler için `tenantId` alanı burada anlamlı değildir
            // (iş bütün kiracıları dolaşır); ayrıntı `detailJson`dadır.
          },
          select: { id: true },
        })
        .catch((err: Error) => {
          // Koşu kaydı açılamadıysa iş ÇALIŞTIRILMAZ: denetim izi olmadan
          // bildirim üretmek, "kim ne zaman ne gönderdi" sorusunu yanıtsız
          // bırakırdı. Hata çağırana döner, kilit `finally`de çözülür.
          this.logger.error(
            `Koşu kaydı açılamadı (${handler.key}): ${err.message}. İş çalıştırılmadı.`
          );
          throw err;
        });

      let result: JobResult;
      let errorMessage: string | null = null;

      try {
        result = await handler.run(ctx);
      } catch (err) {
        // İŞİN KENDİSİ PATLADI: sonuç sıfır, hata kaydedilir.
        result = { created: 0, skipped: 0, failed: 1, errors: [(err as Error).message] };
        errorMessage = `${(err as Error).name}: ${(err as Error).message}`;
        this.logger.error(
          `Zamanlanmış iş başarısız (${handler.key}): ${(err as Error).message}`,
          (err as Error).stack
        );
      }

      const status = resolveJobStatus(result);
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      // Faz 4: iş hatası metriği (uyarı kuralı NomosOSSchedulerJobFailing).
      if (errorMessage) schedulerFailures.labels(handler.key).inc();
      // İş içinden gelen tekil hatalar (tek kiracı patladı) da mesaja girer.
      if (!errorMessage && result.errors?.length) {
        errorMessage = result.errors.join(" | ");
      }
      const detail = {
        tetikleyici: ctx.trigger,
        tetikleyenKullanici: ctx.triggeredBy ?? null,
        uretilen: result.created,
        atlanan: result.skipped,
        basarisiz: result.failed,
        ...(result.detail ?? {}),
      };

      await this.prisma.client.jobRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt,
          itemsProcessed: result.created,
          errorMessage: truncate(errorMessage, MAX_ERROR_LENGTH),
          detailJson: truncate(JSON.stringify(detail), MAX_DETAIL_LENGTH),
        },
      });

      await this.updateDefinition(handler.key, {
        lastRunAt: startedAt,
        lastStatus: status,
        lastError: truncate(errorMessage, MAX_ERROR_LENGTH),
        lastDurationMs: durationMs,
        referenceTime: finishedAt,
      });

      return {
        jobRunId: run.id,
        jobKey: handler.key,
        status,
        trigger: ctx.trigger,
        startedAt,
        finishedAt,
        durationMs,
        itemsProcessed: result.created,
        skipped: result.skipped,
        failed: result.failed,
        errorMessage,
        detail,
      };
    } finally {
      this.running.delete(handler.key);
    }
  }

  /**
   * `ScheduledJob` özet alanlarını günceller.
   *
   * `updateMany` KULLANILIR: tanım satırı silinmişse (operatör tabloyu
   * temizlemişse) `update` P2025 fırlatır ve BAŞARIYLA BİTMİŞ bir koşuyu
   * başarısız gösterirdi. Günlüğün kaynağı `JobRun`dur; `ScheduledJob.last*`
   * yalnız özettir ve kaybı katlanılabilirdir.
   */
  private async updateDefinition(
    key: string,
    input: {
      lastRunAt: Date;
      lastStatus: JobRunSummary["status"];
      lastError: string | null;
      lastDurationMs: number;
      referenceTime: Date;
    }
  ): Promise<void> {
    try {
      const definition = await this.prisma.client.scheduledJob.findUnique({ where: { key } });
      if (!definition) return;

      await this.prisma.client.scheduledJob.updateMany({
        where: { key },
        data: {
          lastRunAt: input.lastRunAt,
          lastStatus: input.lastStatus,
          lastError: input.lastError,
          lastDurationMs: input.lastDurationMs,
          // Kapalı işin "sonraki çalışma"sı YOKTUR; eski değeri bırakmak
          // panelde hiç gelmeyecek bir tarihi gösterirdi.
          nextRunAt: definition.isEnabled
            ? safeNextRun(definition.cronExpression, input.referenceTime)
            : null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `İş tanımı özeti güncellenemedi (${key}): ${(err as Error).message}. ` +
          "Koşu kaydı (JobRun) yazıldı; kaynak tablo odur."
      );
    }
  }
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
