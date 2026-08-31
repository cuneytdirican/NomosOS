/**
 * RİSK MOTORU (Modül 17) — HİBRİT SKOR.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ FORMÜL:  finalScore = clamp(kuralTabanı + aiDüzeltmesi, 0, 100)          ║
 * ║ BANT:    bandOf(kuralTabanı)  ← AI BURAYA HİÇ DOKUNAMAZ                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * AI'IN SINIRLANDIĞI DÖRT YER:
 *  1. ±25 KIRPMA. `RiskAdjustmentSchema` şema düzeyinde sınırlar,
 *     `applyAiAdjustment` koşum düzeyinde bir kez daha kırpar. Şemayı atlatan
 *     bir yol kalmaz; kırpıldığı `adjustmentClamped` ile raporlanır.
 *  2. BANDA DOKUNAMAZ. Kural tabanı ile AI'nin işaret ettiği skor farklı
 *     bantlara düşse bile bant kural tabanından gelir; fark "dikkat" notu
 *     olarak kayda ve yanıta yazılır.
 *  3. REFERANSSIZ DÜZELTME ELENİR. `findingPaths: ["adjustments"]` ile
 *     kaynağı olmayan satırlar output-guard tarafından atılır (iş kuralı 8).
 *  4. GENEL SKORU AI'DEN İSTENMEZ. GENEL yalnızca yedi boyutun kural
 *     tabanlarından türetilir; AI'nin GENEL'e etkisi, boyutlara uygulanan
 *     düzeltmelerin ağırlıklı ortalamasından ibarettir (iş kuralı 5).
 *
 * AI'SIZ DA ÇALIŞIR: sağlayıcı tanımlı değilse veya çağrı düşerse deterministik
 * skorlar YİNE YAZILIR ve uyarı döner — "skorsuz dosya kalmaz" (iş kuralı 9).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type CaseStatus, type RiskBand, type RiskDimension } from "@nomosos/db";
import {
  buildRiskAssessMessages,
  RiskAssessOutputSchema,
  type RiskDimension as AiRiskDimension,
} from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { creditRunContext } from "../credits/credit-context";
import { CaseContextBuilder } from "../assistant/case-context.builder";
import { parseDateParam, parseRangeEnd } from "../common/dates";
import { paged, resolvePage } from "../common/pagination";
import { assertRole, hasRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import type { ComputeRiskInput, OverrideRiskInput } from "./risk.dto";
import {
  applyAiAdjustment,
  BAND_LABELS,
  BAND_THRESHOLDS,
  computeAllDimensions,
  computeGenel,
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
  MAX_AI_ADJUSTMENT,
  SCORED_DIMENSIONS,
  type DimensionResult,
  type RiskCaseSnapshot,
  type RiskSignal,
} from "./risk.rules";

type ScoredDimension = Exclude<RiskDimension, "GENEL">;

/** legal-ai boyut adları ↔ veritabanı boyut adları. */
const AI_TO_DB: Record<AiRiskDimension, ScoredDimension> = {
  LEGAL: "HUKUKI",
  DEADLINE: "SURE",
  EVIDENCE: "DELIL",
  COLLECTION: "TAHSILAT",
  PROCEDURE: "USUL",
  PRECEDENT: "ICTIHAT",
  OPPONENT: "KARSI_TARAF",
};
const DB_TO_AI = Object.fromEntries(
  Object.entries(AI_TO_DB).map(([ai, db]) => [db, ai]),
) as Record<ScoredDimension, AiRiskDimension>;

const CONTEXT_TOKEN_BUDGET = 4000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ADVISORY =
  "Risk skoru bir ÖNERİDİR; hukuki veya mali garanti değildir. Taban skor dosyadaki kayıtlı " +
  "verilerden DETERMİNİSTİK olarak hesaplanır. Yapay zekânın etkisi boyut başına en çok " +
  `±${MAX_AI_ADJUSTMENT} puandır ve RİSK BANDINI DEĞİŞTİREMEZ.`;

