/**
 * F2 · E2 — GECE RİSK SKORLAMA İŞİ (RiskNightlyService).
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║ ÜRÜN İLKESİ: BU İŞ YAPAY ZEKÂ ÇAĞIRMAZ.                                ║
 * ║ Gece işi yalnızca DETERMİNİSTİK kural sinyallerini yeniden sayar:      ║
 * ║ RiskScore.baseScore/band/ruleSignals tazelenir. Bir önceki AI          ║
 * ║ düzeltmesi (avukatın tetiklediği koşudan) SKOR üzerinde KORUNUR —      ║
 * ║ gece işi yeni bir AI yorumu ÜRETMEZ. AI önerir, avukat onaylar; gece   ║
 * ║ işinin tek işi bayat kural tabanını güncellemektir.                     ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * NE YAPILMAZ:
 *  - RiskOverride SATIRLARINA DOKUNULMAZ: override okuma anında uygulanır
 *    (risk.service.ts serialize*); tabloda kalıcıdır ve gece işi onu ezemez.
 *  - KAPANDI/ARSIV/KESINLESTİ dosyaları hesaplanmaz: kapanmış dosyanın riski
 *    bir daha değişmez, boşuna yazılmaz.
 *
 * FOTOĞRAF: iş sonunda her kiracı için DashboardSnapshot (tenantId, gün)
 * upsert edilir — panel açılışı tek satırdan okur.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { Prisma, RiskDimension } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { RiskService } from "./risk.service";
import {
  applyAiAdjustment,
  computeAllDimensions,
  computeGenel,
} from "./risk.rules";
import { trCalendarDay } from "../common/dates";

/** Gece hesabına giren dosya durumları (aktif takip). */
export const NIGHTLY_ACTIVE_CASE_STATUSES = [
  "ACIK",
  "DERDEST",
  "KARAR",
  "ISTINAF",
  "TEMYIZ",
  "ICRADA",
] as const;

/** Panel fotoğrafında listelenen en riskli dosya sayısı. */
export const DASHBOARD_TOP_CASES = 5;

/** Panel fotoğrafının saf toplama katmanı — birim testi buradan geçer. */
export function buildSnapshotRow(
  cases: {
    caseId: string;
    fileNumber: string | null;
    title: string;
    genelScore: number;
    genelBand: "DUSUK" | "ORTA" | "YUKSEK";
  }[],
): {
  caseCount: number;
  highRiskCount: number;
  avgGenelScore: number | null;
  bandDistributionJson: string;
  topCasesJson: string;
} {
  const bands = { DUSUK: 0, ORTA: 0, YUKSEK: 0 };
  for (const c of cases) bands[c.genelBand] += 1;
  const avg =
    cases.length === 0
      ? null
      : Math.round(cases.reduce((acc, c) => acc + c.genelScore, 0) / cases.length);
  const topCases = [...cases]
    .sort((a, b) => b.genelScore - a.genelScore)
    .slice(0, DASHBOARD_TOP_CASES)
    .map((c) => ({ caseId: c.caseId, fileNumber: c.fileNumber, title: c.title, genel: c.genelScore }));
  return {
    caseCount: cases.length,
    highRiskCount: bands.YUKSEK,
    avgGenelScore: avg,
    bandDistributionJson: JSON.stringify(bands),
    topCasesJson: JSON.stringify(topCases),
  };
}

@Injectable()
export class RiskNightlyService {
  private readonly logger = new Logger(RiskNightlyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
  ) {}

  /**
   * Tüm aktif kiracıların aktif dosyaları için deterministik tabanı tazeler
   * ve günün fotoğrafını yazar. İDEMPOTENTTİR: aynı gece ikinci koşu aynı
   * tabanları yazar, fotoğrafı GÜNCELLER (upsert).
   */
  async runNightly(now: Date): Promise<{
    tenantCount: number;
    recomputedCases: number;
    failedCases: number;
    date: string;
  }> {
    // Fotoğraf anahtarı TR takvim gününün ISO tarihidir (yyyy-mm-dd).
    const date = trCalendarDay(now).toISOString().slice(0, 10);
    // Tenant modelinde durum alanı yoktur; tüm kiracılar taranır. Pasiflik
    // PlatformTenant tarafında yönetilir; dosyası olmayan kiracı için iş
    // aşağıda doğal olarak boş döner (maliyeti tek bir boş sorgudur).
    const tenants = await this.prisma.client.tenant.findMany({
      select: { id: true },
    });

    let recomputedCases = 0;
    let failedCases = 0;

    for (const tenant of tenants) {
      try {
        const result = await this.recomputeTenant(tenant.id, now, date);
        recomputedCases += result.recomputed;
        failedCases += result.failed;
      } catch (err) {
        // Bir kiracının arızası diğerini düşürmez.
        failedCases += 1;
        this.logger.error(
          `Gece risk işi kiracıda başarısız (${tenant.id}): ${(err as Error).message}`,
        );
      }
    }

    return { tenantCount: tenants.length, recomputedCases, failedCases, date };
  }

