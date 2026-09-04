/**
 * SÖZLEŞME ANALİZİ VE SİMÜLASYON SERVİSİ.
 *
 * ÜRÜN İLKELERİ:
 *
 *  1. İKİ TARAF PERSPEKTİFİ TEK KOŞUDA, İKİ AYRI ÇIKTIDA (ourSideJson /
 *     otherSideJson). Tek promptta karışması sıralama/önyargı riski taşır;
 *     şema ayrımı test edilebilir kalır.
 *
 *  2. ŞERHLER DETERMİNİSTİK KÜNYEDİR. AI önerir; kayıt AVUKAT KOMUTUYLA
 *     (koşusu başlatan komutla) yazılır. Her şerhte GEREKÇE ZORUNLUDUR ve
 *     alıntı (quote) sözleşme metninde SUNUCUDA birebir doğrulanır —
 *     doğrulanmayan bulgu şerhe DÖNÜŞMEZ, elenmesi yanıtta görünür.
 *
 *  3. SKORU SUNUCU HESAPLAR. `overallRiskScore` = şerh ağırlıklarının
 *     (KRITIK=10 / ORTA=5 / DUSUK=2) 100'e normalize edilmiş bileşimi
 *     (bkz. contract-analysis-score.ts). Model skoru YAZAMAZ.
 *
 *  4. KOŞULAR DEĞİŞTİRİLEMEZ (SimulationRun deseni). Yeniden analiz = yeni
 *     koşu; PATCH ucu YOKTUR.
 *
 *  5. REVİZYON ANALİZİ ESKİ ŞERHLERİ GEÇERSİZ KILAR: REVIZYON modunda koşan
 *     analiz, önceki açık şerhleri SUPERSEDED yapar — hangi şerhin hangi
 *     metne ait olduğu böylece kayıtta kalır.
 *
 *  6. HER SORGU tenantId SÜZGECİ taşır; şerh ve koşu kayıtlarında tenantId
 *     vardır, üst kayıt süzgeci de daima uygulanır.
 *
 *  7. MÜVEKKİL BİLDİRİMİ portal yayın mekanizmasıyladır: özet SUNUCUDA
 *     deterministik kurulur (AI yok, kredi yok), Onaylayan bu ucu çağıran
 *     HUKUKİ rol kullanıcıdır ve Publication allow-list'e yazılır.
 *
 *  8. ANALİZ PARÇA BAZLIDIR (map-reduce) — ÇOK SAYFALI ÖLÇEK. Sözleşme metni
 *     sayfa bazlı chunker ile parçalara bölünür (contract-analysis-chunks);
 *     her parça için AYRI AI çağrısı yapılır. Tek parçanın hatası koşuyu
 *     DÜŞÜRMEZ: parça HATA notuyla işaretlenir, kalan parçalar koşar. Bulgular
 *     parça künyesini (sanal sayfa aralığı) taşır; kredi fiyatı parça sayısına
 *     göredir (bkz. credits/credit.service.ts `units`).
 *
 *  9. LISTELER SINIRLIDIR. Şerh/olay listeleri take/skip ile döner; diff
 *     YALNIZCA DEĞİŞEN SAYFALARI sayfalanmış döndürür. Koşu çıktısında
 *     (ourSideJson/otherSideJson) HAM METİN YAZILMAZ — metin zaten
 *     ContractVersion'dadır; çıktı yalnız bulgu/şerh ve parça künyesi taşır.
 */

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import { AuditService } from "../audit/audit.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationOutboxService } from "../scheduler/notification-outbox.service";
import { PortalPublicationService } from "../portal/portal-publication.service";
import { CreditService } from "../credits/credit.service";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  DROP_REASON_LABELS,
  filterByVerbatimQuote,
  normalizeForQuoteMatch,
  type DroppedQuoteFinding,
} from "../common/ai/quote-guard";
import {
  appendContractEvent,
} from "./contract-events";
import {
  computeRiskScore,
  riskBandOf,
} from "./contract-analysis-score";
import {
  buildAnalysisChunks,
  estimateAnalysisUnits,
  MAX_ANALYSIS_CHUNKS,
  splitIntoPages,
} from "./contract-analysis-chunks";
import { diffPages, type PageDiffEntry } from "./contract-diff";
import {
  assertCanCloseAnnotation,
  assertCanNotifyClient,
  assertCanRunAnalysis,
  assertCanSetNotifyMode,
  assertCloseAnnotation,
} from "./contract-analysis-rules";
import {
  buildContractChunkAnalysisMessages,
  CONTRACT_ANALYSIS_TASK,
  ContractAnalysisOutputSchema,
  type ContractAnalysisFinding,
} from "./contract-analysis-prompts";
import type {
  CloseAnnotationInput,
  ContractDiffInput,
  NotifyClientInput,
  RunContractAnalysisInput,
  SetNotifyModeInput,
} from "./contract-analysis.dto";

const ANALYSIS_ADVISORY_BANNER =
  "Bu analiz YAPAY ZEKÂ ÖNERİSİDİR, hukuki mütalaa değildir. Şerhler avukat komutuyla " +
  "kayda geçmiştir; hangisinin metne işleneceği avukatın kararıdır.";

/** Bildirim (avukat) dedupe öneki — koşu kimliğiyle birleşir. */
const NOTIFY_DEDUPE_PREFIX = "SOZLESME_KRITIK_SHERH";

/** Parça bazlı koşuda eşzamanlı AI çağrısı üst sınırı (sağlayıcıyı ezmemek için). */
const CHUNK_CONCURRENCY = 3;

/** Olay akışının varsayılan sayfa boyutu (zaman çizelgesi "son N + geçmişe yükleme"). */
const EVENTS_PAGE_SIZE = 20;

/** Diff sonuçlarının varsayılan sayfa boyutu (değişen sayfa başına). */
const DIFF_PAGE_SIZE = 10;

/** Şerhin JSON'da saklanan çözülmüş biçimi. */
type AnnotationJson = {
  id: string;
  runId: string;
  clauseRef: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  severity: "KRITIK" | "ORTA" | "DUSUK";
  explanation: string;
  quote: string | null;
  proposedFix: string | null;
  status: "ACIK" | "KAPALI" | "SUPERSEDED";
  closedAt: string | Date | null;
  closeNote: string | null;
  createdAt: string | Date;
};

/** Parça künyesi — koşu kaydına düşen ölçü/durum satırı (parça METNİ YOK). */
interface ChunkReportJson {
  index: number;
  pageFrom: number | null;
  pageTo: number | null;
  status: "TAMAM" | "HATA";
  ourCount: number;
  otherCount: number;
  durationMs: number;
  errorNote?: string;
}

