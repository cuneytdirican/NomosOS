import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { CaselawPoolService } from "../caselaw-pool/caselaw-pool.service";
import { isPlausibleDecisionDate } from "../caselaw-pool/caselaw-pool.schemas";
import type { PlatformAuthUser } from "../platform.types";
import {
  feedResponseSchema,
  type FeedResponse,
  type IngestItemsQuery,
  type SourceUpsertInput,
} from "./caselaw-ingest.schemas";

/**
 * İÇTİHAT TOPLAMA HATTI (caselaw-ingest) — platform işletmesi servisi.
 *
 * Üç yüzeyi vardır ve üçü de bu dosyada birleşir:
 *   1. Zamanlanmış iş (caselaw-ingest-daily) → runAllSources(): yapılandırılmış
 *      beslemelerden yeni kararları ÇEKER, onay kuyruğuna yazar.
 *   2. Platform paneli → elle "şimdi topla", kuyruk listesi, onay/red.
 *   3. Onay → CaseLawPoolService.importRecords(): havuza girişin TEK KAPISI
 *      budur; künye doğrulaması, mükerrer koruması ve büro kaydına dokunmama
 *      kuralları burada ZATEN uygulanır ve İKİNCİ KEZ yazılmaz.
 *
 * UYDURMA ENTEGRASYON YASAĞI (adapters/types.ts): kodda sabit bir "Yargıtay
 * API'si" İSTEMCİSİ YOKTUR. Kaynak adresi CaselawSourceConfig tablosundadır;
 * kod yalnız BELGELENMİŞ sözleşmeyi ({ records: [...] } JSON) okur. Kaynak
 * değişince kod değişmez.
 *
 * Onay akışının taahhütleri:
 *  - Beslemeden çekilen kayıt havuza OTOMATİK YAZILMAZ; önce kuyrukta bekler.
 *  - Onay RED gerekçesi ister; ikisi de denetim izine düşer.
 *  - Reddedilen künye sonraki koşularda geri gelmez (kuyrukta @@unique).
 */

/** Besleme çekimi: zaman aşımı ve gövde tavanı (kayıt başına değil, parti başına). */
const FEED_TIMEOUT_MS = 15_000;
const FEED_MAX_BYTES = 25_000_000;

export interface SourceRunSummary {
  key: string;
  ok: boolean;
  fetched: number;
  queued: number;
  skippedDuplicate: number;
  rejected: number;
  note?: string;
}

const COMPOUND_WHERE = "court_caseNumber_decisionNumber" as const;

