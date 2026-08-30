/**
 * BİLİRKİŞİ ↔ SÜRE MOTORU KÖPRÜSÜ — HESAP DETERMİNİSTİKTİR, AI YOKTUR.
 *
 * docs/moduller/13, iş kuralı 1: rapor TEBLİĞ tarihi girildiğinde HMK m.281'in
 * iki haftalık itiraz süresi Süre Motoru'nda tetiklenir. Gün hesabı, resmî
 * tatil ve adli tatil düzeltmesi @nomosos/legal-core'un `computeDeadline`
 * fonksiyonundan geçer; bu dosya yalnızca "hangi kural, hangi tetikleyici
 * tarih" eşlemesini yapar. AI SÜRE HESAPLAMAZ — sistem çekirdek promptu da
 * modele bunu açıkça yasaklar.
 *
 * ── ONAY NOKTASI ────────────────────────────────────────────────────────────
 * Üretilen kayıt `Deadline(source = KURAL, status = BEKLIYOR)`'dur:
 *   • `source = KURAL` → hesabın deterministik motordan geldiğini gösterir,
 *   • `status = BEKLIYOR` → avukat onaylamadan takvimde "kesin" sayılmaz.
 * Onay mevcut `PATCH /deadlines/:id/status` ucundan verilir. Böylece hem hesap
 * izi (`computeNote`) kalır hem de "sistem süre kesinleştirdi" durumu oluşmaz.
 *
 * İDEMPOTENS: aynı rapor için tebliğ tarihi tekrar kaydedilirse (ör. yazım
 * düzeltmesi) YENİ kayıt açılmaz; aynı kural + aynı tetikleyici tarih için
 * mevcut kayıt döner. Tebliğ tarihi DEĞİŞİRSE yeni tarih için yeni bir öneri
 * doğar ve eskisi otomatik iptal EDİLMEZ — hangi tarihin doğru olduğu bir
 * hukuki tespittir, kod bunu kendiliğinden karara bağlayamaz.
 */

import { Injectable, Logger } from "@nestjs/common";
import { computeDeadline, type ProcedureCode, type RecessExtensionRule } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DeadlineRulesService } from "../deadline-rules/deadline-rules.service";
import { addYears, formatTrDate, startOfDay } from "../common/dates";
import type { AuthUser } from "../common/types";

/**
 * HMK m.281 — bilirkişi raporuna itiraz süresi (2 hafta).
 * Anahtar `@nomosos/legal-core`in sistem kural setinde tanımlıdır; burada
 * uydurulmaz, kural motorundan çözülür.
 */
export const EXPERT_OBJECTION_RULE_KEY = "HMK_BILIRKISI_ITIRAZ";

export interface ObjectionDeadlineResult {
  created: boolean;
  deadlineId: string | null;
  dueDate: Date | null;
  legalBasis: string | null;
  computeNote: string | null;
  warnings: string[];
  /** Süre neden üretilmedi (tebliğ yok, kural pasif vb.). */
  skippedReason?: string;
}

@Injectable()
export class ExpertDeadlinesService {
  private readonly logger = new Logger(ExpertDeadlinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: DeadlineRulesService,
  ) {}

