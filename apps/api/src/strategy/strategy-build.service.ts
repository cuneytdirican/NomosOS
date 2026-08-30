/**
 * STRATEGY_BUILD — 9 halkalı strateji ağacı üretimi.
 *
 * ÜRÜN İLKELERİNİN BU DOSYADAKİ KARŞILIĞI:
 *
 *  1. AI ÇIKTISI ÖNERİDİR. Koşu yalnızca `StrategyVersion` + `StrategyNode`
 *     yazar. Hiçbir düğüm Task, Deadline, Petition veya Case kaydına DÖNMEZ;
 *     dönüştürme her zaman ayrı bir avukat aksiyonudur.
 *  2. KAYNAK GÖSTERME ZORUNLU. `findingPaths: ["nodes"]` ile kaynağı olmayan
 *     düğümler output-guard tarafından ELENİR; elenenler yanıtta AÇIKÇA döner
 *     ("kaynaksız üretildiği için elendi"), sessizce yutulmaz.
 *  3. ATIFLAR KAYIT ÜZERİNDEN DOĞRULANIR. Düğüm metinlerinden çıkarılan
 *     künyeler `CitationVerifyService`'e (deterministik kayıt araması) gider.
 *     LLM'e "bu karar var mı" SORULMAZ. Doğrulanmayanlar düğüm bazında
 *     işaretlenir ve sürüm kaydına yazılır.
 *  4. KVKK. Dışa çıkan HER metin `AiRunnerService`'in PII kapısından geçer;
 *     dış sağlayıcı + kişisel veri + onay yok → 409 `requiresPiiApproval`.
 *  5. HAM PROMPT YOK. Mesajlar `strategyBuildPrompt` (PromptSpec) üzerinden
 *     kurulur; çekirdek sistem promptu her çağrının başında durur.
 *  6. BOŞ DAL KALMAZ. Dokuz halkadan biri modelin çıktısında yoksa veya
 *     düğümleri elendiyse, sunucu o halkaya "veri yetersiz" düğümü koyar —
 *     avukat eksiği görmeden zinciri tamam sanmasın diye.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import type { StrategyNodeType } from "@nomosos/db";
import { DEFAULT_SOURCE_FIELDS } from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { CaselawService } from "../caselaw/caselaw.service";
import {
  CitationVerifyService,
  type CitationVerificationResult,
} from "../caselaw/citation-verify.service";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  buildStrategyChainMessages,
  CHAIN_BY_KEY,
  STRATEGY_CHAIN,
  StrategyChainOutputSchema,
  type StrategyChainKey,
  type StrategyChainNodeOutput,
} from "./strategy.chain";
import type { BuildStrategyInput } from "./strategy.dto";
import { buildNodeTree, fingerprintNodes } from "./strategy.serialize";
import { StrategyService } from "./strategy.service";

/** Bağlam metninin token bütçesi — strateji dosyanın tamamına bakar. */
const CONTEXT_TOKEN_BUDGET = 6000;
/** Modelin üretebileceği azami çıktı. */
const MAX_OUTPUT_TOKENS = 4096;
/** Delil matrisinden bağlama alınacak azami satır. */
const MAX_EVIDENCE_LINES = 40;

interface PreparedNode {
  key: string;
  parentKey: string | null;
  link: StrategyChainKey;
  nodeType: StrategyNodeType;
  content: string;
  strength: number | null;
  sourceRef: string | null;
  citations: string[];
  /** Modelden değil, sunucudan gelen "veri yetersiz" doldurması mı? */
  isPlaceholder: boolean;
}