@Injectable()
export class CaselawIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly pool: CaselawPoolService,
  ) {}

  // ------------------------------------------------------------------ //
  // Kaynak yapılandırması
  // ------------------------------------------------------------------ //

  async listSources() {
    const sources = await this.prisma.client.caselawSourceConfig.findMany({
      orderBy: { createdAt: "asc" },
    });
    const pendingCounts = await this.prisma.client.caseLawIngestItem.groupBy({
      by: ["sourceKey"],
      where: { status: "BEKLIYOR" },
      _count: { _all: true },
    });
    const pendingByKey = new Map(pendingCounts.map((r) => [r.sourceKey, r._count._all]));
    return {
      items: sources.map((s) => ({
        ...s,
        pendingCount: pendingByKey.get(s.key) ?? 0,
      })),
    };
  }

  /** Upssert — anahtar `key`; adres değişince kod değişmez. */
  async upsertSource(user: PlatformAuthUser, input: SourceUpsertInput) {
    const source = await this.prisma.client.caselawSourceConfig.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        name: input.name,
        baseUrl: input.baseUrl,
        isEnabled: input.isEnabled,
        note: input.note ?? null,
      },
      update: {
        name: input.name,
        baseUrl: input.baseUrl,
        isEnabled: input.isEnabled,
        note: input.note ?? null,
      },
    });
    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "CASELAW_SOURCE_UPSERT",
      entity: "CaselawSourceConfig",
      entityId: source.id,
      detail: `${source.key} — ${source.baseUrl} (${source.isEnabled ? "açık" : "kapalı"})`,
    });
    return source;
  }

  // ------------------------------------------------------------------ //
  // Çekim (zamanlanmış iş + elle)
  // ------------------------------------------------------------------ //

  /** Tüm AÇIK kaynakları çeker. Tek kaynağın hatası diğerlerini düşürmez. */
  async runAllSources(now: Date, triggeredBy?: string): Promise<SourceRunSummary[]> {
    const sources = await this.prisma.client.caselawSourceConfig.findMany({
      where: { isEnabled: true },
    });
    const summaries: SourceRunSummary[] = [];
    for (const source of sources) {
      try {
        summaries.push(await this.runSource(source, now));
      } catch (err) {
        summaries.push({
          key: source.key,
          ok: false,
          fetched: 0,
          queued: 0,
          skippedDuplicate: 0,
          rejected: 0,
          note: messageOf(err),
        });
      }
    }
    if (summaries.length > 0) {
      await this.audit.log({
        actor: {
          id: triggeredBy ?? "scheduler",
          role: "SUPER_ADMIN",
          ip: "-",
        },
        action: "CASELAW_INGEST_RUN",
        entity: "CaseLawIngestItem",
        entityId: "-",
        detail: summaries
          .map((s) => `${s.key}: ${s.queued} kuyrukta, ${s.skippedDuplicate} mükerrer, ${s.rejected} reddedildi${s.ok ? "" : ` — HATA: ${s.note ?? ""}`}`)
          .join(" | "),
      });
    }
    return summaries;
  }

  /** Tek kaynağı çeker → kuyruğa yazar. Havuza yazım YOKTUR. */
  async runSource(
    source: { id: string; key: string; baseUrl: string },
    now: Date,
  ): Promise<SourceRunSummary> {
    const feed = await fetchFeed(source.baseUrl);
    const batchId = `ingest-${now.toISOString()}`;

    // Biçimsiz künye KUYRUĞA DA GİREMEZ: havuz kapısıyla AYNI şema.
    const valid: Array<Record<string, string | undefined>> = [];
    let rejected = 0;
    const seen = new Set<string>();
    for (const record of feed.records) {
      if (record.decisionDate && !isPlausibleDecisionDate(record.decisionDate, now)) {
        rejected += 1;
        continue;
      }
      const key = `${record.court}|${record.caseNumber}|${record.decisionNumber}`;
      if (seen.has(key)) {
        rejected += 1;
        continue;
      }
      seen.add(key);
      valid.push({
        court: record.court,
        chamber: record.chamber,
        caseNumber: record.caseNumber,
        decisionNumber: record.decisionNumber,
        decisionDate: record.decisionDate,
        summary: record.summary,
        fullText: record.fullText,
        sourceUrl: record.sourceUrl,
      });
    }

    // skipDuplicates: @@unique(sourceKey, court, caseNumber, decisionNumber).
    // Daha önce işlenmiş (onaylı/retli) künye İKİNCİ KEZ kuyruğa girmez.
    const queued = await this.prisma.client.caseLawIngestItem.createMany({
      data: valid.map((v) => ({
        court: String(v.court),
        chamber: v.chamber ?? null,
        caseNumber: String(v.caseNumber),
        decisionNumber: String(v.decisionNumber),
        decisionDate: v.decisionDate ? new Date(`${v.decisionDate}T00:00:00Z`) : null,
        summary: v.summary ?? null,
        fullText: v.fullText ?? null,
        sourceUrl: v.sourceUrl ?? null,
        sourceKey: source.key,
        batchId,
      })),
      skipDuplicates: true,
    });

    await this.prisma.client.caselawSourceConfig.update({
      where: { id: source.id },
      data: { lastFetchedAt: now },
    });

    return {
      key: source.key,
      ok: true,
      fetched: feed.records.length,
      queued: queued.count,
      skippedDuplicate: valid.length - queued.count,
      rejected,
    };
  }

  // ------------------------------------------------------------------ //
  // Kuyruk: listele, onayla, reddet
  // ------------------------------------------------------------------ //

  async listItems(query: IngestItemsQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceKey ? { sourceKey: query.sourceKey } : {}),
    };
    const [items, counts] = await Promise.all([
      this.prisma.client.caseLawIngestItem.findMany({
        where,
        orderBy: { fetchedAt: "desc" },
        take: query.limit,
      }),
      this.prisma.client.caseLawIngestItem.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);
    const countBy = Object.fromEntries(counts.map((r) => [r.status, r._count._all]));
    return {
      items,
      counts: {
        BEKLIYOR: countBy["BEKLIYOR"] ?? 0,
        ONAYLANDI: countBy["ONAYLANDI"] ?? 0,
        REDDEDILDI: countBy["REDDEDILDI"] ?? 0,
      },
    };
  }

  /**
   * ONAY — kuyruk kaydını havuza yazar. Yazım CaseLawPoolService'ten geçer:
   * künye zaten havuzdaysa GÜNCELLENDI, büro kaydıysa ATLANDI döner ve bu
   * sonuçlar kuyruk kaydına da işlenir. ATLANDI'da kayıt onaylanmış sayılır
   * ama havuza dokunulmamış olur (büro kaydı ezilemez).
   */
  async approveItem(user: PlatformAuthUser, id: string) {
    const item = await this.prisma.client.caseLawIngestItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Kuyruk kaydı bulunamadı.");
    if (item.status !== "BEKLIYOR") {
      throw new BadRequestException(`Kayıt zaten ${item.status}; yalnız BEKLIYOR kayıtlar onaylanabilir.`);
    }

    const result = await this.pool.importRecords(user, {
      sourceAdapter: item.sourceKey,
      sourceNote: `Otomatik toplama onayı (kuyruk ${item.id})`,
      records: [
        {
          court: item.court,
          chamber: item.chamber ?? undefined,
          caseNumber: item.caseNumber,
          decisionNumber: item.decisionNumber,
          decisionDate: item.decisionDate ? item.decisionDate.toISOString().slice(0, 10) : undefined,
          summary: item.summary ?? undefined,
          fullText: item.fullText ?? undefined,
          sourceUrl: item.sourceUrl ?? undefined,
        },
      ],
    });
    const outcome = result.results[0];

    // ATLANDI = aynı künye bir büronun manuel kaydı — havuz dokunulmadı.
    // REDDEDILDI = havuz kapısı reddetti (tarih aralığı vb.) — kuyruk kaydı reddedilir.
    if (outcome.status === "REDDEDILDI") {
      const updated = await this.prisma.client.caseLawIngestItem.update({
        where: { id },
        data: {
          status: "REDDEDILDI",
          reviewedBy: user.id,
          reviewedAt: new Date(),
          rejectReason: outcome.reason ?? "Havuz doğrulaması kaydı reddetti.",
        },
      });
      return { item: updated, poolOutcome: outcome.status };
    }

    // Havuzdaki kaydın kimliğini künyeyle bul (importRecords id döndürmez).
    const poolRecord = await this.prisma.client.caseLawDocument.findUnique({
      where: {
        [COMPOUND_WHERE]: {
          court: item.court,
          caseNumber: item.caseNumber,
          decisionNumber: item.decisionNumber,
        },
      },
      select: { id: true },
    });

    const updated = await this.prisma.client.caseLawIngestItem.update({
      where: { id },
      data: {
        status: "ONAYLANDI",
        reviewedBy: user.id,
        reviewedAt: new Date(),
        poolRecordId: poolRecord?.id ?? null,
      },
    });
    return { item: updated, poolOutcome: outcome.status };
  }

  /** RED — gerekçe ZORUNLU; kayıt bir daha kuyruğa girmez. */
  async rejectItem(user: PlatformAuthUser, id: string, reason: string) {
    const item = await this.prisma.client.caseLawIngestItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Kuyruk kaydı bulunamadı.");
    if (item.status !== "BEKLIYOR") {
      throw new BadRequestException(`Kayıt zaten ${item.status}; yalnız BEKLIYOR kayıtlar reddedilebilir.`);
    }
    const updated = await this.prisma.client.caseLawIngestItem.update({
      where: { id },
      data: {
        status: "REDDEDILDI",
        reviewedBy: user.id,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "CASELAW_INGEST_REJECT",
      entity: "CaseLawIngestItem",
      entityId: id,
      detail: `${item.court} ${item.caseNumber} E. — ${reason}`,
    });
    return updated;
  }
}

/** Besleme sözleşmesi: GET → { records: [...] }; tek biçim, üst veri yok sayılır. */
async function fetchFeed(baseUrl: string): Promise<FeedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Besleme ${res.status} döndü — kaynak adresini ve erişimi kontrol edin.`);
    }
    const text = await res.text();
    if (text.length > FEED_MAX_BYTES) {
      throw new Error("Besleme gövdesi 25 MB sınırını aşıyor; partilere bölün.");
    }
    const parsed = feedResponseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(
        `Besleme sözleşmeye uymuyor (records[]): ${first?.path.join(".") ?? ""} — ${first?.message ?? ""}`,
      );
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Bilinmeyen hata";
}
