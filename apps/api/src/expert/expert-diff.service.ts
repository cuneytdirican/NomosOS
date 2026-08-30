/**
 * EXPERT_REPORT_DIFF — İKİ BİLİRKİŞİ RAPORUNUN MADDE MADDE KARŞILAŞTIRMASI.
 *
 * ÜRÜN İLKELERİ:
 *
 *  1. AYNI DOSYA ZORUNLULUĞU. Farklı dosyaların raporları karşılaştırılamaz
 *     (422). Bu yalnız bir tutarlılık kuralı değil, bir GİZLİLİK kuralıdır:
 *     iki ayrı dosyanın metnini tek bir istemde birleştirmek, iki müvekkilin
 *     verisini aynı LLM bağlamına koymak demektir.
 *
 *  2. ÇIKTI ÖNERİDİR VE HİÇBİR KAYDI DEĞİŞTİRMEZ. Kaydedilen tek şey
 *     `ExpertReportDiff`tir ve o da bir ANALİZ kaydıdır: rapor, itiraz veya
 *     süre kayıtlarına dokunmaz. "İtirazımız karşılanmamış" tespiti bile
 *     `ExpertObjection.status`'ü otomatik değiştirmez — bunu avukat yapar.
 *
 *  3. İKİ ALINTI KURALI. Bir "değişti" iddiası ancak İKİ raporun da alıntısıyla
 *     doğrulanabilir. `enforceQuotePolicy` bunu output-guard'dan DAHA KATI
 *     uygular (guard "herhangi bir kaynak alanı dolu ise geçer" der; burada
 *     kural iki alanlıdır). Elenen maddeler yanıtta görünür.
 *
 *  4. HESAP YAPILMAZ. Prompt modele tutar/oran/gün aritmetiği yasaklar;
 *     raporlardaki rakamlar AKTARILIR, yeniden hesaplanmaz.
 *
 *  5. KVKK. Bilirkişi raporları yoğun kişisel veri taşır (TCKN, adres, sağlık).
 *     Metinler `AiRunnerService`in maskeleme kapısından geçer; dış sağlayıcı +
 *     PII + onay yok → 409 `requiresPiiApproval`.
 */

import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { AuditService } from "../audit/audit.service";
import { formatTrDate } from "../common/dates";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  buildExpertReportDiffMessages,
  ExpertReportDiffOutputSchema,
  type ExpertReportDiffItem,
} from "./expert-prompts";
import type { CompareReportsInput } from "./expert.dto";
import { ExpertService } from "./expert.service";

/** Rapor başına modele gönderilecek azami karakter. */
const REPORT_CHARS = 20000;

