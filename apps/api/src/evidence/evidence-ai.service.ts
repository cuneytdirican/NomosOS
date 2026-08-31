/**
 * DELİL AI KATMANI — İKİ AJAN, İKİSİ DE YALNIZCA ÖNERİ ÜRETİR.
 *
 * ÜRÜN İLKELERİ BU DOSYADA SOMUTLAŞIR:
 *
 *  1. HİÇBİR AI ÇIKTISI KAYIT OLMAZ. Bu servis `Claim`, `Evidence`,
 *     `ClaimEvidenceLink`, `ClaimLegalBasis`, `Task` veya `Deadline`
 *     tablolarına YAZMAZ. Öneriler yanıt gövdesinde döner; avukat
 *     `POST /cases/:caseId/claims` gibi normal uçlardan tek tek ekler.
 *     Mevcut kayıtlar hiçbir koşulda EZİLMEZ.
 *
 *  2. MATRİS HESABI AI'YA SORULMAZ. "Hangi iddia desteksiz" sorusunun cevabı
 *     `EvidenceMatrixService`ten HAZIR gelir ve modele VERİLİR; model bunu
 *     yeniden hesaplayamaz, yalnızca yorumlar. Böylece delil riski deterministik
 *     kalır (Risk Motoru da aynı sayıları okur).
 *
 *  3. KAYNAK GÖSTERME ZORUNLU. Her iki koşuda da `findingPaths` verilir;
 *     alıntısız öneri output-guard tarafından ELENİR ve elenenler yanıtta
 *     `droppedFindings` olarak görünür (şeffaflık).
 *
 *  4. KVKK. Dışa giden her metin `AiRunnerService`in maskeleme kapısından
 *     geçer: dış sağlayıcı + kişisel veri + onay yok → 409 `requiresPiiApproval`.
 *     Tanık adları dilekçe/matris metninde geçtiği için bu kapı bu modülde
 *     özellikle sık çalışır.
 *
 *  5. SES/VİDEO DELİLİNDE İÇERİK GÖNDERİLMEZ. Yalnızca meta veri (başlık, tip,
 *     durum) bağlama girer; transkript belgesi bağlanmadıkça medya içeriği
 *     hiçbir modele gitmez (docs/moduller/14, iş kuralı 11).
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { EvidenceMatrixService } from "./evidence-matrix.service";
import { EVIDENCE_GAP_TASK, EVIDENCE_MATRIX_TASK } from "./evidence-ai-tasks";
import {
  buildEvidenceGapMessages,
  buildEvidenceMatrixMessages,
  EvidenceGapOutputSchema,
  EvidenceMatrixOutputSchema,
} from "./evidence-prompts";
import type { EvidenceAiInput } from "./evidence.dto";

/** Bağlama girecek belge başına azami karakter (OCR metinleri çok uzun olabilir). */
const DOC_CHARS = 4000;
/** Bağlama girecek dilekçe sürümü başına azami karakter. */
const PETITION_CHARS = 6000;
/** Bağlama alınacak azami belge sayısı. */
const MAX_DOCS = 10;
/** Bağlama alınacak azami dilekçe sayısı. */
const MAX_PETITIONS = 5;

/** Metin içeriği modele gönderilmeyecek delil tipleri (yalnız meta veri gider). */
const MEDIA_TYPES = new Set(["SES", "VIDEO", "FOTOGRAF"]);

