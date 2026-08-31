import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../../platform/platform-audit.service";
import { canTransition } from "../../platform/subscriptions/subscription-state";
import { addDays } from "../../common/dates";
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
    "Dönemi biten ACTIVE abonelikleri PAST_DUE olarak işaretler; askıya alma ve " +
    "iptal ÖNERİLERİNİ raporlar (otomatik tahsilat/askıya alma YAPMAZ — dört-göz).";

  private readonly logger = new Logger(SubscriptionRenewalJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const now = ctx.now;

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

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