@Injectable()
export class ExpertDiffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiRunnerService,
    private readonly audit: AuditService,
    private readonly experts: ExpertService,
  ) {}

  /** POST /expert-reports/compare */
  async compare(user: AuthUser, input: CompareReportsInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "bilirkişi raporu karşılaştırma");

    if (input.baseReportId === input.compareReportId) {
      throw new UnprocessableEntityException(
        "Bir rapor kendisiyle karşılaştırılamaz; iki farklı rapor seçin.",
      );
    }

    const base = await this.experts.loadReport(user.tenantId, input.baseReportId, true);
    const compare = await this.experts.loadReport(user.tenantId, input.compareReportId, true);

    // AYNI DOSYA KAPISI — hem tutarlılık hem gizlilik gereği.
    if (base.caseId !== compare.caseId) {
      throw new UnprocessableEntityException(
        "Yalnızca AYNI dosyanın raporları karşılaştırılabilir. Farklı dosyaların rapor " +
          "metinleri tek bir analizde birleştirilemez.",
      );
    }

    const [baseText, compareText] = await Promise.all([
      this.reportText(user.tenantId, base),
      this.reportText(user.tenantId, compare),
    ]);

    // METNİ OLMAYAN RAPOR KARŞILAŞTIRILMAZ. Boş bağlamla üretilen bir "fark
    // listesi" tamamen uydurma olurdu.
    const missing: string[] = [];
    if (!baseText.text) missing.push("temel rapor");
    if (!compareText.text) missing.push("karşılaştırılacak rapor");
    if (missing.length > 0) {
      throw new UnprocessableEntityException(
        `${missing.join(" ve ")} için metin bulunamadı. Karşılaştırma yapılabilmesi için her iki ` +
          "raporun belgesi yüklenmiş ve metin çıkarma (OCR) hattından geçmiş olmalıdır. " +
          "Metinsiz karşılaştırma yapılmaz.",
      );
    }

    // Aradaki itiraz maddelerimiz — modelin "itirazımız karşılandı mı"
    // sorusunu cevaplayabilmesi için bağlama girer.
    const objectionPoints = base.objections.flatMap((o) => safeParsePoints(o.points));
    const objectionText = objectionPoints.length
      ? "İTİRAZ MADDELERİMİZ:\n" +
        objectionPoints.map((p) => `${p.no}. ${p.topic}: ${p.summary}`).join("\n")
      : "İTİRAZ MADDELERİMİZ: (temel rapora kayıtlı itiraz maddesi yok)";

    const baseBlock =
      `TEMEL RAPOR [${base.reportType} · ${formatTrDate(base.receivedAt)}` +
      `${base.servedAt ? ` · tebliğ ${formatTrDate(base.servedAt)}` : ""}]:\n${baseText.text}`;
    const compareBlock =
      `KARŞILAŞTIRILAN RAPOR [${compare.reportType} · ${formatTrDate(compare.receivedAt)}` +
      `${compare.servedAt ? ` · tebliğ ${formatTrDate(compare.servedAt)}` : ""}]:\n${compareText.text}`;

    const instruction =
      "İki raporu madde madde karşılaştır. Her fark için İKİ RAPORDAN DA birebir alıntı ver " +
      "(EKLENDI'de yalnız karşılaştırılan rapordan, CIKARILDI'da yalnız temel rapordan). " +
      "Rakamları aktar, YENİDEN HESAPLAMA. İtiraz maddelerimizden karşılanmamış olanları " +
      "ITIRAZ_KARSILANMADI olarak işaretle ve relatedObjectionNo alanına madde numarasını yaz.";

    const run = await this.ai.run({
      user,
      taskType: "EXPERT_REPORT_DIFF",
      // Sıra önemlidir: buildMessages maskeli metinleri aynı sırayla alır.
      outboundTexts: [baseBlock, compareBlock, objectionText, instruction],
      piiApproved: input.piiApproved,
      schema: ExpertReportDiffOutputSchema,
      /**
       * `findingPaths` VERİLMEZ: guard'ın "herhangi bir kaynak alanı dolu ise
       * geçer" kuralı bu ajan için YETERSİZDİR ve `quoteBase`/`quoteCompare`
       * alanlarını zaten tanımaz. Eleme aşağıda, iki alanlı katı kuralla yapılır.
       */
      entity: "ExpertReport",
      entityId: base.id,
      maxTokens: 4096,
      buildMessages: ([b, c, o, instr]) =>
        buildExpertReportDiffMessages({
          baseText: b,
          compareText: c,
          objectionText: o,
          instruction: instr,
        }),
    });

    const knownObjectionNos = new Set(objectionPoints.map((p) => p.no));
    const policy = enforceQuotePolicy(run.data.diffs, knownObjectionNos);

    const record = await this.prisma.client.expertReportDiff.create({
      data: {
        tenantId: user.tenantId,
        caseId: base.caseId,
        baseReportId: base.id,
        compareReportId: compare.id,
        diffJson: JSON.stringify({
          diffs: policy.kept,
          summary: run.data.summary ?? null,
          droppedForMissingQuote: policy.dropped,
        }),
        model: run.model,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_EXPERT_REPORT_DIFF_SAVE",
      entity: "ExpertReportDiff",
      entityId: record.id,
      detail:
        `dosya=${base.caseId} temel=${base.id} karşı=${compare.id} ` +
        `fark=${policy.kept.length} elenen=${policy.dropped.length} model=${run.model}`,
    });

    return {
      id: record.id,
      caseId: base.caseId,
      baseReport: summarizeReport(base),
      compareReport: summarizeReport(compare),
      /** İNSAN ONAYI NOKTASI. */
      approval: {
        required: true,
        writesRecords: ["ExpertReportDiff (yalnızca analiz kaydı)"],
        note:
          "Fark listesi ÖNERİDİR. İtiraz durumları (ExpertObjection.status), süreler ve rapor " +
          "kayıtları bu çıktı nedeniyle DEĞİŞMEMİŞTİR. «İtirazımız karşılanmadı» tespiti dâhil " +
          "hiçbir madde otomatik işlenmez; ikinci itirazı hazırlamak avukatın kararıdır.",
      },
      advisory: run.advisory,
      diffs: policy.kept,
      summary: run.data.summary ?? null,
      deterministic: {
        objectionPointCount: objectionPoints.length,
        baseTextSource: baseText.source,
        compareTextSource: compareText.source,
        baseTextTruncated: baseText.truncated,
        compareTextTruncated: compareText.truncated,
      },
      ai: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        citations: run.citations,
        droppedFindings: run.droppedFindings,
        /** İki alıntı kuralını karşılamadığı için ELENEN maddeler — şeffaflık. */
        droppedForMissingQuote: policy.dropped,
        /** Kayıtlı itiraz maddesiyle eşleşmediği için TEMİZLENEN atıflar. */
        clearedObjectionRefs: policy.clearedObjectionRefs,
        usage: run.usage,
      },
      warnings: [
        ...(baseText.truncated || compareText.truncated
          ? [
              "Rapor metinleri uzunluk sınırı nedeniyle KISALTILMIŞTIR; karşılaştırma raporların " +
                "tamamını kapsamayabilir. Kritik bölümler için raporların aslıyla karşılaştırma yapın.",
            ]
          : []),
        ...(objectionPoints.length === 0
          ? [
              "Temel rapora kayıtlı itiraz maddesi bulunmadığı için «itirazımız karşılandı mı» " +
                "değerlendirmesi yapılamamıştır.",
            ]
          : []),
      ],
    };
  }

  /** GET /cases/:caseId/expert-report-diffs — geçmiş karşılaştırmalar. */
  async listDiffs(user: AuthUser, caseId: string) {
    await this.experts.assertCase(user.tenantId, caseId);
    const rows = await this.prisma.client.expertReportDiff.findMany({
      where: { tenantId: user.tenantId, caseId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        baseReportId: r.baseReportId,
        compareReportId: r.compareReportId,
        model: r.model,
        createdAt: r.createdAt,
        ...safeParseDiff(r.diffJson),
      })),
      total: rows.length,
    };
  }

  /**
   * Rapor metni: önce bağlı belgenin OCR metni, yoksa AI özeti, o da yoksa
   * kayıttaki `conclusionText`/`summary`. Kaynağın hangisi olduğu yanıtta
   * DÖNER — özet üzerinden yapılan karşılaştırma, tam metin karşılaştırması
   * kadar güvenilir değildir ve avukat bunu bilmelidir.
   */
  private async reportText(
    tenantId: string,
    report: { documentId: string | null; conclusionText: string | null; summary: string | null },
  ) {
    if (report.documentId) {
      const doc = await this.prisma.client.document.findFirst({
        where: { id: report.documentId, tenantId },
        select: { ocrText: true, aiSummary: true, name: true },
      });
      const ocr = doc?.ocrText?.trim();
      if (ocr) return clip(ocr, `belge OCR metni ("${doc?.name}")`);
      const summary = doc?.aiSummary?.trim();
      if (summary) return clip(summary, `belge AI özeti ("${doc?.name}") — TAM METİN DEĞİL`);
    }
    const conclusion = report.conclusionText?.trim();
    if (conclusion) return clip(conclusion, "kayıttaki sonuç bölümü — TAM METİN DEĞİL");
    const summary = report.summary?.trim();
    if (summary) return clip(summary, "kayıttaki özet — TAM METİN DEĞİL");
    return { text: "", source: "yok", truncated: false };
  }
}

