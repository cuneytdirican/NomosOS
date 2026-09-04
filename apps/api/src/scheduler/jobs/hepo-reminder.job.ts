import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { startOfDay, addDays, formatTrDate, trCalendarDay } from "../../common/dates";
import { hepoOverdueKey, hepoReminderKey, type HepoWindow } from "../dedupe-key";
import {
  NotificationOutboxService,
  type OutboxEntry,
} from "../notification-outbox.service";
import { TenantRecipientsService } from "../tenant-recipients";
import {
  HEPO_REMINDER_WINDOWS,
  JOB_KEYS,
  OVERDUE_LOOKBACK_DAYS,
} from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * HEPO YÜKÜMLÜLÜK HATIRLATMALARI (`hepo-reminder-daily`, Modül 28 Faz 3).
 *
 * Süre hatırlatma işiyle AYNI sözleşmeyi izler:
 *
 *  - İDEMPOTENTLİK: anahtar satır + pencere + alıcı + VADE GÜNÜ üzerinden
 *    üretilir (`dedupe-key.ts` → hepoReminderKey/hepoOverdueKey). Vade
 *    düzeltilirse yeni anahtar üretilir, yeni tarih için yeniden hatırlatılır.
 *  - TENANT İZOLASYONU: kiracılar tek tek dolaşılır; her sorgu `tenantId`
 *    süzgeci taşır (izolasyon sorgunun yapısındadır, kodun dikkatinde değil).
 *  - ALICI: atamayı yapan kullanıcı (`createdBy`); pasif/silinmişse büro
 *    yönetimine (ADMIN/PARTNER) düşer — resolveDetailed bu kararı verir.
 *
 * UYGUN durumundaki yükümlülükler HATIRLATILMAZ: uyumlu kayıt için "vade
 * yaklaşıyor" bildirimi gürültüdür. ACIK / UYGUN_DEGIL / IHLAL hatırlatılır.
 */
