/**
 * FAZ 8A — KİMLİKSİZ KAMUSAL UÇLAR (tanıtım sitesi + durum sayfası).
 *
 *  - GET /public/plans   → aktif plan kataloğu (PlanTier'dan; fiyat vitrini DB ile aynı kaynaktan okur)
 *  - GET /public/status  → readiness bileşenleri + sürüm + herkese açık (TUM) duyurular
 *
 * Kişisel/kiracı verisi TAŞIMAZ; global oran sınırı (IP) bu uçları da kapsar. Yanıtlar 60 sn önbelleklenir.
 */

import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { ReadinessService } from "../health/readiness.service";

/** Kendi LLM'ini bağlayan büro için abonelik indirimi (iş modeli kararı, Modül 26). */
export const BYO_LLM_DISCOUNT_PERCENT = 30;

export interface PublicPlan {
  key: string;
  name: string;
  monthlyPricePerUser: string | null;
  annualPricePerUser: string | null;
  /** Yıllık ödemede aylık eşdeğer (annual/12) — vitrin gösterimi için. */
  annualMonthlyEquivalent: string | null;
  maxUsers: number | null;
  features: Record<string, unknown>;
  byoLlmDiscountPercent: number;
  currency: "TRY";
}

@Public()
@Controller("public")
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get("plans")
  @Header("Cache-Control", "public, max-age=60")
  async plans(): Promise<{ items: PublicPlan[]; vatIncluded: boolean; vatRatePercent: number }> {
    const rows = await this.prisma.client.planTier.findMany({ where: { isActive: true }, orderBy: { monthlyPricePerUser: "desc" } });
    const items = rows.map((p) => {
      let features: Record<string, unknown> = {};
      try {
        features = JSON.parse(p.featuresJson) as Record<string, unknown>;
      } catch {
        features = {};
      }
      const annual = p.annualPricePerUser ? p.annualPricePerUser.toFixed(2) : null;
      return {
        key: p.key,
        name: p.name,
        monthlyPricePerUser: p.monthlyPricePerUser ? p.monthlyPricePerUser.toFixed(2) : null,
        annualPricePerUser: annual,
        annualMonthlyEquivalent: p.annualPricePerUser ? p.annualPricePerUser.div(12).toFixed(2) : null,
        maxUsers: p.maxUsers,
        features,
        byoLlmDiscountPercent: BYO_LLM_DISCOUNT_PERCENT,
        currency: "TRY" as const,
      };
    });
    return { items, vatIncluded: false, vatRatePercent: 20 };
  }

  @Get("status")
  @Header("Cache-Control", "public, max-age=30")
  async status() {
    const [ready, announcements] = await Promise.all([
      this.readiness.check().catch((err: unknown) => ({ status: "degraded" as const, time: new Date().toISOString(), checks: {}, error: (err as Error).message })),
      this.prisma.client.announcement.findMany({
        where: { audience: "TUM", publishedAt: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { publishedAt: "desc" },
        take: 5,
        select: { id: true, title: true, severity: true, publishedAt: true, expiresAt: true },
      }),
    ]);
    const checks = (ready as { checks?: Record<string, { status: string; durationMs?: number }> }).checks ?? {};
    const components = Object.entries(checks).map(([name, c]) => ({ name, status: c.status === "up" ? "operational" : c.status === "disabled" ? "not_configured" : "outage", durationMs: c.durationMs ?? null }));
    const overall = components.some((c) => c.status === "outage") ? "major_outage" : (ready as { status?: string }).status === "degraded" ? "degraded" : "operational";
    return {
      status: overall,
      time: (ready as { time?: string }).time ?? new Date().toISOString(),
      version: process.env.APP_VERSION ?? process.env.IMAGE_TAG ?? "dev",
      components,
      announcements,
    };
  }
}