/** Koşu çıktısına iliştirilen bulgu — parça künyesiyle (sanal sayfa aralığı). */
type MergedFinding = ContractAnalysisFinding & {
  pageFrom: number | null;
  pageTo: number | null;
};

@Injectable()
export class ContractAnalysisService {
  private readonly logger = new Logger(ContractAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiRunnerService,
    private readonly outbox: NotificationOutboxService,
    private readonly portalPublications: PortalPublicationService,
    private readonly credits: CreditService,
  ) {}

  // ================================================================== //
  // ANALİZ KOŞUSU (PARÇA BAZLI — map-reduce)
  // ================================================================== //

  /** POST /contracts/:id/analyses */
  async analyze(user: AuthUser, contractId: string, input: RunContractAnalysisInput) {
    assertCanRunAnalysis(user, input.mode);

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        currentVersionId: true,
        clientId: true,
        client: { select: { id: true, name: true } },
      },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");

    const versionId = input.versionId ?? contract.currentVersionId;
    if (!versionId) {
      throw new BadRequestException(
        "Sözleşmenin incelenecek bir sürümü yok. Önce sözleşme metnini bir sürüm olarak ekleyin.",
      );
    }

    const version = await this.prisma.client.contractVersion.findFirst({
      // tenantId süzgeci ÜST KAYITTAN — ContractVersion üzerinde tenantId yoktur.
      where: { id: versionId, contract: { id: contractId, tenantId: user.tenantId } },
      select: { id: true, versionNo: true, contentText: true, changeNote: true },
    });
    if (!version) throw new NotFoundException("Sözleşme sürümü bulunamadı.");

    const text = version.contentText.trim();
    if (text.length < 50) {
      throw new BadRequestException(
        "Sürüm metni analiz için çok kısa. Sözleşmenin tam metnini yükleyin.",
      );
    }

    // ── MAP: SAYFA BAZLI PARÇALAMA ─────────────────────────────────────────
    // Metin TEK prompta tıkılmaz: 1 sayfalık sözleşme de 300 sayfalık sözleşme
    // de AYNI çağrı kalıbıyla incelenir; tek fark parça sayısıdır.
    const chunks = buildAnalysisChunks(text, {
      documentId: version.id,
      documentTitle: contract.title,
    });
    if (chunks.length === 0) {
      throw new BadRequestException("Sözleşme metni parçalanamadı; metin boş görünüyor.");
    }
    if (chunks.length > MAX_ANALYSIS_CHUNKS) {
      throw new BadRequestException(
        `Sözleşme analiz için çok uzun: ${chunks.length} parça (tavan ${MAX_ANALYSIS_CHUNKS}). ` +
          "Sözleşmeyi bölümler hâlinde ayrı sürümler olarak inceleyin.",
      );
    }

    const ourParty = input.ourParty?.trim() || contract.client?.name || null;
    const header = [
      `SÖZLEŞME TİPİ: ${contract.type}`,
      `BAŞLIK: ${contract.title}`,
      `SÜRÜM: v${version.versionNo}` + (version.changeNote ? ` — ${version.changeNote}` : ""),
      ourParty
        ? `MÜVEKKİLİMİZ: ${ourParty}`
        : "MÜVEKKİLİMİZ: (taraf sıfatı bildirilmedi — analiz genel dengeye göre yapılmalı)",
    ].join("\n");

    const instruction = [
      "Sana verilen sözleşme BÖLÜMÜNÜ İKİ AYRI PERSPEKTİFDEN incele: ourSide (müvekkilimiz",
      "açısından riskler ve müzakere maddeleri) ve otherSide (karşı tarafın lehine",
      "kullanacağı maddeler). Her bulgu metinden BİREBİR ALINTI (quote) taşımalıdır;",
      "sunucu alıntıyı metinde arar ve bulamazsa bulgu ŞERHE DÖNÜŞMEZ. severity yalnızca",
      "KRITIK, ORTA veya DUSUK olabilir.",
      input.focus?.trim() ? `\nAVUKATIN YÖNLENDİRMESİ: ${input.focus.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const startedAt = Date.now();
    const chunkReports: ChunkReportJson[] = [];
    const ourSideAll: MergedFinding[] = [];
    const otherSideAll: MergedFinding[] = [];
    const droppedQuotes: (DroppedQuoteFinding & {
      perspective: string;
      reasonLabel: string;
      pageFrom: number | null;
      pageTo: number | null;
    })[] = [];
    let okCount = 0;
    let failCount = 0;
    let model: string | null = null;

    /** Tek parça koşusu — başarısızsa parça HATA notuyla işaretlenir. */
    const runChunk = async (chunkIndex: number): Promise<void> => {
      const chunk = chunks[chunkIndex];
      const pageFrom = chunk.pageFrom ?? null;
      const pageTo = chunk.pageTo ?? null;
      const pageLabel =
        pageFrom !== null
          ? pageTo !== null && pageTo !== pageFrom
            ? `s.${pageFrom}-${pageTo}`
            : `s.${pageFrom}`
          : "(sayfa bilinmiyor)";
      const chunkContext = [
        header,
        "",
        `BÖLÜM: ${chunk.citationLabel}`,
        "",
        "METİN:",
        chunk.content,
      ].join("\n");
      const chunkStartedAt = Date.now();

      try {
        // GEÇİCİ SAĞLAYICI HATALARINA TEK SEFERLİK YENİDEN DENEME: bazı
        // sağlayıcılar arada BOŞ yanıt döndürür (aynı sözleşme önceki koşuda
        // başarılıydı). Parça ilk denemede "boş yanıt" hatası verdiyse 2 sn
        // sonra BİR kez daha denenir; ikinci de başarısızsa parça HATA notuyla
        // işaretlenir (koşu düşmez). Diğer hatalarda yeniden deneme yok.
        const runAi = async () => {
          for (let attempt = 1; ; attempt += 1) {
            try {
              return await this.ai.run({
                user,
                taskType: CONTRACT_ANALYSIS_TASK,
                outboundTexts: [chunkContext, instruction],
                piiApproved: input.piiApproved,
                schema: ContractAnalysisOutputSchema,
                // Kaynak alanı boş olan bulgular (iki perspektif de) burada elenir.
                findingPaths: ["ourSide", "otherSide"],
                entity: "Contract",
                entityId: contract.id,
                // ÇIKTI TAVANI: iki taraflı analiz + birebir alıntılar 4096
                // tokenı AŞIYORDU — model sınırda kesiliyor, JSON ortadan
                // bölünüyor ve koşu "boş yanıt" hatasıyla düşüyordu (AiUsageLog:
                // outputTokens=4096=tavan). Alıntı güvenliği için GİRİŞİ
                // küçültmek DOĞRU OLMAZDI (alıntı kaynağı eksilirdi); çıktı
                // tavanı yükseltildi.
                maxTokens: 16384,
                buildMessages: ([ctx, instr]) =>
                  buildContractChunkAnalysisMessages({
                    contextText: ctx,
                    instruction: instr,
                    pageLabel,
                    chunkLabel: `${chunkIndex + 1}/${chunks.length}`,
                  }),
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              const transientEmpty = msg.includes("boş yanıt") || msg.includes("beklenen biçimde değil");
              if (transientEmpty && attempt < 2) {
                this.logger.warn(
                  `Sözleşme analizi parçası geçici yanıt hatası, yeniden deneniyor (sözleşme ` +
                    `${contract.id}, parça ${chunkIndex + 1}/${chunks.length}, deneme ${attempt}): ${msg.slice(0, 160)}`,
                );
                await new Promise((r) => setTimeout(r, 2000));
                continue;
              }
              throw err;
            }
          }
        };
        const run = await runAi();

        // ── KAPI (b): ALINTI PARÇA METNİNDE BİREBİR VAR MI ────────────────
        // Arama modelin GÖRDÜĞÜ metinde yapılır (maskeliyse maskeli hâlinde).
        const haystack = run.piiMasked ? scanPii(chunk.content).maskedText : chunk.content;
        const ourSide = filterByVerbatimQuote(
          run.data.ourSide,
          haystack,
          (f) => f.quote,
          (f, i) => f.title || `Bulgu #${i + 1}`,
        );
        const otherSide = filterByVerbatimQuote(
          run.data.otherSide,
          haystack,
          (f) => f.quote,
          (f, i) => f.title || `Bulgu #${i + 1}`,
        );

