/**
 * İCRA ↔ SÜRE MOTORU KÖPRÜSÜ — hesap DETERMİNİSTİKTİR, AI YOKTUR.
 *
 * Modül 05 kural 2: ödeme emri tebliğ tarihi girildiğinde İİK m.62'nin 7 günlük
 * itiraz süresi Süre Motoru'nda tetiklenir. Gün hesabı @nomosos/legal-core'un
 * `computeDeadline` fonksiyonundan geçer; bu dosya yalnızca "hangi kural, hangi
 * tetikleyici tarih" eşlemesini yapar.
 *
 * ── SEÇİLEN TASARIM: ÖNERİ, OTOMATİK KAYIT DEĞİL ────────────────────────────
 * `DocumentActionProposal` modeli bir `documentId` zorunlu kıldığı için (icra
 * dosyasının süresinin arkasında bir belge olmayabilir) o desen kullanılmadı.
 * Bunun yerine Deadline kaydı **`status = BEKLIYOR`** ile açılır:
 *   • `source = KURAL` → hesabın deterministik motordan geldiğini gösterir,
 *   • `status = BEKLIYOR` → avukat onaylamadan takvimde "kesin" sayılmaz;
 *     onay mevcut `PATCH /deadlines/:id/status` ucundan verilir (ONAYLANDI).
 * Böylece hem hesap izi (`computeNote`) kaydedilir, hem de "AI/otomasyon süre
 * kesinleştirdi" durumu oluşmaz.
 *
 * KAMBİYO TUZAĞI: kambiyo senetlerine mahsus takipte itiraz süresi 7 değil
 * 5 GÜNDÜR (İİK m.168/5). Takip tipi KAMBIYO ise kural anahtarı buna göre seçilir;
 * yanlış kural seçimi doğrudan hak kaybıdır.
 */

import { Injectable } from "@nestjs/common";
import type { EnforcementFile } from "@nomosos/db";
import {
  computeDeadline,
  type DeadlineComputationResult,
  type ProcedureCode,
  type RecessExtensionRule,
} from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DeadlineRulesService } from "../deadline-rules/deadline-rules.service";
import { addYears, formatTrDate, startOfDay } from "../common/dates";
import type { AuthUser } from "../common/types";