/* ------------------------------------------------------------------ *
 * Saf yardımcılar
 * ------------------------------------------------------------------ */

function clip(text: string, source: string) {
  const clean = text.replace(/\r/g, "").trim();
  const truncated = clean.length > REPORT_CHARS;
  return {
    text: truncated ? `${clean.slice(0, REPORT_CHARS)}\n…[METİN KISALTILDI]` : clean,
    source,
    truncated,
  };
}

export interface DroppedDiff {
  topic: string;
  changeType: string;
  reason: string;
}

/**
 * İKİ ALINTI KURALI.
 *
 *  • DEGISTI / CELISKI / ITIRAZ_KARSILANMADI → İKİ alıntı da zorunlu.
 *    Bu maddeler "iki rapor arasında bir ilişki var" iddiasıdır; tek taraflı
 *    alıntı bu iddiayı doğrulamaz.
 *  • EKLENDI → yalnız `quoteCompare` zorunlu (temel raporda yok ki alıntılansın).
 *  • CIKARILDI → yalnız `quoteBase` zorunlu.
 *
 * Ayrıca `relatedObjectionNo`, KAYITLI itiraz maddelerinden biri değilse
 * TEMİZLENİR: var olmayan bir itiraz maddesine yapılan atıf, uydurma atıftır.
 */
