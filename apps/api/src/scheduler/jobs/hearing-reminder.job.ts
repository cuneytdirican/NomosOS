import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { addDays, formatTrDate, startOfDay, trCalendarDay } from "../../common/dates";
import { hearingReminderKey } from "../dedupe-key";
import { NotificationOutboxService, type OutboxEntry } from "../notification-outbox.service";
import { TenantRecipientsService } from "../tenant-recipients";
import { JOB_KEYS, SCHEDULER_TZ_OFFSET_MINUTES } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/** Duruşma türlerinin Türkçe etiketleri — bildirim metni için. */
const HEARING_TYPE_LABELS: Record<string, string> = {
  DURUSMA: "Duruşma",
  ON_INCELEME: "Ön inceleme",
  KESIF: "Keşif",
  E_DURUSMA: "e-Duruşma",
  MUZAKERE: "Müzakere",
  DIGER: "Duruşma",
};

/**
 * ERTESİ GÜN DURUŞMA HATIRLATMASI (`hearing-reminder-daily`).
 *
 * AKŞAM ÇALIŞIR (varsayılan 18:00 TR): duruşma hazırlığı bir gün önceden
 * yapılır; sabah 07:00'da gönderilen "bugün duruşman var" bildirimi hazırlık
 * için geç kalmış olurdu.
 *
 * YALNIZ `PLANLANDI` duruşmalar: `ERTELENDI`/`IPTAL` edilmiş bir duruşma için
 * hatırlatma göndermek avukatı boş yere adliyeye yollardı. `YAPILDI` zaten
 * geçmiştir.
 *
 * İDEMPOTENTLİK: anahtar DURUŞMANIN GÜNÜNÜ taşır
 * (`DURUSMA_YARIN:<id>:<YYYY-MM-DD>:<userId>`). İş aynı akşam iki kez
 * tetiklense de anahtar aynıdır. Duruşma başka bir güne ertelenirse anahtar
 * DEĞİŞİR ve avukat yeni tarih için yeniden uyarılır — istenen davranış budur.
 *
 * SAAT GÖSTERİMİ: `Hearing.date` UTC saklanır; bildirimde TÜRKİYE YEREL saati
 * gösterilir. "09:30 duruşma" metnini UTC ile yazmak avukatı 3 saat yanıltırdı.
 */
@Injectable()
export class HearingReminderJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.HEARING_REMINDER;
  readonly name = "Ertesi gün duruşma hatırlatmaları";
  readonly defaultCron = "0 18 * * *";
  readonly description =
    "Ertesi günün PLANLANDI duruşmaları için dosya sorumlusu avukata bildirim üretir.";

  private readonly logger = new Logger(HearingReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutboxService,
    private readonly recipients: TenantRecipientsService
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    // "Bugün" TÜRKİYE takvim günüdür — cron da TR saatiyle tetiklenir
    // (denetim bulgusu 5). Elle verilen `targetDate` zaten bir takvim günüdür.
    const today = ctx.targetDate ? startOfDay(ctx.targetDate) : trCalendarDay(ctx.now);
    const tomorrow = addDays(today, 1);
    const dayAfter = addDays(today, 2);

    const tenants = await this.prisma.client.tenant.findMany({ select: { id: true, name: true } });

    let created = 0;
    let skipped = 0;
    let failed = 0;
    let ownerless = 0;
    let total = 0;
    const errors: string[] = [];

    for (const tenant of tenants) {
      const hearings = await this.prisma.client.hearing.findMany({
        where: {
          tenantId: tenant.id, // İZOLASYON: kiracı süzgeci sorgunun yapısındadır.
          status: "PLANLANDI",
          date: { gte: tomorrow, lt: dayAfter },
        },
        select: {
          id: true,
          date: true,
          type: true,
          courtroom: true,
          case: {
            select: { id: true, title: true, fileNumber: true, courtName: true, responsibleUserId: true },
          },
        },
        orderBy: { date: "asc" },
      });

      total += hearings.length;
      if (hearings.length === 0) continue;

      const audience = await this.recipients.load(tenant.id);
      const entries: OutboxEntry[] = [];

      for (const hearing of hearings) {
        const targets = TenantRecipientsService.resolve(
          audience,
          hearing.case.responsibleUserId
        );
        if (targets.length === 0) {
          ownerless += 1;
          continue;
        }
        const label = HEARING_TYPE_LABELS[hearing.type] ?? "Duruşma";
        const body =
          `${formatTrDate(tomorrow)} ${trTime(hearing.date)} — ` +
          `${hearing.case.courtName ?? "mahkeme bilgisi girilmemiş"}` +
          `${hearing.courtroom ? `, ${hearing.courtroom}` : ""}. ` +
          `Dosya: ${hearing.case.title}` +
          `${hearing.case.fileNumber ? ` (${hearing.case.fileNumber})` : ""}.`;

        for (const userId of targets) {
          entries.push({
            tenantId: tenant.id,
            userId,
            kind: "DURUSMA_YARIN",
            title: `Yarın ${label.toLowerCase()}: ${hearing.case.title}`,
            body,
            resourceType: "Hearing",
            resourceId: hearing.id,
            dedupeKey: hearingReminderKey(hearing.id, tomorrow, userId),
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
      `Duruşma hatırlatmaları (${tomorrow.toISOString().slice(0, 10)}): ` +
        `${created} yeni, ${skipped} atlandı, ${failed} hata.`
    );

    return {
      created,
      skipped,
      failed,
      errors,
      detail: {
        durusmaGunu: tomorrow.toISOString().slice(0, 10),
        kiraciSayisi: tenants.length,
        durusmaSayisi: total,
        sorumlusuzDurusma: ownerless,
      },
    };
  }
}

/** UTC zaman damgasından TR yerel "HH:MM". */
function trTime(date: Date): string {
  const local = new Date(date.getTime() + SCHEDULER_TZ_OFFSET_MINUTES * 60_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}
