/**
 * SÖZLEŞME ↔ SÜRE MOTORU KÖPRÜSÜ — HESAP DETERMİNİSTİKTİR, AI YOKTUR.
 *
 * ── HESAP ───────────────────────────────────────────────────────────────────
 *   son ihbar günü = effectiveTo − renewalNoticeDays
 *   gün iş günü değilse → BİR ÖNCEKİ İŞ GÜNÜNE çekilir.
 *
 * NEDEN ÖNCEKİ İŞ GÜNÜ (ileri değil): fesih ihbarının süresi İÇİNDE ulaşması
 * gerekir. HMK m.93'ün "son gün tatile rastlarsa ertesi iş gününe uzar" kuralı
 * KANUNİ SÜRELER içindir; burada süre kanundan değil SÖZLEŞMEDEN doğar.
 * Sözleşmesel bir ihbar süresini tatil nedeniyle UZATMAK, sözleşmeyi
 * müvekkilin aleyhine yorumlamak olurdu. Bu yüzden gün geriye çekilir ve
 * hesap izine (`computeNote`) bu tercih AÇIKÇA yazılır.
 *
 * Gün aritmetiği, hafta sonu ve resmî tatil bilgisi tamamen
 * `@nomosos/legal-core`den gelir; bu dosyada elle tarih hesabı YOKTUR.
 *
 * ── ONAY NOKTASI ────────────────────────────────────────────────────────────
 * Üretilen kayıt `Deadline(source = KURAL, status = BEKLIYOR)`'dur: hesap
 * deterministik motordan gelir ama avukat onaylamadan takvimde "kesin" sayılmaz.
 *
 * ── OTOMATİK YENİLEME ───────────────────────────────────────────────────────
 * `autoRenew` YALNIZCA BİLGİDİR. Sistem hiçbir sözleşmeyi kendiliğinden
 * yenilemez, `effectiveTo`yu ötelemez, durumu değiştirmez. Yalnızca "bu
 * sözleşme kendiliğinden yenileniyor, son ihbar günü şudur" uyarısı üretir.
 *
 * ── DOSYASIZ SÖZLEŞME ───────────────────────────────────────────────────────
 * `Deadline.caseId` ZORUNLUDUR (şema). Sözleşme bir dosyaya bağlı değilse
 * süre kaydı AÇILMAZ; hesap yine yapılır ve yanıtta `deadlineId: null` +
 * gerekçe döner. Kaydı rastgele bir dosyaya iliştirmek, o dosyanın takvimini
 * kirletmek olurdu.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { Contract } from "@nomosos/db";
import { addDays, formatTrDate, previousWorkingDay, toUtcDate } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { addYears, startOfDay } from "../common/dates";
import type { AuthUser } from "../common/types";

/**
 * Hesabın kaynağını gösteren anahtar. `DeadlineRule` tablosunda KARŞILIĞI
 * YOKTUR ve olmamalıdır: süre kanundan değil sözleşmeden doğar, dolayısıyla
 * kiracı bazlı bir kural kaydına bağlanamaz. Anahtar yalnızca idempotens ve
 * izlenebilirlik içindir.
 */
export const CONTRACT_NOTICE_RULE_KEY = "SOZLESME_FESIH_IHBAR";

export interface RenewalComputation {
  /** Hesap yapılabildi mi (effectiveTo + renewalNoticeDays dolu mu). */
  computed: boolean;
  /** Ham hesap: effectiveTo − renewalNoticeDays. */
  rawNoticeDate: Date | null;
  /** İş gününe çekilmiş nihai son ihbar günü. */
  noticeDeadline: Date | null;
  /** Tatile denk geldiği için gün geriye çekildi mi. */
  shifted: boolean;
  computeNote: string | null;
  skippedReason: string | null;
}

export interface RenewalDeadlineResult extends RenewalComputation {
  created: boolean;
  deadlineId: string | null;
  /** Kayıt neden açılamadı (dosya bağı yok vb.). */
  notPersistedReason: string | null;
}

