/**
 * POST /reports/:key/interpret — REPORT_INTERPRET (kredili, OPSİYONEL).
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  RAPOR ONSUZ DA TAMDIR. Yorum bir SÜSLEMEDİR; rakamların kaynağı hiç   ║
 * ║  değişmez. Model çağrısı başarısız olursa rapor yine deterministik     ║
 * ║  hâliyle yanıtın içindedir (`report` alanı).                           ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * AKIŞ:
 *   1. Rol kapısı — raporu göremeyen onu yorumlatamaz da.
 *   2. Rapor DETERMİNİSTİK olarak çalıştırılır (ReportsService).
 *   3. LLM'e giden içerik: rapor adı + ölçü ETİKETLERİ + RAKAMSIZ sinyaller.
 *      Tablo satırları, müvekkil adları, dosya numaraları, tutarlar GİTMEZ.
 *   4. LLM yer tutuculu şablon üretir.
 *   5. UYDURMA RAKAM KAPISI — şablonda basamak varsa 422; kullanıcıya ulaşmaz.
 *   6. Gerçek değerleri API yerleştirir.
 *
 * VERİ MİNİMİZASYONU BEYANI ÖLÇÜMDÜR, İDDİA DEĞİLDİR: `rowsSentToLlm` ve
 * `metricValuesSentToLlm` gerçekten sayılır; kullanıcının kendi soru metni
 * modele birebir gider ve bu AÇIKÇA bildirilir (finance-ai.service.ts'te
 * düzeltilen denetim bulgusunun tekrarlanmaması için).
 */

import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { AssistantLlmService } from "../assistant/assistant-llm.service";
import { buildLocalMessages } from "../assistant/assistant.prompts";
import { formatMoneyTr } from "../finance/money";
import type { AuthUser } from "../common/types";
import { ROLE_LABELS } from "../common/roles";
import { trDecimal } from "./report-csv";
import {
  COMMON_PLACEHOLDERS,
  ReportNarrativeSchema,
  buildReportInterpretPrompt,
  findFabricatedNumbers,
  findUnknownPlaceholders,
  renderTemplate,
} from "./reports.prompts";
import { ReportsService } from "./reports.service";
import type { InterpretReportInput } from "./reports.dto";
import type { ReportMetric, ReportResult } from "./report-types";

const DATA_MINIMIZATION_EXPLANATION =
  "KVKK veri minimizasyonu: raporun HİÇBİR satırı, tutarı, müvekkil adı, dosya numarası ya da " +
  "kullanıcı adı dil modeline gönderilmedi. Modele yalnız raporun adı, ölçü ETİKETLERİ ve " +
  "rakamsız nitel sinyaller (ARTTI/AZALDI/VAR/YOK/KRİTİK) iletildi. Metindeki bütün sayılar " +
  "veritabanından hesaplanıp şablona API tarafından yerleştirildi. ANCAK KULLANICININ KENDİ " +
  "SORU METNİ modele iletilir; soruda müvekkil adı veya tutar yazdıysanız bu bilgi — KVKK " +
  "maskeleme kapısından geçirilerek — sağlayıcıya ulaşır.";

/** Yer tutucu adı yalnız harf içerebilir: uydurma rakam kapısı böyle eleyebiliyor. */
const SAFE_PLACEHOLDER = /^[a-zA-ZçğıöşüÇĞİÖŞÜ]+$/;

@Injectable()
export class ReportsAiService {
  constructor(
    private readonly reports: ReportsService,
    private readonly llm: AssistantLlmService,
    private readonly audit: AuditService,
  ) {}

