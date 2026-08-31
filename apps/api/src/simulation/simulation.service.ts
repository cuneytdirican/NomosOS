/**
 * SİMÜLASYON MODLARI (Modül 16) — koşu yönetimi.
 *
 * ÜRÜN İLKELERİNİN BU DOSYADAKİ KARŞILIĞI:
 *
 *  1. ÇIKTI ÖNERİDİR VE HİÇBİR KAYDA DÖNMEZ. Koşu yalnızca `SimulationRun`
 *     yazar; hiçbir bulgu kendiliğinden Task, Deadline, StrategyNode veya
 *     Petition olmaz. Aktarım her zaman ayrı bir avukat aksiyonudur.
 *  2. KOŞULAR DEĞİŞTİRİLEMEZ. Yeniden analiz = yeni koşu. Güncelleme ucu yoktur.
 *  3. TEKRARLANABİLİRLİK. `inputSnapshotJson` koşuya NE girdiğini saklar:
 *     belge kimlikleri, strateji sürümü, bağlam bölümleri, parametreler, model.
 *     Bu alan dolmadan koşu kaydedilmez; sonuç ekranı hangi veriyle üretildiğini
 *     her zaman gösterir.
 *  4. KAYNAK GÖSTERME ZORUNLU. Her modun `findingPaths` tanımı vardır;
 *     kaynaksız bulgular output-guard tarafından elenir ve elendikleri
 *     yanıtta AÇIKÇA döner.
 *  5. ATIF DOĞRULAMA KAYIT ÜZERİNDEN. Çıktıdan çıkarılan künyeler
 *     `CitationVerifyService`'e gider; LLM'e "bu karar var mı" SORULMAZ.
 *  6. HER ÇIKTIDA SİMÜLASYON UYARISI. `SIMULATION_NOTICE` yanıttan ve kayıttan
 *     kaldırılamaz.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { SimulationMode } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { CitationVerifyService } from "../caselaw/citation-verify.service";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { assertRole, ROLE_SETS } from "../common/roles";
import { paged, resolvePage } from "../common/pagination";
import type { AuthUser } from "../common/types";
import { StrategyService } from "../strategy/strategy.service";
import type { RunSimulationInput } from "./simulation.dto";
import { DROP_REASON_LABELS, filterByVerbatimQuote } from "../common/ai/quote-guard";
import {
  SIMULATION_MODES,
  SIMULATION_MODE_KEYS,
  SIMULATION_NOTICE,
  type NormalizedFinding,
  type SimulationModeSpec,
} from "./simulation.modes";

const CONTEXT_TOKEN_BUDGET = 5000;
/** İncelenecek belgeden modele gönderilecek azami karakter. */
const DOCUMENT_CHARS = 12000;

