import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../../platform/platform-audit.service";
import { canTransition } from "../../platform/subscriptions/subscription-state";
import { addDays } from "../../common/dates";
import { SubscriptionInvoiceService, INVOICE_LEAD_DAYS } from "../../platform-billing/subscription-invoice.service";
import { NotificationOutboxService, type OutboxEntry } from "../notification-outbox.service";
import { TenantRecipientsService } from "../tenant-recipients";
import { dunningKey, invoiceIssuedKey, trialEndingKey } from "../dedupe-key";
import {
  JOB_AUDIT_ACTIONS,
  JOB_KEYS,
  SUBSCRIPTION_GRACE_DAYS,
  SUBSCRIPTION_UPCOMING_DAYS,
} from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * ABONELİK DÖNEM DENETİMİ (`subscription-renewal-daily`) — PLATFORM TARAFI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BU İŞ NE YAPMAZ: otomatik TAHSİLAT yapmaz, otomatik ASKIYA ALMAZ,        ║
 * ║ otomatik İPTAL ETMEZ.                                                    ║
 * ║                                                                          ║
 * ║ Askıya alma ve iptal, `subscription-state.ts` gereği DÖRT-GÖZ onayına    ║
 * ║ tabidir: bir bürodaki bütün avukatların sisteme erişimini kesmek, tek    ║
 * ║ kişinin — hele bir CRON İŞİNİN — veremeyeceği bir karardır. Zamanlanmış  ║
 * ║ bir işin dört-göz kapısını atlaması, kuralı "insan yaparsa iki imza,     ║
 * ║ makine yaparsa sıfır imza"ya çevirir ve kontrolü tümden anlamsız kılar.  ║
 * ║                                                                          ║
 * ║ İŞİN YAPTIĞI TEK MUTASYON: `ACTIVE → PAST_DUE`. Bu geçiş YIKICI DEĞİLDİR ║
 * ║ (erişim kesilmez, yalnız "ödeme gecikmiş" işaretlenir), durum makinesinde║
 * ║ izinlidir ve dört-göz listesinde yer almaz. Geri kalan her şey RAPORDUR: ║
 * ║ askıya alınması önerilenler ve deneme süresi dolanlar `detailJson`a      ║
 * ║ yazılır, kararı insan verir.                                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * İDEMPOTENTLİK: geçiş `updateMany({ where: { id, status: "ACTIVE" } })` ile
 * yapılır. İkinci koşuda satır artık `PAST_DUE` olduğu için süzgece takılmaz,
 * `count` 0 döner ve iş `ATLANDI` işaretlenir. Koruma KOŞUL SÜZGECİNDEDİR;
 * "önce oku sonra yaz" iki eşzamanlı koşuda çift denetim kaydı üretirdi.
 */