type ContractLike = Pick<
  Contract,
  "id" | "tenantId" | "caseId" | "title" | "effectiveTo" | "renewalNoticeDays" | "autoRenew"
>;

/** `Holiday` tablosundan legal-core'a giden asgari alan kümesi. */
type HolidayRow = { date: Date; type: "RESMI_TATIL" | "ADLI_TATIL"; name: string };

@Injectable()
export class ContractRenewalService {
  private readonly logger = new Logger(ContractRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * SON İHBAR GÜNÜNÜ HESAPLAR — yan etkisizdir, hiçbir kayıt açmaz.
   * Liste ekranları ve "yenileme takvimi" görünümü bunu kullanır.
   */
  async compute(
    tenantId: string,
    contract: ContractLike,
    /**
     * Önceden çekilmiş tatil takvimi. TOPLU hesaplarda (yenileme takvimi)
     * ZORUNLU GİBİ DÜŞÜNÜLMELİDİR: verilmezse her sözleşme için ayrı bir
     * `holiday.findMany` koşar ve 200 sözleşmelik bir listede 200 sorgu doğar.
     */
    holidayCache?: HolidayRow[],
  ): Promise<RenewalComputation> {
    if (!contract.effectiveTo) {
      return this.skip("Sözleşmenin yürürlük bitiş tarihi girilmemiş; fesih ihbar günü hesaplanamaz.");
    }
    if (!contract.renewalNoticeDays || contract.renewalNoticeDays < 1) {
      return this.skip(
        "Sözleşmede fesih ihbar süresi (gün) tanımlı değil; ihbar günü hesaplanamaz.",
      );
    }

    const effectiveTo = startOfDay(contract.effectiveTo);
    const raw = addDays(toUtcDate(effectiveTo), -contract.renewalNoticeDays);

    // Tatil takvimi: ihbar gününün etrafındaki iki yıl yeterlidir.
    const holidays =
      holidayCache ??
      // denetim bulgusu Ö-16 — `isHalfDay` / `isApproximate` SÜTUNLARI ÇEKİLİR.
      // Bu iki alan `select` dışında bırakıldığında motor, bayrakları tatilin
      // _adından_ okumaya düşüyordu (`buildHolidayIndex` → `name.includes("(yarım
      // gün)")`); tek bir isim düzenlemesi hesabı sessizce bozmaya yeterdi.
      //
      // YARIM GÜNÜN DOĞRU DAVRANIŞI (motorun kuralıyla tutarlı): arife TAM TATİL
      // DEĞİLDİR. 2429 s.K. m.2/A uyarınca o gün 13.00'e kadar mesai vardır; gün
      // "resmî tatile rastlamış" sayılmaz ve HMK m.93 / İİK m.19 kaydırması
      // TETİKLENMEZ (`isNonWorkingDay` → `isFullDayOfficialHoliday`). Son gün arifeye
      // düşerse süre O GÜN sona erer; motor yalnızca «işlemi 13.00'ten önce
      // tamamlayınız» uyarısı basar (`collectWarnings` §2). Bayrak gelmezse arife tam
      // tatil sayılır ve avukata var olmayan 1-3 gün kazandırılırdı.
      // `isApproximate` ise hicri takvime bağlı bayramlarda teyit uyarısını açar.
      //
      // BURADA YÖN GERİYEDİR (`previousWorkingDay`): fesih ihbarı son güne kadar
      // YETİŞTİRİLMELİDİR. Arife iş günü olduğu için ihbar günü geriye ÇEKİLMEZ;
      // yanlışlıkla tam tatil sayılsaydı ihbar günü bir gün ERKENE alınır ve
      // sözleşme gereksiz yere erken feshedilmiş görünürdü.
      (await this.prisma.client.holiday.findMany({
        where: {
          date: {
            gte: new Date(Date.UTC(raw.getUTCFullYear() - 1, 0, 1)),
            lte: addYears(raw, 1),
          },
        },
        orderBy: { date: "asc" },
        select: { date: true, type: true, name: true, isHalfDay: true, isApproximate: true },
      }));

    const adjusted = previousWorkingDay(raw, holidays);
    const shifted = adjusted.getTime() !== raw.getTime();

    const computeNote =
      `Sözleşme: ${contract.title}\n` +
      `Yürürlük bitişi: ${formatTrDate(effectiveTo)}\n` +
      `Fesih ihbar süresi: ${contract.renewalNoticeDays} gün\n` +
      `Ham hesap: ${formatTrDate(effectiveTo)} − ${contract.renewalNoticeDays} gün = ${formatTrDate(raw)}\n` +
      (shifted
        ? `${formatTrDate(raw)} iş günü değil; ihbarın SÜRESİ İÇİNDE ulaşması gerektiğinden ` +
          `gün BİR ÖNCEKİ iş gününe çekildi: ${formatTrDate(adjusted)}. ` +
          "(Sözleşmesel süre kanuni süre değildir; HMK m.93'ün ileri kaydırması UYGULANMAZ.)\n"
        : `${formatTrDate(raw)} iş günüdür; kaydırma yapılmadı.\n`) +
      (contract.autoRenew
        ? "Sözleşmede KENDİLİĞİNDEN YENİLEME hükmü vardır: bu günden sonra ihbar edilmezse " +
          "sözleşme yenilenir. Sistem sözleşmeyi kendiliğinden YENİLEMEZ, yalnızca uyarır.\n"
        : "") +
      "Hesap @nomosos/legal-core ile DETERMİNİSTİK yapılmıştır; yapay zekâ kullanılmamıştır.";

    return {
      computed: true,
      rawNoticeDate: raw,
      noticeDeadline: adjusted,
      shifted,
      computeNote,
      skippedReason: null,
    };
  }

  /**
   * Hesabı yapar ve `Deadline` ÖNERİSİ açar (source=KURAL, status=BEKLIYOR).
   *
   * İDEMPOTENS: aynı sözleşme + aynı tetikleyici tarih (`effectiveTo`) için
   * ikinci kayıt açılmaz. `effectiveTo` DEĞİŞİRSE yeni tarih için yeni bir
   * öneri doğar; eskisi otomatik iptal EDİLMEZ — hangi tarihin geçerli olduğu
   * sözleşmesel bir tespittir, kod kendiliğinden karara bağlayamaz. Eski
   * öneriyi kapatmak avukatın işidir ve yanıtta `supersedes` ile bildirilir.
   */
  async suggestDeadline(
    user: AuthUser,
    contract: ContractLike,
  ): Promise<RenewalDeadlineResult> {
    const computation = await this.compute(user.tenantId, contract);
    if (!computation.computed || !computation.noticeDeadline || !contract.effectiveTo) {
      return { ...computation, created: false, deadlineId: null, notPersistedReason: null };
    }

    if (!contract.caseId) {
      return {
        ...computation,
        created: false,
        deadlineId: null,
        notPersistedReason:
          "Sözleşme bir dosyaya bağlı olmadığı için süre kaydı AÇILMADI (süre kayıtları " +
          "dosyaya bağlıdır). Hesaplanan son ihbar günü yukarıdadır; takibe almak için " +
          "sözleşmeyi bir dosyaya bağlayın veya süreyi elle kaydedin.",
      };
    }

    const triggerDate = startOfDay(contract.effectiveTo);

    const existing = await this.prisma.client.deadline.findFirst({
      where: {
        tenantId: user.tenantId,
        caseId: contract.caseId,
        ruleKey: CONTRACT_NOTICE_RULE_KEY,
        triggerDate,
      },
      select: { id: true, dueDate: true, status: true },
    });
    if (existing) {
      return {
        ...computation,
        created: false,
        deadlineId: existing.id,
        notPersistedReason:
          `Bu yürürlük bitiş tarihi için süre önerisi zaten mevcut (durum: ${existing.status}).`,
      };
    }

    // Aynı sözleşmenin ESKİ tarihli önerileri — kullanıcı görsün diye bildirilir.
    const superseded = await this.prisma.client.deadline.findMany({
      where: {
        tenantId: user.tenantId,
        caseId: contract.caseId,
        ruleKey: CONTRACT_NOTICE_RULE_KEY,
        status: "BEKLIYOR",
        triggerDate: { not: triggerDate },
      },
      select: { id: true, dueDate: true, triggerDate: true },
    });

    const relatedCase = await this.prisma.client.case.findFirst({
      where: { id: contract.caseId, tenantId: user.tenantId },
      select: { responsibleUserId: true },
    });

    const deadline = await this.prisma.client.deadline.create({
      data: {
        tenantId: user.tenantId,
        caseId: contract.caseId,
        title: `Fesih ihbarı son günü — ${contract.title}`,
        dueDate: computation.noticeDeadline,
        ownerId: relatedCase?.responsibleUserId ?? undefined,
        source: "KURAL",
        // ONAY NOKTASI — kesinleşmesi avukatın onayına bağlıdır.
        status: "BEKLIYOR",
        legalBasis: `Sözleşme hükmü — ${contract.renewalNoticeDays} gün fesih ihbar süresi`,
        computeNote: `${computation.computeNote}\nBu kayıt AVUKAT ONAYINA sunulmuştur (durum: BEKLIYOR).`,
        ruleKey: CONTRACT_NOTICE_RULE_KEY,
        triggerDate,
      },
      select: { id: true },
    });

    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId: contract.caseId,
        userId: user.userId,
        title:
          `Sözleşme fesih ihbarı süresi önerildi — son gün ` +
          `${formatTrDate(computation.noticeDeadline)}`,
        detail:
          `${contract.title} · yürürlük bitişi ${formatTrDate(triggerDate)} · ` +
          `ihbar süresi ${contract.renewalNoticeDays} gün · onay bekliyor.`,
        source: "SISTEM",
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_NOTICE_DEADLINE_SUGGEST",
      entity: "Contract",
      entityId: contract.id,
      detail:
        `bitiş=${formatTrDate(triggerDate)} ihbar_gün=${contract.renewalNoticeDays} ` +
        `son_gün=${formatTrDate(computation.noticeDeadline)} durum=BEKLIYOR (deterministik)`,
    });