        ourSide.kept.forEach((f) => ourSideAll.push({ ...f, pageFrom, pageTo }));
        otherSide.kept.forEach((f) => otherSideAll.push({ ...f, pageFrom, pageTo }));
        droppedQuotes.push(
          ...ourSide.dropped.map((d) => ({
            ...d,
            perspective: "Bizim taraf",
            reasonLabel: DROP_REASON_LABELS[d.reason],
            pageFrom,
            pageTo,
          })),
          ...otherSide.dropped.map((d) => ({
            ...d,
            perspective: "Karşı taraf",
            reasonLabel: DROP_REASON_LABELS[d.reason],
            pageFrom,
            pageTo,
          })),
        );

        okCount += 1;
        model = run.model;
        chunkReports.push({
          index: chunkIndex,
          pageFrom,
          pageTo,
          status: "TAMAM",
          ourCount: ourSide.kept.length,
          otherCount: otherSide.kept.length,
          durationMs: Date.now() - chunkStartedAt,
        });
      } catch (err) {
        // KVKK ONAY AKIŞI KULLANICI KARARI BEKLER: onay isteyen 409 hata
        // toleransına GİRMEZ — onaysız koşu "tamamlandı" GÖSTERİLEMEZ.
        if (isPiiApprovalRequired(err)) throw err;
        failCount += 1;
        const errorNote = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        this.logger.warn(
          `Sözleşme analizi parçası başarısız (sözleşme ${contract.id}, parça ` +
            `${chunkIndex + 1}/${chunks.length}, ${pageLabel}): ${errorNote}`,
        );
        chunkReports.push({
          index: chunkIndex,
          pageFrom,
          pageTo,
          status: "HATA",
          ourCount: 0,
          otherCount: 0,
          durationMs: Date.now() - chunkStartedAt,
          errorNote,
        });
      }
    };

    // Sıralı + SINIRLI EŞZAMANLILIK: parçalar sırayla korunur (şerh sırası
    // okunur kalır), sağlayıcı aynı anda CHUNK_CONCURRENCY çağrıdan fazlasını
    // görmez. Tek parça hatası döngüyü KIRMAZ (bkz. runChunk catch).
    await runWithConcurrency(chunks.length, CHUNK_CONCURRENCY, runChunk);

    if (okCount === 0) {
      throw new BadGatewayException(
        `Analiz koşamadı: ${failCount} parçanın TAMAMI başarısız oldu. Sağlayıcı ` +
          "yapılandırmasını (Ayarlar → AI Sağlayıcı) kontrol edip yeniden deneyin.",
      );
    }

    // ── REDUCE: BİRLEŞTİR + TEKRAR ELE ────────────────────────────────────
    // Örtüşen parçalar aynı maddeyi iki kez bulabilir; aynı alıntıyı taşıyan
    // bulgu TEK kez kayda girer. Sıralama parça sırasıyla korunur, rank
    // yeniden numaralanır.
    const ourSide = dedupeFindings(ourSideAll);
    const otherSide = dedupeFindings(otherSideAll);
    const findings = ourSide;

    const durationMs = Date.now() - startedAt;
    const chunkStats = {
      chunkCount: chunks.length,
      okCount,
      failCount,
      pageCount: splitIntoPages(text).length,
      chars: text.length,
      chunks: chunkReports,
    };

    // ── KAYIT (tek transaction) ────────────────────────────────────────────
    const record = await this.prisma.client.$transaction(async (tx) => {
      // REVİZYON: önceki AÇIK şerhler bu sürümle geçersizleşmiştir.
      if (input.mode === "REVIZYON") {
        await tx.contractClauseAnnotation.updateMany({
          where: { contractId: contract.id, tenantId: user.tenantId, status: "ACIK" },
          data: { status: "SUPERSEDED" },
        });
      }

      const created = await tx.contractAnalysisRun.create({
        data: {
          tenantId: user.tenantId,
          contractId: contract.id,
          versionId: version.id,
          mode: input.mode,
          // Koşu çıktısı YALNIZ BULGU taşır — ham sözleşme metni burada YOKTUR;
          // metin zaten ContractVersion kaydıdır.
          ourSideJson: JSON.stringify(ourSide),
          otherSideJson: JSON.stringify(otherSide),
          chunkStatsJson: JSON.stringify(chunkStats),
          // Skor SUNUCUDA hesaplanır — modelin önerdiği bir sayı OKUNMAZ bile.
          overallRiskScore: computeRiskScore(findings.map((f) => f.severity)),
          model,
          durationMs,
          createdBy: user.userId,
        },
      });

      if (findings.length > 0) {
        await tx.contractClauseAnnotation.createMany({
          data: findings.map((f) => ({
            tenantId: user.tenantId,
            runId: created.id,
            contractId: contract.id,
            clauseRef: f.clauseRef?.trim() || null,
            pageFrom: f.pageFrom,
            pageTo: f.pageTo,
            severity: f.severity,
            explanation: f.body,
            quote: f.quote?.trim() || null,
            proposedFix: f.proposedFix?.trim() || null,
            status: "ACIK",
            createdBy: user.userId,
          })),
        });
      }

      return created;
    });

    const annotations = await this.prisma.client.contractClauseAnnotation.findMany({
      where: { runId: record.id },
      orderBy: { createdAt: "asc" },
    });

    await appendContractEvent(this.prisma.client, {
      tenantId: user.tenantId,
      contractId: contract.id,
      type: "ANALIZ",
      detail:
        `${input.mode} analizi — v${version.versionNo}, ${annotations.length} şerh, skor ` +
        `${record.overallRiskScore}/100 (${okCount}/${chunks.length} parça).`,
      user,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_CONTRACT_ANALYSIS",
      entity: "ContractAnalysisRun",
      entityId: record.id,
      detail:
        `sözleşme=${contract.id} sürüm=v${version.versionNo} mod=${input.mode} ` +
        `şerh=${annotations.length} elenen_alıntı=${droppedQuotes.length} ` +
        `parça=${okCount}+${failCount}/${chunks.length} skor=${record.overallRiskScore}`,
    });

    // ── AVUKAT OTOMATİK BİLDİRİMİ (ContractNotifySetting = OTOMATIK) ──────
    // KRİTİK şerh varsa ve büro bu sözleşme için otomatik kipi açtıysa
    // avukatlara bildirim düşer. Bildirim yazımı analiz sonucunu BOZMAZ.
    let notified = 0;
    const hasCritical = annotations.some((a) => a.severity === "KRITIK");
    if (hasCritical) {
      const setting = await this.prisma.client.contractNotifySetting.findUnique({
        where: { contractId: contract.id },
        select: { mode: true },
      });
      if (setting?.mode === "OTOMATIK") {
        notified = await this.notifyLawyersOfCritical(user, contract.id, contract.title, record.id);
      }
    }

    return {
      runId: record.id,
      contractId: contract.id,
      versionId: version.id,
      versionNo: version.versionNo,
      mode: record.mode,
      overallRiskScore: record.overallRiskScore,
      riskBand: riskBandOf(record.overallRiskScore),
      advisory: { banner: ANALYSIS_ADVISORY_BANNER },
      approval: {
        required: true,
        writesRecords: ["ContractAnalysisRun (değiştirilemez koşu)", "ContractClauseAnnotation (şerhler)"],
        note:
          "Şerhler bu koşuyla kayda geçmiştir; her birinin gerekçesi ve alıntısı sözleşme metninde " +
          "doğrulanmıştır. Metne işlemek ve şerhleri kapatmak avukatın kararına kalmıştır.",
      },
      ourSide,
      otherSide,
      overallNote: null,
      annotations: annotations.map(toAnnotationJson),
      chunks: {
        count: chunks.length,
        ok: okCount,
        failed: failCount,
        pages: chunkStats.pageCount,
        note:
          "Sözleşme parça parça incelendi; her parça ayrı AI çağrısıdır ve şerhler sanal " +
          "sayfa konumu (pageFrom/pageTo) taşır. Başarısız parça varsa raporlanır; koşu " +
          "diğer parçaların bulgularıyla tamamlanmıştır.",
      },
      chunkReports,
      guard: {
        droppedQuotes,
        note:
          "Her bulgu alıntısı incelediği parça metninde birebir aranmıştır; bulunamayanlar " +
          "yukarıda gerekçesiyle listelenmiş ve şerhe DÖNÜŞMEMİŞTİR.",
      },
      autoNotify: { checked: hasCritical, lawyersNotified: notified },
      model,
      durationMs,
      createdAt: record.createdAt,
    };
  }

  // ================================================================== //
  // ANALİZ TAHMİNİ (deterministik — AI YOK, KREDİ YOK)
  // ================================================================== //

  /** GET /contracts/:id/analyses/estimate?versionId= */
  async analysisEstimate(user: AuthUser, contractId: string, versionId?: string) {
    await this.assertContract(user, contractId);

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: { currentVersionId: true },
    });
    const targetVersionId = versionId ?? contract?.currentVersionId ?? null;
    if (!targetVersionId) {
      throw new BadRequestException(
        "Sözleşmenin incelenecek bir sürümü yok. Önce sözleşme metnini bir sürüm olarak ekleyin.",
      );
    }
    const version = await this.prisma.client.contractVersion.findFirst({
      where: { id: targetVersionId, contract: { id: contractId, tenantId: user.tenantId } },
      select: { id: true, versionNo: true, contentText: true },
    });
    if (!version) throw new NotFoundException("Sözleşme sürümü bulunamadı.");

    const estimate = estimateAnalysisUnits(version.contentText);
    if (estimate.chunkCount === 0) {
      throw new BadRequestException(
        "Sürüm metni analiz için çok kısa. Sözleşmenin tam metnini yükleyin.",
      );
    }
    if (estimate.chunkCount > MAX_ANALYSIS_CHUNKS) {
      throw new BadRequestException(
        `Sözleşme analiz için çok uzun: ${estimate.chunkCount} parça (tavan ${MAX_ANALYSIS_CHUNKS}).`,
      );
    }

    const pricing = await this.credits.estimateForUnits(CONTRACT_ANALYSIS_TASK, {
      count: estimate.chunkCount,
      charsPerUnit: Math.max(1, estimate.chunkChars),
    });

    return {
      contractId,
      versionId: version.id,
      versionNo: version.versionNo,
      chars: estimate.chars,
      pageCount: estimate.pageCount,
      chunkCount: estimate.chunkCount,
      chunkChars: estimate.chunkChars,
      pricing,
      estimatedDurationMs: estimate.chunkCount * 15_000,
      note:
        "Tahmin DETERMİNİSTİKTİR (AI çağrısı yok, kredi tüketilmez): metin aynı chunker " +
        "hesabıyla bölünmüştür. Fiyat = parça sayısı × parça başına tahmin.",
    };
  }

  // ================================================================== //
  // OKUMA
  // ================================================================== //

  /** GET /contracts/:id/analyses */
  async listAnalyses(
    user: AuthUser,
    contractId: string,
    query: { page?: string; limit?: string },
  ) {
    await this.assertContract(user, contractId);
    const page = resolvePage(query, 25);
    const where = { tenantId: user.tenantId, contractId };
    const [rows, total] = await Promise.all([
      this.prisma.client.contractAnalysisRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          contractId: true,
          versionId: true,
          mode: true,
          overallRiskScore: true,
          model: true,
          durationMs: true,
          createdBy: true,
          createdAt: true,
          ourSideJson: true,
          otherSideJson: true,
          chunkStatsJson: true,
        },
      }),
      this.prisma.client.contractAnalysisRun.count({ where }),
    ]);
    return paged(
      rows.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        versionId: r.versionId,
        mode: r.mode,
        overallRiskScore: r.overallRiskScore,
        riskBand: riskBandOf(r.overallRiskScore),
        model: r.model,
        durationMs: r.durationMs,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        ourSide: safeParse(r.ourSideJson),
        otherSide: safeParse(r.otherSideJson),
        chunks: chunkSummaryOf(r.chunkStatsJson),
      })),
      total,
      page,
    );
  }

  /** GET /contracts/:id/analyses/:runId */
  async analysisDetail(user: AuthUser, contractId: string, runId: string) {
    const run = await this.prisma.client.contractAnalysisRun.findFirst({
      where: { id: runId, contractId, tenantId: user.tenantId },
    });
    if (!run) throw new NotFoundException("Analiz koşusu bulunamadı.");
    const annotations = await this.prisma.client.contractClauseAnnotation.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      id: run.id,
      contractId: run.contractId,
      versionId: run.versionId,
      mode: run.mode,
      overallRiskScore: run.overallRiskScore,
      riskBand: riskBandOf(run.overallRiskScore),
      model: run.model,
      durationMs: run.durationMs,
      createdBy: run.createdBy,
      createdAt: run.createdAt,
      ourSide: safeParse(run.ourSideJson),
      otherSide: safeParse(run.otherSideJson),
      chunks: chunkSummaryOf(run.chunkStatsJson),
      annotations: annotations.map(toAnnotationJson),
      advisory: { banner: ANALYSIS_ADVISORY_BANNER },
      immutable: true,
      immutableNote: "Koşular DEĞİŞTİRİLEMEZ; yeniden analiz yeni koşu açar.",
    };
  }

  /** GET /contracts/:id/annotations?status= */
  async listAnnotations(
    user: AuthUser,
    contractId: string,
    query: { status?: string; page?: string; limit?: string },
  ) {
    await this.assertContract(user, contractId);
    const status = normalizeQuery(query.status);
    const page = resolvePage(query, 100);
    const where = {
      tenantId: user.tenantId,
      contractId,
      ...(status ? { status: status as never } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.contractClauseAnnotation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.contractClauseAnnotation.count({ where }),
    ]);
    return {
      ...paged(rows.map(toAnnotationJson), total, page),
      counts: await this.annotationCounts(user.tenantId, contractId),
    };
  }

  /** Sözleşmenin GÜNCEL risk özeti — AÇIK şerhlerden yeniden hesaplanır. */
  async riskSummary(user: AuthUser, contractId: string) {
    await this.assertContract(user, contractId);
    const counts = await this.annotationCounts(user.tenantId, contractId);
    const openTotal = counts.ACIK.KRITIK + counts.ACIK.ORTA + counts.ACIK.DUSUK;
    const score = computeRiskScore([
      ...Array.from({ length: counts.ACIK.KRITIK }, () => "KRITIK" as const),
      ...Array.from({ length: counts.ACIK.ORTA }, () => "ORTA" as const),
      ...Array.from({ length: counts.ACIK.DUSUK }, () => "DUSUK" as const),
    ]);
    const lastRun = await this.prisma.client.contractAnalysisRun.findFirst({
      where: { tenantId: user.tenantId, contractId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        mode: true,
        overallRiskScore: true,
        model: true,
        createdAt: true,
        versionId: true,
      },
    });
    return {
      contractId,
      openAnnotations: openTotal,
      counts,
      currentScore: score,
      currentBand: riskBandOf(score),
      lastRun: lastRun
        ? { ...lastRun, riskBand: riskBandOf(lastRun.overallRiskScore) }
        : null,
      note:
        "Güncel skor yalnızca AÇIK şerhlerden hesaplanır; kapatılan ve geçersizleşen " +
        "şerhler skoru DÜŞÜRMEZ, dışındadır. Son koşunun kendi skoru arşiv kaydıdır.",
    };
  }

  /** Sözleşme başına en son koşu — liste kartındaki skor bandının kaynağı. */
  async latestRunScores(user: AuthUser) {
    const rows = await this.prisma.client.contractAnalysisRun.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        contractId: true,
        mode: true,
        overallRiskScore: true,
        createdAt: true,
      },
    });
    // Koşu sayısı >> sözleşme sayısı; ilk gören kazanır (createdAt desc).
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.contractId)) latest.set(row.contractId, row);
    }
    const scores: Record<
      string,
      { runId: string; mode: string; score: number; band: ReturnType<typeof riskBandOf>; runAt: string }
    > = {};
    for (const [contractId, run] of latest) {
      scores[contractId] = {
        runId: run.id,
        mode: run.mode,
        score: run.overallRiskScore,
        band: riskBandOf(run.overallRiskScore),
        runAt: run.createdAt.toISOString(),
      };
    }
    return scores;
  }

  // ================================================================== //
  // ŞERH KAPATMA
  // ================================================================== //

  /** POST /contracts/:id/annotations/:annotationId/close */
  async closeAnnotation(
    user: AuthUser,
    contractId: string,
    annotationId: string,
    input: CloseAnnotationInput,
  ) {
    assertCanCloseAnnotation(user);
    const annotation = await this.prisma.client.contractClauseAnnotation.findFirst({
      where: { id: annotationId, contractId, tenantId: user.tenantId },
    });
    if (!annotation) throw new NotFoundException("Şerh bulunamadı.");

    assertCloseAnnotation(annotation.status);

    const updated = await this.prisma.client.contractClauseAnnotation.update({
      where: { id: annotation.id },
      data: {
        status: "KAPALI",
        closedBy: user.userId,
        closedAt: new Date(),
        closeNote: input.note.trim(),
      },
    });

    await appendContractEvent(this.prisma.client, {
      tenantId: user.tenantId,
      contractId,
      type: "SHERH_KAPANDI",
      detail: `${annotation.clauseRef ? `${annotation.clauseRef} — ` : ""}${annotation.severity} şerh kapatıldı: ${input.note.trim()}`,
      user,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_ANNOTATION_CLOSE",
      entity: "ContractClauseAnnotation",
      entityId: annotation.id,
      detail: `gerekçe=${input.note.trim()}`,
    });

    return toAnnotationJson(updated);
  }

  // ================================================================== //
  // SÜRÜM FARKI (SUNUCUDA, SAYFA PENCERELİ)
  // ================================================================== //

  /** GET /contracts/:id/diff?versionAId=&versionBId=&page=&limit= */
  async diff(user: AuthUser, contractId: string, input: ContractDiffInput) {
    await this.assertContract(user, contractId);

    const [a, b] = await Promise.all([
      this.prisma.client.contractVersion.findFirst({
        where: { id: input.versionAId, contract: { id: contractId, tenantId: user.tenantId } },
        select: { id: true, versionNo: true, contentText: true, changeNote: true },
      }),
      this.prisma.client.contractVersion.findFirst({
        where: { id: input.versionBId, contract: { id: contractId, tenantId: user.tenantId } },
        select: { id: true, versionNo: true, contentText: true, changeNote: true },
      }),
    ]);
    if (!a || !b) throw new NotFoundException("Karşılaştırılacak sürümlerden biri bulunamadı.");

    // Fark DETERMİNİSTİKTİR — aynı çift için TEK kayıt; varsa kayıt döner.
    let cached = await this.prisma.client.contractVersionDiff.findUnique({
      where: { versionAId_versionBId: { versionAId: a.id, versionBId: b.id } },
    });

    if (!cached) {
      const paged = diffPages(a.contentText, b.contentText);
      cached = await this.prisma.client.contractVersionDiff.create({
        data: {
          tenantId: user.tenantId,
          contractId,
          versionAId: a.id,
          versionBId: b.id,
          addedCount: paged.counts.addedCount,
          removedCount: paged.counts.removedCount,
          changedCount: paged.counts.changedCount,
          addedJson: JSON.stringify([]),
          removedJson: JSON.stringify([]),
          changedJson: JSON.stringify([]),
          pagesJson: JSON.stringify({
            pages: paged.pages,
            pageCounts: paged.pageCounts,
            unchangedPages: paged.unchangedPages,
          }),
          createdBy: user.userId,
        },
      });

      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "CONTRACT_VERSION_DIFF",
        entity: "ContractVersionDiff",
        entityId: cached.id,
        detail: `v${a.versionNo} → v${b.versionNo} (+${paged.counts.addedCount}/-${paged.counts.removedCount}/~${paged.counts.changedCount})`,
      });
    } else if (cached.pagesJson === null) {
      // Sayfa pencereli biçimden ÖNCE oluşturulmuş önbellek satırı: sayfa
      // farkı YOKTUR. Tek seferlik yeniden hesaplanıp satıra yazılır; diff
      // deterministik olduğundan bu bir düzeltmedir, davranış değişikliği değil.
      const paged = diffPages(a.contentText, b.contentText);
      cached = await this.prisma.client.contractVersionDiff.update({
        where: { id: cached.id },
        data: {
          addedCount: paged.counts.addedCount,
          removedCount: paged.counts.removedCount,
          changedCount: paged.counts.changedCount,
          pagesJson: JSON.stringify({
            pages: paged.pages,
            pageCounts: paged.pageCounts,
            unchangedPages: paged.unchangedPages,
          }),
        },
      });
    }

    return this.presentDiff(cached, a, b, contractId, input);
  }

  // ================================================================== //
  // SÜREÇ AKIŞI (APPEND-ONLY, SAYFALI)
  // ================================================================== //

  /** GET /contracts/:id/events — son N olay + geçmişe yükleme (take/skip). */
  async listEvents(
    user: AuthUser,
    contractId: string,
    query: { page?: string; limit?: string },
  ) {
    await this.assertContract(user, contractId);
    const page = resolvePage(query, EVENTS_PAGE_SIZE);
    const where = { contractId, tenantId: user.tenantId };
    const [rows, total] = await Promise.all([
      this.prisma.client.contractEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.contractEvent.count({ where }),
    ]);
    return {
      ...paged(
        rows.map((e) => ({
          id: e.id,
          type: e.type,
          detail: e.detail,
          actor: safeParse(e.actorJson),
          createdBy: e.createdBy,
          createdAt: e.createdAt,
        })),
        total,
        page,
      ),
      appendOnly: true,
      appendOnlyNote:
        "Süreç akışı yalnızca OLUŞTURULUR; kayıtlar değiştirilemez ve silinemez. " +
        "Zaman çizelgesi son olaylarla açılır; geçmiş 'daha fazla' ile yüklenir.",
    };
  }

  // ================================================================== //
  // MÜVEKKİL BİLDİRİMİ (PORTAL YAYINI + ÖZET)
  // ================================================================== //

  /**
   * POST /contracts/:id/notify-client
   *
   * KRİTİK şerh özeti müvekkilin portalına YAYINLANIR (allow-list). Özet
   * SUNUCUDA deterministik kurulur — AI çağrısı YOK, kredi YOK. Onaylayan bu
   * ucu çağıran HUKUKİ rol kullanıcısıdır; `approvedBy` boş giden mesaj
   * olamaz (OutboundService'in kimlik kapısının birebir karşılığı).
   */
  async notifyClient(user: AuthUser, contractId: string, input: NotifyClientInput) {
    assertCanNotifyClient(user);

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: {
        id: true,
        title: true,
        caseId: true,
        clientId: true,
        client: { select: { id: true, name: true } },
      },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");
    if (!contract.clientId) {
      throw new BadRequestException(
        "Bu sözleşme bir müvekkile bağlı değil; müvekkil bildirimi gönderilemez. " +
          "Önce sözleşmeyi bir müvekkile bağlayın.",
      );
    }

    const open = await this.prisma.client.contractClauseAnnotation.findMany({
      where: { contractId, tenantId: user.tenantId, status: "ACIK" },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });
    const critical = open.filter((a) => a.severity === "KRITIK");
    if (critical.length === 0) {
      throw new ConflictException(
        "Bu sözleşmede AÇIK KRİTİK şerh yok; müvekkile kritik şerh bildirimi gönderilemez. " +
          "Şerh yoksa bildirim telaş yaratır — önce analizi çalıştırın ya da mevcut kritik " +
          "şerhleri inceleyin.",
      );
    }

    const summary = this.buildClientSummary(contract.title, open, input.note?.trim() || null);
    const scan = scanPii(summary);

    const now = new Date();
    const message = await this.prisma.client.outboundMessage.create({
      data: {
        tenantId: user.tenantId,
        clientId: contract.clientId,
        caseId: contract.caseId,
        channel: "PORTAL",
        subject: `Sözleşme incelemesi — kritik hususlar: ${contract.title}`,
        draftBody: summary,
        finalBody: summary,
        status: "GONDERILDI",
        piiScanJson: JSON.stringify({
          scannedAt: now.toISOString(),
          findingCount: scan.findings.length,
          note: "Özet sunucuda deterministik kuruldu; gönderim kararı bu ucu çağıran avukatındır.",
        }),
        approvedBy: user.userId,
        approvedAt: now,
        sentAt: now,
        createdBy: user.userId,
      },
    });

    // İletişim geçmişi tek tabloda toplanır: "müvekkile ne söylendi?"
    await this.prisma.client.communicationLog.create({
      data: {
        tenantId: user.tenantId,
        clientId: contract.clientId,
        caseId: contract.caseId,
        direction: "GIDEN",
        channel: "PORTAL",
        subject: message.subject,
        body: summary,
        contactRef: contract.client?.name ?? contract.clientId,
        occurredAt: now,
        recordedBy: user.userId,
        source: "SISTEM",
        outboundMessageId: message.id,
      },
    });

    // PORTAL GÖRÜNÜRLÜĞÜ ALLOW-LİST'E YAZILIR — gönderim tek başına görünürlük
    // üretmez; kayıt açılır, Portal Yönetimi'nden geri ÇEKİLEBİLİR.
    let published = true;
    try {
      await this.portalPublications.publishOutboundMessage({
        tenantId: user.tenantId,
        clientId: contract.clientId,
        outboundMessageId: message.id,
        publishedBy: user.userId,
        note: "Kritik sözleşme şerhleri özeti — avukat onayıyla yayınlandı.",
      });
    } catch (err) {
      published = false;
      this.logger.error(
        `Portal yayın kaydı açılamadı (mesaj ${message.id}): ${(err as Error).message}. ` +
          "Mesaj kaydedildi; Portal Yönetimi ekranından elle yayınlayın.",
      );
    }

    await appendContractEvent(this.prisma.client, {
      tenantId: user.tenantId,
      contractId,
      type: "MUVEKKIL_BILGILENDIRILDI",
      detail: `${critical.length} kritik şerh özeti portala yayınlandı (mesaj ${message.id}).`,
      user,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_NOTIFY_CLIENT",
      entity: "OutboundMessage",
      entityId: message.id,
      detail: `sözleşme=${contractId} kritik=${critical.length} yayın=${published ? "açık" : "başarısız"}`,
    });

    return {
      messageId: message.id,
      contractId: contract.id,
      clientId: contract.clientId,
      published,
      criticalCount: critical.length,
      openCount: open.length,
      summaryPreview: summary.slice(0, 600),
      note: published
        ? "Özet müvekkilin portalında yayında. Portal Yönetimi'nden geri çekilebilir."
        : "Mesaj kaydedildi ancak portal yayın kaydı AÇILAMADI; Portal Yönetimi'nden elle yayınlayın.",
    };
  }

  // ================================================================== //
  // BİLDİRİM KİPİ
  // ================================================================== //

  /** GET /contracts/:id/notify-setting */
  async getNotifySetting(user: AuthUser, contractId: string) {
    await this.assertContract(user, contractId);
    const setting = await this.prisma.client.contractNotifySetting.findUnique({
      where: { contractId },
    });
    return {
      contractId,
      mode: setting?.mode ?? "MANUAL",
      note:
        "MANUAL: kritik şerh bildirimini avukat elle gönderir (varsayılan). OTOMATIK: " +
        "analizde kritik şerh çıktığında büro avukatlarına bildirim düşer. Kip değişikliği " +
        "denetim izine yazılır; açma PARTNER+ yetkisidir.",
    };
  }

  /** PUT /contracts/:id/notify-setting */
  async setNotifyMode(user: AuthUser, contractId: string, input: SetNotifyModeInput) {
    assertCanSetNotifyMode(user);
    await this.assertContract(user, contractId);

    const setting = await this.prisma.client.contractNotifySetting.upsert({
      where: { contractId },
      create: {
        tenantId: user.tenantId,
        contractId,
        mode: input.mode,
        updatedBy: user.userId,
      },
      update: { mode: input.mode, updatedBy: user.userId },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_NOTIFY_MODE_SET",
      entity: "ContractNotifySetting",
      entityId: setting.id,
      detail: `sözleşme=${contractId} kip=${input.mode}`,
    });

    return { contractId, mode: setting.mode };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  /** Tenant süzgeçli sözleşme varlık denetimi. */
  private async assertContract(user: AuthUser, contractId: string) {
    const found = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("Sözleşme bulunamadı.");
  }

  /** Şiddet × durum kırılımı — tek sorgu, Liste/güncel skorun kaynağı. */
  private async annotationCounts(tenantId: string, contractId: string) {
    const rows = await this.prisma.client.contractClauseAnnotation.groupBy({
      by: ["status", "severity"],
      where: { tenantId, contractId },
      _count: { _all: true },
    });
    const counts = {
      ACIK: { KRITIK: 0, ORTA: 0, DUSUK: 0 },
      KAPALI: { KRITIK: 0, ORTA: 0, DUSUK: 0 },
      SUPERSEDED: { KRITIK: 0, ORTA: 0, DUSUK: 0 },
    };
    for (const row of rows) {
      counts[row.status][row.severity] = row._count._all;
    }
    return counts;
  }

  /** KRİTİK şerh varlığında büro avukatlarına bildirim düşürür (dedupe'li). */
  private async notifyLawyersOfCritical(
    user: AuthUser,
    contractId: string,
    contractTitle: string,
    runId: string,
  ): Promise<number> {
    const lawyers = await this.prisma.client.user.findMany({
      where: { tenantId: user.tenantId, isActive: true, role: { in: ROLE_SETS.HUKUKI } },
      select: { id: true },
    });
    let notified = 0;
    for (const lawyer of lawyers) {
      const outcome = await this.outbox.enqueue({
        tenantId: user.tenantId,
        userId: lawyer.id,
        kind: "SOZLESME_KRITIK_SHERH",
        title: `Kritik sözleşme şerhi: ${contractTitle}`,
        body:
          "Sözleşme analizinde KRİTİK şerh açıldı. Sözleşme Analizi ekranından şerhi " +
          "inceleyin; müvekkile bildirim için 'Müvekkile Bildir' eylemini kullanın.",
        resourceType: "Contract",
        resourceId: contractId,
        dedupeKey: `${NOTIFY_DEDUPE_PREFIX}:${runId}:${lawyer.id}`,
      });
      if (outcome === "yazildi") notified += 1;
    }
    return notified;
  }

  /** Müvekkil portalı özet metni — DETERMİNİSTİK, AI'sız. */
  private buildClientSummary(
    contractTitle: string,
    annotations: AnnotationJson[],
    note: string | null,
  ): string {
    const critical = annotations.filter((a) => a.severity === "KRITIK");
    const others = annotations.filter((a) => a.severity !== "KRITIK");
    const lines: string[] = [
      `SÖZLEŞME İNCELEME ÖZETİ — ${contractTitle}`,
      "",
      `Sözleşmeniz incelenmiş olup ${critical.length} kritik husus tespit edilmiştir. ` +
        "Aşağıdaki hususların çözümlenmeden sözleşmenin imzalanmaması önerilir.",
      "",
      "KRİTİK HUSUSLAR:",
    ];
    critical.forEach((a, i) => {
      lines.push(
        `${i + 1}. ${a.clauseRef ? `${a.clauseRef} — ` : ""}${a.explanation}`,
      );
      if (a.proposedFix) lines.push(`   Önerilen düzeltme: ${a.proposedFix}`);
    });
    if (others.length > 0) {
      lines.push(
        "",
        `Ayrıca ${others.length} adet orta/low şiddette görüşümüze açık husus bulunmaktadır; ` +
          "detayları avukatınızdan talep edebilirsiniz.",
      );
    }
    lines.push(
      "",
      "Bu özet, sözleşmenin bütünüyle ilgili görüş değildir; yalnızca kritik hususlara " +
        "ilişkindir. Tam değerlendirme için avukatınızla görüşmeniz önerilir.",
    );
    if (note) lines.push("", `AVUKAT NOTU: ${note}`);
    return lines.join("\n");
  }

  /** Sayfa pencereli diff sunumu — yalnızca İSTENEN sayfa dilimi döner. */
  private presentDiff(
    row: {
      id: string;
      versionAId: string;
      versionBId: string;
      addedCount: number;
      removedCount: number;
      changedCount: number;
      pagesJson: string | null;
      createdBy: string;
      createdAt: Date;
    },
    a: { versionNo: number; changeNote: string | null },
    b: { versionNo: number; changeNote: string | null },
    contractId: string,
    input: ContractDiffInput,
  ) {
    const parsed = safeParse(row.pagesJson) as {
      pages?: unknown;
      pageCounts?: { a?: number; b?: number };
      unchangedPages?: number;
    } | null;
    const allPages = Array.isArray(parsed?.pages) ? (parsed?.pages as PageDiffEntry[]) : [];
    const page = resolvePage(
      {
        page: input.page !== undefined ? String(input.page) : undefined,
        limit: input.limit !== undefined ? String(input.limit) : undefined,
      },
      DIFF_PAGE_SIZE,
    );
    const items = allPages.slice(page.skip, page.skip + page.take);

    return {
      id: row.id,
      contractId,
      versionA: { id: row.versionAId, versionNo: a.versionNo, changeNote: a.changeNote },
      versionB: { id: row.versionBId, versionNo: b.versionNo, changeNote: b.changeNote },
      counts: {
        added: row.addedCount,
        removed: row.removedCount,
        changed: row.changedCount,
      },
      pageCounts: {
        a: parsed?.pageCounts?.a ?? null,
        b: parsed?.pageCounts?.b ?? null,
      },
      unchangedPages: parsed?.unchangedPages ?? null,
      pages: paged(items, allPages.length, page),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      method:
        "Sayfa pencereli satır LCS — sunucuda üretildi, denetim izine yazıldı. Değişmeyen " +
        "sayfalar atlanır; yalnızca değişen sayfalar (sayfalanmış) döner.",
    };
  }
}