@Injectable()
export class EvidenceAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiRunnerService,
    private readonly matrix: EvidenceMatrixService,
  ) {}

  // ================================================================== //
  // POST /cases/:caseId/evidence/ai-matrix — EVIDENCE_MATRIX
  // ================================================================== //

  async suggestMatrix(user: AuthUser, caseId: string, input: EvidenceAiInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "AI matris önerisi çalıştırma");
    const found = await this.matrix.assertCase(user.tenantId, caseId);
    const computed = await this.matrix.compute(user.tenantId, caseId);
    const sources = await this.loadTextSources(user.tenantId, caseId);

    const context = [
      `DOSYA: ${found.fileNumber ?? "-"} · ${found.title} · durum ${found.status}`,
      "",
      "MEVCUT İDDİALAR (yeniden önerme):",
      computed.rows.length
        ? computed.rows
            .map((r) => `- ${r.ref} (${r.side}, ${r.status}) ${r.text}`)
            .join("\n")
        : "- (kayıtlı iddia yok)",
      "",
      "MEVCUT DELİLLER (yeniden önerme):",
      computed.rows.length || computed.unlinkedEvidence.length
        ? this.evidenceLines(computed)
        : "- (kayıtlı delil yok)",
      "",
      "BELGE/DİLEKÇE METİNLERİ:",
      sources.lines.length ? sources.lines.join("\n") : "- (metni çıkarılmış belge/dilekçe yok)",
    ].join("\n");

    const instruction = [
      "Yukarıdaki dilekçe ve belge metinlerinden EKSİK kalan iddia, delil, iddia-delil bağı ve",
      "hukuki dayanak önerilerini çıkar. Mevcut kayıtları TEKRARLAMA. Her öneri için metinden",
      "birebir alıntı (sourceQuote) ver; alıntısı olmayan öneriler sistem tarafından elenecektir.",
      input.question?.trim() ? `\nAVUKATIN YÖNLENDİRMESİ: ${input.question.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const run = await this.ai.run({
      user,
      taskType: EVIDENCE_MATRIX_TASK,
      // Sıra önemlidir: buildMessages maskeli metinleri aynı sırayla alır.
      outboundTexts: [context, instruction],
      piiApproved: input.piiApproved,
      schema: EvidenceMatrixOutputSchema,
      findingPaths: ["suggestions"],
      entity: "Case",
      entityId: caseId,
      maxTokens: 4096,
      buildMessages: ([ctx, instr]) =>
        buildEvidenceMatrixMessages({ contextText: ctx, instruction: instr }),
    });

    return {
      caseId,
      /** İNSAN ONAYI NOKTASI — her yanıtta durur. */
      approval: {
        required: true,
        writesRecords: [],
        note:
          "Bu çıktı bir ÖNERİ KUYRUĞUDUR. Hiçbir iddia, delil, bağ veya hukuki dayanak " +
          "kaydı oluşturulmamıştır; mevcut matris DEĞİŞMEMİŞTİR. Önerileri tek tek " +
          "inceleyip kabul ettiklerinizi /cases/:caseId/claims ve /cases/:caseId/evidence " +
          "uçlarından ekleyin.",
      },
      advisory: run.advisory,
      suggestions: run.data.suggestions,
      notes: run.data.notes ?? null,
      ai: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        citations: run.citations,
        /** Kaynak göstermediği için elenen öneriler — şeffaflık. */
        droppedFindings: run.droppedFindings,
        usage: run.usage,
      },
      deterministic: {
        existingClaims: computed.rows.length,
        existingEvidence: computed.summary.totalEvidence,
        sourcesConsidered: sources.considered,
        sourcesSkipped: sources.skipped,
      },
      warnings: sources.warnings,
    };
  }

  // ================================================================== //
  // POST /cases/:caseId/evidence/gap-analysis — EVIDENCE_GAP
  // ================================================================== //

  async analyzeGaps(user: AuthUser, caseId: string, input: EvidenceAiInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "delil boşluğu analizi çalıştırma");
    const found = await this.matrix.assertCase(user.tenantId, caseId);

    // DETERMİNİSTİK ÖN-HESAP: desteksiz/zayıf iddia listesi burada çıkar.
    // Model bu listeyi DEĞİŞTİREMEZ, yalnızca yorumlar.
    const computed = await this.matrix.compute(user.tenantId, caseId);
    const unsupported = computed.rows.filter((r) => r.unsupported);
    const weak = computed.rows.filter((r) => r.weaklySupported);
    const onlyPlanned = computed.rows.filter((r) => r.onlyPlannedSupport);
    /** Çürüten bağı olan BİZ iddiaları — deterministik tespit (F2 · E6). */
    const contradicted = computed.rows.filter((r) => r.contradicted);
    /** Karşı tarafın, hiçbir delilimizle karşılanmamış iddiaları. */
    const unansweredOpposing = computed.rows.filter(
      (r) => r.side === "KARSI_TARAF" && r.status !== "CURUTULDU" && r.supportingCount === 0,
    );

    const gapLines = [
      ...unsupported.map(
        (r) => `[BOŞLUK] ${r.ref} hiçbir delille desteklenmiyor (deterministik tespit).`,
      ),
      ...contradicted.map(
        (r) =>
          `[ÇÜRÜTÜLEN] ${r.ref} delillerimizden ${r.contradictingCount} tanesi bu iddiayı ÇÜRÜTÜYOR ` +
          "(deterministik tespit).",
      ),
      ...weak.map(
        (r) =>
          `[ZAYIF] ${r.ref} yalnızca ${r.supportingCount} delille ve en fazla ` +
          `${r.strongestStrength ?? "-"}/5 güçle destekleniyor (deterministik tespit).`,
      ),
      ...onlyPlanned.map(
        (r) =>
          `[TOPLANMAMIŞ] ${r.ref} yalnızca PLANLANAN (henüz elde edilmemiş) delillerle ` +
          "destekleniyor (deterministik tespit).",
      ),
      ...unansweredOpposing.map(
        (r) => `[CEVAPSIZ] ${r.ref} karşı tarafın iddiasıdır ve karşı delilimiz yok.`,
      ),
    ];

    const context = [
      `DOSYA: ${found.fileNumber ?? "-"} · ${found.title} · durum ${found.status}`,
      "",
      "MATRİS (deterministik hesap — DEĞİŞTİRME):",
      computed.rows.length
        ? computed.rows
            .map(
              (r) =>
                `- ${r.ref} (${r.side}, ${r.status}) ${r.text} → destekleyen delil: ` +
                `${r.supportingCount}` +
                (r.strongestStrength !== null ? ` (en güçlü: ${r.strongestStrength}/5)` : "") +
                (r.legalBases.length
                  ? ` · dayanak: ${r.legalBases.map((b) => b.reference).join(", ")}`
                  : " · dayanak: yok"),
            )
            .join("\n")
        : "- (kayıtlı iddia yok)",
      "",
      "DELİL ENVANTERİ (yalnız meta veri):",
      this.evidenceLines(computed),
      "",
      gapLines.length ? gapLines.join("\n") : "[BOŞLUK] Deterministik hesapta boşluk bulunmadı.",
    ].join("\n");

    const instruction = [
      "Yukarıdaki [BOŞLUK] / [ZAYIF] / [TOPLANMAMIŞ] / [CEVAPSIZ] satırları DETERMİNİSTİK",
      "matris hesabının çıktısıdır. Bu listeyi YENİDEN HESAPLAMA ve listede olmayan bir iddiayı",
      "desteksiz ilan etme. Her satır için: boşluğun neden riskli olduğunu ve hangi somut delilin",
      "toplanması gerektiğini yaz. Her bulguda claimRef alanına ilgili [İDDİA-n] etiketini aynen koy",
      "ve matris satırından birebir alıntı ver.",
      input.question?.trim() ? `\nAVUKATIN YÖNLENDİRMESİ: ${input.question.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const run = await this.ai.run({
      user,
      taskType: EVIDENCE_GAP_TASK,
      outboundTexts: [context, instruction],
      piiApproved: input.piiApproved,
      schema: EvidenceGapOutputSchema,
      findingPaths: ["gaps"],
      entity: "Case",
      entityId: caseId,
      maxTokens: 3072,
      buildMessages: ([ctx, instr]) =>
        buildEvidenceGapMessages({ contextText: ctx, instruction: instr }),
    });

    /** Modelin var olmayan bir iddiaya bulgu yazmasına izin verilmez. */
    const knownRefs = new Set(computed.rows.map((r) => r.ref));
    const gaps = run.data.gaps.filter((g) => knownRefs.has(g.claimRef.trim()));
    const droppedUnknownRefs = run.data.gaps
      .map((g) => g.claimRef.trim())
      .filter((ref) => !knownRefs.has(ref));

    return {
      caseId,
      approval: {
        required: true,
        writesRecords: [],
        note:
          "Rapor ÖNERİDİR ve matrisi DEĞİŞTİRMEZ. Önerilen delillerin toplanması için görev " +
          "açmak, delil ikamesi süresini değerlendirmek ve dilekçeye aktarmak avukatın kararıdır.",
      },
      advisory: run.advisory,
      /** DETERMİNİSTİK YARI — tek doğru kaynak budur; AI bu sayıları değiştiremez. */
      deterministic: {
        computedBy: "deterministik matris hesabı (AI kullanılmaz)",
        summary: computed.summary,
        unsupportedClaims: unsupported.map((r) => ({ ref: r.ref, claimId: r.claimId, text: r.text })),
        contradictedClaims: contradicted.map((r) => ({
          ref: r.ref,
          claimId: r.claimId,
          text: r.text,
          contradictingCount: r.contradictingCount,
        })),
        weaklySupportedClaims: weak.map((r) => ({
          ref: r.ref,
          claimId: r.claimId,
          text: r.text,
          supportingCount: r.supportingCount,
          strongestStrength: r.strongestStrength,
        })),
        onlyPlannedSupportClaims: onlyPlanned.map((r) => ({ ref: r.ref, claimId: r.claimId })),
        unansweredOpposingClaims: unansweredOpposing.map((r) => ({
          ref: r.ref,
          claimId: r.claimId,
          text: r.text,
        })),
      },
      gaps,
      summary: run.data.summary ?? null,
      ai: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        droppedFindings: run.droppedFindings,
        /** Matriste karşılığı olmadığı için REDDEDİLEN bulgular. */
        droppedUnknownRefs,
        usage: run.usage,
      },
    };
  }

  // ================================================================== //
  // Bağlam kurma
  // ================================================================== //

  /** Delil envanterini etiketli satırlara çevirir (yalnız meta veri). */
  private evidenceLines(computed: Awaited<ReturnType<EvidenceMatrixService["compute"]>>): string {
    const seen = new Map<string, string>();
    let index = 0;

    const push = (e: {
      evidenceId: string;
      title: string;
      type: string;
      evidenceStatus: string;
      witnessName?: string | null;
      document?: { name: string } | null;
    }) => {
      if (seen.has(e.evidenceId)) return;
      index += 1;
      const parts = [
        `- [DELİL-${index}] ${e.type} · "${e.title}" · durum ${e.evidenceStatus}`,
        e.witnessName ? `tanık: ${e.witnessName}` : null,
        e.document ? `belge: ${e.document.name}` : null,
        MEDIA_TYPES.has(e.type) ? "(medya içeriği modele GÖNDERİLMEZ, yalnız meta veri)" : null,
      ].filter(Boolean);
      seen.set(e.evidenceId, parts.join(" · "));
    };

    for (const row of computed.rows) {
      for (const e of row.evidence) push(e);
    }
    for (const e of computed.unlinkedEvidence) {
      push({
        evidenceId: e.id,
        title: e.title,
        type: e.type,
        evidenceStatus: e.status,
        document: e.document,
      });
    }

    return seen.size ? [...seen.values()].join("\n") : "- (kayıtlı delil yok)";
  }

  /**
   * Dilekçe ve belge metinleri. METNİ ÇIKARILMAMIŞ BELGE GÖNDERİLMEZ ve bu
   * durum yanıtta `warnings` ile bildirilir: eksik bağlamla üretilmiş bir
   * matris önerisi, üretilmemiş öneriden daha tehlikelidir.
   */
  private async loadTextSources(tenantId: string, caseId: string) {
    const [petitions, documents] = await Promise.all([
      // Dosyanın dilekçeleri — her birinin YALNIZ güncel sürümü.
      this.prisma.client.petition.findMany({
        where: { tenantId, caseId },
        orderBy: { updatedAt: "desc" },
        take: MAX_PETITIONS,
        select: {
          id: true,
          title: true,
          type: true,
          versions: {
            orderBy: { versionNo: "desc" },
            take: 1,
            select: { plainText: true, versionNo: true },
          },
        },
      }),
      // Dosyanın belgeleri — metni çıkarılmamış olanlar aşağıda ELENİR.
      this.prisma.client.document.findMany({
        where: { tenantId, caseId },
        orderBy: { createdAt: "desc" },
        take: MAX_DOCS,
        select: { id: true, name: true, class: true, ocrText: true, aiSummary: true },
      }),
    ]);

    const lines: string[] = [];
    const considered: { kind: string; id: string; label: string }[] = [];

    for (const p of petitions) {
      const version = p.versions[0];
      if (!version || !version.plainText.trim()) continue;
      lines.push(
        `- [DİLEKÇE ${p.id}] "${p.title}" (${p.type}): ${truncate(version.plainText, PETITION_CHARS)}`,
      );
      considered.push({ kind: "PETITION", id: p.id, label: p.title });
    }

    let skipped = 0;
    for (const d of documents) {
      const text = (d.ocrText ?? d.aiSummary ?? "").trim();
      if (!text) {
        skipped += 1;
        continue;
      }
      lines.push(`- [BELGE ${d.id}] "${d.name}" (${d.class}): ${truncate(text, DOC_CHARS)}`);
      considered.push({ kind: "DOCUMENT", id: d.id, label: d.name });
    }

    const warnings: string[] = [];
    if (lines.length === 0) {
      warnings.push(
        "Dosyada metni çıkarılmış dilekçe veya belge bulunamadı. Öneriler yalnızca mevcut " +
          "matris kayıtlarına dayanacaktır; belgeleri yükleyip metin çıkarma hattından " +
          "geçirdikten sonra tekrarlayınız.",
      );
    }
    if (skipped > 0) {
      warnings.push(
        `${skipped} belgenin metni çıkarılmamış ve bağlama DÂHİL EDİLMEMİŞTİR; bu belgelerdeki ` +
          "iddia ve deliller önerilere yansımaz.",
      );
    }

    return { lines, considered, skipped, warnings };
  }

}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)} …[KISALTILDI]`;
}
