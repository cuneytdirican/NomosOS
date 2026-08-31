import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreditService } from "../../credits/credit.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * KREDİ DÖNEMİ YENİLEME (`credit-period-renewal-daily`).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ HESAP BURADA YAPILMAZ. `CreditService.renewPeriod()` çağrılır.           ║
 * ║                                                                          ║
 * ║ Modül 26'nın kuralları (dahil kota DEVRETMEZ ve sıfırlanır, satın alınan ║
 * ║ bakiye KORUNUR, yanan kota `SURESI_DOLDU` hareketiyle deftere yazılır,   ║
 * ║ yeni tahsis `TAHSIS` hareketiyle işlenir, `balanceAfter` mutabakatı      ║
 * ║ tutar) o servisin işlem sınırları içinde uygulanır. Aynı mantığı burada  ║
 * ║ ikinci kez yazmak, iki farklı kredi matematiği demek olurdu — kredi      ║
 * ║ paraya eşdeğerdir ve iki ayrı doğru kabul edilemez.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * İDEMPOTENTLİK — İKİ KATLI:
 *   1. Yalnız `periodEnd <= now` olan cüzdanlar seçilir. `renewPeriod` yeni
 *      dönemi (`nextPeriod`) GELECEĞE kurar; ikinci koşuda hiçbir cüzdan
 *      süzgece takılmaz ve iş `ATLANDI` işaretlenir.
 *   2. `force` BİLİNÇLİ OLARAK GÖNDERİLMEZ. `force: true`, dönemi bitmemiş bir
 *      cüzdanı da yeniler; bir zamanlama hatası ya da elle tetiklemenin
 *      tekrarı, kotayı gün ortasında sıfırlayıp yeniden tahsis ederek
 *      SINIRSIZ KREDİ basardı. Servis dönem bitmemişse hata fırlatır; o hata
 *      burada tek cüzdan için yakalanır, `failed` sayılır ve iş devam eder.
 *
 * ELLE TETİKLEME `targetDate` KABUL ETMEZ: geçmiş bir tarihe göre yenileme,
 * kotayı geriye dönük sıfırlamak anlamına gelirdi.
 */
@Injectable()
export class CreditPeriodRenewalJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.CREDIT_PERIOD_RENEWAL;
  readonly name = "Kredi dönemi yenileme ve kota sıfırlama";
  readonly defaultCron = "0 1 * * *";
  readonly description =
    "Dönemi biten kredi cüzdanlarında dahil kotayı sıfırlayıp yeniden tahsis eder; " +
    "satın alınan bakiye korunur, hareketler CreditTransaction'a yazılır.";

  private readonly logger = new Logger(CreditPeriodRenewalJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditService
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const due = await this.prisma.client.creditWallet.findMany({
      where: { periodEnd: { lte: ctx.now } },
      select: { tenantId: true, periodEnd: true },
      orderBy: { periodEnd: "asc" },
    });

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const renewed: Array<{ tenantId: string; sifirlanan: number; yeniKota: number }> = [];

    for (const wallet of due) {
      try {
        const result = await this.credits.renewPeriod(wallet.tenantId, {
          note: `Zamanlanmış iş (${this.key}, tetikleyici: ${ctx.trigger}).`,
        });
        created += 1;
        renewed.push({
          tenantId: wallet.tenantId,
          sifirlanan: result.sifirlanan,
          yeniKota: result.yeniKota,
        });
      } catch (err) {
        /**
         * ÇİFT TAHSİS KORUMASI BİR HATA DEĞİLDİR (denetim bulgusu 6).
         * `renewPeriod` işlem içindeki koşullu yazmayı kaybettiğinde
         * `ConflictException` fırlatır: dönemi başka bir koşu yenilemiştir ve
         * ikinci tahsis YAPILMAMIŞTIR — istenen davranış tam olarak budur.
         * Bunu `failed` saymak, operatöre var olmayan bir arıza gösterirdi.
         */
        if (err instanceof ConflictException) {
          skipped += 1;
          this.logger.log(
            `Kredi dönemi zaten yenilenmiş (${wallet.tenantId}); çift tahsis engellendi.`
          );
          continue;
        }
        // TEK CÜZDANIN HATASI GECEYİ DURDURMAZ: diğer büroların kotası
        // yenilenmeye devam eder, hata sayılır ve panelde görünür.
        failed += 1;
        if (errors.length < 5) errors.push(`${wallet.tenantId}: ${(err as Error).message}`);
        this.logger.warn(
          `Kredi dönemi yenilenemedi (${wallet.tenantId}): ${(err as Error).message}`
        );
      }
    }

    this.logger.log(
      `Kredi dönemi yenileme: ${created} cüzdan yenilendi, ${skipped} zaten yenilenmiş, ` +
        `${failed} hata (aday: ${due.length}).`
    );

    return {
      created,
      // Süzgeç "dönemi bitmiş" cüzdanları seçer; ikinci SIRALI koşuda aday
      // listesi BOŞ döner. `skipped` yalnız EŞ ZAMANLI ikinci koşunun çift
      // tahsis korumasına takıldığı hâli sayar.
      skipped,
      failed,
      errors,
      detail: {
        adayCuzdan: due.length,
        yenilenen: renewed,
        cakismaNedeniyleAtlanan: skipped,
        forceKullanildi: false,
      },
    };
  }
}
