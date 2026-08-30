/**
 * İCRA AI COPILOT — altı komut, hepsi ÖNERİ.
 *
 * ÜRÜN İLKELERİ BU DOSYADA SOMUTLAŞIR:
 *  1. AI ÇIKTISI ÖNERİDİR. Hiçbir komut EnforcementAction, Task, Deadline veya
 *     aşama değişikliği YAZMAZ. Tek yazılan kayıt `CollectionScore`'dur ve o da
 *     değiştirilemez bir hesap kaydıdır: skoru kural motoru üretir, AI yalnızca
 *     `aiCommentary` alanını doldurur.
 *  2. PARA VE SÜRE HESABI DETERMİNİSTİKTİR. KACIRILAN_SURELER'de gün hesabını
 *     @nomosos/legal-core, TAHSILAT_IHTIMALI'nde taban skoru CollectionScoreService
 *     yapar; modele hesaplanmış sonuç VERİLİR ve "yeniden hesaplama" denir.
 *  3. KAYNAK GÖSTERME ZORUNLU. Bağlam etiketli satırlardan oluşur; output-guard
 *     kaynaksız bulguları eler (`findingPaths: ["findings"]`).
 *  4. KVKK. Dışa giden her metin `AiRunnerService.applyPiiGate`'ten geçer:
 *     dış sağlayıcı + PII + onay yok → 409 `requiresPiiApproval`.
 *  5. HAM PROMPT YAZILMAZ. Mesajlar @nomosos/legal-ai'nin
 *     `buildEnforcementAnalysisMessages` fonksiyonuyla kurulur; sistem çekirdeği
 *     (uydurma yasağı, atıf disiplini) her çağrının başında durur.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type EnforcementFile } from "@nomosos/db";
import {
  buildEnforcementAnalysisMessages,
  EnforcementAnalysisOutputSchema,
  type EnforcementAnalysisOutput,
} from "@nomosos/legal-ai";
import type { AiTaskType } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { EnforcementBalanceService } from "./balance.service";
import {
  CollectionScoreService,
  MAX_AI_ADJUSTMENT,
  SCORE_BAND_LABELS,
  type BaseScoreResult,
} from "./collection-score.service";
import {
  buildActionLines,
  buildAssetLines,
  buildCollectionLines,
  buildDeadlineLines,
  buildDocumentLines,
  buildHeader,
  buildSignalLines,
  type EnforcementContextParts,
} from "./enforcement-context";
import { EnforcementDeadlinesService } from "./enforcement-deadlines.service";
import { buildPlaybookLines } from "./enforcement-playbook";
import { STAGE_LABELS } from "./enforcement-stage";
import type { CopilotCommand, CopilotInput } from "./enforcement.dto";

/** Her komutun insan onayı sözleşmesi — yanıtta açıkça döner. */
const APPROVAL_NOTES: Record<CopilotCommand, string> = {
  MALVARLIGI_ANALIZ:
    "Tespit edilen boşluklar için sorgu/müzekkere talebi oluşturmadan önce avukat onayı gerekir; " +
    "bu komut hiçbir işlem kaydı açmaz.",
  SONRAKI_ADIMLAR:
    "Sıralanan işlemler ÖNERİDİR. Görev veya icra işlemi olarak kaydedilmeleri avukatın ayrı " +
    "kararına bağlıdır; bu komut Task/EnforcementAction YAZMAZ.",
  KACIRILAN_SURELER:
    "Süre hesapları deterministik motordan gelir. Listelenen süreler dosyaya kaydedilecekse " +
    "«Süre önerisi oluştur» ucunu kullanın; kayıtlar BEKLIYOR durumunda açılır ve avukat onayıyla kesinleşir.",
  TAHSILAT_IHTIMALI:
    "Skor ÖNERİDİR, tahsilat garantisi değildir. Taban skor kurallardan gelir; AI'nin düzeltmesi " +
    `±${MAX_AI_ADJUSTMENT} puanla sınırlıdır ve BANDI DEĞİŞTİREMEZ. Müvekkile beklenti bildirirken avukat teyidi şarttır.`,
  ISLEM_GECMISI_ANALIZ:
    "Tespit edilen tekrar/eksik işlemler ÖNERİDİR; dosyada işlem yapılması avukat kararıdır.",
  ITIRAZ_KARSILASTIRMA:
    "Cevapsız görünen itirazlar ÖNERİDİR; belge metinleri eksik veya OCR hatalı olabilir. " +
    "Dilekçe hazırlanmadan önce belgelerin aslıyla karşılaştırılması gerekir.",
};