@Injectable()
export class SubscriptionRenewalJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.SUBSCRIPTION_RENEWAL;
  readonly name = "Abonelik dönem yenileme denetimi";
  readonly defaultCron = "0 3 * * *";
  readonly description =
    "Dönem sonuna 7 gün kala DÖNEM FATURASI keser ve yöneticilere bildirir (Faz 3); dönemi biten " +
    "ACTIVE abonelikleri PAST_DUE işaretler; gecikmiş ödemede 1/3/7. gün DUNNING bildirimi, deneme " +
    "bitişine 3 gün kala uyarı üretir; askıya alma/iptal ÖNERİLERİNİ raporlar (dört-göz).";

  private readonly logger = new Logger(SubscriptionRenewalJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly invoices: SubscriptionInvoiceService,
    private readonly outbox: NotificationOutboxService,
    private readonly recipients: TenantRecipientsService,
  ) {}

  /** Faz 3: büronun ADMIN/PARTNER kullanıcılarına bildirim satırları üretir. */
  private async notifyAdmins(tenantId: string, build: (userId: string) => OutboxEntry): Promise<number> {
    const audience = await this.recipients.load(tenantId);
    if (audience.fallbackUserIds.length === 0) return 0;
    const res = await this.outbox.enqueueMany(audience.fallbackUserIds.map(build));
    return res.created;
  }

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const now = ctx.now;

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    // ---- 0) Faz 3: dönem sonuna INVOICE_LEAD_DAYS kala DÖNEM FATURASI --------
    // İdempotent: [tenantId, ABONELIK, periodStart] tekil; ikinci koşu "zaten var".
    const faturaAdaylari = await this.prisma.client.subscription.findMany({
      where: {
        status: { in: ["ACTIVE", "PAST_DUE"] },
        currentPeriodEnd: { not: null, lte: addDays(now, INVOICE_LEAD_DAYS) },
      },
    });
    let faturaKesilen = 0;
    let faturaBildirim = 0;
    for (const sub of faturaAdaylari) {
      if (!sub.currentPeriodEnd) continue;
      try {
        const res = await this.invoices.issueForPeriod({ subscription: sub, periodStart: sub.currentPeriodEnd, now });
        if (!res.created) continue;
        faturaKesilen += 1;
        const inv = res.invoice;
        faturaBildirim += await this.notifyAdmins(sub.tenantId, (userId) => ({
          tenantId: sub.tenantId,
          userId,
          kind: "FATURA_KESILDI",
          title: `Abonelik faturası kesildi: ${inv.number ?? ""} — ${inv.total.toFixed(2)} TRY`,
          body:
            `${inv.description ?? "Dönem faturası"}. Son ödeme tarihi ${inv.dueDate?.toISOString().slice(0, 10) ?? "-"}. ` +
            "Ayarlar → Abonelik ekranından çevrimiçi ödeyebilir ya da havale/EFT ile gönderebilirsiniz.",
          resourceType: "InvoiceRecord",
          resourceId: inv.id,
          dedupeKey: invoiceIssuedKey(inv.id, userId),
        }));
        await this.audit.log({
          actor: null,
          action: "SUBSCRIPTION_INVOICE_ISSUED",
          entity: "InvoiceRecord",
          entityId: inv.id,
          tenantId: sub.tenantId,
          detail: `Dönem faturası ${inv.number} kesildi: ${inv.total.toFixed(2)} TRY (${inv.description ?? ""}).`,
        });
      } catch (err) {
        failed += 1;
        if (errors.length < 5) errors.push(`fatura ${sub.tenantId}: ${(err as Error).message}`);
        this.logger.warn(`Dönem faturası kesilemedi (${sub.tenantId}): ${(err as Error).message}`);
      }
    }

    // ---- 1) Dönemi biten ACTIVE abonelikler → PAST_DUE ---------------------
    const expired = await this.prisma.client.subscription.findMany({
      where: { status: "ACTIVE", currentPeriodEnd: { not: null, lte: now } },
      select: { id: true, tenantId: true, planKey: true, currentPeriodEnd: true },
    });

    const transitioned: Array<{ tenantId: string; periodEnd: string | null }> = [];

    for (const sub of expired) {
      // Durum makinesine SORULUR; iş kuralı tek yerde tanımlıdır ve burada
      // kopyalanmaz. Geçiş kapatılırsa bu iş de kendiliğinden durur.
      if (!canTransition("ACTIVE", "PAST_DUE")) {
        skipped += 1;
        continue;
      }
      try {
        const result = await this.prisma.client.subscription.updateMany({
          // `status: "ACTIVE"` KOŞULU İDEMPOTENTLİĞİN KENDİSİDİR.
          where: { id: sub.id, status: "ACTIVE" },
          data: { status: "PAST_DUE" },
        });
        if (result.count === 0) {
          skipped += 1;
          continue;
        }
        created += 1;
        transitioned.push({
          tenantId: sub.tenantId,
          periodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        });
        await this.audit.log({
          // Fail: sistem kaynaklı işlemde platform kullanıcısı YOKTUR.
          // `actor` null bırakılır; uydurma bir kullanıcı yazmak denetim izini
          // yalanlardı.
          actor: null,
          action: JOB_AUDIT_ACTIONS.AUTO_PAST_DUE,
          entity: "Subscription",
          entityId: sub.id,
          tenantId: sub.tenantId,
          detail:
            `Zamanlanmış iş (${this.key}, tetikleyici: ${ctx.trigger}): dönem sonu ` +
            `${sub.currentPeriodEnd?.toISOString().slice(0, 10) ?? "-"} geçti, ` +
            "abonelik ACTIVE → PAST_DUE işaretlendi. Tahsilat ve askıya alma YAPILMADI.",
        });
      } catch (err) {
        failed += 1;
        if (errors.length < 5) errors.push(`${sub.tenantId}: ${(err as Error).message}`);
        this.logger.warn(
          `Abonelik PAST_DUE işaretlenemedi (${sub.tenantId}): ${(err as Error).message}`
        );
      }
    }

    // ---- 1b) Faz 3: DUNNING — PAST_DUE 1/3/7. gün bildirimi (e-posta dağıtım işiyle çıkar)
    const pastDue = await this.prisma.client.subscription.findMany({
      where: { status: "PAST_DUE", currentPeriodEnd: { not: null } },
      select: { id: true, tenantId: true, currentPeriodEnd: true },
    });
    let dunningBildirim = 0;
    for (const sub of pastDue) {
      if (!sub.currentPeriodEnd) continue;
      const periodEnd = sub.currentPeriodEnd;
      const gun = Math.floor((now.getTime() - periodEnd.getTime()) / 86_400_000);
      if (![1, 3, 7].includes(gun)) continue;
      const acik = await this.prisma.client.invoiceRecord.findFirst({
        where: { tenantId: sub.tenantId, type: "ABONELIK", status: { in: ["GONDERILDI", "TASLAK", "KISMI_ODENDI"] } },
        orderBy: { issueDate: "desc" },
        select: { id: true, number: true, total: true },
      });
      const kalan = Math.max(0, SUBSCRIPTION_GRACE_DAYS - gun);
      dunningBildirim += await this.notifyAdmins(sub.tenantId, (userId) => ({
        tenantId: sub.tenantId,
        userId,
        kind: "ODEME_GECIKTI",
        title: `Abonelik ödemesi ${gun} gündür gecikmiş${acik ? ` — ${acik.number ?? ""} ${acik.total.toFixed(2)} TRY` : ""}`,
        body:
          `Dönem ${periodEnd.toISOString().slice(0, 10)} tarihinde bitti; ödeme alınamadı. ` +
          (kalan > 0
            ? `${kalan} gün içinde ödenmezse yazma işlemleri kapanır (veriler silinmez).`
            : "Ödeme süresi doldu; yazma işlemleri ödeme tamamlanana kadar kapalı.") +
          " Ayarlar → Abonelik ekranından ödeyebilirsiniz.",
        resourceType: acik ? "InvoiceRecord" : "Subscription",
        resourceId: acik?.id ?? sub.id,
        dedupeKey: dunningKey(sub.id, periodEnd, gun, userId),
      }));
    }

    // ---- 1c) Faz 3: deneme bitişine 3 gün kala uyarı -------------------------
    const trialSoon = await this.prisma.client.subscription.findMany({
      where: { status: "TRIAL", trialEndsAt: { gt: now, lte: addDays(now, 3) } },
      select: { id: true, tenantId: true, trialEndsAt: true },
    });
    let denemeBildirim = 0;
    for (const sub of trialSoon) {
      if (!sub.trialEndsAt) continue;
      const trialEndsAt = sub.trialEndsAt;
      denemeBildirim += await this.notifyAdmins(sub.tenantId, (userId) => ({
        tenantId: sub.tenantId,
        userId,
        kind: "DENEME_BITIYOR",
        title: `Deneme süreniz ${trialEndsAt.toISOString().slice(0, 10)} tarihinde bitiyor`,
        body: "Aboneliği başlatmak için Ayarlar → Abonelik ekranından plan seçip ilk dönem faturasını ödeyin. Verileriniz korunur.",
        resourceType: "Subscription",
        resourceId: sub.id,
        dedupeKey: trialEndingKey(sub.id, trialEndsAt, userId),
      }));
    }

    // ---- 2) RAPOR: askıya alma önerilenler (MUTASYON YOK) -----------------
    const graceCutoff = addDays(now, -SUBSCRIPTION_GRACE_DAYS);
    const suspendCandidates = await this.prisma.client.subscription.findMany({
      where: { status: "PAST_DUE", currentPeriodEnd: { not: null, lte: graceCutoff } },
      select: { id: true, tenantId: true, currentPeriodEnd: true },
    });

    // ---- 3) RAPOR: deneme süresi dolanlar (MUTASYON YOK) ------------------
    const trialExpired = await this.prisma.client.subscription.findMany({
      where: { status: "TRIAL", trialEndsAt: { not: null, lte: now } },
      select: { id: true, tenantId: true, trialEndsAt: true },
    });

    // ---- 4) RAPOR: yaklaşan yenilemeler ----------------------------------
    const upcoming = await this.prisma.client.subscription.count({
      where: {
        status: { in: ["ACTIVE", "TRIAL"] },
        currentPeriodEnd: { gt: now, lte: addDays(now, SUBSCRIPTION_UPCOMING_DAYS) },
      },
    });

    this.logger.log(
      `Abonelik denetimi: ${created} abonelik PAST_DUE, ` +
        `${suspendCandidates.length} askıya alma önerisi, ${trialExpired.length} deneme süresi doldu.`
    );

    return {
      created,
      skipped,
      failed,
      errors,
      detail: {
        faturaKesilen,
        faturaBildirim,
        dunningBildirim,
        denemeBildirim,
        pastDueYapilan: transitioned,
        /**
         * DÖRT-GÖZ BEKLEYENLER — iş bunlara DOKUNMAZ. Operatör panelden
         * `POST /subscriptions/:id/transition` ile onay kuyruğunu açar.
         */
        askiyaAlmaOnerilen: suspendCandidates.map((s) => ({
          tenantId: s.tenantId,
          donemSonu: s.currentPeriodEnd?.toISOString().slice(0, 10) ?? null,
          gerekce: `${SUBSCRIPTION_GRACE_DAYS} günlük ödeme süresi aşıldı.`,
        })),
        denemeSuresiDolan: trialExpired.map((s) => ({
          tenantId: s.tenantId,
          denemeBitisi: s.trialEndsAt?.toISOString().slice(0, 10) ?? null,
        })),
        yaklasanYenileme: upcoming,
        yaklasanPencereGun: SUBSCRIPTION_UPCOMING_DAYS,
        otomatikTahsilat: false,
        otomatikAskiyaAlma: false,
      },
    };
  }
}