    return {
      ...computation,
      created: true,
      deadlineId: deadline.id,
      notPersistedReason: superseded.length
        ? `Bu sözleşme için ${superseded.length} eski tarihli süre önerisi hâlâ BEKLIYOR ` +
          "durumunda; hangisinin geçerli olduğunu siz karara bağlamalısınız."
        : null,
    };
  }

  /**
   * GET /contracts/renewals — yaklaşan yenileme/fesih takvimi.
   * Tamamen deterministiktir; kayıt AÇMAZ (yalnız hesaplar).
   */
  async upcoming(user: AuthUser, days = 90) {
    const window = Math.min(730, Math.max(1, Math.trunc(days) || 90));
    const today = startOfDay(new Date());
    const until = addDays(toUtcDate(today), window);

    const contracts = await this.prisma.client.contract.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ["YURURLUKTE", "IMZADA", "IMZAYA_HAZIR"] },
        effectiveTo: { not: null, lte: addDays(until, 365) },
        renewalNoticeDays: { not: null },
      },
      orderBy: { effectiveTo: "asc" },
      take: 200,
      select: {
        id: true,
        tenantId: true,
        caseId: true,
        clientId: true,
        title: true,
        type: true,
        status: true,
        effectiveTo: true,
        renewalNoticeDays: true,
        autoRenew: true,
        client: { select: { id: true, name: true } },
      },
    });

    // TATİL TAKVİMİ TEK SEFERDE ÇEKİLİR. Aksi hâlde her sözleşme için ayrı bir
    // sorgu koşar ve 200 sözleşmelik listede 200 sorgu doğardı (N+1).
    const years = contracts
      .map((c) => c.effectiveTo?.getUTCFullYear())
      .filter((y): y is number => typeof y === "number");
    const holidays = years.length
      // denetim bulgusu Ö-16 — `isHalfDay` / `isApproximate` SÜTUNLARI ÇEKİLİR.
      // Bu iki alan `select` dışında bırakıldığında motor, bayrakları tatilin
      // _adından_ okumaya düşüyordu (`buildHolidayIndex` → `name.includes("(yarım
      // gün)")`); tek bir isim düzenlemesi hesabı sessizce bozmaya yeterdi.
      //
      // YARIM GÜNÜN DOĞRU DAVRANIŞI (motorun kuralıyla tutarlı): arife TAM TATİL
      // DEĞİLDİR. 2429 s.K. m.2/A uyarınca o gün 13.00'e kadar mesai vardır; gün
      // "resmî tatile rastlamış" sayılmaz ve HMK m.93 / İİK m.19 kaydırması
      // TETİKLENMEZ (`isNonWorkingDay` → `isFullDayOfficialHoliday`). Son gün arifeye
      // düşerse süre O GÜN sona erer; motor yalnızca «işlemi 13.00'ten önce
      // tamamlayınız» uyarısı basar (`collectWarnings` §2). Bayrak gelmezse arife tam
      // tatil sayılır ve avukata var olmayan 1-3 gün kazandırılırdı.
      // `isApproximate` ise hicri takvime bağlı bayramlarda teyit uyarısını açar.
      //
      // Toplu (N+1 önleyen) tek sorgu; yukarıdaki tekil sorguyla AYNI sütunları
      // çekmelidir, aksi hâlde liste ekranı ile tekil hesap ayrışırdı.
      ? await this.prisma.client.holiday.findMany({
          where: {
            date: {
              gte: new Date(Date.UTC(Math.min(...years) - 1, 0, 1)),
              lte: new Date(Date.UTC(Math.max(...years) + 1, 11, 31)),
            },
          },
          orderBy: { date: "asc" },
          select: { date: true, type: true, name: true, isHalfDay: true, isApproximate: true },
        })
      : [];

    const rows = [];
    for (const c of contracts) {
      const computation = await this.compute(user.tenantId, c, holidays);
      if (!computation.noticeDeadline) continue;
      const due = computation.noticeDeadline;
      // Pencere: bugünle `window` günü arasında kalan ihbar günleri + geçmişte
      // kalıp HÂLÂ ihbar edilmemiş olanlar (uyarı değeri en yüksek grup).
      const overdue = toUtcDate(due) < toUtcDate(today);
      if (!overdue && toUtcDate(due) > toUtcDate(until)) continue;
      rows.push({
        contractId: c.id,
        title: c.title,
        type: c.type,
        status: c.status,
        client: c.client,
        caseId: c.caseId,
        effectiveTo: c.effectiveTo,
        renewalNoticeDays: c.renewalNoticeDays,
        autoRenew: c.autoRenew,
        noticeDeadline: due,
        overdue,
        shifted: computation.shifted,
        computeNote: computation.computeNote,
      });
    }

    return {
      generatedAt: new Date(),
      windowDays: window,
      deterministic: true,
      note:
        "Son ihbar günleri @nomosos/legal-core ile deterministik hesaplanmıştır. " +
        "Kendiliğinden yenilenen sözleşmeler sistem tarafından YENİLENMEZ; bu liste " +
        "yalnızca uyarı amaçlıdır.",
      items: rows,
    };
  }

  private skip(reason: string): RenewalComputation {
    return {
      computed: false,
      rawNoticeDate: null,
      noticeDeadline: null,
      shifted: false,
      computeNote: null,
      skippedReason: reason,
    };
  }
}