const COMMAND_LABELS: Record<CopilotCommand, string> = {
  MALVARLIGI_ANALIZ: "Malvarlığı analizi",
  SONRAKI_ADIMLAR: "Sonraki adımlar",
  KACIRILAN_SURELER: "Kaçırılan süreler denetimi",
  TAHSILAT_IHTIMALI: "Tahsilat ihtimali",
  ISLEM_GECMISI_ANALIZ: "İşlem geçmişi analizi",
  ITIRAZ_KARSILASTIRMA: "İtiraz–cevap karşılaştırması",
};

/** ISLEM_GECMISI_ANALIZ varsayılan pencere. */
const DEFAULT_LAST_N = 20;
/** İtiraz karşılaştırmasında belge başına gönderilecek azami karakter. */
const DOC_CHARS = 6000;
/** Aynı türden işlemin "tekrar" sayılacağı gün penceresi. */
const REPEAT_WINDOW_DAYS = 30;

@Injectable()
export class EnforcementCopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiRunnerService,
    private readonly balance: EnforcementBalanceService,
    private readonly score: CollectionScoreService,
    private readonly deadlines: EnforcementDeadlinesService,
  ) {}

  /** POST /enforcement/:id/copilot */
  async run(user: AuthUser, fileId: string, input: CopilotInput) {
    // Copilot dosya içeriğini (borçlu bilgisi, malvarlığı, tahsilat) görür;
    // stajyer dâhil salt-okur roller için ayrı bir kapı yoktur, ancak analiz
    // hukuki tasarruf önerisi ürettiği için hukuki rollerle sınırlıdır.
    assertRole(user, ROLE_SETS.HUKUKI, "icra copilot çalıştırma");

    const parts = await this.loadContext(user.tenantId, fileId);
    const command = input.command;

    switch (command) {
      case "TAHSILAT_IHTIMALI":
        return this.runCollectionLikelihood(user, parts, input);
      case "KACIRILAN_SURELER":
        return this.runMissedDeadlines(user, parts, input);
      case "ISLEM_GECMISI_ANALIZ":
        return this.runActionLogAnalysis(user, parts, input);
      case "ITIRAZ_KARSILASTIRMA":
        return this.runObjectionCompare(user, parts, input);
      case "MALVARLIGI_ANALIZ":
        return this.runAssetAnalysis(user, parts, input);
      case "SONRAKI_ADIMLAR":
      default:
        return this.runNextActions(user, parts, input);
    }
  }

  // ================================================================== //
  // a) MALVARLIGI_ANALIZ
  // ================================================================== //

  private async runAssetAnalysis(user: AuthUser, parts: EnforcementContextParts, input: CopilotInput) {
    // DETERMİNİSTİK YARISI: hangi sorgu türü hiç yapılmamış?
    const queried = new Set(parts.assets.map((a) => a.assetType));
    const expected = ["TASINMAZ", "ARAC", "BANKA_HESABI", "MAAS", "ALACAK"] as const;
    const missingQueries = expected.filter((t) => !queried.has(t));
    const totalAssetValue = parts.assets
      .filter((a) => a.status !== "SERBEST_BIRAKILDI" && a.estimatedValue !== null)
      .reduce<Prisma.Decimal>(
        (acc, a) => acc.plus(new Prisma.Decimal(a.estimatedValue as Prisma.Decimal)),
        new Prisma.Decimal(0),
      );

    const context = [
      buildHeader(parts),
      buildAssetLines(parts.assets),
      buildActionLines(parts.actions, 40),
      "[EKSİK] Hiç kaydı bulunmayan malvarlığı türleri: " +
        (missingQueries.length ? missingQueries.join(", ") : "yok"),
      `[EKSİK] Kayıtlı malvarlığının toplam tahmini değeri: ${totalAssetValue.toFixed(2)} ${parts.file.currency}`,
    ].join("\n");

    const instruction =
      "Borçlunun kayıtlı malvarlığını ve üzerinde yapılan işlemleri özetle. Hangi sorguların " +
      "yapılmamış veya sonuçsuz kaldığını, hangi kalemin haczedilmediğini BOŞLUK olarak belirt. " +
      "Malvarlığı değeri hakkında rakam uydurma; yalnızca kayıtlı değerleri kullan.";

    const run = await this.execute(user, parts.file, "ENFORCEMENT_ANALYSIS", context, instruction, input);
    return this.envelope("MALVARLIGI_ANALIZ", run, {
      deterministic: {
        assetCount: parts.assets.length,
        totalEstimatedValue: totalAssetValue.toFixed(2),
        currency: parts.file.currency,
        missingQueryTypes: missingQueries,
        seizedCount: parts.assets.filter((a) => a.status === "HACZEDILDI" || a.status === "SATILDI").length,
      },
    });
  }

  // ================================================================== //
  // b) SONRAKI_ADIMLAR
  // ================================================================== //

  private async runNextActions(user: AuthUser, parts: EnforcementContextParts, input: CopilotInput) {
    const audit = await this.deadlines.auditDeadlines(user.tenantId, parts.file);

    const context = [
      buildHeader(parts),
      buildPlaybookLines(parts.file.stage),
      buildActionLines(parts.actions, 30),
      buildAssetLines(parts.assets),
      buildDeadlineLines(audit.candidates, audit.recorded),
    ].join("\n");

    const instruction =
      `Dosya «${STAGE_LABELS[parts.file.stage]}» aşamasındadır. [KATALOG] satırlarındaki ` +
      "işlemlerden bu dosyaya uygun olanları ÖNCELİK SIRASIYLA listele; her biri için neden " +
      "şimdi yapılması gerektiğini dosyadaki işleme/tarihe dayanarak açıkla. Katalogda olmayan " +
      "bir madde numarası yazma. Her bulguyu SONRAKI_ADIM türünde ver.";

    const run = await this.execute(user, parts.file, "ENFORCEMENT_ANALYSIS", context, instruction, input);
    return this.envelope("SONRAKI_ADIMLAR", run, {
      deterministic: {
        stage: parts.file.stage,
        stageLabel: STAGE_LABELS[parts.file.stage],
        /** Katalog, avukatın AI çıktısını karşılaştırabilmesi için AYNEN döner. */
        playbook: buildPlaybookLines(parts.file.stage)
          .split("\n")
          .filter((l) => l.startsWith("[KATALOG]"))
          .slice(1),
        openDeadlines: audit.upcoming.length,
        overdueDeadlines: audit.overdueOpen.length,
      },
    });
  }

  // ================================================================== //
  // c) KACIRILAN_SURELER — hesap motorun, yorum AI'nin
  // ================================================================== //

  private async runMissedDeadlines(user: AuthUser, parts: EnforcementContextParts, input: CopilotInput) {
    const audit = await this.deadlines.auditDeadlines(user.tenantId, parts.file);

    const context = [
      buildHeader(parts),
      buildDeadlineLines(audit.candidates, audit.recorded),
      buildActionLines(parts.actions, 40),
    ].join("\n");

    const instruction =
      "Yukarıdaki [SÜRE] satırları DETERMİNİSTİK süre motorunun çıktısıdır. GÜN HESABI YAPMA ve " +
      "hiçbir tarihi değiştirme. Görevin: geçmiş ya da yaklaşan sürelerin dosyadaki işlemlerle " +
      "birlikte ne anlama geldiğini yorumlamak, kaydı olmayan (DOSYADA KAYITLI DEĞİL) süreleri " +
      "risk olarak işaretlemek ve hangi işlemin hâlâ yapılabileceğini söylemektir. " +
      "Bulguları KACIRILAN_SURE türünde ver.";

    const run = await this.execute(user, parts.file, "ENFORCEMENT_ANALYSIS", context, instruction, input);

    return this.envelope("KACIRILAN_SURELER", run, {
      deterministic: {
        /** Süre motorunun çıktısı — AI'den BAĞIMSIZ, tek doğru kaynak budur. */
        computedBy: "@nomosos/legal-core (deterministik süre motoru)",
        candidates: audit.candidates.map((c) => ({
          ruleKey: c.ruleKey,
          ruleName: c.ruleName,
          legalBasis: c.legalBasis,
          triggerLabel: c.triggerLabel,
          triggerDate: c.triggerDate,
          dueDate: c.dueDate,
          daysRemaining: c.daysRemaining,
          isOverdue: c.isOverdue,
          recorded: Boolean(c.existingDeadlineId),
          existingStatus: c.existingStatus ?? null,
          steps: c.steps,
          warnings: c.warnings,
        })),
        overdueOpen: audit.overdueOpen,
        upcoming: audit.upcoming,
        unrecordedCount: audit.unrecorded.length,
      },
    });
  }

  // ================================================================== //
  // d) TAHSILAT_IHTIMALI — HİBRİT: kural taban + sınırlı AI düzeltmesi
  // ================================================================== //

  private async runCollectionLikelihood(
    user: AuthUser,
    parts: EnforcementContextParts,
    input: CopilotInput,
  ) {
    // 1) KURAL TABANLI TABAN SKOR (deterministik; AI görmeden hesaplanır).
    const base: BaseScoreResult = await this.score.computeBase(user.tenantId, parts.file.id);

    const context = [
      buildHeader(parts),
      buildSignalLines(base.baseScore, base.signals),
      buildAssetLines(parts.assets),
      buildCollectionLines(parts.collections),
      buildActionLines(parts.actions, 30),
    ].join("\n");

    const instruction =
      `Kural motorunun hesapladığı taban skor ${base.baseScore}/100'dür. Bu skoru YENİDEN ` +
      "HESAPLAMA. Görevin: sinyalleri gerekçelendirmek ve dosyaya özgü, sinyallerde " +
      "yakalanmayan bir husus varsa bunu belirtmektir. `collectionLikelihood` alanına 0-1 " +
      "aralığında kendi değerlendirmeni yaz; bu değer taban skoru DEĞİŞTİRMEZ, sınırlı bir " +
      "düzeltme olarak kullanılacaktır. Değerlendirmeni yalnızca dosyadaki dayanaklara " +
      "(malvarlığı, tahsilat, itiraz, işlem tarihleri) dayandır; dayanak yoksa alanı hiç yazma.";

    const run = await this.execute(
      user,
      parts.file,
      "COLLECTION_LIKELIHOOD",
      context,
      instruction,
      input,
    );

    // 2) AI DÜZELTMESİ — SINIRLI. Modelin 0-1 değerlendirmesi 0-100'e çevrilir,
    //    taban skorla farkı alınır ve ±MAX_AI_ADJUSTMENT'e KIRPILIR. Bant daima
    //    taban skordan gelir; AI bandı değiştiremez.
    const likelihood = run.data.collectionLikelihood;
    const rawAdjustment =
      likelihood === undefined ? 0 : Math.round(likelihood * 100) - base.baseScore;
    const adjusted = this.score.applyAiAdjustment(base, rawAdjustment);

    const commentary = [
      run.data.collectionReasoning?.trim(),
      ...run.data.findings.map((f) => `${f.title}: ${f.detail}`),
    ]
      .filter((v): v is string => Boolean(v))
      .join("\n");

    // 3) DEĞİŞTİRİLEMEZ KAYIT — her hesap yeni satırdır.
    const record = await this.prisma.client.collectionScore.create({
      data: {
        tenantId: user.tenantId,
        enforcementFileId: parts.file.id,
        score: adjusted.finalScore,
        band: adjusted.band,
        /**
         * TABAN SKOR VE AI DÜZELTMESİ AYRI SAKLANIR (denetim bulgusu 16).
         *
         * Kayıtta yalnız `score` (AI etkili) ile `band` (taban skordan)
         * bulunsaydı ikisi görünürde çelişirdi ve bandı skordan yeniden türeten
         * herhangi bir tüketici (rapor, dışa aktarım, panel) "AI bandı
         * değiştiremez" korumasını SESSİZCE kaybederdi. Üç değer birlikte
         * yazılınca ayrım kayıtta da okunabilir kalır.
         */
        baseScore: base.baseScore,
        aiAdjustment: adjusted.appliedAdjustment,
        bandSource: "TABAN_SKOR",
        ruleSignalsJson: JSON.stringify(base.signals),
        aiCommentary: commentary || null,
        model: run.model,
        computedBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "ENFORCEMENT_COLLECTION_SCORE",
      entity: "CollectionScore",
      entityId: record.id,
      detail:
        `taban=${base.baseScore} ai_duzeltme=${adjusted.appliedAdjustment} ` +
        `nihai=${adjusted.finalScore} bant=${adjusted.band} (bant taban skordan)`,
    });

    return this.envelope("TAHSILAT_IHTIMALI", run, {
      score: {
        id: record.id,
        baseScore: base.baseScore,
        aiSuggestedScore: likelihood === undefined ? null : Math.round(likelihood * 100),
        requestedAdjustment: rawAdjustment,
        appliedAdjustment: adjusted.appliedAdjustment,
        adjustmentClamped: adjusted.clamped,
        maxAdjustment: MAX_AI_ADJUSTMENT,
        finalScore: adjusted.finalScore,
        band: adjusted.band,
        bandLabel: SCORE_BAND_LABELS[adjusted.band],
        bandSource: "TABAN_SKOR",
        computedAt: record.computedAt,
      },
      deterministic: {
        baseScore: base.baseScore,
        band: base.band,
        signals: base.signals,
        warnings: base.warnings,
      },
      notice:
        "Skor bir ÖNERİDİR ve hukuki/mali garanti değildir. Taban skor dosyadaki kayıtlı " +
        "verilerden deterministik olarak hesaplanmıştır; yapay zekânın etkisi en çok " +
        `±${MAX_AI_ADJUSTMENT} puandır ve risk bandını değiştiremez.`,
    });
  }

  // ================================================================== //
  // e) ISLEM_GECMISI_ANALIZ
  // ================================================================== //

  private async runActionLogAnalysis(user: AuthUser, parts: EnforcementContextParts, input: CopilotInput) {
    const lastN = input.lastN ?? DEFAULT_LAST_N;
    const window = parts.actions.slice(0, lastN);

    // DETERMİNİSTİK YARISI: tekrar eden işlemler ve durgunluk tespiti.
    const repeats = findRepeatedActions(window);
    const lastAction = parts.actions[0];
    const idleDays = lastAction
      ? Math.round((Date.now() - lastAction.date.getTime()) / (24 * 60 * 60 * 1000))
      : null;

    const context = [
      buildHeader(parts),
      buildActionLines(window),
      buildPlaybookLines(parts.file.stage),
      repeats.length
        ? `[TEKRAR] ${REPEAT_WINDOW_DAYS} gün içinde yinelenen işlem türleri: ` +
          repeats.map((r) => `${r.type} (${r.count} kez)`).join(", ")
        : "[TEKRAR] Kısa aralıkla yinelenen işlem türü tespit edilmedi.",
      idleDays === null
        ? "[DURGUNLUK] Dosyada hiç işlem kaydı yok."
        : `[DURGUNLUK] Son işlemden bu yana ${idleDays} gün geçti.`,
    ].join("\n");

    const instruction =
      `Dosyanın son ${window.length} işlemini analiz et. Tekrar eden veya sonuçsuz kalan ` +
      "işlemleri, başlatılıp tamamlanmamış süreçleri (ör. talep var karşılığı yok) ve aşamaya " +
      "göre eksik kalan işlemleri tespit et. Her tespiti bir işlem satırına dayandır.";

    const run = await this.execute(user, parts.file, "ENFORCEMENT_ANALYSIS", context, instruction, input);
    return this.envelope("ISLEM_GECMISI_ANALIZ", run, {
      deterministic: {
        analyzedCount: window.length,
        totalCount: parts.actions.length,
        repeatedActionTypes: repeats,
        idleDays,
        lastActionDate: lastAction?.date ?? null,
      },
    });
  }

  // ================================================================== //
  // f) ITIRAZ_KARSILASTIRMA
  // ================================================================== //

  private async runObjectionCompare(user: AuthUser, parts: EnforcementContextParts, input: CopilotInput) {
    const objectionActions = parts.actions.filter(
      (a) => a.type === "ITIRAZ" || a.type === "ITIRAZIN_IPTALI",
    );
    // İtiraz ve cevap dilekçeleri: dosyaya bağlı, metni çıkarılmış belgeler.
    const documents = await this.prisma.client.document.findMany({
      where: {
        tenantId: user.tenantId,
        caseId: parts.file.caseId,
        class: { in: ["DILEKCE", "ICRA_EVRAKI", "TEBLIGAT", "DIGER"] },
      },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: { id: true, name: true, class: true, createdAt: true, ocrText: true, aiSummary: true },
    });
    const withText = documents.filter((d) => (d.ocrText ?? d.aiSummary ?? "").trim().length > 0);

    const context = [
      buildHeader(parts),
      objectionActions.length
        ? buildActionLines(objectionActions)
        : "[İŞLEM] Dosyada kayıtlı itiraz/itirazın iptali işlemi yok.",
      buildDocumentLines(withText, DOC_CHARS),
    ].join("\n");

    const instruction =
      "Borçlunun ileri sürdüğü itirazları tek tek çıkar ve bizim dilekçelerimizde/işlemlerimizde " +
      "bu itirazların her birine verilen cevabı eşleştir. Cevabı bulunmayan itirazları AÇIKÇA " +
      "CEVAPSIZ olarak işaretle. Her itiraz için kaynak alıntısını (sourceQuote) belgeden birebir " +
      "ver. Belgede olmayan bir itirazı veya cevabı UYDURMA. Bulguları ITIRAZ türünde ver.";

    const run = await this.execute(user, parts.file, "ENFORCEMENT_ANALYSIS", context, instruction, input);

    const warnings: string[] = [];
    if (withText.length === 0) {
      warnings.push(
        "Dosyaya bağlı, metni çıkarılmış itiraz/cevap belgesi bulunamadı. Karşılaştırma yalnızca " +
          "işlem günlüğü açıklamalarına dayanmaktadır; belgeleri yükleyip metin çıkarma hattından " +
          "geçirdikten sonra tekrarlayınız.",
      );
    }
    if (documents.length > withText.length) {
      warnings.push(
        `${documents.length - withText.length} belgenin metni çıkarılmamış ve karşılaştırmaya ` +
          "dâhil edilmemiştir.",
      );
    }

    return this.envelope("ITIRAZ_KARSILASTIRMA", run, {
      deterministic: {
        objectionActionCount: objectionActions.length,
        documentsConsidered: withText.map((d) => ({ id: d.id, name: d.name, class: d.class })),
        documentsSkipped: documents.length - withText.length,
      },
      warnings,
    });
  }

  // ================================================================== //
  // Ortak yürütme
  // ================================================================== //

  /**
   * Tek LLM çağrısı. `outboundTexts` DIŞARI ÇIKACAK HER METNİ içerir; KVKK kapısı
   * bunların üzerinde çalışır ve mesajlar maskeli hâlleriyle kurulur.
   */
  private async execute(
    user: AuthUser,
    file: EnforcementFile,
    taskType: AiTaskType,
    contextText: string,
    instruction: string,
    input: CopilotInput,
  ) {
    const question = input.question?.trim();
    const fullInstruction = question ? `${instruction}\n\nAVUKATIN SORUSU: ${question}` : instruction;

    return this.ai.run({
      user,
      taskType,
      // Sıra önemlidir: buildMessages aynı sırayla maskeli metinleri alır.
      outboundTexts: [contextText, fullInstruction],
      piiApproved: input.piiApproved,
      schema: EnforcementAnalysisOutputSchema,
      // Kaynak göstermeyen bulgular elenir (ürün ilkesi: uydurma yasak).
      findingPaths: ["findings"],
      entity: "EnforcementFile",
      entityId: file.id,
      maxTokens: 3072,
      buildMessages: ([context, instr]) =>
        buildEnforcementAnalysisMessages({ caseContextText: context, instruction: instr }),
    });
  }

  /** Tüm komutların ortak yanıt zarfı — onay noktası her yanıtta görünür. */
  private envelope(
    command: CopilotCommand,
    run: {
      data: EnforcementAnalysisOutput;
      model: string;
      providerType: string;
      piiMasked: boolean;
      citations: unknown[];
      droppedFindings: unknown[];
      advisory: { isAdvisory: true; notice: string };
      usage: { inputTokens?: number; outputTokens?: number; durationMs: number };
    },
    extra: Record<string, unknown> = {},
  ) {
    return {
      command,
      commandLabel: COMMAND_LABELS[command],
      /** İNSAN ONAYI NOKTASI — bu alan her yanıtta vardır. */
      approval: {
        required: true,
        note: APPROVAL_NOTES[command],
        writesRecords:
          command === "TAHSILAT_IHTIMALI"
            ? ["CollectionScore (değiştirilemez hesap kaydı)"]
            : [],
      },
      advisory: run.advisory,
      ai: {
        findings: run.data.findings,
        collectionLikelihood: run.data.collectionLikelihood ?? null,
        collectionReasoning: run.data.collectionReasoning ?? null,
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        citations: run.citations,
        /** Kaynak göstermediği için elenen bulgular — şeffaflık. */
        droppedFindings: run.droppedFindings,
        usage: run.usage,
      },
      ...extra,
    };
  }

  /** Bağlamın veri tabanı yarısı — tek turda çekilir. */
  private async loadContext(tenantId: string, fileId: string): Promise<EnforcementContextParts> {
    const file = await this.prisma.client.enforcementFile.findFirst({
      where: { id: fileId, tenantId },
      include: {
        actions: { orderBy: { date: "desc" } },
        assets: { orderBy: { discoveredAt: "desc" } },
        collections: { orderBy: { date: "desc" } },
        case: {
          select: {
            title: true,
            fileNumber: true,
            client: { select: { name: true } },
          },
        },
      },
    });
    if (!file) throw new NotFoundException("İcra dosyası bulunamadı.");

    const balance = await this.balance.compute(tenantId, fileId);
    const { actions, assets, collections, case: caseRow, ...bare } = file;

    return {
      file: bare as EnforcementFile,
      caseInfo: {
        title: caseRow.title,
        fileNumber: caseRow.fileNumber,
        clientName: caseRow.client?.name ?? null,
      },
      actions,
      assets,
      collections,
      balance,
    };
  }
}

/** Aynı türden işlemin dar bir pencerede yinelenmesi — deterministik tespit. */
function findRepeatedActions(
  actions: { type: string; date: Date }[],
): { type: string; count: number }[] {
  const windowMs = REPEAT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const byType = new Map<string, Date[]>();
  for (const a of actions) {
    const list = byType.get(a.type) ?? [];
    list.push(a.date);
    byType.set(a.type, list);
  }
  const result: { type: string; count: number }[] = [];
  for (const [type, dates] of byType) {
    if (dates.length < 2) continue;
    const sorted = [...dates].sort((x, y) => x.getTime() - y.getTime());
    let cluster = 1;
    let best = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      cluster = sorted[i].getTime() - sorted[i - 1].getTime() <= windowMs ? cluster + 1 : 1;
      best = Math.max(best, cluster);
    }
    if (best >= 2) result.push({ type, count: best });
  }
  return result;
}