export function enforceQuotePolicy(
  diffs: readonly ExpertReportDiffItem[],
  knownObjectionNos: ReadonlySet<number>,
): { kept: ExpertReportDiffItem[]; dropped: DroppedDiff[]; clearedObjectionRefs: number[] } {
  const kept: ExpertReportDiffItem[] = [];
  const dropped: DroppedDiff[] = [];
  const clearedObjectionRefs: number[] = [];

  for (const diff of diffs) {
    const hasBase = Boolean(diff.quoteBase?.trim());
    const hasCompare = Boolean(diff.quoteCompare?.trim());

    let ok: boolean;
    let reason = "";
    if (diff.changeType === "EKLENDI") {
      ok = hasCompare;
      reason = "EKLENDI maddesi karşılaştırılan rapordan alıntı taşımıyor.";
    } else if (diff.changeType === "CIKARILDI") {
      ok = hasBase;
      reason = "CIKARILDI maddesi temel rapordan alıntı taşımıyor.";
    } else {
      ok = hasBase && hasCompare;
      reason = `${diff.changeType} maddesi iki raporun DA alıntısını taşımıyor.`;
    }

    if (!ok) {
      dropped.push({ topic: diff.topic, changeType: diff.changeType, reason });
      continue;
    }

    if (diff.relatedObjectionNo !== undefined && !knownObjectionNos.has(diff.relatedObjectionNo)) {
      clearedObjectionRefs.push(diff.relatedObjectionNo);
      kept.push({ ...diff, relatedObjectionNo: undefined });
      continue;
    }
    kept.push(diff);
  }

  return { kept, dropped, clearedObjectionRefs };
}

function summarizeReport(report: {
  id: string;
  reportType: string;
  receivedAt: Date;
  servedAt: Date | null;
  documentId: string | null;
}) {
  return {
    id: report.id,
    reportType: report.reportType,
    receivedAt: report.receivedAt,
    servedAt: report.servedAt,
    documentId: report.documentId,
  };
}

function safeParsePoints(raw: string): { no: number; topic: string; summary: string }[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as { no: number; topic: string; summary: string }[]) : [];
  } catch {
    return [];
  }
}

function safeParseDiff(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