  private async recomputeTenant(
    tenantId: string,
    now: Date,
    date: string,
  ): Promise<{ recomputed: number; failed: number }> {
    const cases = await this.prisma.client.case.findMany({
      where: { tenantId, status: { in: [...NIGHTLY_ACTIVE_CASE_STATUSES] } },
      select: { id: true, fileNumber: true, title: true },
    });

    let recomputed = 0;
    let failed = 0;
    const snapshotRows: {
      caseId: string;
      fileNumber: string | null;
      title: string;
      genelScore: number;
      genelBand: "DUSUK" | "ORTA" | "YUKSEK";
    }[] = [];

    for (const kase of cases) {
      try {
        const genel = await this.recomputeCase(tenantId, kase.id, now);
        snapshotRows.push({
          caseId: kase.id,
          fileNumber: kase.fileNumber,
          title: kase.title,
          genelScore: genel.score,
          genelBand: genel.band,
        });
        recomputed += 1;
      } catch (err) {
        // Tek dosyanin hatası geceyi düşürmez; fotoğraf o dosyayı ESKİ skoruyla
        // göstermek yerine atlar — bayat satır yazmak yanlış rapor olurdu.
        failed += 1;
        this.logger.warn(
          `Gece risk işi dosyada başarısız (${kase.id}): ${(err as Error).message}`,
        );
      }
    }

    // İ-12: FOTOĞRAF OVERRIDE'LARI YOK SAYIYORDU. risk.service.ts okuma anında
    // aktif GENEL override'ının bandını uyguladığı hâlde, gece fotoğrafı ham
    // hesaplanan bandı yazıyordu — panel sayıları ile fotoğraf çelişiyordu.
    // Fotoğraf da okuma anındaki kuralı izler: aktif (süresi dolmamış) GENEL
    // override'ı bant dağılımına uygulanır.
    const activeOverrides = await this.prisma.client.riskOverride.findMany({
      where: {
        tenantId,
        caseId: { in: cases.map((c) => c.id) },
        dimension: "GENEL",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      select: { caseId: true, band: true },
    });
    const overrideBandByCase = new Map<string, "DUSUK" | "ORTA" | "YUKSEK">();
    for (const o of activeOverrides) {
      if (!overrideBandByCase.has(o.caseId)) overrideBandByCase.set(o.caseId, o.band);
    }
    for (const row of snapshotRows) {
      const overrideBand = overrideBandByCase.get(row.caseId);
      if (overrideBand) row.genelBand = overrideBand;
    }

    await this.writeSnapshot(tenantId, date, snapshotRows, recomputed);
    return { recomputed, failed };
  }

  /**
   * Tek dosyanın DETERMİNİSTİK tabanını tazeler; varsa önceki AI düzeltmesini
   * yeni taban üzerine YENİDEN UYGULAR (yeni AI yorumu üretmez).
   */
  private async recomputeCase(
    tenantId: string,
    caseId: string,
    now: Date,
  ): Promise<{ score: number; band: "DUSUK" | "ORTA" | "YUKSEK" }> {
    const snapshot = await this.risk.loadSnapshot(tenantId, caseId);
    const dimensions = computeAllDimensions(snapshot);

    // Önceki AI düzeltmeleri (varsa) korunur: gece koşusu yorumu YENİLEMEZ.
    const previous = await this.prisma.client.riskScore.findMany({
      where: { caseId, dimension: { not: "GENEL" } },
      select: { dimension: true, aiAdjustment: true, model: true },
    });
    const prevByDimension = new Map(previous.map((p) => [p.dimension, p]));
    const prevGeneral = await this.prisma.client.riskScore.findUnique({
      where: { caseId_dimension: { caseId, dimension: "GENEL" } },
      select: { aiAdjustment: true },
    });

    const appliedAdjustments = new Map<Exclude<RiskDimension, "GENEL">, number>();
    const rows: {
      dimension: Exclude<RiskDimension, "GENEL"> | "GENEL";
      score: number;
      baseScore: number;
      band: string;
      ruleSignalsJson: string;
      aiAdjustment: number | null;
      model: string | null;
    }[] = [];

    for (const dim of dimensions) {
      const prevAdj = prevByDimension.get(dim.dimension)?.aiAdjustment ?? undefined;
      const outcome = applyAiAdjustment(dim.baseScore, prevAdj);
      appliedAdjustments.set(dim.dimension, prevAdj ?? 0);
      rows.push({
        dimension: dim.dimension,
        score: outcome.finalScore,
        baseScore: dim.baseScore,
        band: outcome.band,
        ruleSignalsJson: JSON.stringify(dim.signals),
        aiAdjustment: prevAdj ?? null,
        model: prevByDimension.get(dim.dimension)?.model ?? null,
      });
    }

    const genel = computeGenel(dimensions, appliedAdjustments);
    // GENEL: boyutların korunmuş düzeltmelerinin ağırlıklı ortalaması taşınır.
    const genelAdjust = prevGeneral?.aiAdjustment ?? genel.aiAdjustment;
    const genelScore = Math.max(0, Math.min(100, genel.baseScore + genelAdjustmentClamp(genelAdjust)));
    rows.push({
      dimension: "GENEL",
      score: genelScore,
      baseScore: genel.baseScore,
      band: genel.band,
      ruleSignalsJson: JSON.stringify(genel.signals),
      aiAdjustment: genelAdjust,
      model: null,
    });

    await this.prisma.client.$transaction(
      rows.map((row) =>
        this.prisma.client.riskScore.upsert({
          where: { caseId_dimension: { caseId, dimension: row.dimension as never } },
          create: {
            tenantId,
            caseId,
            dimension: row.dimension as never,
            score: row.score,
            baseScore: row.baseScore,
            band: row.band as never,
            ruleSignalsJson: row.ruleSignalsJson,
            aiAdjustment: row.aiAdjustment,
            aiCommentary:
              row.dimension === "GENEL"
                ? "GENEL skor yalnızca yedi boyutun KURAL TABANLARININ ağırlıklı ortalamasıdır."
                : "Gece işi: deterministik taban tazelendi; AI yorumu önceki koşudan korundu.",
            model: row.model,
            computedAt: now,
            // Şema sözleşmesi: gece hesabında computedBy NULL'dır.
            computedBy: null,
          },
          update: {
            score: row.score,
            baseScore: row.baseScore,
            band: row.band as never,
            ruleSignalsJson: row.ruleSignalsJson,
            aiAdjustment: row.aiAdjustment,
            model: row.model,
            computedAt: now,
            computedBy: null,
          },
        }),
      ),
    );

    return { score: genelScore, band: genel.band };
  }

  private async writeSnapshot(
    tenantId: string,
    date: string,
    snapshotRows: {
      caseId: string;
      fileNumber: string | null;
      title: string;
      genelScore: number;
      genelBand: "DUSUK" | "ORTA" | "YUKSEK";
    }[],
    recomputedCount: number,
  ): Promise<void> {
    const row = buildSnapshotRow(snapshotRows);
    const data: Prisma.DashboardSnapshotUncheckedCreateInput = {
      tenantId,
      date,
      caseCount: row.caseCount,
      highRiskCount: row.highRiskCount,
      avgGenelScore: row.avgGenelScore,
      bandDistributionJson: row.bandDistributionJson,
      topCasesJson: row.topCasesJson,
      recomputedCount,
    };
    await this.prisma.client.dashboardSnapshot.upsert({
      where: { tenantId_date: { tenantId, date } },
      create: data,
      update: {
        caseCount: data.caseCount,
        highRiskCount: data.highRiskCount,
        avgGenelScore: data.avgGenelScore,
        bandDistributionJson: data.bandDistributionJson,
        topCasesJson: data.topCasesJson,
        recomputedCount: data.recomputedCount,
      },
    });
  }
}

/** GENEL düzeltmesi de ±MAX_AI_ADJUSTMENT ile sınırlıdır. */
function genelAdjustmentClamp(value: number): number {
  return Math.max(-25, Math.min(25, Math.round(value)));
}
