/**
 * TARİFELER (Faz 6) — faiz oranı dönemleri (yasal/avans/ticari temerrüt) ve harç tarifesi.
 *
 * İkisi de PLATFORM verisidir: Resmî Gazete / TCMB duyurusundan platform görevlisi girer;
 * NomosOS rakam UYDURMAZ. Kiracı uçları salt okur; hesaplar (icra bakiyesi, faiz aracı, harç
 * hesabı) bu tablodan beslenir. Kanuni faiz %9 (3095 s.K., 2006) göçle tohumlanmıştır.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type InterestRateKind } from "@nomosos/db";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import type { PlatformAuthUser } from "../platform/platform.types";

export const INTEREST_KINDS = ["YASAL", "AVANS", "TICARI_TEMERRUT"] as const;
export const INTEREST_KIND_LABELS: Record<InterestRateKind, string> = {
  YASAL: "Kanuni (yasal) faiz — 3095 s.K. m.1",
  AVANS: "Avans faizi — TCMB (3095 s.K. m.2/2, ticari işler)",
  TICARI_TEMERRUT: "Ticari temerrüt faizi — TCMB reeskont/avans oranı",
};

export const interestPeriodSchema = z.object({
  kind: z.enum(INTEREST_KINDS),
  validFrom: z.coerce.date(),
  ratePercent: z.coerce.number().positive().max(999),
  source: z.string().trim().max(300).nullable().optional(),
});
export type InterestPeriodInput = z.infer<typeof interestPeriodSchema>;

export const harcTarifesiSchema = z.object({
  pesinBinde: z.coerce.number().positive().max(999),
  istinafBinde: z.coerce.number().positive().max(999),
  temyizBinde: z.coerce.number().positive().max(999),
  maktuKalemler: z
    .array(z.object({ kod: z.string().trim().min(2).max(40), ad: z.string().trim().min(2).max(200), tutar: z.coerce.number().nonnegative() }))
    .max(200)
    .default([]),
  kaynak: z.string().trim().max(300).nullable().optional(),
});
export type HarcTarifesiInput = z.infer<typeof harcTarifesiSchema>;

@Injectable()
export class TarifeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /* ----------------------------- faiz oranları ----------------------------- */

  async listInterestPeriods(kind?: InterestRateKind) {
    const rows = await this.prisma.client.interestRatePeriod.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ kind: "asc" }, { validFrom: "desc" }],
    });
    return {
      items: rows.map((r) => ({ id: r.id, kind: r.kind, kindLabel: INTEREST_KIND_LABELS[r.kind], validFrom: r.validFrom, ratePercent: r.ratePercent.toFixed(2), source: r.source })),
      not: "Oranlar platform panelinden Resmî Gazete/TCMB duyurusuna göre girilir; eksik dönem varsa hesap o dilimi faizsiz bırakır ve uyarır.",
    };
  }

  /** Hesap motorları için: türün tüm dönemleri (artan tarih). */
  async periodsFor(kind: InterestRateKind): Promise<Array<{ validFrom: Date; ratePercent: number }>> {
    const rows = await this.prisma.client.interestRatePeriod.findMany({ where: { kind }, orderBy: { validFrom: "asc" } });
    return rows.map((r) => ({ validFrom: r.validFrom, ratePercent: Number(r.ratePercent) }));
  }

  async upsertInterestPeriod(user: PlatformAuthUser, input: InterestPeriodInput) {
    const validFrom = new Date(Date.UTC(input.validFrom.getUTCFullYear(), input.validFrom.getUTCMonth(), input.validFrom.getUTCDate()));
    const row = await this.prisma.client.interestRatePeriod.upsert({
      where: { kind_validFrom: { kind: input.kind, validFrom } },
      create: { kind: input.kind, validFrom, ratePercent: new Prisma.Decimal(input.ratePercent).toDecimalPlaces(2), source: input.source ?? null, createdBy: user.id },
      update: { ratePercent: new Prisma.Decimal(input.ratePercent).toDecimalPlaces(2), source: input.source ?? null },
    });
    await this.audit.log({ actor: user, action: "FAIZ_ORANI_UPSERT", entity: "InterestRatePeriod", entityId: row.id, detail: `${row.kind} ${validFrom.toISOString().slice(0, 10)} → %${row.ratePercent.toFixed(2)} (${row.source ?? "kaynak yok"})` });
    return { id: row.id, kind: row.kind, validFrom: row.validFrom, ratePercent: row.ratePercent.toFixed(2), source: row.source };
  }

  async deleteInterestPeriod(user: PlatformAuthUser, id: string) {
    const row = await this.prisma.client.interestRatePeriod.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Faiz dönemi bulunamadı.");
    if (row.kind === "YASAL" && row.validFrom.getTime() <= Date.UTC(2006, 0, 1)) {
      throw new BadRequestException("3095 s.K. kanuni faiz tohum kaydı silinemez; yeni dönem ekleyin.");
    }
    await this.prisma.client.interestRatePeriod.delete({ where: { id } });
    await this.audit.log({ actor: user, action: "FAIZ_ORANI_DELETE", entity: "InterestRatePeriod", entityId: id, detail: `${row.kind} ${row.validFrom.toISOString().slice(0, 10)}` });
    return { ok: true };
  }

  /* ------------------------------ harç tarifesi ---------------------------- */

  async getHarcTarifesi(yil: number) {
    const row = await this.prisma.client.platformHarcTarifesi.findUnique({ where: { yil } });
    if (!row) {
      return { yil, tanimli: false, mesaj: `${yil} yılı harç tarifesi platform panelinden girilmemiş; hesap aracı varsayılan binde oranlarıyla ve maktu kalem olmadan çalışır — Resmî Gazete tarifesiyle teyit edin.`, pesinBinde: null, istinafBinde: null, temyizBinde: null, maktuKalemler: [] as Array<{ kod: string; ad: string; tutar: string }>, kaynak: null };
    }
    let maktu: Array<{ kod: string; ad: string; tutar: string }> = [];
    try {
      maktu = (JSON.parse(row.maktuKalemlerJson) as Array<{ kod: string; ad: string; tutar: string | number }>).map((k) => ({ kod: k.kod, ad: k.ad, tutar: Number(k.tutar).toFixed(2) }));
    } catch {
      maktu = [];
    }
    return { yil, tanimli: true, mesaj: null, pesinBinde: row.pesinBinde.toFixed(2), istinafBinde: row.istinafBinde.toFixed(2), temyizBinde: row.temyizBinde.toFixed(2), maktuKalemler: maktu, kaynak: row.kaynak };
  }

  async upsertHarcTarifesi(user: PlatformAuthUser, yil: number, input: HarcTarifesiInput) {
    if (yil < 2020 || yil > 2100) throw new BadRequestException("Yıl 2020-2100 aralığında olmalı.");
    const row = await this.prisma.client.platformHarcTarifesi.upsert({
      where: { yil },
      create: { yil, pesinBinde: new Prisma.Decimal(input.pesinBinde), istinafBinde: new Prisma.Decimal(input.istinafBinde), temyizBinde: new Prisma.Decimal(input.temyizBinde), maktuKalemlerJson: JSON.stringify(input.maktuKalemler), kaynak: input.kaynak ?? null, updatedBy: user.id },
      update: { pesinBinde: new Prisma.Decimal(input.pesinBinde), istinafBinde: new Prisma.Decimal(input.istinafBinde), temyizBinde: new Prisma.Decimal(input.temyizBinde), maktuKalemlerJson: JSON.stringify(input.maktuKalemler), kaynak: input.kaynak ?? null, updatedBy: user.id },
    });
    await this.audit.log({ actor: user, action: "HARC_TARIFESI_UPSERT", entity: "PlatformHarcTarifesi", entityId: row.id, detail: `${yil}: ‰${input.pesinBinde}/${input.istinafBinde}/${input.temyizBinde}, ${input.maktuKalemler.length} maktu kalem (${input.kaynak ?? "kaynak yok"})` });
    return this.getHarcTarifesi(yil);
  }
}
