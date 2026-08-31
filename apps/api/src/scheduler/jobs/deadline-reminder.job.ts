import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { startOfDay, addDays, formatTrDate, trCalendarDay } from "../../common/dates";
import { deadlineOverdueKey, deadlineReminderKey, type DeadlineWindow } from "../dedupe-key";
import {
  NotificationOutboxService,
  type OutboxEntry,
} from "../notification-outbox.service";
// denetim bulgusu Ö-33b: kullanılmayan `TenantAudience` tip içe aktarımı
// kaldırıldı — ilk gerçek lint koşusunun yakaladığı ölü içe aktarım.
import { TenantRecipientsService } from "../tenant-recipients";
import {
  DEADLINE_REMINDER_WINDOWS,
  JOB_KEYS,
  OVERDUE_LOOKBACK_DAYS,
} from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * SÜRE HATIRLATMALARI (`deadline-reminder-daily`).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ YALNIZ `ONAYLANDI` SÜRELER HATIRLATILIR.                                 ║
 * ║                                                                          ║
 * ║ `BEKLIYOR` durumundaki bir süre, AI'ın ÖNERDİĞİ ama avukatın HENÜZ       ║
 * ║ ONAYLAMADIĞI bir tarihtir (`DeadlineStatus.BEKLIYOR` = "AI önerisi:      ║
 * ║ onay bekliyor"). Onaylanmamış bir öneri için "3 gün kaldı" bildirimi     ║
 * ║ göndermek, ürünün en temel ilkesini çiğnerdi: AI ÇIKTISI ÖNERİDİR.       ║
 * ║ Bildirim, öneriyi sessizce KESİNLEŞMİŞ bir süreye dönüştürürdü — üstelik ║
 * ║ hatalı bir öneriye göre iş planlanmasına yol açarak gerçek bir süre      ║
 * ║ kaçırmasına neden olabilirdi. Onay bekleyen öneriler AYRI bir bildirim   ║
 * ║ türünün (ONAY_BEKLIYOR) konusudur.                                       ║
 * ║                                                                          ║
 * ║ `TAMAMLANDI`, `IPTAL` ve `KACIRILDI` de kapsam dışıdır: ilk ikisi bitmiş ║
 * ║ işlerdir, sonuncusu zaten insan eliyle işaretlenmiş bir kaçırmadır.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * İDEMPOTENTLİK: anahtar SÜRENİN KENDİSİNE ve PENCEREYE bağlıdır, işin
 * çalıştığı güne değil (`SURE_YAKLASIYOR:<id>:3g:<userId>`). Bir süre için
 * "3 gün kala" penceresi ömründe bir kez oluşur; iş o gün on kez tetiklense
 * de anahtar aynıdır ve bildirim bir kez yazılır.
 *
 * TENANT İZOLASYONU: kiracılar TEK TEK dolaşılır ve her sorgu `tenantId`
 * süzgeci taşır. Tüm kiracıları tek sorguda tarayıp bellekte gruplamak daha
 * hızlı olurdu; ancak o tasarımda tek bir gruplama hatası bir büronun
 * süresini başka büronun avukatına gönderirdi. Burada izolasyon SORGUNUN
 * YAPISINDADIR, kodun dikkatinde değil.
 */
@Injectable()
export class DeadlineReminderJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.DEADLINE_REMINDER;
  readonly name = "Yaklaşan ve geçen süre hatırlatmaları";
  readonly defaultCron = "0 7 * * *";
  readonly description =
    "ONAYLANDI durumundaki süreler için 7/3/1 gün kala hatırlatma, geçmiş süreler " +
    "için tek seferlik SURE_GECTI bildirimi üretir. AI önerisi (BEKLIYOR) süreler kapsam dışıdır.";

  private readonly logger = new Logger(DeadlineReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutboxService,
    private readonly recipients: TenantRecipientsService
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    /**
     * "BUGÜN" TÜRKİYE TAKVİM GÜNÜDÜR (denetim bulgusu 5).
     *
     * Cron TR saatiyle tetiklenir; "bugün"ü UTC takviminden okumak, TR
     * saatiyle gece yarısı ile 03:00 arasında çalışan bir iş için pencereleri
     * BİR GÜN kaydırırdı. Elle verilen `targetDate` zaten bir takvim günüdür
     * (YYYY-MM-DD), olduğu gibi kullanılır.
     */
    const today = ctx.targetDate ? startOfDay(ctx.targetDate) : trCalendarDay(ctx.now);
    const tenants = await this.prisma.client.tenant.findMany({ select: { id: true, name: true } });

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    let ownerless = 0;
    /** Sahibi çözülemeyip büro yönetimine düşen süre sayısı (bkz. bulgu 17). */
    let fellBackToManagement = 0;
    const perWindow: Record<string, number> = {};

    for (const tenant of tenants) {
      const audience = await this.recipients.load(tenant.id);
      const entries: OutboxEntry[] = [];

      // ---- Yaklaşan süreler: 7 / 3 / 1 gün kala -------------------------
      for (const window of DEADLINE_REMINDER_WINDOWS) {
        const dueDay = addDays(today, window);
        const rows = await this.findDeadlines(tenant.id, {
          gte: dueDay,
          lt: addDays(dueDay, 1),
        });
        perWindow[`${window}g`] = (perWindow[`${window}g`] ?? 0) + rows.length;

        for (const row of rows) {
          const { targets, fallback } = TenantRecipientsService.resolveDetailed(
            audience,
            row.ownerId ?? row.case.responsibleUserId
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
              title: `${window} gün kaldı: ${row.title}`,
              body: this.upcomingBody(row, window, dueDay),
              resourceType: "Deadline",
              resourceId: row.id,
              // Anahtar VADE GÜNÜNÜ taşır: vade düzeltilirse yeni anahtar
              // üretilir ve yeni tarih için hatırlatmalar yeniden gider.
              dedupeKey: deadlineReminderKey(row.id, window as DeadlineWindow, userId, row.dueDate),
            });
          }
        }
      }

      // ---- Geçmiş süreler ------------------------------------------------
      const overdue = await this.findDeadlines(tenant.id, {
        gte: addDays(today, -OVERDUE_LOOKBACK_DAYS),
        lt: today,
      });
      perWindow.gecmis = (perWindow.gecmis ?? 0) + overdue.length;

      for (const row of overdue) {
        const { targets, fallback } = TenantRecipientsService.resolveDetailed(
          audience,
          row.ownerId ?? row.case.responsibleUserId
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
            title: `SÜRE GEÇTİ: ${row.title}`,
            body:
              `${formatTrDate(row.dueDate)} tarihli süre ${lateDays} gün önce doldu ` +
              `ve hâlâ açık görünüyor. Dosya: ${row.case.title}` +
              (row.case.fileNumber ? ` (${row.case.fileNumber})` : "") +
              (row.legalBasis ? `. Dayanak: ${row.legalBasis}` : "") +
              ". Bu bildirim bir kez üretilir; durumu güncelleyiniz.",
            resourceType: "Deadline",
            resourceId: row.id,
            dedupeKey: deadlineOverdueKey(row.id, userId, row.dueDate),
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
      `Süre hatırlatmaları: ${created} yeni, ${skipped} atlandı (zaten var), ${failed} hata.`
    );

    return {
      created,
      skipped,
      failed,
      errors,
      detail: {
        gun: today.toISOString().slice(0, 10),
        kiraciSayisi: tenants.length,
        pencereBasinaSure: perWindow,
        alicisizSure: ownerless,
        // Sahibi pasif/silinmiş olduğu için büro yönetimine düşen süreler.
        // Büro içi gizlilik açısından izlenmesi gereken sayıdır: beklenmedik
        // artış, atama tarafında bir sorunun ilk işaretidir.
        yonetimeDusenSure: fellBackToManagement,
        gecmisGeriyeBakisGun: OVERDUE_LOOKBACK_DAYS,
      },
    };
  }

  /**
   * `dueDate` alanı `@db.Date`tir. Eşitlik yerine [gün, gün+1) ARALIĞI
   * kullanılır: sürücü katmanı tarihi bazen gün başı zaman damgasına
   * çevirdiği için doğrudan eşitlik kırılgandır.
   */
  private findDeadlines(tenantId: string, range: { gte: Date; lt: Date }) {
    return this.prisma.client.deadline.findMany({
      where: {
        tenantId, // İZOLASYON: bu süzgeç kaldırılamaz.
        status: "ONAYLANDI",
        dueDate: range,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        ownerId: true,
        legalBasis: true,
        computeNote: true,
        case: { select: { id: true, title: true, fileNumber: true, responsibleUserId: true } },
      },
      orderBy: { dueDate: "asc" },
    });
  }

  private upcomingBody(
    row: { case: { title: string; fileNumber: string | null }; legalBasis: string | null },
    window: number,
    dueDay: Date
  ): string {
    const parts = [
      `Son gün ${formatTrDate(dueDay)} (${window} gün kaldı).`,
      `Dosya: ${row.case.title}${row.case.fileNumber ? ` (${row.case.fileNumber})` : ""}.`,
    ];
    // Dayanak GÖSTERİLİR: kaynak gösterme zorunluluğu bildirimlerde de geçerlidir.
    if (row.legalBasis) parts.push(`Dayanak: ${row.legalBasis}.`);
    return parts.join(" ");
  }
}