@Injectable()
export class SimulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiRunnerService,
    private readonly citations: CitationVerifyService,
    private readonly context: CaseContextBuilder,
    private readonly strategies: StrategyService,
  ) {}

  /** GET /simulations/modes — arayüzdeki 5 mod kartı. */
  listModes() {
    return {
      modes: SIMULATION_MODE_KEYS.map((key) => {
        const spec = SIMULATION_MODES[key];
        return {
          mode: spec.mode,
          label: spec.label,
          taskType: spec.taskType,
          requiresDocument: spec.requiresDocument,
        };
      }),
      notice: SIMULATION_NOTICE,
    };
  }

  // ================================================================== //
  // Koşu
  // ================================================================== //

  /** POST /cases/:caseId/simulate */
  async run(user: AuthUser, caseId: string, input: RunSimulationInput) {
    // Simülasyon çalıştırma AVUKAT ve üstü; STAJYER/SEKRETER yalnız okur
    // (Modül 16, iş kuralı 4). Maliyet BYO-LLM'de büroya yazıldığı için de
    // koşuyu başlatma yetkisi dardır.
    assertRole(user, ROLE_SETS.HUKUKI, "simülasyon çalıştırma");

    const spec = SIMULATION_MODES[input.mode as SimulationMode];
    if (!spec) throw new BadRequestException("Geçersiz simülasyon modu.");

    const kase = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    if (!kase) throw new NotFoundException("Dosya bulunamadı.");

    // ---- Belge zorunluluğu (KARSI_DILEKCE_ZAYIFLIK) ----------------------
    const document = await this.resolveDocument(user.tenantId, caseId, spec, input.documentId);

    // ---- Bağlam ----------------------------------------------------------
    const built = await this.context.buildFor(
      user.tenantId,
      caseId,
      spec.contextTaskType,
      CONTEXT_TOKEN_BUDGET,
    );
    const strategySummary = await this.strategies.strategySummaryText(user.tenantId, caseId);
    const strategyVersion = await this.currentStrategyVersion(user.tenantId, caseId);

    const documentText = document?.text ? document.text.slice(0, DOCUMENT_CHARS) : undefined;

    // ---- LLM koşusu ------------------------------------------------------
    // outboundTexts sırası buildMessages ile BİREBİR aynıdır; KVKK kapısı
    // maskeli metinleri aynı sırada geri verir.
    const outboundTexts = [
      built.built.text,
      strategySummary ?? "",
      documentText ?? "",
      input.question ?? "",
    ];

    const startedAt = Date.now();
    const run = await this.ai.run({
      user,
      taskType: spec.taskType,
      outboundTexts,
      piiApproved: input.piiApproved,
      schema: spec.schema,
      findingPaths: spec.findingPaths,
      entity: "Case",
      entityId: caseId,
      maxTokens: spec.maxTokens,
      buildMessages: ([contextText, strategyText, docText, questionText]) =>
        spec.build({
          caseContextText: contextText,
          strategySummary: strategyText || undefined,
          documentText: docText || undefined,
          documentTitle: document?.name,
          question: questionText || undefined,
          argumentCount: input.argumentCount,
        }),
    });
    const durationMs = Date.now() - startedAt;

    /**
     * ALINTI DOĞRULAMA KAPISI — KARSI_DILEKCE_ZAYIFLIK (denetim bulgusu Ö-20).
     *
     * `weaknesses[].quote` ŞEMADA ZORUNLUDUR (`z.string().min(1)`) ve prompt
     * "metinde geçmeyen bir cümleyi alıntılamak en ağır hatadır" der — ama
     * hiçbir yerde DOĞRULANMIYORDU. Model karşı dilekçede bulunmayan bir
     * "çelişki alıntısı" ürettiğinde, avukat replik dilekçesinde o cümleyi
     * karşı tarafa atfediyordu.
     *
     * `filterByVerbatimQuote` bu depoda zaten yazılıydı ama `simulation/`
     * altında sıfır kez çağrılıyordu. Arama, modelin GÖRDÜĞÜ metinde
     * (`documentText` — maskeliyse maskeli hâlinde) yapılır.
     */
    let quoteDropped: ReturnType<typeof filterByVerbatimQuote>["dropped"] = [];
    if (spec.mode === "KARSI_DILEKCE_ZAYIFLIK" && documentText) {
      const data = run.data as { weaknesses?: Array<{ quote?: string; weaknessType?: string }> };
      if (Array.isArray(data.weaknesses)) {
        const gate = filterByVerbatimQuote(
          data.weaknesses,
          documentText,
          (w) => w.quote,
          (w, i) => `${w.weaknessType ?? "Zayıflık"} #${i + 1}`,
        );
        data.weaknesses = gate.kept;
        quoteDropped = gate.dropped;
      }
    }

    // ---- Atıf doğrulama — kayıt üzerinden --------------------------------
    const rawCitations = run.citations.map((c) => c.raw);
    const verification =
      rawCitations.length > 0
        ? await this.citations.verify(user, { citations: rawCitations })
        : { results: [], summary: null };

    // ---- Tekrarlanabilirlik künyesi --------------------------------------
    const inputSnapshot = {
      mode: spec.mode,
      params: {
        question: input.question ?? null,
        documentId: document?.id ?? null,
        argumentCount: input.mode === "KARSI_TARAF_AVUKATI" ? (input.argumentCount ?? 7) : null,
      },
      /** Bağlama GERÇEKTEN giren belgeler ve bölümler. */
      contextSections: built.built.includedSections,
      omittedSections: built.built.omittedSections,
      contextTruncated: built.built.truncated,
      contextDroppedItems: built.built.droppedItemCount,
      unindexedDocuments: built.unindexedDocumentNames,
      strategyVersionId: strategyVersion?.id ?? null,
      strategyVersionNo: strategyVersion?.versionNo ?? null,
      documentIds: document ? [document.id] : [],
      model: run.model,
      providerType: run.providerType,
      piiMasked: run.piiMasked,
      generatedAt: new Date().toISOString(),
    };

    const output = {
      result: run.data,
      droppedFindings: run.droppedFindings,
      /**
       * Ö-20: belgede birebir bulunamayan alıntıya dayandığı için ELENEN
       * bulgular. Sessizce atılmaz — avukat neyin elendiğini görmelidir.
       */
      droppedQuotes: quoteDropped.map((d) => ({
        ...d,
        reasonLabel: DROP_REASON_LABELS[d.reason],
      })),
      citationVerification: {
        method: "Kayıt üzerinden deterministik arama (CitationVerifyService)",
        summary: verification.summary,
        results: verification.results,
      },
      notice: SIMULATION_NOTICE,
      advisory: run.advisory,
    };

    const record = await this.prisma.client.simulationRun.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        mode: spec.mode,
        inputSnapshotJson: JSON.stringify(inputSnapshot),
        outputJson: JSON.stringify(output),
        model: run.model,
        durationMs,
        createdBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SIMULATION_RUN",
      entity: "SimulationRun",
      entityId: record.id,
      detail:
        `caseId=${caseId} mod=${spec.mode} model=${run.model} elenen=${run.droppedFindings.length} ` +
        `atıf=${rawCitations.length} süre=${durationMs}ms`,
    });

    return this.envelope(record, inputSnapshot, output, {
      caseTitle: built.caseTitle,
      caseFileNumber: built.caseFileNumber,
      documentWarnings: document?.warnings ?? [],
      usage: run.usage,
    });
  }

  // ================================================================== //
  // Okuma
  // ================================================================== //

  /** GET /simulations?caseId=&mode= */
  async list(
    user: AuthUser,
    query: { caseId?: string; mode?: string; page?: string; limit?: string },
  ) {
    const page = resolvePage(query, 25);
    if (query.mode && !SIMULATION_MODE_KEYS.includes(query.mode as SimulationMode)) {
      throw new BadRequestException(
        `Geçersiz simülasyon modu. Geçerli değerler: ${SIMULATION_MODE_KEYS.join(", ")}.`,
      );
    }

    const where = {
      tenantId: user.tenantId,
      ...(query.caseId ? { caseId: query.caseId } : {}),
      ...(query.mode ? { mode: query.mode as SimulationMode } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.simulationRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          caseId: true,
          mode: true,
          model: true,
          durationMs: true,
          createdBy: true,
          createdAt: true,
          inputSnapshotJson: true,
          case: { select: { title: true, fileNumber: true } },
        },
      }),
      this.prisma.client.simulationRun.count({ where }),
    ]);

    return {
      ...paged(
        rows.map((r) => ({
          id: r.id,
          caseId: r.caseId,
          caseTitle: r.case.title,
          caseFileNumber: r.case.fileNumber,
          mode: r.mode,
          modeLabel: SIMULATION_MODES[r.mode].label,
          model: r.model,
          durationMs: r.durationMs,
          createdBy: r.createdBy,
          createdAt: r.createdAt,
          inputSnapshot: safeParse(r.inputSnapshotJson),
        })),
        total,
        page,
      ),
      notice: SIMULATION_NOTICE,
    };
  }

  /** GET /simulations/:id */
  async detail(user: AuthUser, id: string) {
    const record = await this.prisma.client.simulationRun.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { case: { select: { title: true, fileNumber: true } } },
    });
    // Tenant süzgeci NOT-FOUND ile kapatılır (id tahmin edilse bile sızmaz).
    if (!record) throw new NotFoundException("Simülasyon koşusu bulunamadı.");

    return this.envelope(record, safeParse(record.inputSnapshotJson), safeParse(record.outputJson), {
      caseTitle: record.case.title,
      caseFileNumber: record.case.fileNumber,
      documentWarnings: [],
      usage: null,
    });
  }

  /**
   * GET /simulations/compare?a=&b=
   *
   * FARKLI MODLARDAKİ İKİ KOŞU KARŞILAŞTIRILAMAZ (400): şemaları farklıdır ve
   * "eklendi/çıktı" karşılaştırması anlamsız olur.
   */
  async compare(user: AuthUser, aId: string, bId: string) {
    if (!aId || !bId) {
      throw new BadRequestException("Karşılaştırma için iki koşu kimliği gerekir (a ve b).");
    }
    if (aId === bId) {
      throw new BadRequestException("Aynı koşu kendisiyle karşılaştırılamaz.");
    }

    const [a, b] = await Promise.all([
      this.prisma.client.simulationRun.findFirst({ where: { id: aId, tenantId: user.tenantId } }),
      this.prisma.client.simulationRun.findFirst({ where: { id: bId, tenantId: user.tenantId } }),
    ]);
    if (!a || !b) throw new NotFoundException("Simülasyon koşusu bulunamadı.");
    if (a.mode !== b.mode) {
      throw new BadRequestException(
        `Yalnızca AYNI moddaki koşular karşılaştırılabilir (a=${a.mode}, b=${b.mode}).`,
      );
    }
    if (a.caseId !== b.caseId) {
      throw new BadRequestException("Yalnızca aynı dosyaya ait koşular karşılaştırılabilir.");
    }

    const spec = SIMULATION_MODES[a.mode];
    const findingsA = spec.normalize(resultOf(a.outputJson));
    const findingsB = spec.normalize(resultOf(b.outputJson));

    const byKeyA = new Map(findingsA.map((f) => [f.key, f]));
    const byKeyB = new Map(findingsB.map((f) => [f.key, f]));

    const added = findingsB.filter((f) => !byKeyA.has(f.key));
    const removed = findingsA.filter((f) => !byKeyB.has(f.key));
    const changed: { key: string; title: string; before: NormalizedFinding; after: NormalizedFinding }[] =
      [];
    const unchanged: NormalizedFinding[] = [];
    for (const before of findingsA) {
      const after = byKeyB.get(before.key);
      if (!after) continue;
      if (after.body !== before.body || after.severity !== before.severity) {
        changed.push({ key: before.key, title: after.title, before, after });
      } else {
        unchanged.push(after);
      }
    }

    return {
      mode: a.mode,
      modeLabel: spec.label,
      caseId: a.caseId,
      a: { id: a.id, createdAt: a.createdAt, model: a.model, findingCount: findingsA.length },
      b: { id: b.id, createdAt: b.createdAt, model: b.model, findingCount: findingsB.length },
      diff: { added, removed, changed, unchangedCount: unchanged.length },
      /** Bulgu eşleştirmesi başlık normalizasyonuna dayanır — sezgiseldir. */
      matchingNote:
        "Bulgular BAŞLIK benzerliğiyle eşleştirilir; başlığı yeniden yazılmış bir bulgu " +
        "«çıktı + eklendi» olarak görünebilir. Karşılaştırma bir okuma yardımıdır, " +
        "koşuların kendisi değişmez.",
      inputDiff: {
        a: safeParse(a.inputSnapshotJson),
        b: safeParse(b.inputSnapshotJson),
      },
      notice: SIMULATION_NOTICE,
    };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /**
   * Belge çözümü.
   *
   * MENŞE UYARISI: şemada bir `Document`'ın karşı taraftan mı bizden mi geldiği
   * TUTULMAZ (`source` yalnızca MANUEL/UYAP/SISTEM'dir). Bu yüzden "yalnız karşı
   * taraf belgesi seçilebilir" kuralı sunucuda DOĞRULANAMAZ; sessizce doğru
   * varsaymak yerine yanıtta AÇIK UYARI döneriz. Belge menşei şemaya eklendiğinde
   * bu kontrol 422'ye yükseltilmelidir.
   */
  private async resolveDocument(
    tenantId: string,
    caseId: string,
    spec: SimulationModeSpec,
    documentId: string | undefined,
  ): Promise<{ id: string; name: string; text: string; warnings: string[] } | null> {
    if (!documentId) {
      if (spec.requiresDocument) {
        throw new UnprocessableEntityException(
          `«${spec.label}» modu bir belge üzerinde çalışır. İncelenecek karşı taraf belgesini ` +
            "`documentId` ile seçin.",
        );
      }
      return null;
    }

    const document = await this.prisma.client.document.findFirst({
      where: { id: documentId, tenantId, caseId },
      select: { id: true, name: true, class: true, ocrText: true, aiSummary: true, source: true },
    });
    if (!document) {
      throw new NotFoundException("Belge bu dosyada bulunamadı.");
    }

    const text = (document.ocrText ?? document.aiSummary ?? "").trim();
    if (spec.requiresDocument && text.length === 0) {
      throw new UnprocessableEntityException(
        `«${document.name}» belgesinin metni çıkarılmamış. Bu mod belgenin metni üzerinde ` +
          "çalışır; belgeyi metin çıkarma hattından geçirdikten sonra tekrar deneyin.",
      );
    }

    const warnings: string[] = [];
    warnings.push(
      "Belgenin KARŞI TARAF menşeli olduğu sistemce doğrulanamaz (belge kaydında taraf menşei " +
        "tutulmamaktadır). Kendi dilekçemizi seçtiyseniz çıktı yanıltıcı olur; seçimi teyit edin.",
    );
    if ((document.ocrText ?? "").trim().length === 0) {
      warnings.push(
        "Belgenin ham metni yok; analiz yalnızca AI özeti üzerinden yapılmıştır. Birebir alıntılar " +
          "belgenin aslıyla karşılaştırılmalıdır.",
      );
    }
    if (text.length > DOCUMENT_CHARS) {
      warnings.push(
        `Belge metni ${DOCUMENT_CHARS} karakterde kırpıldı; sonraki bölümler analize girmedi.`,
      );
    }

    return { id: document.id, name: document.name, text, warnings };
  }

  private async currentStrategyVersion(tenantId: string, caseId: string) {
    const strategy = await this.prisma.client.strategy.findFirst({
      where: { tenantId, caseId },
      select: { currentVersionId: true },
    });
    if (!strategy?.currentVersionId) return null;
    return this.prisma.client.strategyVersion.findFirst({
      where: { id: strategy.currentVersionId },
      select: { id: true, versionNo: true },
    });
  }

  private envelope(
    record: {
      id: string;
      caseId: string;
      mode: SimulationMode;
      model: string | null;
      durationMs: number | null;
      createdBy: string;
      createdAt: Date;
    },
    inputSnapshot: unknown,
    output: unknown,
    extra: {
      caseTitle: string | null;
      caseFileNumber: string | null;
      documentWarnings: string[];
      usage: unknown;
    },
  ) {
    return {
      id: record.id,
      caseId: record.caseId,
      caseTitle: extra.caseTitle,
      caseFileNumber: extra.caseFileNumber,
      mode: record.mode,
      modeLabel: SIMULATION_MODES[record.mode].label,
      model: record.model,
      durationMs: record.durationMs,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      /** TEKRARLANABİLİRLİK: koşuya ne girdi? */
      inputSnapshot,
      output,
      usage: extra.usage,
      warnings: extra.documentWarnings,
      /** İNSAN ONAYI NOKTASI. */
      approval: {
        required: true,
        note:
          "Bulgular ÖNERİDİR. Stratejiye düğüm veya göreve dönüştürülmeleri ayrı bir avukat " +
          "aksiyonudur; bu koşu hiçbir kayıt açmaz.",
        writesRecords: ["SimulationRun (değiştirilemez koşu kaydı)"],
      },
      immutable: true,
      notice: SIMULATION_NOTICE,
    };
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return { parseError: "Koşu kaydı okunamadı (bozuk JSON).", raw: json.slice(0, 500) };
  }
}

/** Kayıttaki `outputJson` içinden mod şemasına ait `result` gövdesini çıkarır. */
function resultOf(json: string): unknown {
  const parsed = safeParse(json);
  if (typeof parsed === "object" && parsed !== null && "result" in parsed) {
    return (parsed as { result: unknown }).result;
  }
  return parsed;
}