  /**
   * Tebliğ tarihinden itiraz süresi ÖNERİSİ üretir.
   *
   * `servedAt` yoksa hiçbir şey yapılmaz — tebliğ tarihi olmayan rapor için
   * süre üretmek, başlangıcı bilinmeyen bir süreyi kesinleştirmek olurdu
   * (docs/moduller/13, iş kuralı 3).
   */
  async suggestObjectionDeadline(
    user: AuthUser,
    report: { id: string; caseId: string; servedAt: Date | null; reportType: string },
  ): Promise<ObjectionDeadlineResult> {
    if (!report.servedAt) {
      return {
        created: false,
        deadlineId: null,
        dueDate: null,
        legalBasis: null,
        computeNote: null,
        warnings: [],
        skippedReason:
          "Rapor tebliğ tarihi girilmediği için itiraz süresi hesaplanmadı. Tebliğ tarihi " +
          "girildiğinde süre deterministik olarak hesaplanacak ve onayınıza sunulacaktır.",
      };
    }

    const triggerDate = startOfDay(report.servedAt);

    const rule = await this.rules
      .resolveByKey(user.tenantId, EXPERT_OBJECTION_RULE_KEY)
      .catch(() => null);
    if (!rule) {
      // Kural pasif/silinmişse SESSİZ KALINMAZ: hesap uydurulmaz ama kullanıcı
      // sürenin üretilmediğini görür — sessiz atlama burada hak kaybı demektir.
      this.logger.warn(
        `${EXPERT_OBJECTION_RULE_KEY} kuralı çözülemedi; bilirkişi itiraz süresi üretilmedi ` +
          `(tenant=${user.tenantId}, rapor=${report.id}).`,
      );
      return {
        created: false,
        deadlineId: null,
        dueDate: null,
        legalBasis: null,
        computeNote: null,
        warnings: [
          `"${EXPERT_OBJECTION_RULE_KEY}" süre kuralı bulunamadı veya pasif durumda; itiraz ` +
            "süresi HESAPLANAMADI. İtiraz süresini elle takip edin ve Ayarlar → Süre Kuralları " +
            "ekranından kuralı etkinleştirin.",
        ],
        skippedReason: "Süre kuralı bulunamadı veya pasif.",
      };
    }

    // İDEMPOTENS KAPISI: aynı kural + aynı tetikleyici tarih için kayıt varsa
    // yenisi açılmaz.
    const existing = await this.prisma.client.deadline.findFirst({
      where: {
        tenantId: user.tenantId,
        caseId: report.caseId,
        ruleKey: rule.key,
        triggerDate,
      },
      select: { id: true, dueDate: true, legalBasis: true, computeNote: true, status: true },
    });
    if (existing) {
      return {
        created: false,
        deadlineId: existing.id,
        dueDate: existing.dueDate,
        legalBasis: existing.legalBasis,
        computeNote: existing.computeNote,
        warnings: [],
        skippedReason: `Bu tebliğ tarihi için süre kaydı zaten mevcut (durum: ${existing.status}).`,
      };
    }

    const holidays = await this.prisma.client.holiday.findMany({
      where: {
        date: {
          gte: new Date(Date.UTC(triggerDate.getUTCFullYear(), 0, 1)),
          lte: addYears(triggerDate, 3),
        },
      },
      orderBy: { date: "asc" },
      select: { date: true, type: true, name: true },
    });

    const result = computeDeadline({
      ruleKey: rule.key,
      triggerDate,
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

    const computeNote =
      `Rapor tebliğ tarihi: ${formatTrDate(triggerDate)}\n` +
      result.steps.map((s) => `- ${s.explanation}`).join("\n") +
      "\nBu süre bilirkişi modülü tarafından DETERMİNİSTİK kural motoruyla hesaplanmış ve " +
      "AVUKAT ONAYINA sunulmuştur (durum: BEKLIYOR). Yapay zekâ bu hesaba dâhil değildir.";

    const relatedCase = await this.prisma.client.case.findFirst({
      where: { id: report.caseId, tenantId: user.tenantId },
      select: { responsibleUserId: true },
    });

    const deadline = await this.prisma.client.deadline.create({
      data: {
        tenantId: user.tenantId,
        caseId: report.caseId,
        title: `${rule.name} (${report.reportType === "EK" ? "ek rapor" : "rapor"})`,
        dueDate: result.dueDate,
        ownerId: relatedCase?.responsibleUserId ?? undefined,
        source: "KURAL",
        // ONAY NOKTASI — kesinleşmesi avukatın onayına bağlıdır.
        status: "BEKLIYOR",
        legalBasis: result.legalBasis,
        computeNote,
        ruleKey: rule.key,
        triggerDate,
      },
      select: { id: true, dueDate: true, legalBasis: true, computeNote: true },
    });

    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId: report.caseId,
        userId: user.userId,
        title: `Bilirkişi raporuna itiraz süresi önerildi — son gün ${formatTrDate(result.dueDate)}`,
        detail: `${result.legalBasis} · Tebliğ: ${formatTrDate(triggerDate)} · Onay bekliyor.`,
        source: "SISTEM",
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_OBJECTION_DEADLINE_SUGGEST",
      entity: "ExpertReport",
      entityId: report.id,
      detail:
        `kural=${rule.key} tebliğ=${formatTrDate(triggerDate)} ` +
        `son_gün=${formatTrDate(result.dueDate)} durum=BEKLIYOR (deterministik)`,
    });

    return {
      created: true,
      deadlineId: deadline.id,
      dueDate: deadline.dueDate,
      legalBasis: deadline.legalBasis,
      computeNote: deadline.computeNote,
      warnings: result.warnings,
    };
  }

  /** Bir rapora ait tebliğ tarihinden doğan süre kaydını bulur (varsa). */
  async findObjectionDeadline(tenantId: string, caseId: string, servedAt: Date | null) {
    if (!servedAt) return null;
    return this.prisma.client.deadline.findFirst({
      where: {
        tenantId,
        caseId,
        ruleKey: EXPERT_OBJECTION_RULE_KEY,
        triggerDate: startOfDay(servedAt),
      },
      select: { id: true, dueDate: true, status: true, legalBasis: true },
    });
  }
}