// ===========================================================================
// Parça bazlı koşu yardımcıları
// ===========================================================================

/** 0..count-1 görevlerini en fazla `concurrency` eşzamanlı işleyen sıralı havuz. */
async function runWithConcurrency(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, async () => {
    while (next < count) {
      const index = next;
      next += 1;
      await task(index);
    }
  });
  await Promise.all(workers);
}

/** KVKK onayı (409) mi, yoksa sıradan bir hata mı — onay akışı balonlaştırılır. */
function isPiiApprovalRequired(err: unknown): boolean {
  if (!(err instanceof ConflictException)) return false;
  const body = err.getResponse();
  return typeof body === "object" && body !== null && "requiresPiiApproval" in body;
}

/**
 * Örtüşen parçalardan gelen tekrar bulguları eler (aynı alıntı = aynı bulgu)
 * ve rank'i yeniden numaralar. Sıra: parça sırası (metin okunuş sırası korunur).
 */
function dedupeFindings(findings: readonly MergedFinding[]): MergedFinding[] {
  const seen = new Set<string>();
  const out: MergedFinding[] = [];
  for (const f of findings) {
    const key = f.quote ? normalizeForQuoteMatch(f.quote) : `${f.title}::${f.clauseRef ?? ""}`;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(f);
  }
  return out.map((f, i) => ({ ...f, rank: i + 1 }));
}