interface AiAdjustmentRow {
  dimension: ScoredDimension;
  adjustment: number;
  reason: string;
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiRunnerService,
    private readonly context: CaseContextBuilder,
  ) {}

  // ================================================================== //
  // POST /cases/:caseId/risk/compute
  // ================================================================== //

  async compute(user: AuthUser, caseId: string, input: ComputeRiskInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "risk skoru hesaplama");
    const snapshot = await this.loadSnapshot(user.tenantId, caseId);

    // ---- 1) DETERMİNİSTİK TABAN (AI görmeden) ---------------------------
    const dimensions = computeAllDimensions(snapshot);

    // ---- 2) AI DEĞERLENDİRMESİ (sınırlı, opsiyonel) ---------------------
    const warnings: string[] = dimensions.flatMap((d) =>
      d.warnings.map((w) => `[${DIMENSION_LABELS[d.dimension]}] ${w}`),
    );
    let aiRows: AiAdjustmentRow[] = [];
    let aiModel: string | null = null;
    let aiNotes: string | null = null;
    let aiDropped: unknown[] = [];
    let aiUsed = false;

    if (input.useAi !== false) {
      const outcome = await this.runAssessment(user, caseId, dimensions, input.piiApproved);
      if (outcome.ok) {
        aiRows = outcome.rows;
        aiModel = outcome.model;
        aiNotes = outcome.notes;
        aiDropped = outcome.dropped;
        aiUsed = true;
      } else {
        warnings.push(outcome.warning);
      }
    } else {
      warnings.push(
        "Yapay zekâ değerlendirmesi bu koşuda istenmedi (useAi=false); skorlar yalnızca " +
          "deterministik kural sinyallerinden hesaplandı.",
      );
    }

    const aiByDimension = new Map<ScoredDimension, AiAdjustmentRow>(
      aiRows.map((r) => [r.dimension, r] as const),
    );

    // ---- 3) HİBRİT BİRLEŞTİRME ------------------------------------------
    const applied = new Map<ScoredDimension, number>();
    const computedRows = dimensions.map((dim) => {
      const suggestion = aiByDimension.get(dim.dimension);
      const outcome = applyAiAdjustment(dim.baseScore, suggestion?.adjustment);
      applied.set(dim.dimension, outcome.applied);
      return { dim, suggestion, outcome };
    });

    const genel = computeGenel(dimensions, applied);
    const genelFinal = Math.max(0, Math.min(100, genel.baseScore + genel.aiAdjustment));

    // ---- 4) KAYIT: güncel skor (upsert) + geçmiş (append-only) ----------
    const now = new Date();
    const persistRows: {
      dimension: RiskDimension;
      score: number;
      /**
       * Deterministik taban SAKLANIR, türetilmez. `score - aiAdjustment` ile
       * geri hesaplamak, 0-100 kırpması devreye girdiğinde yanlış sonuç verir:
       * taban 85 + AI +25 → saklanan skor 100, geri hesaplanan taban 75.
       * Avukat override kararını bu ekrandaki tabana bakarak verir.
       */
      baseScore: number;
      band: RiskBand;
      ruleSignalsJson: string;
      aiAdjustment: number | null;
      aiCommentary: string | null;
    }[] = computedRows.map(({ dim, suggestion, outcome }) => ({
      dimension: dim.dimension,
      score: outcome.finalScore,
      baseScore: dim.baseScore,
      // BANT DAİMA KURAL TABANINDAN.
      band: outcome.band,
      ruleSignalsJson: JSON.stringify(dim.signals),
      aiAdjustment: aiUsed ? outcome.applied : null,
      aiCommentary: buildCommentary(suggestion?.reason, outcome.bandConflictNote),
    }));

    persistRows.push({
      dimension: "GENEL",
      score: genelFinal,
      baseScore: genel.baseScore,
      band: genel.band,
      ruleSignalsJson: JSON.stringify(genel.signals),
      aiAdjustment: aiUsed ? genel.aiAdjustment : null,
      aiCommentary:
        "GENEL skor yalnızca yedi boyutun KURAL TABANLARININ ağırlıklı ortalamasıdır; " +
        "yapay zekâdan ayrıca istenmez ve doğrudan yazılamaz.",
    });

    await this.prisma.client.$transaction([
      ...persistRows.map((row) =>
        this.prisma.client.riskScore.upsert({
          where: { caseId_dimension: { caseId, dimension: row.dimension } },
          create: {
            tenantId: user.tenantId,
            caseId,
            dimension: row.dimension,
            score: row.score,
            baseScore: row.baseScore,
            band: row.band,
            ruleSignalsJson: row.ruleSignalsJson,
            aiAdjustment: row.aiAdjustment,
            aiCommentary: row.aiCommentary,
            model: aiModel,
            computedAt: now,
            computedBy: user.userId,
          },
          update: {
            score: row.score,
            baseScore: row.baseScore,
            band: row.band,
            ruleSignalsJson: row.ruleSignalsJson,
            aiAdjustment: row.aiAdjustment,
            aiCommentary: row.aiCommentary,
            model: aiModel,
            computedAt: now,
            computedBy: user.userId,
          },
        }),
      ),
      // Geçmiş APPEND-ONLY: güncellenmez, silinmez.
      this.prisma.client.riskScoreHistory.createMany({
        data: persistRows.map((row) => ({
          tenantId: user.tenantId,
          caseId,
          dimension: row.dimension,
          score: row.score,
          baseScore: row.baseScore,
          band: row.band,
          ruleSignalsJson: row.ruleSignalsJson,
          aiAdjustment: row.aiAdjustment,
          computedAt: now,
        })),
      }),
    ]);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "RISK_COMPUTE",
      entity: "Case",
      entityId: caseId,
      detail:
        `genel=${genelFinal} (taban ${genel.baseScore}/${genel.band}) ai=${aiUsed ? aiModel : "kullanılmadı"} ` +
        computedRows
          .map((r) => `${r.dim.dimension}:${r.dim.baseScore}${signed(r.outcome.applied)}=${r.outcome.finalScore}`)
          .join(" "),
    });

    // ---- 5) Yanıt --------------------------------------------------------
    const overrides = await this.activeOverrides(user.tenantId, caseId);

    return {
      caseId,
      computedAt: now,
      formula: {
        description: "finalScore = clamp(kuralTabanı + aiDüzeltmesi, 0, 100)",
        bandSource: "KURAL_TABANI",
        bandThresholds: BAND_THRESHOLDS,
        maxAiAdjustment: MAX_AI_ADJUSTMENT,
        dimensionWeights: DIMENSION_WEIGHTS,
        note:
          "Bant DAİMA kural tabanından türetilir. Yapay zekâ düzeltmesi gösterilen skoru " +
          "oynatabilir ancak bandı değiştiremez; iki taraf farklı banda işaret ediyorsa fark " +
          "bir «dikkat» notu olarak kayda geçer.",
      },
      overall: {
        dimension: "GENEL" as const,
        label: DIMENSION_LABELS.GENEL,
        baseScore: genel.baseScore,
        aiAdjustment: aiUsed ? genel.aiAdjustment : null,
        score: genelFinal,
        band: genel.band,
        bandLabel: BAND_LABELS[genel.band],
        override: overrides.get("GENEL") ?? null,
        signals: genel.signals,
      },
      dimensions: computedRows.map(({ dim, suggestion, outcome }) =>
        this.serializeComputed(dim, suggestion, outcome, overrides.get(dim.dimension) ?? null, aiUsed),
      ),
      ai: {
        used: aiUsed,
        model: aiModel,
        notes: aiNotes,
        /** Kaynak göstermediği için elenen düzeltmeler — şeffaflık. */
        droppedFindings: aiDropped,
        limits: {
          maxAdjustment: MAX_AI_ADJUSTMENT,
          canChangeBand: false,
          canWriteOverall: false,
        },
      },
      warnings,
      advisory: ADVISORY,
    };
  }

  // ================================================================== //
  // GET /cases/:caseId/risk
  // ================================================================== //

  async get(user: AuthUser, caseId: string) {
    await this.assertCase(user.tenantId, caseId);
    const [rows, overrides] = await Promise.all([
      this.prisma.client.riskScore.findMany({
        where: { tenantId: user.tenantId, caseId },
      }),
      this.activeOverrides(user.tenantId, caseId),
    ]);

    if (rows.length === 0) {
      return {
        caseId,
        computed: false,
        message:
          "Bu dosya için henüz risk hesabı yapılmamış. POST /cases/:caseId/risk/compute ile " +
          "hesaplayın.",
        dimensions: [],
        overall: null,
        advisory: ADVISORY,
      };
    }

    const byDimension = new Map(rows.map((r) => [r.dimension, r] as const));
    const overall = byDimension.get("GENEL");

    return {
      caseId,
      computed: true,
      computedAt: rows.reduce<Date>(
        (acc, r) => (r.computedAt > acc ? r.computedAt : acc),
        rows[0].computedAt,
      ),
      formula: {
        description: "finalScore = clamp(kuralTabanı + aiDüzeltmesi, 0, 100)",
        bandSource: "KURAL_TABANI",
        bandThresholds: BAND_THRESHOLDS,
        maxAiAdjustment: MAX_AI_ADJUSTMENT,
        dimensionWeights: DIMENSION_WEIGHTS,
      },
      overall: overall ? this.serializeStored(overall, overrides.get("GENEL") ?? null) : null,
      dimensions: SCORED_DIMENSIONS.map((dimension) => {
        const row = byDimension.get(dimension);
        return row
          ? this.serializeStored(row, overrides.get(dimension) ?? null)
          : {
              dimension,
              label: DIMENSION_LABELS[dimension],
              computed: false,
              note: "Bu boyut henüz hesaplanmadı.",
            };
      }),
      advisory: ADVISORY,
    };
  }

  // ================================================================== //
  // GET /cases/:caseId/risk/history
  // ================================================================== //

  async history(
    user: AuthUser,
    caseId: string,
    query: { dimension?: string; from?: string; to?: string; page?: string; limit?: string },
  ) {
    await this.assertCase(user.tenantId, caseId);
    const page = resolvePage(query, 200);

    const dimension = query.dimension as RiskDimension | undefined;
    if (dimension && !isDimension(dimension)) {
      throw new BadRequestException("Geçersiz risk boyutu.");
    }

    const where: Prisma.RiskScoreHistoryWhereInput = {
      tenantId: user.tenantId,
      caseId,
      ...(dimension ? { dimension } : {}),
      ...(query.from || query.to
        ? {
            computedAt: {
              ...(query.from ? { gte: parseDateParam(query.from, "from") } : {}),
              ...(query.to ? { lte: parseRangeEnd(query.to, "to") } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.riskScoreHistory.findMany({
        where,
        orderBy: { computedAt: "asc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          dimension: true,
          score: true,
          band: true,
          aiAdjustment: true,
          computedAt: true,
        },
      }),
      this.prisma.client.riskScoreHistory.count({ where }),
    ]);

    return {
      ...paged(
        rows.map((r) => ({
          ...r,
          label: DIMENSION_LABELS[r.dimension],
          bandLabel: BAND_LABELS[r.band],
        })),
        total,
        page,
      ),
      note:
        "Risk geçmişi APPEND-ONLY'dir: hiçbir kayıt güncellenmez veya silinmez. Her hesap, " +
        "o anki 8 satırı (7 boyut + GENEL) geçmişe ekler.",
    };
  }

  // ================================================================== //
  // GET /risk/office — büro geneli riskli dosyalar
  // ================================================================== //

  async office(
    user: AuthUser,
    query: {
      band?: string;
      dimension?: string;
      assigneeId?: string;
      status?: string;
      page?: string;
      limit?: string;
    },
  ) {
    // Risk listesi tüm dosyaların hukuki durumunu gösterir; sekreter ve stajyer
    // için ayrı bir portföy görünümü yoktur.
    assertRole(user, ROLE_SETS.HUKUKI, "büro risk listesini görüntüleme");
    const page = resolvePage(query, 50);

    const dimension = (query.dimension as RiskDimension | undefined) ?? "GENEL";
    if (!isDimension(dimension)) throw new BadRequestException("Geçersiz risk boyutu.");
    if (query.band && !["DUSUK", "ORTA", "YUKSEK"].includes(query.band)) {
      throw new BadRequestException("Geçersiz risk bandı (DUSUK / ORTA / YUKSEK).");
    }
    if (query.status && !isCaseStatus(query.status)) {
      throw new BadRequestException(
        `Geçersiz dosya durumu. Geçerli değerler: ${CASE_STATUSES.join(", ")}.`,
      );
    }
    const caseStatus = query.status ? (query.status as CaseStatus) : undefined;

    /**
     * YETKİ: PARTNER ve ADMIN tüm dosyaları görür; AVUKAT yalnızca sorumlusu
     * olduğu dosyaları (Modül 17, iş kuralı 8). `assigneeId` süzgeci AVUKAT
     * için kendi kimliğinden başkasına genişletilemez.
     */
    const seesAll = hasRole(user, ROLE_SETS.ONAY);
    if (!seesAll && query.assigneeId && query.assigneeId !== user.userId) {
      throw new ForbiddenException(
        "Avukat rolü yalnızca kendi sorumluluğundaki dosyaların risk listesini görebilir.",
      );
    }
    const responsibleUserId = seesAll ? query.assigneeId : user.userId;

    const where: Prisma.RiskScoreWhereInput = {
      tenantId: user.tenantId,
      dimension,
      ...(query.band ? { band: query.band as RiskBand } : {}),
      case: {
        ...(responsibleUserId ? { responsibleUserId } : {}),
        ...(caseStatus ? { status: caseStatus } : {}),
      },
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.riskScore.findMany({
        where,
        orderBy: [{ score: "desc" }, { computedAt: "desc" }],
        skip: page.skip,
        take: page.take,
        include: {
          case: {
            select: {
              id: true,
              title: true,
              fileNumber: true,
              type: true,
              status: true,
              responsibleUserId: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.client.riskScore.count({ where }),
    ]);

    // En baskın boyut: aynı dosyalar için diğer boyutların en yüksek skorlusu.
    const caseIds = rows.map((r) => r.caseId);
    const others = caseIds.length
      ? await this.prisma.client.riskScore.findMany({
          where: { tenantId: user.tenantId, caseId: { in: caseIds }, dimension: { not: "GENEL" } },
          select: { caseId: true, dimension: true, score: true, band: true },
        })
      : [];
    const dominant = new Map<string, { dimension: RiskDimension; score: number; band: RiskBand }>();
    for (const row of others) {
      const current = dominant.get(row.caseId);
      if (!current || row.score > current.score) {
        dominant.set(row.caseId, { dimension: row.dimension, score: row.score, band: row.band });
      }
    }

    const overrides = await this.prisma.client.riskOverride.findMany({
      where: {
        tenantId: user.tenantId,
        caseId: { in: caseIds.length ? caseIds : ["-"] },
        dimension,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });
    const overrideByCase = new Map<string, (typeof overrides)[number]>();
    for (const o of overrides) if (!overrideByCase.has(o.caseId)) overrideByCase.set(o.caseId, o);

    return {
      ...paged(
        rows.map((row) => {
          const override = overrideByCase.get(row.caseId);
          const top = dominant.get(row.caseId);
          return {
            caseId: row.caseId,
            caseTitle: row.case.title,
            caseFileNumber: row.case.fileNumber,
            caseType: row.case.type,
            caseStatus: row.case.status,
            clientId: row.case.client.id,
            clientName: row.case.client.name,
            responsibleUserId: row.case.responsibleUserId,
            dimension: row.dimension,
            dimensionLabel: DIMENSION_LABELS[row.dimension],
            score: row.score,
            band: override ? override.band : row.band,
            bandLabel: BAND_LABELS[override ? override.band : row.band],
            computedBand: row.band,
            manuallyOverridden: Boolean(override),
            overrideReason: override?.reason ?? null,
            aiAdjustment: row.aiAdjustment,
            dominantDimension: top
              ? {
                  dimension: top.dimension,
                  label: DIMENSION_LABELS[top.dimension],
                  score: top.score,
                  band: top.band,
                }
              : null,
            computedAt: row.computedAt,
          };
        }),
        total,
        page,
      ),
      filters: { dimension, band: query.band ?? null, responsibleUserId: responsibleUserId ?? null },
      scope: seesAll ? "TUM_BURO" : "KENDI_DOSYALARIM",
      advisory: ADVISORY,
    };
  }

  // ================================================================== //
  // Override — GEREKÇE ZORUNLU
  // ================================================================== //

  /** POST /cases/:caseId/risk/override */
  async override(user: AuthUser, caseId: string, input: OverrideRiskInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "risk bandını elle ayarlama");
    await this.assertCase(user.tenantId, caseId);

    const computed = await this.prisma.client.riskScore.findFirst({
      where: { tenantId: user.tenantId, caseId, dimension: input.dimension },
      select: { score: true, band: true },
    });

    const record = await this.prisma.client.riskOverride.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        dimension: input.dimension,
        band: input.band,
        reason: input.reason.trim(),
        createdBy: user.userId,
        expiresAt: input.expiresAt ?? null,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "RISK_OVERRIDE",
      entity: "Case",
      entityId: caseId,
      detail:
        `boyut=${input.dimension} hesaplanan=${computed?.band ?? "yok"} → elle=${input.band} · ` +
        `gerekçe: ${input.reason.trim().slice(0, 200)}`,
    });

    return {
      id: record.id,
      caseId,
      dimension: record.dimension,
      dimensionLabel: DIMENSION_LABELS[record.dimension],
      band: record.band,
      bandLabel: BAND_LABELS[record.band],
      reason: record.reason,
      expiresAt: record.expiresAt,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      computedBand: computed?.band ?? null,
      computedScore: computed?.score ?? null,
      note:
        "Bant elle ayarlandı. Hesaplanan skor DEĞİŞMEDİ ve geçmişte olduğu gibi durur; " +
        "arayüzde bu boyut «elle ayarlandı» rozetiyle görünür. Override kaldırıldığında " +
        "veya süresi dolduğunda hesaplanan bant yeniden geçerli olur.",
    };
  }

  /** DELETE /cases/:caseId/risk/override/:dimension */
  async clearOverride(user: AuthUser, caseId: string, dimensionParam: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "risk override kaldırma");
    await this.assertCase(user.tenantId, caseId);
    const dimension = dimensionParam as RiskDimension;
    if (!isDimension(dimension)) throw new BadRequestException("Geçersiz risk boyutu.");

    const now = new Date();
    const active = await this.prisma.client.riskOverride.findMany({
      where: {
        tenantId: user.tenantId,
        caseId,
        dimension,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (active.length === 0) {
      throw new NotFoundException("Bu boyutta etkin bir elle ayar bulunmuyor.");
    }

    /**
     * Kayıt SİLİNMEZ, süresi doldurulur.
     *
     * Override bir hukuki beyandır ("bu bandı şu gerekçeyle değiştirdim");
     * silinirse gerekçe de kaybolur ve denetim izi kopar.
     */
    await this.prisma.client.riskOverride.updateMany({
      where: { id: { in: active.map((a) => a.id) } },
      data: { expiresAt: now },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "RISK_OVERRIDE_CLEAR",
      entity: "Case",
      entityId: caseId,
      detail: `boyut=${dimension} kaldırılan=${active.length}`,
    });

    return {
      cleared: active.length,
      dimension,
      note:
        "Elle ayar kaldırıldı (kayıt silinmedi, geçerliliği sonlandırıldı). Bu boyutta " +
        "hesaplanan bant yeniden geçerlidir.",
    };
  }

  // ================================================================== //
  // AI koşusu
  // ================================================================== //

  private async runAssessment(
    user: AuthUser,
    caseId: string,
    dimensions: readonly DimensionResult[],
    piiApproved: boolean | undefined,
  ): Promise<
    | { ok: true; rows: AiAdjustmentRow[]; model: string; notes: string | null; dropped: unknown[] }
    | { ok: false; warning: string }
  > {
    try {
      const built = await this.context.buildFor(
        user.tenantId,
        caseId,
        "RISK_ASSESS",
        CONTEXT_TOKEN_BUDGET,
      );

      // Modele KURAL SİNYALLERİ "zaten puanlandı" diye verilir; çifte sayım
      // prompt düzeyinde de yasaklanır.
      const ruleSignals = dimensions.flatMap((d) =>
        d.signals
          .filter((s) => s.contribution > 0)
          .map((s) => ({
            dimension: DB_TO_AI[d.dimension],
            description: `${s.label}: ${s.value}`,
            points: s.contribution,
          })),
      );
      const simulationFindings = await this.recentSimulationHeadlines(user.tenantId, caseId);

      const run = await this.ai.run({
        user,
        taskType: "RISK_ASSESS",
        outboundTexts: [built.built.text],
        piiApproved,
        schema: RiskAssessOutputSchema,
        // (3) Referanssız düzeltmeler ELENİR.
        findingPaths: ["adjustments"],
        entity: "Case",
        entityId: caseId,
        maxTokens: 2048,
        buildMessages: ([contextText]) =>
          buildRiskAssessMessages({
            ruleSignals,
            caseContextText: contextText,
            simulationFindings,
          }),
      });

      const rows: AiAdjustmentRow[] = run.data.adjustments.map((a) => ({
        dimension: AI_TO_DB[a.dimension],
        adjustment: a.adjustment,
        reason: a.reason,
      }));

      return {
        ok: true,
        rows,
        model: run.model,
        notes: run.data.notes ?? null,
        dropped: run.droppedFindings,
      };
    } catch (err) {
      // KVKK onayı (409) İSTİSNADIR: avukatın maskeli metni onaylaması gerekir,
      // sessizce AI'sız devam etmek bu kararı gizlerdi.
      if (err instanceof ConflictException) throw err;
      // HATA YUTULUYOR → UÇ 200 DÖNECEK (skorsuz dosya kalmaz) → interceptor
      // BAŞARI görecek. Kredi kaydı düşürülmezse, "AI değerlendirmesi
      // yapılamadı" diyen bir yanıt için 15 kredi tam olarak tahsil edilirdi
      // (iş kuralı 4 ihlali). Bu uç TEK sağlayıcı çağrısı yapar.
      creditRunContext.discard();
      const message = err instanceof Error ? err.message : "bilinmeyen hata";
      this.logger.warn(`RISK_ASSESS koşusu başarısız (caseId=${caseId}): ${message}`);
      return {
        ok: false,
        warning:
          "Yapay zekâ değerlendirmesi yapılamadı; skorlar YALNIZCA deterministik kural " +
          `sinyallerinden hesaplandı (dosya skorsuz kalmadı). Neden: ${message}`,
      };
    }
  }

  /** Son 30 gündeki risk odaklı simülasyon bulgularının başlıkları. */
  private async recentSimulationHeadlines(tenantId: string, caseId: string): Promise<string[]> {
    const since = new Date(Date.now() - 30 * MS_PER_DAY);
    const runs = await this.prisma.client.simulationRun.findMany({
      where: {
        tenantId,
        caseId,
        mode: { in: ["KAYBETTIREN_HUSUSLAR", "HAKIM_GOZU"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { mode: true, outputJson: true },
    });
    const lines: string[] = [];
    for (const run of runs) {
      for (const title of extractFindingTitles(run.outputJson)) {
        lines.push(`[${run.mode}] ${title}`);
        if (lines.length >= 12) return lines;
      }
    }
    return lines;
  }

  // ================================================================== //
  // Anlık görüntü
  // ================================================================== //

  /**
   * Görünüm public'e alındı (F2 · E2): gece risk işi (`RiskNightlyService`) aynı
   * anlık görüntüyü KOPYALAMADAN kullanır — iki farklı "doğru" olmaz.
   */
  async loadSnapshot(tenantId: string, caseId: string): Promise<RiskCaseSnapshot> {
    const kase = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      include: {
        parties: { select: { role: true, isClient: true, lawyerName: true } },
        deadlines: { select: { status: true, dueDate: true, title: true } },
        hearings: { select: { status: true, date: true } },
        documents: {
          select: { class: true, ocrStatus: true, chunkStatus: true, createdAt: true },
        },
        timelineEvents: { select: { date: true }, orderBy: { date: "desc" }, take: 200 },
        decisions: { select: { type: true, outcome: true, date: true } },
        caseLawRefs: { select: { status: true } },
        enforcementFile: {
          select: {
            id: true,
            objectionDate: true,
            stage: true,
            actions: { select: { type: true } },
            scores: { orderBy: { computedAt: "desc" }, take: 1, select: { score: true } },
          },
        },
      },
    });
    if (!kase) throw new NotFoundException("Dosya bulunamadı.");

    const [poaCount, claims, evidences, strategy, financialEntries, feeAgreementCount, unverified] =
      await Promise.all([
        this.prisma.client.powerOfAttorney.count({ where: { tenantId, caseId } }),
        this.prisma.client.claim.findMany({
          where: { tenantId, caseId },
          select: { side: true, status: true, _count: { select: { evidenceLinks: true } } },
        }),
        this.prisma.client.evidence.findMany({
          where: { tenantId, caseId },
          select: { status: true, _count: { select: { claimLinks: true } } },
        }),
        this.prisma.client.strategy.findFirst({
          where: { tenantId, caseId },
          select: { id: true, status: true },
        }),
        this.prisma.client.financialEntry.findMany({
          where: { tenantId, caseId },
          select: { type: true, amount: true },
        }),
        this.prisma.client.feeAgreement.count({ where: { tenantId, caseId } }),
        this.countUnverifiedCitations(tenantId, caseId),
      ]);

    const strategyNodes = strategy
      ? await this.prisma.client.strategyNode.groupBy({
          by: ["nodeType"],
          where: { tenantId, strategyId: strategy.id },
          _count: { _all: true },
        })
      : [];
    const nodeCount = (type: string): number =>
      strategyNodes.find((n) => n.nodeType === type)?._count._all ?? 0;

    const since = new Date(Date.now() - 30 * MS_PER_DAY);
    const recentRuns = await this.prisma.client.simulationRun.findMany({
      where: {
        tenantId,
        caseId,
        mode: { in: ["KAYBETTIREN_HUSUSLAR", "HAKIM_GOZU"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { outputJson: true },
    });
    const recentLossFindingCount = recentRuns.reduce(
      (acc, r) => acc + extractFindingTitles(r.outputJson).length,
      0,
    );

    // PARA: Decimal ile toplanır, float aritmetiği YASAK (ortak karar 5).
    const BILLED_TYPES = new Set(["TAHAKKUK", "VEKALET_UCRETI", "DANISMANLIK", "MASRAF", "HARC"]);
    const COLLECTED_TYPES = new Set(["TAHSILAT", "AVANS"]);
    let billed = new Prisma.Decimal(0);
    let collected = new Prisma.Decimal(0);
    for (const entry of financialEntries) {
      const amount = new Prisma.Decimal(entry.amount);
      if (BILLED_TYPES.has(entry.type)) billed = billed.plus(amount);
      else if (COLLECTED_TYPES.has(entry.type)) collected = collected.plus(amount);
      else if (entry.type === "IADE") collected = collected.minus(amount);
    }

    const enforcement = kase.enforcementFile;
    const objectionActions = enforcement?.actions.filter((a) => a.type === "ITIRAZ").length ?? 0;
    const objectionResolved =
      (enforcement?.actions.some((a) => a.type === "ITIRAZIN_IPTALI") ?? false) ||
      ["KESINLESME", "HACIZ", "SATIS", "TAHSILAT"].includes(enforcement?.stage ?? "");

    return {
      now: new Date(),
      kase: {
        id: kase.id,
        type: kase.type,
        status: kase.status,
        openedAt: kase.openedAt,
        lastActivityAt: kase.lastActivityAt,
        responsibleUserId: kase.responsibleUserId,
      },
      deadlines: kase.deadlines,
      hearings: kase.hearings,
      documents: kase.documents,
      timelineEventDates: kase.timelineEvents.map((e) => e.date),
      decisions: kase.decisions,
      powerOfAttorneyCount: poaCount,
      parties: kase.parties,
      caseLawRefs: kase.caseLawRefs,
      unverifiedCitationCount: unverified,
      claims: claims.map((c) => ({
        side: c.side,
        status: c.status,
        evidenceLinkCount: c._count.evidenceLinks,
      })),
      evidences: evidences.map((e) => ({
        status: e.status,
        claimLinkCount: e._count.claimLinks,
      })),
      enforcement: {
        exists: Boolean(enforcement),
        hasOpenObjection:
          Boolean(enforcement) &&
          (enforcement?.objectionDate !== null || objectionActions > 0) &&
          !objectionResolved,
        objectionActionCount: objectionActions,
        latestCollectionScore: enforcement?.scores[0]?.score ?? null,
      },
      finance: {
        billed: billed.toFixed(2),
        collected: collected.toFixed(2),
        hasFeeAgreement: feeAgreementCount > 0,
      },
      strategy: {
        exists: Boolean(strategy),
        status: strategy?.status ?? null,
        weakPointCount: nodeCount("ZAYIF_NOKTA"),
        riskNodeCount: nodeCount("RISK"),
      },
      recentLossFindingCount,
    };
  }

  /** Bu dosyanın dilekçe sürümlerinde doğrulanamamış atıf sayısı. */
  private async countUnverifiedCitations(tenantId: string, caseId: string): Promise<number> {
    const versions = await this.prisma.client.petitionVersion.findMany({
      where: { petition: { tenantId, caseId } },
      select: { id: true },
      take: 200,
    });
    if (versions.length === 0) return 0;
    return this.prisma.client.citationCheck.count({
      where: {
        tenantId,
        sourceType: "PETITION",
        sourceId: { in: versions.map((v) => v.id) },
        status: { not: "DOGRULANDI" },
      },
    });
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  private async activeOverrides(tenantId: string, caseId: string) {
    const rows = await this.prisma.client.riskOverride.findMany({
      where: {
        tenantId,
        caseId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });
    const map = new Map<
      RiskDimension,
      { band: RiskBand; bandLabel: string; reason: string; createdBy: string; createdAt: Date; expiresAt: Date | null }
    >();
    for (const row of rows) {
      if (map.has(row.dimension)) continue;
      map.set(row.dimension, {
        band: row.band,
        bandLabel: BAND_LABELS[row.band],
        reason: row.reason,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      });
    }
    return map;
  }

  private serializeComputed(
    dim: DimensionResult,
    suggestion: AiAdjustmentRow | undefined,
    outcome: ReturnType<typeof applyAiAdjustment>,
    override: { band: RiskBand; bandLabel: string; reason: string } | null,
    aiUsed: boolean,
  ) {
    return {
      dimension: dim.dimension,
      label: DIMENSION_LABELS[dim.dimension],
      baseScore: dim.baseScore,
      score: outcome.finalScore,
      /** Gösterilen bant: elle ayar varsa o, yoksa KURAL TABANINDAN türeyen bant. */
      band: override ? override.band : outcome.band,
      bandLabel: override ? override.bandLabel : BAND_LABELS[outcome.band],
      computedBand: outcome.band,
      bandSource: override ? "ELLE_AYAR" : "KURAL_TABANI",
      manuallyOverridden: Boolean(override),
      overrideReason: override?.reason ?? null,
      ai: aiUsed
        ? {
            requestedAdjustment: outcome.requested,
            appliedAdjustment: outcome.applied,
            clamped: outcome.clamped,
            reason: suggestion?.reason ?? null,
            bandConflictNote: outcome.bandConflictNote,
          }
        : null,
      signals: dim.signals,
      warnings: dim.warnings,
    };
  }

  private serializeStored(
    row: {
      dimension: RiskDimension;
      score: number;
      baseScore: number | null;
      band: RiskBand;
      ruleSignalsJson: string;
      aiAdjustment: number | null;
      aiCommentary: string | null;
      model: string | null;
      computedAt: Date;
      computedBy: string | null;
    },
    override: { band: RiskBand; bandLabel: string; reason: string; createdAt: Date } | null,
  ) {
    const signals = parseSignals(row.ruleSignalsJson);
    /**
     * KURAL TABANI OKUNUR, TÜRETİLMEZ.
     *
     * Eski hâlde taban `clamp(score - aiAdjustment, 0, 100)` ile geri
     * hesaplanıyordu. Bu ters çevirme, `applyAiAdjustment`'taki 0-100 kırpması
     * devreye girdiğinde YANLIŞ sonuç verir: taban 85, AI +25 → saklanan
     * skor 100, aiAdjustment 25 → geri hesaplanan taban 75 (gerçeği 85).
     * `bandExplanation` metni de bu yanlış sayıyı yazıyordu; yani motorun
     * "her puanın nasıl bulunduğu görünür" vaadinin tam kalbinde 10 puanlık
     * bir sapma vardı.
     *
     * `baseScore` sütunu öncesindeki satırlar için eski hesaba düşülür —
     * o satırlar zaten ilk yeniden hesapta gerçek tabanla güncellenir.
     */
    const baseScore =
      row.baseScore ?? Math.max(0, Math.min(100, row.score - (row.aiAdjustment ?? 0)));
    const baseScoreSource = row.baseScore === null ? "GERI_HESAPLANDI" : "KAYITLI";
    return {
      dimension: row.dimension,
      label: DIMENSION_LABELS[row.dimension],
      computed: true,
      score: row.score,
      baseScore,
      /** "KAYITLI" = hesaplandığı anda yazıldı · "GERI_HESAPLANDI" = eski satır. */
      baseScoreSource,
      aiAdjustment: row.aiAdjustment,
      band: override ? override.band : row.band,
      bandLabel: override ? override.bandLabel : BAND_LABELS[row.band],
      computedBand: row.band,
      bandSource: override ? "ELLE_AYAR" : "KURAL_TABANI",
      manuallyOverridden: Boolean(override),
      overrideReason: override?.reason ?? null,
      overriddenAt: override?.createdAt ?? null,
      /**
       * SKOR İLE BANT GÖRÜNÜRDE ÇELİŞEBİLİR (ör. taban 39/DUSUK + AI +25 → skor 64,
       * bant hâlâ DUSUK). Bu bir hata değil, KORUMANIN KENDİSİDİR; üç değer birlikte
       * döner ki bandı skordan yeniden türeten bir tüketici korumayı sessizce
       * kaybetmesin.
       */
      bandExplanation:
        `Kural tabanı: ${baseScore} · AI düzeltmesi: ${signed(row.aiAdjustment ?? 0)} · ` +
        `nihai skor: ${row.score} · bant: ${BAND_LABELS[row.band]} ` +
        "(bant DAİMA kural tabanından türer; AI düzeltmesi bandı değiştiremez)" +
        (override ? ` · Bu boyut ELLE ${override.bandLabel} olarak ayarlanmıştır.` : ""),
      aiCommentary: row.aiCommentary,
      model: row.model,
      signals,
      computedAt: row.computedAt,
      computedBy: row.computedBy,
    };
  }

  private async assertCase(tenantId: string, caseId: string) {
    const kase = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true },
    });
    if (!kase) throw new NotFoundException("Dosya bulunamadı.");
    return kase;
  }
}

/* ------------------------------------------------------------------ *
 * Saf yardımcılar
 * ------------------------------------------------------------------ */

function isDimension(value: string): value is RiskDimension {
  return ["GENEL", ...SCORED_DIMENSIONS].includes(value);
}

/** Büro listesi süzgeci için dosya durumları (Prisma `CaseStatus` ile aynı küme). */
const CASE_STATUSES: readonly string[] = [
  "ACIK",
  "DERDEST",
  "KARAR",
  "ISTINAF",
  "TEMYIZ",
  "KESINLESTI",
  "ICRADA",
  "KAPANDI",
  "ARSIV",
];

function isCaseStatus(value: string): boolean {
  return CASE_STATUSES.includes(value);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function buildCommentary(reason: string | undefined, conflictNote: string | null): string | null {
  const parts = [reason?.trim(), conflictNote].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join("\n") : null;
}

function parseSignals(json: string): RiskSignal[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RiskSignal[]) : [];
  } catch {
    return [];
  }
}

/** Simülasyon çıktısındaki bulgu başlıklarını (mod bağımsız) çıkarır. */
function extractFindingTitles(outputJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputJson) as unknown;
  } catch {
    return [];
  }
  const root =
    typeof parsed === "object" && parsed !== null && "result" in parsed
      ? (parsed as { result: unknown }).result
      : parsed;
  if (typeof root !== "object" || root === null) return [];

  const titles: string[] = [];
  for (const value of Object.values(root as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const title = row.title ?? row.issue ?? row.topic ?? row.item;
      if (typeof title === "string" && title.trim()) titles.push(title.trim());
    }
  }
  return titles;
}