  async interpret(user: AuthUser, key: string, input: InterpretReportInput) {
    // (1) Rol kapısı — `definitionOf` yetkisiz rolde 403 fırlatır.
    const def = this.reports.definitionOf(user, key);

    // (2) DETERMİNİSTİK RAPOR — tüm sayılar buradan gelir.
    const report = await this.reports.run(user, def.key, input.params ?? {}, "EKRAN");

    const { values, signals, placeholders } = this.buildContext(report);

    // (3) LLM'e giden içerik: rapor adı + etiketler + rakamsız sinyaller.
    const messages = buildLocalMessages(
      buildReportInterpretPrompt(placeholders),
      [
        `RAPOR: ${report.name}`,
        input.soru ? `SORU: ${input.soru}` : "SORU: (belirtilmedi — genel yönetici özeti yaz)",
        "SİNYALLER (rakam içermez):",
        ...signals.map((s) => `- ${s}`),
      ].join("\n"),
    );

    const run = await this.llm.runTask({
      user,
      routeKeys: ["REPORT_INTERPRET", "OFFICE_QUERY", "CASE_CHAT"],
      logTaskType: "REPORT_INTERPRET",
      messages,
      schema: ReportNarrativeSchema,
      // Anlatım bir "bulgu" değildir; kaynaksız eleme uygulanmaz.
      findingPaths: [],
      piiApproved: input.piiApproved,
      maxTokens: 1400,
      auditDetail: `rapor=${def.key} veriMinimizasyonu=satirVeTutarGonderilmedi`,
    });

    // (5) UYDURMA RAKAM KAPISI.
    const candidates = [
      run.data.narrativeTemplate,
      ...run.data.highlights,
      ...run.data.recommendedActions,
      run.data.scopeNote,
    ];
    const fabricated = [...new Set(candidates.flatMap((t) => findFabricatedNumbers(t)))];
    if (fabricated.length > 0) {
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "AI_REPORT_INTERPRET_REJECTED",
        entity: "AiUsageLog",
        entityId: run.usageLogId,
        detail: `Model rapora kendi ürettiği sayı(lar) yazdı, çıktı reddedildi: ${fabricated.slice(0, 10).join(", ")}`,
      });
      throw new UnprocessableEntityException({
        message:
          "AI yorumu reddedildi: model metne kendi ürettiği sayı(lar) yazdı. Rapor rakamları " +
          "yalnız NomosOS'un deterministik hesabından gelebilir. Lütfen tekrar deneyin; " +
          "sorun sürerse Ayarlar'dan daha güçlü bir model seçin.",
        fabricatedTokens: fabricated,
        /** Rapor SAĞLAMDIR ve hatayla birlikte döner — kullanıcı işsiz kalmaz. */
        report,
      });
    }

    const unknownPlaceholders = [
      ...new Set(candidates.flatMap((t) => findUnknownPlaceholders(t, placeholders))),
    ];

    // (6) Gerçek değerleri API yerleştirir.
    return {
      reportKey: def.key,
      question: input.soru ?? null,
      narrative: renderTemplate(run.data.narrativeTemplate, values),
      highlights: run.data.highlights.map((h) => renderTemplate(h, values)),
      recommendedActions: run.data.recommendedActions.map((a) => renderTemplate(a, values)),
      scopeNote: run.data.scopeNote
        ? renderTemplate(run.data.scopeNote, values)
        : `Sonuçlar yalnız kendi büronuzun kayıtları üzerinde, ${ROLE_LABELS[user.role]} rolünüzün yetkisiyle sınırlıdır.`,
      /** Anlatımın dayandığı DETERMİNİSTİK rapor — her sayı buradan gelir. */
      report,
      /** Şablona yerleştirilen gerçek değerler (denetlenebilirlik). */
      renderedValues: values,
      unknownPlaceholders,
      dataMinimization: {
        rowsSentToLlm: 0,
        metricValuesSentToLlm: 0,
        metricLabelsSentToLlm: report.metrics?.length ?? 0,
        questionSentVerbatim: Boolean(input.soru),
        piiMaskedInQuestion: run.piiMasked,
        explanation: DATA_MINIMIZATION_EXPLANATION,
      },
      advisory: run.advisory,
      model: run.model,
      usageLogId: run.usageLogId,
      piiMasked: run.piiMasked,
    };
  }

  /**
   * Deterministik rapordan üç şey üretir:
   *   `values`       → şablona yerleştirilecek GERÇEK değerler (LLM GÖRMEZ).
   *   `signals`      → LLM'e gidecek RAKAMSIZ nitel sinyaller.
   *   `placeholders` → sistem promptuna yazılacak yer tutucu adları.
   */
  private buildContext(report: ReportResult): {
    values: Record<string, string>;
    signals: string[];
    placeholders: string[];
  } {
    const values: Record<string, string> = {
      raporAdi: report.name,
      donem: report.period.label,
      oncekiDonem: report.comparisonPeriod?.label ?? "önceki dönem",
      satirSayisi: trDecimal(String(report.rowCount)),
    };
    const placeholders: string[] = [...COMMON_PLACEHOLDERS];
    const signals: string[] = [];

    for (const metric of report.metrics ?? []) {
      if (!SAFE_PLACEHOLDER.test(metric.key)) continue;
      values[metric.key] = this.formatValue(metric);
      placeholders.push(metric.key);
      signals.push(`${metric.key}: ${this.signalOf(metric)}`);
    }

    signals.push(`karsilastirmaVar: ${report.comparisonPeriod ? "EVET" : "HAYIR"}`);
    signals.push(`uyariVar: ${(report.warnings?.length ?? 0) > 0 ? "EVET" : "HAYIR"}`);
    signals.push(
      `kirpilmisTabloVar: ${report.tables.some((t) => t.truncated) ? "EVET" : "HAYIR"}`,
    );
    signals.push(`gizlenenBolumVar: ${(report.hiddenSections?.length ?? 0) > 0 ? "EVET" : "HAYIR"}`);
    signals.push(`veriBosMu: ${report.rowCount === 0 ? "EVET" : "HAYIR"}`);

    return { values, signals, placeholders };
  }

  /** GERÇEK değerin Türkçe gösterimi — yalnız API tarafında kullanılır. */
  private formatValue(metric: ReportMetric): string {
    if (metric.value === null || metric.value === undefined) return "veri yok";
    switch (metric.type) {
      case "money":
        return formatMoneyTr(String(metric.value), metric.currency ?? "TRY");
      case "percent":
        return `%${trDecimal(Number(metric.value).toFixed(2))}`;
      case "minutes":
        return `${trDecimal(String(metric.value))} dk`;
      default:
        return trDecimal(String(metric.value));
    }
  }

  /**
   * RAKAMSIZ sinyal: yön + varlık + kritiklik.
   *
   * Modelin metne "az/çok" gibi büyüklük iddiası yazmasını istemiyoruz; bu
   * yüzden büyüklük bandı DEĞİL, yalnız YÖN bildirilir. Büyüklüğü okuyucu
   * yerleştirilen gerçek rakamdan görür.
   */
  private signalOf(metric: ReportMetric): string {
    const parts: string[] = [];

    if (metric.value === null || metric.value === undefined) {
      parts.push("VERI_YOK");
    } else if (metric.type === "money") {
      const raw = String(metric.value);
      parts.push(raw.startsWith("-") ? "NEGATIF" : /^0+(?:\.0+)?$/.test(raw) ? "YOK" : "VAR");
    } else {
      const n = Number(metric.value);
      parts.push(n < 0 ? "NEGATIF" : n === 0 ? "YOK" : "VAR");
    }

    if (metric.previous !== undefined && metric.delta !== null && metric.delta !== undefined) {
      const deltaRaw = String(metric.delta);
      const negative = deltaRaw.startsWith("-");
      const zero = /^-?0+(?:[.,]0+)?$/.test(deltaRaw);
      parts.push(zero ? "DEGISMEDI" : negative ? "AZALDI" : "ARTTI");
    }

    if (metric.critical && metric.value !== null && Number(metric.value) !== 0) {
      parts.push("KRİTİK");
    }

    return parts.join(" ");
  }
}