@Injectable()
export class StrategyBuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiRunnerService,
    private readonly caselaw: CaselawService,
    private readonly citations: CitationVerifyService,
    private readonly context: CaseContextBuilder,
    private readonly strategies: StrategyService,
  ) {}

  /** POST /strategy/:id/build */
  async build(user: AuthUser, strategyId: string, input: BuildStrategyInput) {
    // Strateji dosyanın hukuki mücadele planıdır; stajyer düğüm ÖNEREBİLİR
    // (createNode) ama koşuyu (ve maliyeti) başlatmak hukuki rollerdedir.
    assertRole(user, ROLE_SETS.HUKUKI, "strateji üretimi çalıştırma");

    const strategy = await this.strategies.assertStrategy(user.tenantId, strategyId);
    const kase = await this.prisma.client.case.findFirst({
      where: { id: strategy.caseId, tenantId: user.tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    if (!kase) throw new NotFoundException("Dosya bulunamadı.");

    // ---- 0) AVUKATIN EMEĞİNİ KORU — KOŞUDAN ÖNCE -------------------------
    //
    // `persistNodes` çalışma kopyasının TAMAMINI siler. Dosya başındaki
    // "eski düğümler kaybolmaz, bir önceki sürümün treeJson'ında durur" sözü
    // yalnız YAYINLANMIŞ sürüm için doğrudur: avukatın son sürümden sonra
    // `POST /nodes` ve `PATCH /nodes/:nodeId` ile eklediği/düzenlediği
    // düğümler hiçbir sürüme dondurulmamıştır ve geri dönülemez biçimde yok
    // olurdu. Servis bu hâli zaten `hasUnpublishedChanges` diye raporluyordu;
    // koşu ise onu hiç sormuyordu.
    //
    // ÇÖZÜM: onay istemek yerine OTOMATİK YEDEK. Avukatı "üzerine yazayım mı"
    // diye sorguya çekmek, iş akışının ortasında verilecek bir karar değildir
    // ve yanlış cevap geri alınamaz. Sürüm dondurmak bedavadır (kredi
    // harcanmaz), hiçbir şey kaybolmaz ve avukat isterse o sürüme döner.
    const backup = await this.backupUnpublishedWork(user, strategyId);

    // ---- 1) Bağlam (KVKK maskelemesi CaseContextBuilder içinde) ----------
    const built = await this.context.buildFor(
      user.tenantId,
      strategy.caseId,
      "STRATEGY_BUILD",
      CONTEXT_TOKEN_BUDGET,
    );
    const precedents = await this.caselaw.approvedPrecedentsForCase(user.tenantId, strategy.caseId);
    const evidenceLines = await this.loadEvidenceLines(user.tenantId, strategy.caseId);
    const existingSummary = await this.strategies.strategySummaryText(
      user.tenantId,
      strategy.caseId,
    );

    // ---- 2) LLM koşusu ---------------------------------------------------
    // Metin sırası buildMessages ile BİREBİR aynıdır; PII kapısı maskeli
    // hâllerini aynı sırada geri verir.
    const outboundTexts = [
      built.built.text,
      precedents.lines.join("\n"),
      evidenceLines.join("\n"),
      existingSummary ?? "",
      input.instruction ?? "",
    ];

    const run = await this.ai.run({
      user,
      taskType: "STRATEGY_BUILD",
      outboundTexts,
      piiApproved: input.piiApproved,
      schema: StrategyChainOutputSchema,
      // (2) Kaynaksız düğümler burada elenir.
      findingPaths: ["nodes"],
      /**
       * KAYNAK ALANI LİSTESİ GENİŞLETİLİR — aksi hâlde ağaç HER KOŞUDA BOŞ ÇIKAR.
       *
       * Düğüm şemasındaki kaynak alanı `sourceRef` (TEKİL). Guard'ın sabit
       * listesi ise ["sourceQuote","sourceRefs","citations","refs","sources"] —
       * `sourceRef` bu listede YOKTUR. `hasSource` boş diziyi kaynak saymadığı
       * için, kaynağını belge/sayfa referansıyla gösteren (yani TİPİK) her düğüm
       * "KAYNAKSIZ" gerekçesiyle eleniyor; `fillMissingLinks` dokuz halkayı da
       * "VERİ YETERSİZ" ile dolduruyor ve avukat 30 kredi ödeyip boş ağaç
       * alıyordu. Promptun kendi örneğindeki düğüm bile bu elemeye takılıyordu.
       *
       * Prompt kuralı (d) "`sourceRef` ya da `citations` yeterlidir" der; guard
       * artık bunu uyguluyor.
       */
      sourceFields: [...DEFAULT_SOURCE_FIELDS, "sourceRef"],
      entity: "Strategy",
      entityId: strategyId,
      maxTokens: MAX_OUTPUT_TOKENS,
      buildMessages: ([contextText, precedentText, evidenceText, summaryText, instructionText]) =>
        buildStrategyChainMessages({
          caseContextText: contextText,
          approvedPrecedents: precedentText ? precedentText.split("\n").filter(Boolean) : [],
          evidenceLines: evidenceText ? evidenceText.split("\n").filter(Boolean) : undefined,
          existingStrategySummary: summaryText || undefined,
          instruction: instructionText || undefined,
        }),
    });

    // ---- 3) Düğümleri hazırla + eksik halkaları doldur --------------------
    const prepared = fillMissingLinks(normalizeNodes(run.data.nodes));

    // ---- 4) ATIF DOĞRULAMA — kayıt üzerinden, LLM'e sorulmadan -----------
    const rawCitations = collectCitations(prepared, run.citations.map((c) => c.raw));
    const verification =
      rawCitations.length > 0
        ? await this.citations.verify(user, { citations: rawCitations })
        : { results: [] as CitationVerificationResult[], summary: null };
    const verdictByRaw = new Map(
      verification.results.map((r) => [normalizeCitation(r.raw), r] as const),
    );

    const nodesWithCitations = prepared.map((n) => ({
      ...n,
      citationChecks: n.citations.map((raw) => {
        const found = verdictByRaw.get(normalizeCitation(raw));
        return {
          raw,
          status: found?.status ?? "BELIRSIZ",
          verified: found?.status === "DOGRULANDI" && !found.isDemo,
          note:
            found?.note ??
            "Bu künye için deterministik arama yapılamadı; kayıt üzerinden teyit edilmelidir.",
        };
      }),
    }));
    const unverifiedNodeKeys = nodesWithCitations
      .filter((n) => n.citationChecks.some((c) => !c.verified))
      .map((n) => n.key);

    // ---- 5) Sürümü dondur + çalışma kopyasını değiştir --------------------
    const treeJson = JSON.stringify({
      nodes: nodesWithCitations,
      /** Çalışma kopyasının bu sürümden sapıp sapmadığını anlamak için. */
      fingerprint: fingerprintNodes(prepared),
      chain: STRATEGY_CHAIN.map((l) => ({ key: l.key, order: l.order, label: l.label })),
      summary: run.data.summary ?? null,
      generatedAt: new Date().toISOString(),
      source: "AI",
      model: run.model,
      providerType: run.providerType,
      piiMasked: run.piiMasked,
      droppedFindings: run.droppedFindings,
      unverifiedNodeKeys,
      advisory: run.advisory.notice,
    });

    const version = await this.strategies.createVersion(strategyId, {
      treeJson,
      summary: run.data.summary?.trim() || null,
      model: run.model,
      createdBy: user.userId,
    });

    // Çalışma kopyası yeniden kurulur. Eski düğümler kaybolmaz: bir önceki
    // sürümün dondurulmuş `treeJson`'ında tam hâliyle durur.
    const idByKey = await this.persistNodes(user.tenantId, strategyId, prepared);

    await this.prisma.client.strategy.update({
      where: { id: strategyId },
      data: { currentVersionId: version.id, status: "GUNCEL" },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_BUILD",
      entity: "StrategyVersion",
      entityId: version.id,
      detail:
        `strategyId=${strategyId} versionNo=${version.versionNo} düğüm=${prepared.length} ` +
        `elenen=${run.droppedFindings.length} teyitsizDüğüm=${unverifiedNodeKeys.length} model=${run.model}`,
    });

    // ---- 6) Yanıt --------------------------------------------------------
    return {
      strategyId,
      version: { id: version.id, versionNo: version.versionNo, createdAt: version.createdAt },
      /** İNSAN ONAYI NOKTASI — her yanıtta görünür. */
      approval: {
        required: true,
        note:
          "Üretilen ağaç bir TASLAKTIR. Düğümleri düzenleyebilir, silebilir ve elle " +
          "ekleyebilirsiniz; hiçbir düğüm kendiliğinden görev, süre veya dilekçe hâline gelmez.",
        writesRecords: ["StrategyVersion (değiştirilemez)", "StrategyNode (çalışma kopyası)"],
      },
      /**
       * YEDEK — bu koşu, avukatın yayınlanmamış çalışmasının üzerine yazdıysa
       * o çalışma önce sürüm olarak donduruldu. `null` ise dondurulacak bir
       * değişiklik yoktu.
       */
      backup: backup
        ? {
            ...backup,
            note:
              `Yeniden üretimden ÖNCE, yayınlanmamış ${backup.nodeCount} düğümünüz ` +
              `${backup.versionNo}. sürüm olarak donduruldu. Hiçbir şey kaybolmadı; ` +
              "bu sonucu beğenmezseniz o sürüme dönebilirsiniz.",
          }
        : null,
      advisory: run.advisory,
      chain: STRATEGY_CHAIN.map((link) => {
        const items = nodesWithCitations.filter((n) => n.link === link.key);
        return {
          link: link.key,
          order: link.order,
          label: link.label,
          nodeType: link.nodeType,
          nodeCount: items.length,
          hasData: items.some((n) => !n.isPlaceholder),
        };
      }),
      nodes: nodesWithCitations.map((n) => ({
        id: idByKey.get(n.key) ?? null,
        key: n.key,
        parentKey: n.parentKey,
        parentId: n.parentKey ? (idByKey.get(n.parentKey) ?? null) : null,
        link: n.link,
        linkLabel: CHAIN_BY_KEY[n.link].label,
        nodeType: n.nodeType,
        content: n.content,
        strength: n.strength,
        sourceRef: n.sourceRef,
        isPlaceholder: n.isPlaceholder,
        citationChecks: n.citationChecks,
      })),
      citationVerification: {
        /** Teyit DETERMİNİSTİKTİR: kayıt araması yapılır, LLM'e sorulmaz. */
        method: "Kayıt üzerinden deterministik arama (CitationVerifyService)",
        summary: verification.summary,
        results: verification.results,
        unverifiedNodeKeys,
        note:
          unverifiedNodeKeys.length > 0
            ? `${unverifiedNodeKeys.length} düğümdeki atıf kayıt üzerinden doğrulanamadı. ` +
              "Bu düğümler «teyit bekliyor» olarak işaretlenmiştir; dilekçeye aktarmadan önce " +
              "künyeyi elle teyit edin."
            : "Ağaçta doğrulanmamış atıf yok.",
      },
      ai: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        /** Kaynak göstermediği için elenen düğümler — şeffaflık. */
        droppedFindings: run.droppedFindings,
        usage: run.usage,
      },
      context: {
        includedSections: built.built.includedSections,
        omittedSections: built.built.omittedSections,
        truncated: built.built.truncated,
        droppedItemCount: built.built.droppedItemCount,
        unindexedDocuments: built.unindexedDocumentNames,
        approvedPrecedentCount: precedents.lines.length,
        excludedDemoPrecedents: precedents.excludedDemo,
        evidenceLineCount: evidenceLines.length,
      },
      warnings: buildWarnings(
        prepared,
        run.droppedFindings.length,
        precedents.excludedDemo.length,
        backup,
      ),
    };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /**
   * Yayınlanmamış elle değişiklik varsa çalışma kopyasını sürüm olarak dondurur.
   *
   * "Yayınlanmamış" ölçütü `StrategyService.hasUnpublishedChanges` ile
   * BİREBİR AYNIDIR: içerik parmak izi (zaman damgası değil — AI koşusu önce
   * sürümü dondurup sonra düğümleri yazdığı için düğümler daima sürümden
   * birkaç milisaniye yenidir ve zaman karşılaştırması her koşudan sonra
   * yanlışlıkla "değişiklik var" derdi).
   *
   * Hiç sürümü olmayan strateji: düğüm varsa yine dondurulur — o düğümler de
   * avukat emeğidir ve ilk AI koşusunda yok olmamalıdır.
   *
   * @returns dondurulan sürüm bilgisi, gerek yoksa `null`.
   */
  private async backupUnpublishedWork(
    user: AuthUser,
    strategyId: string,
  ): Promise<{ versionId: string; versionNo: number; nodeCount: number } | null> {
    const nodes = await this.prisma.client.strategyNode.findMany({
      where: { tenantId: user.tenantId, strategyId },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    });
    if (nodes.length === 0) return null;

    const strategy = await this.prisma.client.strategy.findFirst({
      where: { id: strategyId, tenantId: user.tenantId },
      select: { currentVersionId: true },
    });
    const currentVersion = strategy?.currentVersionId
      ? await this.prisma.client.strategyVersion.findFirst({
          where: { id: strategy.currentVersionId, strategyId },
          select: { treeJson: true },
        })
      : null;

    const fingerprint = fingerprintNodes(nodes);
    if (currentVersion && versionFingerprintOf(currentVersion.treeJson) === fingerprint) {
      // Çalışma kopyası güncel sürümle birebir aynı: yedeklenecek emek yok.
      return null;
    }

    const version = await this.strategies.createVersion(strategyId, {
      treeJson: JSON.stringify({
        nodes: buildNodeTree(nodes),
        fingerprint,
        generatedAt: new Date().toISOString(),
        // Kaynak AÇIKÇA işaretlenir: bu sürümü avukat yayınlamadı, yeniden
        // üretim öncesi sistem dondurdu.
        source: "MANUEL_OTOMATIK_YEDEK",
      }),
      summary:
        "OTOMATİK YEDEK — yapay zekâ yeniden üretimi öncesinde, yayınlanmamış elle " +
        `değişiklikler (${nodes.length} düğüm) sürüm olarak dondurulmuştur. Bu sürüm ` +
        "avukat tarafından yayınlanmamıştır; yeniden üretimin sonucunu beğenmezseniz " +
        "bu sürüme dönebilirsiniz.",
      model: null,
      createdBy: user.userId,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "STRATEGY_AUTO_BACKUP",
      entity: "StrategyVersion",
      entityId: version.id,
      detail:
        `strategyId=${strategyId} versionNo=${version.versionNo} düğüm=${nodes.length} ` +
        "sebep=AI yeniden üretimi öncesi yayınlanmamış çalışma kopyası dondurulması",
    });

    return { versionId: version.id, versionNo: version.versionNo, nodeCount: nodes.length };
  }

  /**
   * İddia–delil matrisi satırları (Modül 14 tabloları).
   *
   * Bu tablolar başka bir modülün SAHİPLİĞİNDEDİR; burada yalnız OKUNUR ve
   * tenant süzgeci elle verilir (şema zorlamaz).
   */
  private async loadEvidenceLines(tenantId: string, caseId: string): Promise<string[]> {
    const claims = await this.prisma.client.claim.findMany({
      where: { tenantId, caseId },
      orderBy: [{ side: "asc" }, { orderIndex: "asc" }],
      take: MAX_EVIDENCE_LINES,
      include: {
        evidenceLinks: { include: { evidence: { select: { title: true, type: true, status: true } } } },
        legalBases: { select: { reference: true } },
      },
    });

    const lines = claims.map((claim) => {
      const evidences = claim.evidenceLinks
        .map((l) => `${l.evidence.title} (${l.evidence.type}/${l.evidence.status})`)
        .join(", ");
      const bases = claim.legalBases.map((b) => b.reference).join(", ");
      return (
        `[${claim.side === "BIZ" ? "BİZİM İDDİAMIZ" : "KARŞI TARAF İDDİASI"} · ${claim.status}] ` +
        `${claim.text} — Deliller: ${evidences || "YOK (delil boşluğu)"}` +
        (bases ? ` — Dayanak: ${bases}` : "")
      );
    });

    if (lines.length === 0) return [];

    const orphanEvidence = await this.prisma.client.evidence.findMany({
      where: { tenantId, caseId, claimLinks: { none: {} } },
      select: { title: true, type: true, status: true },
      take: 20,
    });
    for (const e of orphanEvidence) {
      lines.push(`[BAĞLANMAMIŞ DELİL] ${e.title} (${e.type}/${e.status}) — hangi iddiayı taşıdığı belirsiz`);
    }
    return lines;
  }

  /**
   * Düğümleri yazar. ÖNCE eski çalışma kopyası silinir, sonra üst→alt sırayla
   * yenileri açılır (parentKey → id çözümü için sıra zorunludur).
   */
  private async persistNodes(
    tenantId: string,
    strategyId: string,
    nodes: readonly PreparedNode[],
  ): Promise<Map<string, string>> {
    const idByKey = new Map<string, string>();

    await this.prisma.client.strategyNode.deleteMany({ where: { tenantId, strategyId } });

    // Topolojik sıra: üstü henüz yazılmamış düğüm bekletilir.
    const pending = [...nodes];
    let orderIndex = 0;
    let guard = 0;
    while (pending.length > 0 && guard < nodes.length * 2 + 10) {
      guard += 1;
      const ready = pending.filter((n) => !n.parentKey || idByKey.has(n.parentKey));
      if (ready.length === 0) {
        // Çözülemeyen üst (uydurma parentKey): kalanları KÖKE al, kaybetme.
        for (const node of pending) {
          const created = await this.createNodeRow(tenantId, strategyId, node, null, orderIndex++);
          idByKey.set(node.key, created);
        }
        break;
      }
      for (const node of ready) {
        const parentId = node.parentKey ? (idByKey.get(node.parentKey) ?? null) : null;
        const created = await this.createNodeRow(tenantId, strategyId, node, parentId, orderIndex++);
        idByKey.set(node.key, created);
        pending.splice(pending.indexOf(node), 1);
      }
    }

    return idByKey;
  }

  private async createNodeRow(
    tenantId: string,
    strategyId: string,
    node: PreparedNode,
    parentId: string | null,
    orderIndex: number,
  ): Promise<string> {
    const created = await this.prisma.client.strategyNode.create({
      data: {
        tenantId,
        strategyId,
        parentId,
        nodeType: node.nodeType,
        content: node.content,
        strength: node.strength,
        sourceRef: node.sourceRef,
        orderIndex,
      },
      select: { id: true },
    });
    return created.id;
  }
}

/* ------------------------------------------------------------------ *
 * Saf yardımcılar
 * ------------------------------------------------------------------ */

/** Model çıktısını iç temsile çevirir; yinelenen anahtarları tekilleştirir. */
function normalizeNodes(nodes: readonly StrategyChainNodeOutput[]): PreparedNode[] {
  const seen = new Set<string>();
  const result: PreparedNode[] = [];
  for (const node of nodes) {
    let key = node.key.trim();
    if (seen.has(key)) {
      let suffix = 2;
      while (seen.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    seen.add(key);
    const link = node.link;
    result.push({
      key,
      parentKey: node.parentKey?.trim() || null,
      link,
      nodeType: CHAIN_BY_KEY[link].nodeType,
      content: node.content.trim(),
      // `strength` yalnız argüman halkalarında anlamlıdır.
      strength:
        node.strength !== undefined &&
        (link === "BIZIM_ARGUMAN" || link === "KARSI_ARGUMAN" || link === "KARSI_TARAFIN_KULLANACAGI")
          ? node.strength
          : null,
      sourceRef: node.sourceRef?.trim() || null,
      citations: node.citations.map((c) => c.trim()).filter(Boolean),
      isPlaceholder: false,
    });
  }
  // Kendi kendine bağlanan düğümleri köke al.
  for (const node of result) {
    if (node.parentKey === node.key) node.parentKey = null;
  }
  return result;
}

/**
 * Boş kalan halkalara "veri yetersiz" düğümü koyar.
 *
 * Kabul kriteri 1: "boş dal kalmaz; veri yoksa dal 'veri yetersiz' notu taşır".
 * Bir halka ya modelde hiç üretilmediği ya da düğümleri kaynaksız olduğu için
 * elendiği için boş kalabilir; iki durumda da avukat eksiği GÖRMELİDİR.
 */
function fillMissingLinks(nodes: PreparedNode[]): PreparedNode[] {
  const present = new Set(nodes.map((n) => n.link));
  const filled = [...nodes];
  for (const link of STRATEGY_CHAIN) {
    if (present.has(link.key)) continue;
    filled.push({
      key: `bos_${link.key.toLowerCase()}`,
      parentKey: null,
      link: link.key,
      nodeType: link.nodeType,
      content:
        `VERİ YETERSİZ — «${link.label}» halkası doldurulamadı. Dosyadaki mevcut belge, ` +
        "safahat ve delil kayıtları bu halka için kaynaklı bir tespit üretmeye yetmedi " +
        "(veya üretilen tespitler kaynak göstermediği için elendi). Bu halkayı elle " +
        "doldurun ya da eksik belgeleri dosyaya yükleyip yeniden üretin.",
      strength: null,
      sourceRef: null,
      citations: [],
      isPlaceholder: true,
    });
  }
  return filled;
}

/** Düğüm künyeleri + guard'ın metinden çıkardığı atıflar — tekilleştirilmiş. */
function collectCitations(nodes: readonly PreparedNode[], extracted: readonly string[]): string[] {
  const set = new Map<string, string>();
  for (const node of nodes) {
    for (const raw of node.citations) set.set(normalizeCitation(raw), raw);
  }
  for (const raw of extracted) set.set(normalizeCitation(raw), raw);
  return [...set.values()];
}

function normalizeCitation(raw: string): string {
  return raw.toLocaleLowerCase("tr-TR").replace(/[\s.,;:/\\-]+/g, "");
}

/** Sürümün dondurulmuş parmak izi (yoksa null). */
function versionFingerprintOf(treeJson: string): string | null {
  try {
    const parsed = JSON.parse(treeJson) as { fingerprint?: unknown };
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

function buildWarnings(
  nodes: readonly PreparedNode[],
  droppedCount: number,
  excludedDemoCount: number,
  backup: { versionNo: number; nodeCount: number } | null,
): string[] {
  const warnings: string[] = [];
  if (backup) {
    warnings.push(
      `Bu koşu, yayınlanmamış ${backup.nodeCount} düğümlük çalışma kopyanızın üzerine ` +
        `yazdı. Kaybolmadı: yeniden üretimden önce ${backup.versionNo}. sürüm olarak ` +
        "donduruldu ve sürüm listesinden geri alınabilir.",
    );
  }
  const placeholders = nodes.filter((n) => n.isPlaceholder);
  if (placeholders.length > 0) {
    warnings.push(
      `Zincirin ${placeholders.length} halkası dosyadaki veriyle doldurulamadı: ` +
        placeholders.map((p) => CHAIN_BY_KEY[p.link].label).join(", ") +
        ". Bu halkalar «veri yetersiz» düğümüyle işaretlendi.",
    );
  }
  if (droppedCount > 0) {
    warnings.push(
      `${droppedCount} düğüm kaynak göstermediği için elendi. Kaynaksız tespit, ürün ilkesi ` +
        "gereği ağaca yazılmaz; elenenlerin listesi `ai.droppedFindings` alanındadır.",
    );
  }
  if (excludedDemoCount > 0) {
    warnings.push(
      `${excludedDemoCount} onaylı emsal DEMO kaydı olduğu için bağlama alınmadı; strateji ` +
        "bu emsalleri görmeden üretildi.",
    );
  }
  return warnings;
}