@Injectable()
export class HepoReminderJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.HEPO_REMINDER;
  readonly name = "HEPO yükümlülüğü hatırlatmaları";
  readonly defaultCron = "0 7 * * *";
  readonly description =
    "Müvekkile atanmış İSG/çevre/sağlık yükümlülükleri için 30/7/1 gün kala " +
    "hatırlatma, vadesi geçenler için tek seferlik SURE_GECTI bildirimi üretir. " +
    "UYGUN durumundaki kayıtlar kapsam dışıdır.";

  private readonly logger = new Logger(HepoReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutboxService,
    private readonly recipients: TenantRecipientsService
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    // "Bugün" Türkiye takvim günü — DeadlineReminderJob ile aynı kural.
    const today = ctx.targetDate ? startOfDay(ctx.targetDate) : trCalendarDay(ctx.now);
    const tenants = await this.prisma.client.tenant.findMany({ select: { id: true, name: true } });

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    let ownerless = 0;
    let fellBackToManagement = 0;
    const perWindow: Record<string, number> = {};

    for (const tenant of tenants) {
      const audience = await this.recipients.load(tenant.id);
      const entries: OutboxEntry[] = [];

      // ---- Yaklaşan vadeler: 30 / 7 / 1 gün kala --------------------------
      for (const window of HEPO_REMINDER_WINDOWS) {
        const dueDay = addDays(today, window);
        const rows = await this.findRows(tenant.id, {
          gte: dueDay,
          lt: addDays(dueDay, 1),
        });
        perWindow[`${window}g`] = (perWindow[`${window}g`] ?? 0) + rows.length;

        for (const row of rows) {
          // Sorgu not-null süzer ama tür Date | null'dır — daraltma kodda.
          if (!row.dueDate) continue;
          const { targets, fallback } = TenantRecipientsService.resolveDetailed(
            audience,
            row.createdBy
          );
          if (targets.length === 0) {
            ownerless += 1;
            continue;
          }
          if (fallback) fellBackToManagement += 1;
          for (const userId of targets) {
            entries.push({
              tenantId: tenant.id,
              userId,
              kind: "SURE_YAKLASIYOR",
              title: `${window} gün kaldı: ${row.obligation.title}`,
              body: this.upcomingBody(row, window, dueDay),
              resourceType: "HepoClientObligation",
              resourceId: row.id,
              dedupeKey: hepoReminderKey(row.id, window as HepoWindow, userId, row.dueDate),
            });
          }
        }
      }

      // ---- Vadesi geçenler (tek seferlik) ---------------------------------
      const overdue = await this.findRows(tenant.id, {
        gte: addDays(today, -OVERDUE_LOOKBACK_DAYS),
        lt: today,
      });
      perWindow.gecmis = (perWindow.gecmis ?? 0) + overdue.length;

      for (const row of overdue) {
        if (!row.dueDate) continue;
        const { targets, fallback } = TenantRecipientsService.resolveDetailed(
          audience,
          row.createdBy
        );
        if (targets.length === 0) {
          ownerless += 1;
          continue;
        }
        if (fallback) fellBackToManagement += 1;
        const lateDays = Math.round((today.getTime() - startOfDay(row.dueDate).getTime()) / 86_400_000);
        for (const userId of targets) {
          entries.push({
            tenantId: tenant.id,
            userId,
            kind: "SURE_GECTI",
            title: `VADE GEÇTİ: ${row.obligation.title}`,
            body:
              `${formatTrDate(row.dueDate)} tarihli yükümlülük vadesi ${lateDays} gün önce doldu ` +
              `ve hâlâ uyumlu görünüyor. Müvekkil: ${row.client.name}` +
              `. Dayanak: ${row.obligation.legalBasis}` +
              ". Bu bildirim bir kez üretilir; durumu HEPO → Müvekkil Takibi'nden güncelleyiniz.",
            resourceType: "HepoClientObligation",
            resourceId: row.id,
            dedupeKey: hepoOverdueKey(row.id, userId, row.dueDate),
          });
        }
      }

      const result = await this.outbox.enqueueMany(entries);
      created += result.created;
      skipped += result.skipped;
      failed += result.failed;
      for (const e of result.errors) if (errors.length < 5) errors.push(`${tenant.name}: ${e}`);
    }

    this.logger.log(
      `HEPO hatırlatmaları: ${created} yeni, ${skipped} atlandı (zaten var), ${failed} hata.`
    );

    return {
      created,
      skipped,
      failed,
      errors,
      detail: {
        gun: today.toISOString().slice(0, 10),
        kiraciSayisi: tenants.length,
        pencereBasinaYukumluluk: perWindow,
        alicisizYukumluluk: ownerless,
        yonetimeDusenYukumluluk: fellBackToManagement,
        gecmisGeriyeBakisGun: OVERDUE_LOOKBACK_DAYS,
      },
    };
  }

  /**
   * UYUMLU olmayan kayıtlar; vade aralığı [gün, gün+1) — sürücünün tarihi
   * gün başı zaman damgasına çevirdiği kırılganlığa karşı aralık sorgusu.
   */
  private findRows(tenantId: string, range: { gte: Date; lt: Date }) {
    return this.prisma.client.hepoClientObligation.findMany({
      where: {
        tenantId, // İZOLASYON: bu süzgeç kaldırılamaz.
        status: { not: "UYGUN" },
        dueDate: { not: null, ...range },
      },
      select: {
        id: true,
        dueDate: true,
        createdBy: true,
        obligation: { select: { title: true, legalBasis: true } },
        client: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
    });
  }

  private upcomingBody(
    row: { client: { name: string }; obligation: { title: string; legalBasis: string } },
    window: number,
    dueDay: Date
  ): string {
    return (
      `Vade ${formatTrDate(dueDay)} (${window} gün kaldı). ` +
      `Müvekkil: ${row.client.name}. Yükümlülük: ${row.obligation.title} (${row.obligation.legalBasis}).`
    );
  }
}