export interface DeadlineCandidate {
  ruleKey: string;
  ruleName: string;
  legalBasis: string;
  triggerDate: Date;
  /** Tetikleyicinin dosyadaki karşılığı ("ödeme emri tebliğ tarihi"). */
  triggerLabel: string;
  dueDate: Date;
  steps: DeadlineComputationResult["steps"];
  warnings: string[];
  computeNote: string;
  /** Son gün geçmiş mi (bugün UTC gün başına göre)? */
  isOverdue: boolean;
  /** Bugüne kalan gün (negatifse geçmiş). */
  daysRemaining: number;
  /** Aynı kural+tetikleyici için zaten bir Deadline kaydı var mı? */
  existingDeadlineId?: string;
  existingStatus?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class EnforcementDeadlinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: DeadlineRulesService,
  ) {}

  /**
   * Dosyadaki tarihlerden çıkan İİK sürelerini DETERMİNİSTİK olarak hesaplar.
   * Hiçbir kayıt yazmaz.
   */
  async computeCandidates(tenantId: string, file: EnforcementFile): Promise<DeadlineCandidate[]> {
    const triggers = await this.collectTriggers(tenantId, file);
    const candidates: DeadlineCandidate[] = [];
    const today = startOfDay(new Date());

    for (const trigger of triggers) {
      const rule = await this.rules.resolveByKey(tenantId, trigger.ruleKey).catch(() => null);
      if (!rule) continue; // Kural pasif/silinmişse sessizce atlanır, hesap uydurulmaz.

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
      // İcra sürelerinde (İİK m.19) kural aynıdır: arife iş günüdür, ödeme/itiraz
      // süresi o gün 13.00'te fiilen kapanır, ertesi güne KAYMAZ.
      const holidays = await this.prisma.client.holiday.findMany({
        where: {
          date: {
            gte: new Date(Date.UTC(trigger.date.getUTCFullYear(), 0, 1)),
            lte: addYears(trigger.date, 3),
          },
        },
        orderBy: { date: "asc" },
        select: { date: true, type: true, name: true, isHalfDay: true, isApproximate: true },
      });

      const result = computeDeadline({
        ruleKey: rule.key,
        triggerDate: trigger.date,
        // İcra tebligatının yöntemi dosyada tutulmuyor; motorun varsayılanı kullanılır.
        rule: {
          durationValue: rule.durationValue,
          durationUnit: rule.durationUnit,
          legalBasis: rule.legalBasis,
        },
        holidays,
        applyJudicialRecess: rule.judicialRecessApplies,
        recessRule: rule.recessRule as RecessExtensionRule,
        procedureCode: rule.procedureCode as ProcedureCode,
      });

      const existing = await this.prisma.client.deadline.findFirst({
        where: { tenantId, caseId: file.caseId, ruleKey: rule.key, triggerDate: trigger.date },
        select: { id: true, status: true },
      });

      const daysRemaining = Math.round((startOfDay(result.dueDate).getTime() - today.getTime()) / MS_PER_DAY);

      candidates.push({
        ruleKey: rule.key,
        ruleName: rule.name,
        legalBasis: result.legalBasis,
        triggerDate: trigger.date,
        triggerLabel: trigger.label,
        dueDate: result.dueDate,
        steps: result.steps,
        warnings: result.warnings,
        computeNote: buildComputeNote(result),
        isOverdue: daysRemaining < 0,
        daysRemaining,
        existingDeadlineId: existing?.id,
        existingStatus: existing?.status,
      });
    }

    return candidates.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }

  /**
   * Hesaplanan süreleri ONAY BEKLEYEN Deadline kayıtlarına dönüştürür.
   *
   * Aynı kural + aynı tetikleyici tarih için kayıt varsa YENİSİ AÇILMAZ — bu
   * fonksiyon her ödeme emri güncellemesinde çağrıldığı için idempotent olmak
   * zorundadır.
   */
  async persistCandidates(
    user: AuthUser,
    file: EnforcementFile,
    candidates: DeadlineCandidate[],
    ownerId?: string,
  ) {
    const created: { id: string; title: string; dueDate: Date; ruleKey: string }[] = [];
    const skipped: { ruleKey: string; reason: string }[] = [];

    const relatedCase = await this.prisma.client.case.findFirst({
      where: { id: file.caseId, tenantId: user.tenantId },
      select: { id: true, responsibleUserId: true, fileNumber: true, title: true },
    });
    if (!relatedCase) return { created, skipped };

    for (const candidate of candidates) {
      if (candidate.existingDeadlineId) {
        skipped.push({ ruleKey: candidate.ruleKey, reason: "Bu süre için kayıt zaten mevcut." });
        continue;
      }
      const deadline = await this.prisma.client.deadline.create({
        data: {
          tenantId: user.tenantId,
          caseId: file.caseId,
          title: candidate.ruleName,
          dueDate: candidate.dueDate,
          ownerId: ownerId ?? relatedCase.responsibleUserId ?? undefined,
          source: "KURAL",
          // ONAY NOKTASI: kayıt "beklemede" açılır; kesinleşmesi avukatın onayına bağlıdır.
          status: "BEKLIYOR",
          legalBasis: candidate.legalBasis,
          computeNote:
            `${candidate.triggerLabel}: ${formatTrDate(candidate.triggerDate)}\n${candidate.computeNote}\n` +
            "Bu süre icra modülü tarafından deterministik kural motoruyla hesaplanmış ve " +
            "AVUKAT ONAYINA sunulmuştur (durum: BEKLIYOR).",
          ruleKey: candidate.ruleKey,
          triggerDate: candidate.triggerDate,
        },
        select: { id: true, title: true, dueDate: true, ruleKey: true },
      });
      created.push({ ...deadline, ruleKey: candidate.ruleKey });

      await this.prisma.client.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: file.caseId,
          userId: user.userId,
          title: `İcra süresi önerildi: ${candidate.ruleName} — son gün ${formatTrDate(candidate.dueDate)}`,
          detail: `${candidate.legalBasis} · Onay bekliyor.`,
          source: "SISTEM",
        },
      });
    }

    if (created.length > 0) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "ENFORCEMENT_DEADLINE_SUGGEST",
        entity: "EnforcementFile",
        entityId: file.id,
        detail: `${created.length} süre önerisi (BEKLIYOR): ${created.map((c) => c.ruleKey).join(", ")}`,
      });
    }
    return { created, skipped };
  }

  /**
   * KACIRILAN_SURELER komutunun deterministik yarısı: dosyadaki kayıtlı süreler
   * + kural motorundan çıkan adaylar birlikte değerlendirilir.
   */
  async auditDeadlines(tenantId: string, file: EnforcementFile) {
    const candidates = await this.computeCandidates(tenantId, file);
    const today = startOfDay(new Date());

    const recorded = await this.prisma.client.deadline.findMany({
      where: { tenantId, caseId: file.caseId },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        source: true,
        ruleKey: true,
        legalBasis: true,
      },
    });

    const overdueOpen = recorded.filter(
      (d) =>
        d.dueDate.getTime() < today.getTime() &&
        (d.status === "BEKLIYOR" || d.status === "ONAYLANDI"),
    );
    const upcoming = recorded.filter(
      (d) =>
        d.dueDate.getTime() >= today.getTime() &&
        (d.status === "BEKLIYOR" || d.status === "ONAYLANDI"),
    );
    /** Motorun bulduğu ama dosyada hiç kaydı olmayan süreler — en riskli grup. */
    const unrecorded = candidates.filter((c) => !c.existingDeadlineId);

    return { candidates, recorded, overdueOpen, upcoming, unrecorded, today };
  }

  /** Dosyadaki tarihlerden hangi İİK kuralının tetiklendiğini çözer. */
  private async collectTriggers(
    tenantId: string,
    file: EnforcementFile,
  ): Promise<{ ruleKey: string; date: Date; label: string }[]> {
    const triggers: { ruleKey: string; date: Date; label: string }[] = [];

    if (file.paymentOrderServedAt) {
      triggers.push({
        // KAMBİYO'da süre 5 gündür (İİK m.168/5); diğer takiplerde 7 gün (İİK m.62).
        ruleKey:
          file.trackingType === "KAMBIYO"
            ? "IIK_KAMBIYO_ODEME_EMRI_ITIRAZ"
            : "IIK_ODEME_EMRI_ITIRAZ",
        date: startOfDay(file.paymentOrderServedAt),
        label: "Ödeme emri tebliğ tarihi",
      });
    }

    if (file.objectionDate) {
      triggers.push({
        ruleKey: "IIK_ITIRAZIN_IPTALI",
        date: startOfDay(file.objectionDate),
        label: "İtiraz tarihi",
      });
    }

    const auction = await this.prisma.client.enforcementAction.findFirst({
      where: { tenantId, enforcementFileId: file.id, type: "IHALE" },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (auction) {
      triggers.push({
        ruleKey: "IIK_IHALENIN_FESHI",
        date: startOfDay(auction.date),
        label: "İhale tarihi",
      });
    }

    return triggers;
  }
}

/** Hesap izini tek metne indirger (Deadline.computeNote ile aynı biçim). */
function buildComputeNote(result: DeadlineComputationResult): string {
  const lines = result.steps.map(
    (step, index) => `${index + 1}. ${step.step} — ${formatTrDate(step.date)}: ${step.explanation}`,
  );
  if (result.warnings.length > 0) {
    lines.push(`UYARI: ${result.warnings.join(" | ")}`);
  }
  return lines.join("\n");
}
