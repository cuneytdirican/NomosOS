import { Injectable, Logger } from "@nestjs/common";
import type { DocumentClass, Prisma, ProcessingStatus } from "@nomosos/db";
import type { DeadlineDetectOutput, DocumentClassifyOutput } from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AgentRunnerService } from "./agent-runner.service";
import { DeadlineComputeService } from "./deadline-compute.service";
import { extractFindings, findHearingDate, findNotifiedAt } from "./extraction";
import { extractText } from "./text-extract";
import {
  courtSimilarity,
  decideAutoLink,
  extractCaseNumbers,
  normalizeCaseNumber,
  courtAppearsInText,
  normalizeForCompare,
  partyAppearsInText,
  rankCandidates,
  type CaseMatchCandidate,
} from "./case-match";
import { templateForRequestedDocument, templatesForClass } from "./task-templates";
import {
  DROP_REASON_LABELS,
  filterByVerbatimQuote,
  quoteAppearsIn,
} from "../common/ai/quote-guard";
import {
  CLASS_SOURCE,
  CLASSIFY_CONFIDENCE_THRESHOLD,
  MATCH_CASE_CONFIDENCE_THRESHOLD,
  PIPELINE_STEP_LABELS,
  classCanTriggerDeadline,
  classSourceLabel,
  type PipelineContext,
  type PipelineStep,
  type PipelineStepRecord,
  type PipelineStepResult,
  type ProposalDraft,
} from "./pipeline.types";

/** Sınıflandırmanın "kesin" sayıldığı eşik; altı triyaj kuyruğuna düşer (Modül 06, kural 2). */
const CLASSIFY_TRIAGE_THRESHOLD = 0.85;

/** LLM'e gönderilen belge metni üst sınırı (bağlam bütçesi). */
const MAX_PROMPT_TEXT_CHARS = 12_000;

/** Taraf adı taramasında okunacak azami taraf kaydı. */
const MAX_PARTY_SCAN = 2000;

