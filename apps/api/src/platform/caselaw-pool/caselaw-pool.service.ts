import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";
import {
  isPlausibleDecisionDate,
  type PoolImportInput,
  type PoolRecord,
  type PoolRecordsQuery,
} from "./caselaw-pool.schemas";

/**
 * İÇTİHAT HAVUZ YÖNETİMİ (ai-egitim-stratejisi.md D1) — Super Admin tarafı.
 *
 * RAG'ın kamusal tarafı `CaseLawDocument` havuzudur; bu servis havuzu platform
 * operatörünce DOLDURUR: toplu içe aktarım (biçim ön doğrulamasıyla), havuz
 * sağlık istatistikleri ve son kayıtları listeleme.
 *
 * İçerik güvenliği kuralları:
 * 1. Biçimsiz künye REDDEDİLİR (halüsinasyon zinciri havuz girişinde kesilir).
 * 2. Aynı partide aynı künye ikinci kez geçerse REDDEDİLİR.
 * 3. Aynı künye bir BÜRONUN manuel kaydındaysa (createdByTenantId != null)
 *    ATLANIR — ortak havuza yazma ortak değildir; büro kaydı ezilmez.
 * 4. İçe aktarılan kayıtlar `createdByTenantId: null` yazar (sistem kaydı).
 */

/** Partide tek bir kaydın sonucu. */
export interface PoolRecordResult {
  index: number;
  court: string;
  caseNumber: string;
  decisionNumber: string;
  status: "EKLENDI" | "GUNCELLENDI" | "ATLANDI" | "REDDEDILDI";
  reason?: string;
}

const COMPOUND_WHERE = "court_caseNumber_decisionNumber" as const;

@Injectable()
export class CaselawPoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  /** Havuz sağlık durumu — kaynak, daire ve yıl kırılımı. */
  async stats() {
    const [total, tenantEntered, bySource, byCourtRaw] = await Promise.all([
      this.prisma.client.caseLawDocument.count(),
      this.prisma.client.caseLawDocument.count({ where: { createdByTenantId: { not: null } } }),
      this.prisma.client.caseLawDocument.groupBy({
        by: ["sourceAdapter"],
        _count: { _all: true },
      }),
      this.prisma.client.caseLawDocument.groupBy({
        by: ["court"],
        _count: { _all: true },
        orderBy: { _count: { court: "desc" } },
        take: 10,
      }),
    ]);
    return {
      total,
      systemEntered: total - tenantEntered,
      tenantEntered,
      bySource: bySource
        .map((r) => ({ sourceAdapter: r.sourceAdapter, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      topCourts: byCourtRaw.map((r) => ({ court: r.court, count: r._count._all })),
    };
  }

  /** Son kayıtlar — operatörün içe aktarımı gözlemlemesi için. */
  async records(query: PoolRecordsQuery) {
    const rows = await this.prisma.client.caseLawDocument.findMany({
      where: query.sourceAdapter ? { sourceAdapter: query.sourceAdapter } : {},
      orderBy: { fetchedAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        court: true,
        chamber: true,
        caseNumber: true,
        decisionNumber: true,
        decisionDate: true,
        sourceAdapter: true,
        createdByTenantId: true,
        fetchedAt: true,
      },
    });
    return { items: rows };
  }

  /**
   * TOPLU İÇE AKTARIM. Kayıt kaydı işlenir; tek kaydın hatası partiyi düşürmez
   * (rapor satırına REDDEDILDI olarak düşer). Tamamı reddedilen boş parti
   * denetim izine yine düşer.
   */
  async importRecords(user: PlatformAuthUser, input: PoolImportInput) {
    const results: PoolRecordResult[] = [];
    const seen = new Set<string>();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let rejected = 0;

    for (const [index, record] of input.records.entries()) {
      const outcome = await this.importOne(record, index, input.sourceAdapter, seen);
      if (outcome.status === "EKLENDI") added += 1;
      else if (outcome.status === "GUNCELLENDI") updated += 1;
      else if (outcome.status === "ATLANDI") skipped += 1;
      else rejected += 1;
      results.push(outcome);
    }

    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "CASELAW_POOL_IMPORT",
      entity: "CaseLawDocument",
      entityId: "-",
      detail:
        `İçe aktarım (${input.sourceAdapter}${input.sourceNote ? ` — ${input.sourceNote}` : ""}): ` +
        `${added} eklendi, ${updated} güncellendi, ${skipped} atlandı, ${rejected} reddedildi.`,
    });

    return {
      results,
      counts: { added, updated, skipped, rejected, total: input.records.length },
    };
  }

  private async importOne(
    record: PoolRecord,
    index: number,
    sourceAdapter: string,
    seen: Set<string>
  ): Promise<PoolRecordResult> {
    const base = {
      index,
      court: record.court,
      caseNumber: record.caseNumber,
      decisionNumber: record.decisionNumber,
    };

    if (record.decisionDate && !isPlausibleDecisionDate(record.decisionDate)) {
      return {
        ...base,
        status: "REDDEDILDI",
        reason: "Karar tarihi makul aralıkta değil (1900 – gelecek yıl).",
      };
    }

    const key = `${record.court}|${record.caseNumber}|${record.decisionNumber}`;
    if (seen.has(key)) {
      return { ...base, status: "REDDEDILDI", reason: "Aynı künye bu partide zaten işlendi." };
    }
    seen.add(key);

    const existing = await this.prisma.client.caseLawDocument.findUnique({
      where: {
        [COMPOUND_WHERE]: {
          court: record.court,
          caseNumber: record.caseNumber,
          decisionNumber: record.decisionNumber,
        },
      },
    });

    // İçerik güvenliği: büronun manuel kaydına dokunulmaz.
    if (existing?.createdByTenantId) {
      return {
        ...base,
        status: "ATLANDI",
        reason: "Aynı künye bir büronun manuel kaydı; ortak havuz yazması üzerine yazılmaz.",
      };
    }

    const data = {
      court: record.court,
      chamber: record.chamber ?? null,
      caseNumber: record.caseNumber,
      decisionNumber: record.decisionNumber,
      decisionDate: record.decisionDate ? new Date(`${record.decisionDate}T00:00:00Z`) : null,
      summary: record.summary ?? null,
      fullText: record.fullText ?? null,
      sourceUrl: record.sourceUrl ?? null,
    };

    await this.prisma.client.caseLawDocument.upsert({
      where: {
        [COMPOUND_WHERE]: {
          court: record.court,
          caseNumber: record.caseNumber,
          decisionNumber: record.decisionNumber,
        },
      },
      create: { ...data, sourceAdapter, createdByTenantId: null },
      update: { ...data },
    });

    return { ...base, status: existing ? "GUNCELLENDI" : "EKLENDI" };
  }
}

/** Boş partiyi şema yakalar; servis katmanı savunma olarak da reddeder. */
export function assertNonEmptyBatch(count: number): void {
  if (count === 0) throw new BadRequestException("İçe aktarılacak kayıt yok.");
}
