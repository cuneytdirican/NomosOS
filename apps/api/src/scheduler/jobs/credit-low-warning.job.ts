import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { creditLowKey } from "../dedupe-key";
import {
  CREDIT_LOW_WARNING_RATIO,
  creditWarningText,
  evaluateCreditWarning,
} from "../credit-threshold";
import { NotificationOutboxService, type OutboxEntry } from "../notification-outbox.service";
import { TenantRecipientsService } from "../tenant-recipients";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * KREDİ AZALDI UYARISI (`credit-low-warning-hourly`) — denetim bulgusu Ö-29.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN SAATLİK, NEDEN GECELİK DEĞİL                                       ║
 * ║ Uyarının tek amacı 402'nin SÜRPRİZ OLMAMASIDIR. Gecelik bir iş, sabah    ║
 * ║ %60'ta olan bir büronun öğleden sonra %100'e çarpmasını hiç göremezdi;   ║
 * ║ uyarı ancak ertesi sabah, kesinti YAŞANDIKTAN sonra giderdi. Saatlik     ║
 * ║ koşu, tek bir cüzdan sorgusuyla (indeksli, kiracı başına tek satır) çok  ║
 * ║ ucuzdur ve dönem başına tek bildirim ürettiği için gürültü yapmaz.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN TÜKETİM ANINDA (settle içinde) DEĞİL                               ║
 * ║ `CreditsModule` zamanlayıcıyı TANIMAZ; ok yönü tersidir                  ║
 * ║ (SchedulerModule ──▶ CreditsModule) ve `scheduler.module.ts` bu yönü     ║
 * ║ açıkça sözleşme sayar. `settle()` içinden bildirim yazmak ya modüller    ║
 * ║ arası döngü ya da `NotificationOutbox`a İKİNCİ bir yazım yolu            ║
 * ║ gerektirirdi; ikincisi `dedupeKey` sözleşmesini delen ilk yer olurdu.    ║
 * ║ Kararın hesabı `credit-threshold.ts`te SAF bir fonksiyondadır: tüketim   ║
 * ║ anında tetiklemek istendiğinde o fonksiyon olduğu gibi çağrılabilir,     ║
 * ║ yalnız yazma yolu (bu job) değişir.                                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * İDEMPOTENTLİK: anahtar `KREDI_AZALDI:<tenantId>:<periodStart>:<userId>`.
 * Dönem başına, alıcı başına TEK bildirim. İş saatte bir koşsa da ikinci
 * kayıt veritabanı kısıtına takılır ve `atlandi` sayılır — "önce SELECT sonra
 * INSERT" gibi yarışa açık bir kontrol KULLANILMAZ.
 *
 * ALICI: büro yönetimi (ADMIN/PARTNER). Kredi bakiyesi TİCARİ bir veridir;
 * `platform-permissions.ts:407-410`teki aynı gerekçeyle stajyere ya da tüm
 * personele düşmez. Yönetici yoksa kayıt `alicisiz` olarak raporlanır.
 */
@Injectable()
export class CreditLowWarningJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.CREDIT_LOW_WARNING;
  readonly name = "AI kredisi azaldı uyarısı (%80 eşiği)";
  readonly defaultCron = "30 * * * *";
  readonly description =
    "Kullanılabilir AI kredisi dönem tahsisinin %20'sinin altına düşen bürolarda " +
    "yönetime KREDI_AZALDI bildirimi üretir. Dönem başına tek bildirim (idempotent).";

  private readonly logger = new Logger(CreditLowWarningJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutboxService,
    private readonly recipients: TenantRecipientsService,
  ) {}

  async run(_ctx: JobExecutionContext): Promise<JobResult> {
    /**
     * TÜM CÜZDANLAR OKUNUR, EŞİK KODDA UYGULANIR.
     *
     * Eşik SQL'e yazılamaz çünkü karşılaştırma iki sütunun ARİTMETİĞİNE
     * dayanır (`(included−consumed)+purchased ≤ 0.2×included`) ve Prisma'nın
     * `where` dili sütunlar arası aritmetik kabul etmez. Ham SQL yazmak
     * mümkündü ama eşik mantığının iki yerde (SQL + `credit-threshold.ts`)
     * yaşaması demekti; kredi paraya eşdeğerdir ve iki ayrı doğru kabul
     * edilemez. Cüzdan tablosu kiracı başına TEK satırdır — birkaç bin bürolu
     * bir kurulumda bile tam tarama saatlik bir iş için önemsizdir.
     */
    const wallets = await this.prisma.client.creditWallet.findMany({
      select: {
        tenantId: true,
        periodStart: true,
        periodEnd: true,
        includedCredits: true,
        includedConsumed: true,
        purchasedCredits: true,
      },
    });

    let created = 0;
    let skipped = 0;
    let failed = 0;
    let ownerless = 0;
    let esikAltinda = 0;
    const errors: string[] = [];
    const uyarilan: Array<{ tenantId: string; kalan: number; yuzde: number }> = [];

    for (const wallet of wallets) {
      const decision = evaluateCreditWarning(wallet, CREDIT_LOW_WARNING_RATIO);
      if (!decision.warn) continue;
      esikAltinda += 1;

      // TENANT İZOLASYONU: alıcı kümesi kiracının KENDİ aktif kullanıcılarından
      // okunur; bkz. tenant-recipients.ts.
      const audience = await this.recipients.load(wallet.tenantId);
      const targets = audience.fallbackUserIds;
      if (targets.length === 0) {
        ownerless += 1;
        this.logger.warn(
          `Kredi uyarısı gönderilemedi: ${wallet.tenantId} bürosunda aktif ADMIN/PARTNER yok.`,
        );
        continue;
      }

      const text = creditWarningText(decision, wallet.periodEnd);
      const entries: OutboxEntry[] = targets.map((userId) => ({
        tenantId: wallet.tenantId,
        userId,
        kind: "KREDI_AZALDI" as const,
        title: text.title,
        body: text.body,
        resourceType: "CreditWallet",
        resourceId: wallet.tenantId,
        dedupeKey: creditLowKey(wallet.tenantId, wallet.periodStart, userId),
      }));

      const result = await this.outbox.enqueueMany(entries);
      created += result.created;
      skipped += result.skipped;
      failed += result.failed;
      for (const e of result.errors) {
        if (errors.length < 5) errors.push(e);
      }
      if (result.created > 0) {
        uyarilan.push({
          tenantId: wallet.tenantId,
          kalan: decision.kalan,
          yuzde: Math.round(decision.tuketimOrani * 100),
        });
      }
    }

    this.logger.log(
      `Kredi uyarısı: ${wallets.length} cüzdan tarandı, ${esikAltinda} eşik altında, ` +
        `${created} bildirim yazıldı, ${skipped} zaten vardı, ${failed} hata.`,
    );

    return {
      created,
      skipped,
      failed,
      errors,
      detail: {
        taranan: wallets.length,
        esikAltinda,
        esikYuzde: Math.round(CREDIT_LOW_WARNING_RATIO * 100),
        alicisiz: ownerless,
        uyarilan,
      },
    };
  }
}