/**
 * BELGE → AKSİYON HATTI (Modül 06).
 *
 * "Belge geldi → sistem ne yapılması gerektiğini kendisi çıkardı."
 *
 * 7 adım: OCR → CLASSIFY → MATCH_CASE → EXTRACT → DETECT_DEADLINE →
 *          CREATE_TASKS → NOTIFY
 *
 * TAVİZSİZ KURALLAR
 * -----------------
 * 1. HİÇBİR ADIM Task / Deadline / TimelineEvent OLUŞTURMAZ. Her çıkarım
 *    `DocumentActionProposal` (status=BEKLIYOR) olarak onay kuyruğuna düşer.
 *    Hattın tek doğrudan yazdığı alanlar belgenin KENDİ meta verileridir
 *    (ocrText, class, caseId) — bunlar da düzeltilebilir.
 * 2. Bir adım düşerse hat DURMAZ; koşum KISMI olarak devam eder ve hata
 *    `stepsJson` içinde saklanır.
 * 3. AI süre HESAPLAMAZ. DEADLINE_DETECT yalnızca olayı tespit eder; son gün
 *    daima `@nomosos/legal-core` motorundan gelir (DeadlineComputeService).
 * 4. Metin yoksa sonraki adımlar ATLANIR. Boş metinden sınıf/süre üretmek yoktur.
 *
 * FAZ NOTU: Hat şu an SENKRON koşar. Her adım `PipelineStep` arayüzünü uygulayan
 * bağımsız bir birimdir; BullMQ'ya taşındığında adım gövdeleri değişmez.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly agents: AgentRunnerService,
    private readonly deadlines: DeadlineComputeService
  ) {}

  /** Hattın adım listesi — sıra buradaki sıradır. */
  private steps(): PipelineStep[] {
    return [
      { code: "OCR", run: (ctx) => this.stepExtractText(ctx) },
      { code: "CLASSIFY", run: (ctx) => this.stepClassify(ctx) },
      { code: "MATCH_CASE", run: (ctx) => this.stepMatchCase(ctx) },
      { code: "EXTRACT", run: (ctx) => this.stepExtract(ctx) },
      { code: "DETECT_DEADLINE", run: (ctx) => this.stepDetectDeadline(ctx) },
      { code: "CREATE_TASKS", run: (ctx) => this.stepCreateTasks(ctx) },
      { code: "NOTIFY", run: (ctx) => this.stepNotify(ctx) },
    ];
  }

  /**
   * Bir belge için hattı koşar. FIRLATMAZ — yükleme isteği hattın hatasıyla
   * başarısız olmamalıdır (belge zaten güvenle saklanmıştır).
   */
  async run(params: {
    tenantId: string;
    userId?: string;
    documentId: string;
  }): Promise<{ runId: string | null; status: string; proposalCount: number }> {
    const document = await this.prisma.client.document.findFirst({
      where: { id: params.documentId, tenantId: params.tenantId },
      select: {
        id: true,
        name: true,
        storageKey: true,
        mimeType: true,
        caseId: true,
      },
    });
    if (!document) {
      return { runId: null, status: "BASARISIZ", proposalCount: 0 };
    }

    const run = await this.prisma.client.pipelineRun.create({
      data: {
        tenantId: params.tenantId,
        documentId: document.id,
        status: "CALISIYOR",
      },
      select: { id: true },
    });

    const ctx: PipelineContext = {
      tenantId: params.tenantId,
      userId: params.userId,
      documentId: document.id,
      documentName: document.name,
      storageKey: document.storageKey,
      mimeType: document.mimeType,
      caseId: document.caseId,
      caseIdWasGivenByUser: document.caseId !== null,
      triage: false,
      findings: [],
      detections: [],
      proposals: [],
      piiMasked: false,
      warnings: [],
    };

    const records: PipelineStepRecord[] = [];
    for (const step of this.steps()) {
      const startedAt = new Date();
      const t0 = Date.now();
      let result: PipelineStepResult;
      try {
        result = await step.run(ctx);
      } catch (err) {
        // Beklenmeyen hata bile hattı durdurmaz (kural 2).
        this.logger.warn(
          `Hat adımı düştü (${step.code} / belge ${document.id}): ${(err as Error).message}`
        );
        result = { status: "BASARISIZ", error: (err as Error).message };
      }
      records.push({
        ...result,
        step: step.code,
        label: PIPELINE_STEP_LABELS[step.code],
        durationMs: Date.now() - t0,
        startedAt: startedAt.toISOString(),
      });
    }

    const proposalCount = await this.persistProposals(ctx);
    const status = summarizeStatus(records);
    const failures = records.filter((r) => r.status === "BASARISIZ");

    await this.prisma.client.pipelineRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        stepsJson: JSON.stringify(records),
        errorMessage:
          failures.length > 0
            ? failures.map((f) => `${f.label}: ${f.error ?? "bilinmeyen hata"}`).join(" | ")
            : null,
      },
    });

    return { runId: run.id, status, proposalCount };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 1 — METİN ÇIKARMA
   * ------------------------------------------------------------------ */

  private async stepExtractText(ctx: PipelineContext): Promise<PipelineStepResult> {
    let buffer: Buffer;
    try {
      buffer = await this.storage.getObjectBuffer(ctx.storageKey);
    } catch (err) {
      await this.setOcrStatus(ctx.documentId, "BASARISIZ");
      return { status: "BASARISIZ", error: `Belge depodan okunamadı: ${(err as Error).message}` };
    }

    const extracted = await extractText({
      buffer,
      mimeType: ctx.mimeType,
      fileName: ctx.documentName,
    });

    const ocrStatus: ProcessingStatus =
      extracted.outcome === "TAMAM"
        ? "TAMAM"
        : extracted.outcome === "GEREKSIZ"
          ? "GEREKSIZ"
          : "BASARISIZ";

    await this.prisma.client.document.update({
      where: { id: ctx.documentId },
      data: {
        ocrText: extracted.text ?? null,
        ocrStatus,
        pageCount: extracted.pageCount ?? null,
      },
    });

    if (extracted.outcome !== "TAMAM" || !extracted.text) {
      ctx.warnings.push(extracted.note);
      return {
        status: extracted.outcome === "GEREKSIZ" ? "ATLANDI" : "BASARISIZ",
        detail: extracted.note,
        error: extracted.outcome === "BASARISIZ" ? extracted.note : undefined,
        output: { ocrStatus },
      };
    }

    ctx.text = extracted.text;
    ctx.pageCount = extracted.pageCount;
    return {
      status: "TAMAM",
      detail: extracted.note,
      output: { ocrStatus, chars: extracted.text.length, pageCount: extracted.pageCount },
    };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 2 — SINIFLANDIRMA (DOC_CLASSIFIER ajanı)
   * ------------------------------------------------------------------ */

  private async stepClassify(ctx: PipelineContext): Promise<PipelineStepResult> {
    if (!ctx.text) {
      return { status: "ATLANDI", detail: "Belgeden metin çıkarılamadığı için sınıflandırma yapılmadı." };
    }

    const result = await this.agents.run<DocumentClassifyOutput>({
      agentKey: "DOC_CLASSIFIER",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      context: {
        documentTitle: ctx.documentName,
        documentText: ctx.text.slice(0, MAX_PROMPT_TEXT_CHARS),
      },
    });

    if (result.piiMasked) ctx.piiMasked = true;

    if (!result.ok || !result.data) {
      ctx.triage = true;
      if (result.skipped) ctx.warnings.push(result.error ?? "Sınıflandırma adımı atlandı.");
      return {
        // KVKK rızası yok / politika dışı rota → hata DEĞİL, bilinçli ATLAMA.
        status: result.skipped ? "ATLANDI" : "BASARISIZ",
        error: result.skipped ? undefined : (result.error ?? "Sınıflandırma çıktısı alınamadı."),
        detail:
          (result.skipped ? `${result.error} ` : "") +
          "Belge sınıfı DIGER olarak bırakıldı; triyaj kuyruğunda elle sınıflandırılabilir.",
        output: { piiMasked: result.piiMasked, skipped: Boolean(result.skipped) },
      };
    }

    const output = result.data;
    ctx.classification = output;

    // EŞİK MANTIĞI
    //  < 0.70 → sınıf YAZILMAZ (DIGER kalır), belge triyaja düşer.
    //  < 0.85 → sınıf yazılır ama koşum yine de triyaj işaretlenir (Modül 06, kural 2).
    const confident = output.confidence >= CLASSIFY_CONFIDENCE_THRESHOLD;
    ctx.triage = output.confidence < CLASSIFY_TRIAGE_THRESHOLD;

    await this.prisma.client.document.update({
      where: { id: ctx.documentId },
      data: {
        class: confident ? (output.class as DocumentClass) : "DIGER",
        classSource: classSourceLabel(
          confident ? CLASS_SOURCE.AI : CLASS_SOURCE.AI_LOW,
          output.confidence
        ),
        aiSummary: output.summary,
      },
    });

    if (output.uncertaintyNote) ctx.warnings.push(output.uncertaintyNote);

    const detail = confident
      ? `Sınıf: ${output.class} (güven ${(output.confidence * 100).toFixed(0)}%).` +
        (ctx.triage ? " Güven %85 altında olduğu için belge triyaj kuyruğunda kalır." : "")
      : `Güven ${(output.confidence * 100).toFixed(0)}% eşiğin (70%) altında; sınıf DIGER bırakıldı, ` +
        "belge triyaj kuyruğuna alındı.";

    return {
      status: "TAMAM",
      detail,
      output: {
        class: output.class,
        applied: confident ? output.class : "DIGER",
        confidence: output.confidence,
        triage: ctx.triage,
        piiMasked: result.piiMasked,
        droppedFindings: result.droppedFindings.length,
        model: result.model,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 3 — DOSYA EŞLEME (deterministik)
   * ------------------------------------------------------------------ */

  private async stepMatchCase(ctx: PipelineContext): Promise<PipelineStepResult> {
    if (ctx.caseIdWasGivenByUser && ctx.caseId) {
      return {
        status: "TAMAM",
        detail: "Dosya yükleme sırasında kullanıcı tarafından seçildi; otomatik eşleme aranmadı.",
        output: { caseId: ctx.caseId, source: "KULLANICI" },
      };
    }
    if (!ctx.text) {
      ctx.proposals.push(this.buildMatchProposal([], "Belgeden metin çıkarılamadı."));
      return {
        status: "ATLANDI",
        detail: "Metin olmadığı için eşleme yapılamadı; dosya seçimi önerisi üretildi.",
      };
    }

    const candidates = await this.findCaseCandidates(ctx);
    const ranked = rankCandidates(candidates);
    const decision = decideAutoLink(ranked, MATCH_CASE_CONFIDENCE_THRESHOLD);

    if (decision.auto) {
      await this.prisma.client.document.update({
        where: { id: ctx.documentId },
        data: { caseId: decision.auto.caseId },
      });
      // Belge parçaları varsa (asistan hattı) dosya bağı onlarda da tazelenir.
      // SAVUNMA DERİNLİĞİ: üst kayıt zaten tenant süzgeciyle doğrulandı, yine de
      // her toplu yazma kendi tenantId koşulunu taşır.
      await this.prisma.client.documentChunk.updateMany({
        where: { documentId: ctx.documentId, tenantId: ctx.tenantId },
        data: { caseId: decision.auto.caseId },
      });
      ctx.caseId = decision.auto.caseId;
      return {
        status: "TAMAM",
        detail: `Dosya otomatik bağlandı: ${decision.auto.fileNumber ?? decision.auto.title} — ${decision.auto.reason}`,
        output: { caseId: decision.auto.caseId, confidence: decision.auto.confidence },
      };
    }

    const reason =
      ranked.length === 0
        ? "Belgede sistemdeki hiçbir dosyayla eşleşen esas numarası veya taraf adı bulunamadı."
        : decision.ambiguous
          ? "Birden fazla dosya eşleşti; hangisinin doğru olduğu belirsiz."
          : `En yüksek eşleşme güveni %${Math.round((ranked[0]?.confidence ?? 0) * 100)} ve otomatik bağlama eşiğinin (%90) altında.`;

    ctx.proposals.push(this.buildMatchProposal(ranked.slice(0, 5), reason));
    ctx.triage = true;
    return {
      status: "TAMAM",
      detail: `${reason} Dosya seçimi avukat onayına bırakıldı.`,
      output: { candidateCount: ranked.length, ambiguous: decision.ambiguous },
    };
  }

  /** Esas numarası + mahkeme adı + taraf adlarıyla aday dosya listesi. */
  private async findCaseCandidates(ctx: PipelineContext): Promise<CaseMatchCandidate[]> {
    const text = ctx.text ?? "";
    const byId = new Map<string, CaseMatchCandidate>();
    const upsert = (candidate: CaseMatchCandidate): void => {
      const existing = byId.get(candidate.caseId);
      if (!existing || existing.confidence < candidate.confidence) byId.set(candidate.caseId, candidate);
    };

    // (a) Esas numarası — en güçlü sinyal.
    //
    // AI'IN ESAS NO İPUCU ARAMA KÜMESİNE EKLENMEZ (denetim bulgusu Ö-19).
    //
    // Eskiden `numbers.add(suggested)` yazılıydı: model, belge metninde HİÇ
    // GEÇMEYEN bir esas numarası uydurup arama kümesini genişletebiliyordu —
    // yani halüsinasyon, hangi dosyaların aday olacağını belirliyordu. İpucu
    // artık yalnızca DOĞRULAMA sinyali olarak kullanılır: metinden çıkarılmış
    // bir numarayla ÖRTÜŞÜYORSA güveni destekler, tek başına aday üretemez.
    const textNumbers = new Set(extractCaseNumbers(text));
    const suggestedRaw = normalizeCaseNumber(ctx.classification?.suggestedCaseNumber);
    // İpucu yalnız metinde de geçiyorsa "doğrulanmış" sayılır.
    const suggested = suggestedRaw && textNumbers.has(suggestedRaw) ? suggestedRaw : undefined;
    if (suggestedRaw && !suggested) {
      ctx.warnings.push(
        `Belge sınıflandırması "${suggestedRaw}" esas numarasını önerdi, ancak bu numara belge ` +
          "metninde bulunamadı; dosya eşleştirmesinde KULLANILMADI (uydurma esas no koruması).",
      );
    }
    const numbers = textNumbers;

    if (numbers.size > 0) {
      const matches = await this.prisma.client.case.findMany({
        where: { tenantId: ctx.tenantId, fileNumber: { in: [...numbers] } },
        select: { id: true, title: true, fileNumber: true, courtName: true },
        orderBy: [{ fileNumber: "asc" }, { id: "asc" }],
        take: 20,
      });

      // Aynı esas numarasını taşıyan birden çok dosya varsa eşleşme HER HÂLÜKÂRDA
      // belirsizdir: numara tek başına o dosyayı işaret etmiyordur.
      const countByNumber = new Map<string, number>();
      for (const found of matches) {
        const key = found.fileNumber ?? "";
        countByNumber.set(key, (countByNumber.get(key) ?? 0) + 1);
      }

      for (const found of matches) {
        const courtScore = courtSimilarity(ctx.classification?.courtName, found.courtName ?? undefined);
        const duplicateNumber = (countByNumber.get(found.fileNumber ?? "") ?? 0) > 1;

        // [DÜZELTME] Esas numarası TEK BAŞINA otomatik bağlamaz.
        //
        // `extractCaseNumbers` metindeki her "YYYY/N" kalıbını yakalar: karşı
        // tarafın esas numarası, başka bir mahkemenin dosyası, hatta "2024/12"
        // gibi sıradan bir ifade. Bu numara kiracıda bir fileNumber ile
        // çakıştığında belge AVUKAT ONAYI OLMADAN o dosyaya bağlanıyordu ve
        // ardından süre/duruşma önerileri YANLIŞ dosya bağlamıyla üretiliyordu.
        // Artık taban güven 0.85'tir (otomatik bağlama eşiği 0.90'ın altında);
        // otomatik bağlama için mahkeme adı ya da AI'ın esas no ipucu gibi
        // İKİNCİ BİR SİNYAL gerekir.
        //
        // AI TÜREVLİ SİNYALLER OTOMATİK BAĞLAMA EŞİĞİNİ AŞAMAZ (Ö-19).
        //
        // Eskiden `courtScore >= 0.5` güveni doğrudan **0.97**'ye çıkarıyordu ve
        // `decideAutoLink` 0.90 eşiğini geçtiği için belge AVUKAT ONAYI OLMADAN
        // bağlanıyordu. Sinyalin girdisi `ctx.classification.courtName`, yani
        // AI ÇIKTISIDIR ve `output.confidence` eşiğine tabi DEĞİLDİR (o eşik
        // yalnız `class` alanına uygulanır).
        //
        // Aritmetik ölçüldü (`courtSimilarity`, 3 harften kısa jetonlar elenir):
        //   "İstanbul 5. Asliye TİCARET Mahkemesi" ↔ "İstanbul 5. Asliye HUKUK Mahkemesi"
        //   ortak {istanbul, asliye, mahkemesi} = 3, min(4,4) = 4 → 0.75 ≥ 0.5
        // Yani AYRI İKİ MAHKEME 0.97 güvenle eşleşiyor, belge yanlış dosyaya
        // bağlanıyor ve DEADLINE_DETECT o yanlış bağlamda koşuyordu.
        //
        // Artık: metin türevli sinyaller (esas no eşleşmesi) otomatik bağlayabilir;
        // AI türevli sinyaller güveni yalnız AUTO_LINK_THRESHOLD'ün ALTINDA bir
        // tavana (0.89) kadar yükseltir — sonuç avukat onayına düşer.
        const AI_SIGNAL_CEILING = 0.89;
        let confidence = 0.85;
        const reasons = [`Esas numarası eşleşti (${found.fileNumber})`];

        // ÖNCE DETERMİNİSTİK SİNYAL: dosyanın kayıtlı mahkeme adı belge
        // METNİNDE geçiyor mu? Geçiyorsa kanıt metinden gelir ve otomatik
        // bağlamaya yeter. AI'ın `courtName` tahmini yalnız YEDEKTİR ve
        // tavanı eşiğin altındadır.
        if (courtAppearsInText(found.courtName, normalizeForCompare(text))) {
          confidence = 0.97;
          reasons.push("dosyanın mahkeme adı belge metninde birebir geçiyor");
        } else if (courtScore >= 0.5) {
          confidence = Math.min(AI_SIGNAL_CEILING, 0.97);
          reasons.push(
            `mahkeme adı AI sınıflandırmasıyla örtüşüyor (benzerlik ${courtScore.toFixed(2)}); ` +
              "bu sinyal AI çıktısından geldiği için otomatik bağlamaya YETMEZ, öneri olarak sunulur",
          );
        }
        if (suggested && found.fileNumber === suggested) {
          confidence = Math.min(AI_SIGNAL_CEILING, confidence + 0.05);
          reasons.push("belge sınıflandırması aynı esas numarasını gösteriyor");
        }
        if (duplicateNumber) {
          confidence = Math.min(confidence, 0.85);
          reasons.push("AYNI esas numarasını taşıyan birden çok dosya var; seçim avukatındır");
        }
        upsert({
          caseId: found.id,
          title: found.title,
          fileNumber: found.fileNumber,
          courtName: found.courtName,
          confidence,
          reason: reasons.join("; "),
        });
      }
    }

    // (b) Taraf adları — esas no yoksa/zayıfsa. Tek başına OTOMATİK BAĞLAMAZ
    //     (tavan 0.85 < eşik 0.90): sonuç daima avukat seçimine düşer.
    const normalizedText = normalizeForCompare(text);

    // DETERMİNİSTİKLİK: `orderBy` olmadan hangi MAX_PARTY_SCAN kaydın geleceği
    // belirsizdi; aynı belge iki koşumda FARKLI dosyalarla eşleşebiliyordu.
    // Sıra sabitlendi ve sınıra takılma kullanıcıya bildiriliyor.
    const partyCount = await this.prisma.client.caseParty.count({
      where: { case: { tenantId: ctx.tenantId } },
    });
    if (partyCount > MAX_PARTY_SCAN) {
      ctx.warnings.push(
        `Taraf adı taraması eksik: büronuzda ${partyCount} taraf kaydı var, ilk ${MAX_PARTY_SCAN} ` +
          "tanesi tarandı. Dosya eşleştirmesi için esas numarasını kullanın veya belgeyi elle bağlayın.",
      );
    }

    // Ağır `case` join'i kaldırıldı: önce yalnızca (caseId, name) taranır,
    // dosya künyesi SADECE eşleşen dosyalar için çekilir.
    const parties = await this.prisma.client.caseParty.findMany({
      where: { case: { tenantId: ctx.tenantId } },
      select: { caseId: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: MAX_PARTY_SCAN,
    });

    const hitsByCase = new Map<string, Set<string>>();
    for (const party of parties) {
      if (!partyAppearsInText(party.name, normalizedText)) continue;
      const entry = hitsByCase.get(party.caseId) ?? new Set<string>();
      entry.add(party.name);
      hitsByCase.set(party.caseId, entry);
    }

    if (hitsByCase.size > 0) {
      const metas = await this.prisma.client.case.findMany({
        where: { id: { in: [...hitsByCase.keys()] }, tenantId: ctx.tenantId },
        select: { id: true, title: true, fileNumber: true, courtName: true },
      });
      for (const meta of metas) {
        const names = hitsByCase.get(meta.id);
        if (!names) continue;
        const confidence = Math.min(0.85, 0.5 + 0.15 * names.size);
        upsert({
          caseId: meta.id,
          title: meta.title,
          fileNumber: meta.fileNumber,
          courtName: meta.courtName,
          confidence,
          reason: `Belgede geçen taraf adları: ${[...names].join(", ")}`,
        });
      }
    }

    return [...byId.values()];
  }

  private buildMatchProposal(candidates: CaseMatchCandidate[], reason: string): ProposalDraft {
    return {
      type: "DOSYA_ESLESTIRME",
      title: "Belgeyi bir dosyaya bağlayın",
      payload: {
        candidates: candidates.map((c) => ({
          caseId: c.caseId,
          title: c.title,
          fileNumber: c.fileNumber,
          courtName: c.courtName,
          confidence: Number(c.confidence.toFixed(2)),
          reason: c.reason,
        })),
      },
      confidence: candidates[0]?.confidence,
      reasoning: reason,
      caseId: null,
    };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 4 — VERİ ÇIKARMA
   * ------------------------------------------------------------------ */

  private async stepExtract(ctx: PipelineContext): Promise<PipelineStepResult> {
    if (!ctx.text) {
      return { status: "ATLANDI", detail: "Metin olmadığı için veri çıkarma yapılmadı." };
    }

    ctx.findings = extractFindings(ctx.text);

    // Duruşma tarihi değişikliği — yalnızca kaynak alıntısı olan tarihler.
    // Ö-20: DOCUMENT_CLASSIFY'ın `extractedDates[]` alıntıları da doğrulanır.
    // `findHearingDate` "yalnızca kaynak alıntısı olan tarihler" diyordu; ama
    // alıntının DOLU olması, belgede GERÇEKTEN geçmesi demek değildi.
    const hearingCandidate = findHearingDate(ctx.classification?.extractedDates ?? []);
    const hearing =
      hearingCandidate?.quote && !quoteAppearsIn(hearingCandidate.quote, ctx.text)
        ? undefined
        : hearingCandidate;
    if (hearingCandidate && !hearing) {
      ctx.warnings.push(
        `Duruşma tarihi önerisi ELENDİ: modelin verdiği alıntı («${hearingCandidate.quote?.slice(0, 80)}») ` +
          "belge metninde birebir bulunamadı (uydurma alıntı koruması).",
      );
    }
    if (hearing?.isoDate && ctx.caseId) {
      ctx.findings.push(hearing);
      ctx.proposals.push({
        type: "DURUSMA_GUNCELLEME",
        title: `Duruşma tarihi güncelle: ${hearing.isoDate}`,
        payload: { newDate: hearing.isoDate, label: hearing.label },
        reasoning:
          "Belgede duruşma tarihi geçiyor. Onaylarsanız dosyanın en yakın planlı duruşması bu tarihe " +
          "alınır; planlı duruşma yoksa yeni duruşma kaydı açılır.",
        sourceQuote: hearing.quote,
        caseId: ctx.caseId,
      });
    }

    const counts = ctx.findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.kind] = (acc[f.kind] ?? 0) + 1;
      return acc;
    }, {});

    return {
      status: "TAMAM",
      detail:
        ctx.findings.length === 0
          ? "Belgede süre/istenen belge/talep kalıbı bulunamadı."
          : `${ctx.findings.length} tespit çıkarıldı (${Object.entries(counts)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}).`,
      output: { counts, findings: ctx.findings.map((f) => ({ kind: f.kind, quote: f.quote })) },
    };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 5 — SÜRE TESPİTİ (AI tespit eder, MOTOR hesaplar)
   * ------------------------------------------------------------------ */

  private async stepDetectDeadline(ctx: PipelineContext): Promise<PipelineStepResult> {
    if (!ctx.text) {
      return { status: "ATLANDI", detail: "Metin olmadığı için süre tespiti yapılmadı." };
    }
    const cls = ctx.classification?.class as DocumentClass | undefined;
    if (cls && !classCanTriggerDeadline(cls)) {
      return {
        status: "ATLANDI",
        detail: `«${cls}» sınıfındaki belgeler kural olarak süre başlatmaz; tespit çalıştırılmadı.`,
      };
    }

    const relatedCase = ctx.caseId
      ? await this.prisma.client.case.findFirst({
          where: { id: ctx.caseId, tenantId: ctx.tenantId },
          select: { type: true, responsibleUserId: true },
        })
      : null;

    // Modelin GÖRDÜĞÜ metin — alıntı doğrulaması bu dilimde yapılır (Ö-20).
    const promptText = ctx.text.slice(0, MAX_PROMPT_TEXT_CHARS);
    const result = await this.agents.run<DeadlineDetectOutput>({
      agentKey: "DEADLINE_DETECTOR",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      context: {
        documentTitle: ctx.documentName,
        documentText: promptText,
        documentClass: cls,
        caseType: relatedCase?.type,
        notifiedAt: findNotifiedAt(ctx.classification?.extractedDates ?? []),
      },
    });

    if (result.piiMasked) ctx.piiMasked = true;

    if (!result.ok || !result.data) {
      if (result.skipped) ctx.warnings.push(result.error ?? "Süre tespiti adımı atlandı.");
      return {
        status: result.skipped ? "ATLANDI" : "BASARISIZ",
        error: result.skipped ? undefined : (result.error ?? "Süre tespiti çıktısı alınamadı."),
        detail:
          (result.skipped ? `${result.error} ` : "") +
          "Bu belge için süre önerisi üretilmedi; süreleri elle kontrol ediniz.",
      };
    }

    /**
     * ALINTI DOĞRULAMA KAPISI (denetim bulgusu Ö-20).
     *
     * `output-guard.hasSource` alanın DOLU olup olmadığına bakar, DOĞRU olup
     * olmadığına bakamaz. İkinci kapı olan `filterByVerbatimQuote` bu depoda
     * ZATEN YAZILIYDI (Türkçe tipografi normalizasyonu ve birim testi dahil) ve
     * üç modülden çağrılıyordu — ama `pipeline/` ve `simulation/` altında SIFIR
     * kez. Oysa buradaki senaryo en keskini:
     *
     *   model `{"eventDate":"2026-08-12","sourceQuote":"Bilirkişi raporu
     *   12.08.2026 tarihinde tebliğ edilmiş olmakla"}` üretir; bu cümle belgede
     *   YOKTUR, gerçek tarih 22.08'dir. Alıntı `DocumentActionProposal.sourceQuote`a
     *   yazılır ve avukata "Belgeden alıntı: «…»" diye gösterilir. Avukat
     *   ALINTIYI GÖRDÜĞÜ İÇİN onaylar; deterministik motor 12.08'den hesaplar ve
     *   DOĞRU ÇALIŞARAK YANLIŞ son günü üretir.
     *
     * Arama, modelin GÖRDÜĞÜ metinde yapılır (maskeliyse maskeli hâlinde):
     * `promptText` tam olarak prompta giden dilimdir.
     */
    const quoteGate = filterByVerbatimQuote(
      result.data.detections,
      promptText,
      (d) => d.sourceQuote,
      (d, i) => d.eventDescription || `Süre tespiti #${i + 1}`,
    );
    if (quoteGate.dropped.length > 0) {
      ctx.warnings.push(
        `${quoteGate.dropped.length} süre tespiti, belgede birebir bulunamayan bir alıntıya ` +
          "dayandığı için ELENDİ (uydurma alıntı koruması). Elenen tespitler: " +
          quoteGate.dropped.map((d) => `«${d.label}» — ${DROP_REASON_LABELS[d.reason]}`).join(" | "),
      );
    }

    ctx.detections = [...quoteGate.kept];
    if (ctx.detections.length === 0) {
      return {
        status: "TAMAM",
        detail: result.data.notes ?? "Belgede süre başlatan bir olay tespit edilmedi.",
        output: { detections: 0, droppedFindings: result.droppedFindings.length },
      };
    }

    let computed = 0;
    let unresolved = 0;
    for (const detection of ctx.detections) {
      const triggerDate = new Date(`${detection.eventDate}T00:00:00.000Z`);
      const outcome = Number.isNaN(triggerDate.getTime())
        ? {
            ok: false as const,
            ruleKey: detection.suggestedRuleKey,
            warnings: [],
            error: `Geçersiz olay tarihi: ${detection.eventDate}`,
          }
        : await this.deadlines.compute({
            tenantId: ctx.tenantId,
            ruleKey: detection.suggestedRuleKey,
            triggerDate,
          });

      if (outcome.ok) computed += 1;
      else unresolved += 1;

      ctx.proposals.push({
        type: "SURE",
        title: outcome.ok
          ? `Süre: ${outcome.ruleName ?? detection.suggestedRuleKey} — son gün ${formatIso(outcome.dueDate)}`
          : `Süre tespiti (kural seçilmeli): ${detection.eventDescription}`,
        payload: {
          // AI'DAN GELEN (tespit):
          eventDescription: detection.eventDescription,
          eventDate: detection.eventDate,
          suggestedRuleKey: detection.suggestedRuleKey,
          statuteBasis: detection.statuteBasis,
          // MOTORDAN GELEN (hesap) — onay anında YENİDEN hesaplanır:
          computed: outcome.ok,
          ruleKey: outcome.ok ? outcome.ruleKey : null,
          ruleName: outcome.ruleName,
          dueDate: outcome.dueDate ? formatIso(outcome.dueDate) : null,
          legalBasis: outcome.legalBasis,
          computeNote: outcome.computeNote,
          warnings: outcome.warnings,
          computeError: outcome.error,
        },
        confidence: detection.confidence,
        reasoning: outcome.ok
          ? `AI olayı tespit etti; son gün deterministik Süre Motoru tarafından hesaplandı. ${
              outcome.warnings.length > 0 ? `Uyarı: ${outcome.warnings.join(" | ")}` : ""
            }`.trim()
          : outcome.error,
        sourceQuote: detection.sourceQuote,
        caseId: ctx.caseId,
      });
    }

    return {
      status: "TAMAM",
      detail:
        `${ctx.detections.length} süre tespiti yapıldı; ${computed} tanesinin son günü motorla hesaplandı` +
        (unresolved > 0 ? `, ${unresolved} tanesi için kural seçimi gerekiyor.` : "."),
      output: {
        detections: ctx.detections.length,
        computed,
        unresolved,
        droppedFindings: result.droppedFindings.length,
        model: result.model,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 6 — GÖREV ÖNERİSİ (kural tabanlı şablonlar)
   * ------------------------------------------------------------------ */

  private async stepCreateTasks(ctx: PipelineContext): Promise<PipelineStepResult> {
    const cls = ctx.classification?.class as DocumentClass | undefined;
    const drafts: ProposalDraft[] = [];

    if (cls) {
      for (const template of templatesForClass(cls)) {
        drafts.push({
          type: "GOREV",
          title: template.title,
          payload: {
            title: template.title,
            description: template.description,
            priority: template.priority,
          },
          confidence: ctx.classification?.confidence,
          reasoning:
            `${template.rationale} Belge sınıfı: ${cls}` +
            (ctx.classification ? ` (güven %${Math.round(ctx.classification.confidence * 100)}).` : ".") +
            (ctx.classification?.summary ? ` Belge özeti: ${ctx.classification.summary}` : ""),
          caseId: ctx.caseId,
        });
      }
    }

    for (const finding of ctx.findings.filter((f) => f.kind === "ISTENEN_BELGE")) {
      const template = templateForRequestedDocument(finding.quote);
      drafts.push({
        type: "GOREV",
        title: template.title,
        payload: {
          title: template.title,
          description: template.description,
          priority: template.priority,
        },
        reasoning: template.rationale,
        sourceQuote: finding.quote,
        caseId: ctx.caseId,
      });
    }

    ctx.proposals.push(...drafts);
    return {
      status: "TAMAM",
      detail:
        drafts.length === 0
          ? "Bu belge sınıfı için görev şablonu yok; öneri üretilmedi."
          : `${drafts.length} görev önerisi hazırlandı (onaylanmadan görev açılmaz).`,
      output: { proposed: drafts.length, class: cls ?? null },
    };
  }

  /* ------------------------------------------------------------------ *
   * ADIM 7 — BİLDİRİM
   * ------------------------------------------------------------------ */

  private async stepNotify(ctx: PipelineContext): Promise<PipelineStepResult> {
    const pending = ctx.proposals.length;

    let responsible: { id: string; fullName: string } | null = null;
    if (ctx.caseId) {
      const found = await this.prisma.client.case.findFirst({
        where: { id: ctx.caseId, tenantId: ctx.tenantId },
        select: { responsibleUser: { select: { id: true, fullName: true } } },
      });
      responsible = found?.responsibleUser ?? null;
    }

    // KURAL 1 GEREĞİ TimelineEvent BURADA YAZILMAZ. Safahat kaydı da bir
    // ÖNERİDİR; onaylandığında TimelineEvent olarak dosyaya düşer.
    if (ctx.caseId) {
      const clsLabel = ctx.classification?.class ?? "DIGER";
      ctx.proposals.push({
        type: "SAFAHAT",
        title: `Safahata işle: ${ctx.documentName}`,
        payload: {
          title: `Belge dosyaya eklendi: ${ctx.documentName} (${clsLabel})`,
          detail:
            (ctx.classification?.summary ?? "Belge işlendi.") +
            (pending > 0 ? `\nOnay bekleyen öneri sayısı: ${pending}.` : ""),
          date: new Date().toISOString(),
        },
        reasoning: "Belge hattı tamamlandı; dosya safahatına kayıt önerilir.",
        caseId: ctx.caseId,
      });
    }

    const notifyLines = [
      `Onay bekleyen öneri: ${ctx.proposals.length}.`,
      responsible
        ? `Sorumlu avukat: ${responsible.fullName}.`
        : "Dosyanın sorumlu avukatı atanmamış; öneriler büro geneli onay kuyruğunda.",
      ctx.triage ? "Belge TRİYAJ kuyruğunda (sınıf/dosya kesinleşmedi)." : null,
      ctx.piiMasked
        ? "KVKK: dış AI sağlayıcısına gönderilen metinde kişisel veri maskelendi."
        : null,
      ...ctx.warnings,
    ].filter(Boolean) as string[];

    return {
      status: "TAMAM",
      detail: notifyLines.join(" "),
      output: {
        proposalCount: ctx.proposals.length,
        responsibleUserId: responsible?.id ?? null,
        triage: ctx.triage,
        piiMasked: ctx.piiMasked,
        // Gerçek bildirim kanalı (e-posta/push) Faz 5 kapsamındadır.
        channel: "IN_APP",
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * Yardımcılar
   * ------------------------------------------------------------------ */

  /**
   * Önerileri tek işlemde yazar.
   *
   * YENİDEN OYNATMA GÜVENLİĞİ: aynı belge için henüz KARARA BAĞLANMAMIŞ
   * (BEKLIYOR) öneriler silinip yenileri yazılır. Onaylanmış/reddedilmiş
   * kayıtlara DOKUNULMAZ — denetim izi korunur.
   */
  private async persistProposals(ctx: PipelineContext): Promise<number> {
    if (ctx.proposals.length === 0) {
      await this.prisma.client.documentActionProposal.deleteMany({
        where: { documentId: ctx.documentId, tenantId: ctx.tenantId, status: "BEKLIYOR" },
      });
      return 0;
    }

    const data: Prisma.DocumentActionProposalCreateManyInput[] = ctx.proposals.map((draft) => ({
      tenantId: ctx.tenantId,
      documentId: ctx.documentId,
      caseId: draft.caseId ?? null,
      type: draft.type,
      status: "BEKLIYOR",
      title: draft.title.slice(0, 300),
      payloadJson: JSON.stringify(draft.payload),
      confidence: draft.confidence,
      reasoning: draft.reasoning,
      sourceQuote: draft.sourceQuote,
    }));

    await this.prisma.client.$transaction(async (tx) => {
      await tx.documentActionProposal.deleteMany({
        where: { documentId: ctx.documentId, tenantId: ctx.tenantId, status: "BEKLIYOR" },
      });
      await tx.documentActionProposal.createMany({ data });
    });

    return data.length;
  }

  private async setOcrStatus(documentId: string, status: ProcessingStatus): Promise<void> {
    await this.prisma.client.document.update({ where: { id: documentId }, data: { ocrStatus: status } });
  }
}

/** Adım sonuçlarından koşum durumu: hepsi başarılı → TAMAM, karışık → KISMI. */
function summarizeStatus(records: PipelineStepRecord[]): "TAMAM" | "KISMI" | "BASARISIZ" {
  const failed = records.filter((r) => r.status === "BASARISIZ").length;
  const succeeded = records.filter((r) => r.status === "TAMAM").length;
  if (failed === 0) return "TAMAM";
  if (succeeded === 0) return "BASARISIZ";
  return "KISMI";
}

function formatIso(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}