/** Koşu kaydındaki parça künyesinin özeti (liste/detay uçlarında gösterilir). */
function chunkSummaryOf(chunkStatsJson: string | null): {
  count: number;
  ok: number;
  failed: number;
  pages: number;
} | null {
  const parsed = safeParse(chunkStatsJson) as {
    chunkCount?: number;
    okCount?: number;
    failCount?: number;
    pageCount?: number;
  } | null;
  if (!parsed || typeof parsed.chunkCount !== "number") return null;
  return {
    count: parsed.chunkCount,
    ok: parsed.okCount ?? 0,
    failed: parsed.failCount ?? 0,
    pages: parsed.pageCount ?? 0,
  };
}

/** Şerhin JSON gösterimi (liste/detay uçlarında kullanılır). */
function toAnnotationJson(a: {
  id: string;
  runId: string;
  clauseRef: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  severity: "KRITIK" | "ORTA" | "DUSUK";
  explanation: string;
  quote: string | null;
  proposedFix: string | null;
  status: "ACIK" | "KAPALI" | "SUPERSEDED";
  closedBy: string | null;
  closedAt: Date | null;
  closeNote: string | null;
  createdBy: string;
  createdAt: Date;
}): AnnotationJson {
  return {
    id: a.id,
    runId: a.runId,
    clauseRef: a.clauseRef,
    pageFrom: a.pageFrom,
    pageTo: a.pageTo,
    severity: a.severity,
    explanation: a.explanation,
    quote: a.quote,
    proposedFix: a.proposedFix,
    status: a.status,
    closedAt: a.closedAt,
    closeNote: a.closeNote,
    createdAt: a.createdAt,
  };
}

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return { parseError: "Kayıt okunamadı (bozuk JSON).", raw: json.slice(0, 500) };
  }
}
