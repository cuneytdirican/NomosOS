import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { parseStatuteText } from "@nomosos/legal-core";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { LegislationPoolService, type StatuteImportResult } from "./legislation-pool.service";
import { govTurToDocType, parseTrDate } from "../../legislation/connectors/types";
import { MevzuatGovConnector } from "../../legislation/connectors/mevzuat-gov.connector";
import { ResmiGazeteClient } from "../../legislation/connectors/resmi-gazete.client";
import { KvkkClient, extractKvkkDecisionMeta } from "../../legislation/connectors/kvkk.client";
import { RekabetClient } from "../../legislation/connectors/rekabet.client";
import type { PlatformAuthUser } from "../platform.types";

/**
 * MEVZUAT TOPLAMA HATTI (legislation-ingest) — caselaw-ingest ile aynı desen.
 *
 * Üç üretici, tek kuyruk, tek onay kapısı:
 *  1. TOHUM: çekirdek kanun listesi mevzuat.gov.tr'de künyeyle bulunup kuyruğa yazılır.
 *  2. RG İZLEYİCİ (resmi-gazete-gunluk işi): her sabah dünün sayfası taranır,
 *     mevzuat bölümündeki belgeler kuyruğa yazılır.
 *  3. ONAY: platform görevlisi metni okur, onaylar → LegislationPoolService
 *     (tek kapı) havuza yazar. Hiçbir çekim otomatik yayınlanmaz.
 *
 * RG'den gelen bir KANUN değişikliği onaylanınca: değişiklik metninden etkilenen
 * kanun numaraları çıkarılır, o kanunların KONSOLİDE metni mevzuat.gov.tr'den
 * yeniden çekilir ve madde sürüm farkı işlenir (StatuteArticleVersion zinciri).
 */

export interface IngestRunSummary {
  source: string;
  ok: boolean;
  fetched: number;
  queued: number;
  note?: string;
}

export interface IngestItemsQuery {
  status?: string;
  sourceKey?: string;
  limit?: number;
}

/**
 * ÇEKİRDEK KANUN TOHUMU — ilk günden "TCK 86" atfının doğrulanabilmesi için.
 * abbrs, citation-patterns (TR_STATUTE_REFS) ile eşleşir.
 */
export const CORE_STATUTES: ReadonlyArray<{ mevzuatNo: string; abbrs: string }> = [
  { mevzuatNo: "2709", abbrs: "AY,Anayasa" },
  { mevzuatNo: "5237", abbrs: "TCK" },
  { mevzuatNo: "6098", abbrs: "TBK" },
  { mevzuatNo: "4721", abbrs: "TMK" },
  { mevzuatNo: "6100", abbrs: "HMK" },
  { mevzuatNo: "2004", abbrs: "İİK,IIK" },
  { mevzuatNo: "4857", abbrs: "İşK,İK" },
  { mevzuatNo: "6102", abbrs: "TTK" },
  { mevzuatNo: "5271", abbrs: "CMK" },
  { mevzuatNo: "6698", abbrs: "KVKK" },
  { mevzuatNo: "6183", abbrs: "AATUHK" },
  { mevzuatNo: "2942", abbrs: "İYUK,IYUK" },
  { mevzuatNo: "213", abbrs: "VUK" },
  { mevzuatNo: "193", abbrs: "GVK" },
  { mevzuatNo: "5549", abbrs: "MASAK" },
];

const TOHUM_SOURCE_KEY = "MEVZUAT_TOHUM";
const RG_SOURCE_KEY = "RG_GUNLUK";
/** KVKK Kurul kararları izleyicisi (Faz 3, regülatör kaynak 1). */
export const KVKK_SOURCE_KEY = "KVKK_KURUL";
/** Rekabet Kurulu kararları izleyicisi (Faz 3, regülatör kaynak 2). */
export const REKABET_SOURCE_KEY = "REKABET_KURUL";
/** RG izleyicisinin kaç gün geriye bakacağı (kaçırılan günlerin telafisi). */
const RG_LOOKBACK_DAYS = 3;
/** KVKK izleyicisinin tarayacağı liste sayfası sayısı. */
const KVKK_LIST_PAGES = 2;
/** Rekabet izleyicisinin tarayacağı liste sayfası sayısı. */
const REKABET_LIST_PAGES = 2;

/** Değişiklik metninden etkilenen kanun numaraları ("4857 sayılı Kanunun…"). */
function extractStatuteNumbers(text: string): string[] {
  const found = new Set<string>();
  const re = /(\d{3,5})\s*say[ıi]l[ıi][^\n.]{0,80}?Kanun/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

@Injectable()
export class LegislationIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly pool: LegislationPoolService,
    private readonly mevzuat: MevzuatGovConnector,
    private readonly rg: ResmiGazeteClient,
    private readonly kvkk: KvkkClient,
    private readonly rekabet: RekabetClient,
  ) {}

  // ------------------------------------------------------------------ //
  // Üretici 1: çekirdek kanun tohumu
  // ------------------------------------------------------------------ //

  /** Çekirdek listeyi mevzuat.gov.tr'de bulup kuyruğa yazar. */
  async runCoreSeed(now: Date, triggeredBy?: string): Promise<IngestRunSummary> {
    const batchId = `leg-tohum-${now.toISOString()}`;
    let queued = 0;
    let fetched = 0;

    for (const core of CORE_STATUTES) {
      try {
        const { hits } = await this.mevzuat.search({
          query: core.mevzuatNo,
          mevzuatTur: 1,
          aramaYer: "Baslik",
          pageSize: 10,
        });
        fetched += hits.length;
        const hit = hits.find((h) => h.mevzuatNo === core.mevzuatNo);
        if (!hit) continue;

        const created = await this.prisma.client.legislationIngestItem.createMany({
          data: [
            {
              sourceKey: TOHUM_SOURCE_KEY,
              externalKey: hit.externalKey,
              docType: govTurToDocType(hit.mevzuatTur),
              title: hit.title,
              number: hit.mevzuatNo,
              abbrs: core.abbrs,
              rgDate: parseTrDate(hit.rgTarihi) ? new Date(`${parseTrDate(hit.rgTarihi)}T00:00:00Z`) : null,
              rgNo: hit.rgSayisi ?? null,
              sourceUrl: hit.sourceUrl,
              batchId,
            },
          ],
          skipDuplicates: true,
        });
        queued += created.count;
      } catch (err) {
        await this.audit.log({
          actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
          action: "LEGISLATION_INGEST_RUN",
          entity: "LegislationIngestItem",
          detail: `Tohumlama hatası (${core.mevzuatNo}): ${(err as Error).message}`,
        });
      }
    }

    await this.audit.log({
      actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
      action: "LEGISLATION_INGEST_RUN",
      entity: "LegislationIngestItem",
      detail: `Tohum: ${queued} kuyrukta, ${fetched} aday tarandı.`,
    });
    return { source: TOHUM_SOURCE_KEY, ok: true, fetched, queued };
  }

  // ------------------------------------------------------------------ //
  // Üretici 2: RG günlük izleyici
  // ------------------------------------------------------------------ //

  /** Son RG_LOOKBACK_DAYS günün sayfalarını tarar → kuyruğa yazar. */
  async runRgWatcher(now: Date, triggeredBy?: string): Promise<IngestRunSummary> {
    const batchId = `leg-rg-${now.toISOString()}`;
    let queued = 0;
    let fetched = 0;
    const notes: string[] = [];

    for (let back = RG_LOOKBACK_DAYS; back >= 1; back -= 1) {
      const day = new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
      try {
        const issue = await this.rg.fetchDay(day);
        fetched += issue.items.length;
        if (issue.items.length === 0) continue;

        const created = await this.prisma.client.legislationIngestItem.createMany({
          data: issue.items.map((item) => ({
            sourceKey: RG_SOURCE_KEY,
            externalKey: `${issue.date}-${item.order}`,
            docType: item.docType,
            title: item.title,
            rgDate: new Date(`${issue.date}T00:00:00Z`),
            rgNo: issue.rgNo ?? null,
            sourceUrl: item.url,
            batchId,
          })),
          skipDuplicates: true,
        });
        queued += created.count;
      } catch (err) {
        notes.push(`${day.toISOString().slice(0, 10)}: ${(err as Error).message}`);
      }
    }

    if (notes.length > 0) {
      await this.audit.log({
        actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
        action: "LEGISLATION_INGEST_RUN",
        entity: "LegislationIngestItem",
        detail: `RG izleyici gün hataları: ${notes.join(" | ")}`,
      });
    }

    return {
      source: RG_SOURCE_KEY,
      ok: notes.length < RG_LOOKBACK_DAYS,
      fetched,
      queued,
      note: notes.length > 0 ? notes.join(" | ") : undefined,
    };
  }

  // ------------------------------------------------------------------ //
  // Üretici 3: KVKK Kurul kararları izleyici (Faz 3, regülatör kaynak 1)
  // ------------------------------------------------------------------ //

  /**
   * KVKK Kurul Kararları listesinin ilk sayfalarını tarar → kuyruğa yazar.
   * externalKey = karar detay/PDF adresi (aynı karar ikinci kez kuyruğa girmez).
   */
  async runKvkkWatcher(now: Date, triggeredBy?: string): Promise<IngestRunSummary> {
    const batchId = `leg-kvkk-${now.toISOString()}`;
    let queued = 0;
    let fetched = 0;

    for (let page = 1; page <= KVKK_LIST_PAGES; page += 1) {
      try {
        const decisions = await this.kvkk.fetchDecisionList(page);
        fetched += decisions.length;
        if (decisions.length === 0) break;
        const created = await this.prisma.client.legislationIngestItem.createMany({
          data: decisions.map((d) => ({
            sourceKey: KVKK_SOURCE_KEY,
            externalKey: d.url,
            docType: "DIGER",
            title: d.title,
            sourceUrl: d.url,
            batchId,
          })),
          skipDuplicates: true,
        });
        queued += created.count;
      } catch (err) {
        await this.audit.log({
          actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
          action: "LEGISLATION_INGEST_RUN",
          entity: "LegislationIngestItem",
          detail: `KVKK izleyici sayfa ${page} hatası: ${(err as Error).message}`,
        });
      }
    }

    await this.audit.log({
      actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
      action: "LEGISLATION_INGEST_RUN",
      entity: "LegislationIngestItem",
      detail: `KVKK izleyici: ${queued} kuyrukta, ${fetched} kalem tarandı.`,
    });
    return { source: KVKK_SOURCE_KEY, ok: true, fetched, queued };
  }

  /**
   * Rekabet Kurulu kararları listesinin ilk sayfalarını tarar → kuyruğa yazar.
   * externalKey = kararId (UUID). Karar metinleri PDF'tir; künye ve başlık
   * LİSTEDEN alınır (karar sayısı/tarihi/türü kuyruk kaydında taşınır).
   */
  async runRekabetWatcher(now: Date, triggeredBy?: string): Promise<IngestRunSummary> {
    const batchId = `leg-rekabet-${now.toISOString()}`;
    let queued = 0;
    let fetched = 0;

    for (let page = 1; page <= REKABET_LIST_PAGES; page += 1) {
      try {
        const decisions = await this.rekabet.fetchDecisionList(page);
        fetched += decisions.length;
        if (decisions.length === 0) break;
        const created = await this.prisma.client.legislationIngestItem.createMany({
          data: decisions.map((d) => ({
            sourceKey: REKABET_SOURCE_KEY,
            externalKey: d.kararId,
            docType: "DIGER",
            title: d.title,
            number: d.kararSayisi,
            sourceUrl: d.detailUrl,
            batchId,
          })),
          skipDuplicates: true,
        });
        queued += created.count;
      } catch (err) {
        await this.audit.log({
          actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
          action: "LEGISLATION_INGEST_RUN",
          entity: "LegislationIngestItem",
          detail: `Rekabet izleyici sayfa ${page} hatası: ${(err as Error).message}`,
        });
      }
    }

    await this.audit.log({
      actor: { id: triggeredBy ?? "scheduler", role: "SUPER_ADMIN", ip: "-" },
      action: "LEGISLATION_INGEST_RUN",
      entity: "LegislationIngestItem",
      detail: `Rekabet izleyici: ${queued} kuyrukta, ${fetched} kalem tarandı.`,
    });
    return { source: REKABET_SOURCE_KEY, ok: true, fetched, queued };
  }

  // ------------------------------------------------------------------ //
  // Kuyruk: listele / önizle / onayla / reddet
  // ------------------------------------------------------------------ //

  async listItems(query: IngestItemsQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceKey ? { sourceKey: query.sourceKey } : {}),
    };
    const [items, counts] = await Promise.all([
      this.prisma.client.legislationIngestItem.findMany({
        where,
        orderBy: { fetchedAt: "desc" },
        take: Math.min(Math.max(query.limit ?? 50, 1), 200),
      }),
      this.prisma.client.legislationIngestItem.groupBy({
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
   * ÖNİZLEME — onay ÖNCESİ metni okuma (Onay Masası deseni).
   * Öncelik: kuyruk fullText → kaynağa göre canlı çekim → dürüst hata.
   */
  async preview(id: string): Promise<{
    item: { id: string; title: string; docType: string; sourceKey: string; sourceUrl: string | null };
    source: "KUYRUK" | "MEVZUAT_GOV" | "RG" | "KVKK";
    text: string;
  }> {
    const item = await this.prisma.client.legislationIngestItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Kuyruk kaydı bulunamadı.");

    const meta = {
      item: {
        id: item.id,
        title: item.title,
        docType: item.docType,
        sourceKey: item.sourceKey,
        sourceUrl: item.sourceUrl,
      },
    };

    if (item.fullText && item.fullText.trim().length > 0) {
      return { ...meta, source: "KUYRUK", text: item.fullText };
    }

    if (item.sourceKey === TOHUM_SOURCE_KEY) {
      const doc = await this.mevzuat.fetchDocument(item.externalKey);
      return { ...meta, source: "MEVZUAT_GOV", text: doc.text };
    }

    if (item.sourceKey === REKABET_SOURCE_KEY) {
      throw new BadRequestException(
        "Rekabet Kurulu karar metni PDF olarak sunulur; metin önizlemesi yok. Künye ve başlık üzerinden karar verin.",
      );
    }

    if (item.sourceKey === KVKK_SOURCE_KEY) {
      if (item.sourceUrl && /\/Icerik\/\d+\//.test(item.sourceUrl)) {
        const text = await this.kvkk.fetchDecisionText(item.sourceUrl);
        return { ...meta, source: "KVKK", text };
      }
      throw new BadRequestException(
        "Bu KVKK kararı doğrudan RG PDF'idir; metin önizlemesi yok. Künye üzerinden karar verin ya da belgeyi kaynaktan okuyun.",
      );
    }

    if (item.sourceKey === RG_SOURCE_KEY) {
      if (item.sourceUrl && /\.htm$/i.test(item.sourceUrl)) {
        const text = await this.rg.fetchDocumentText(item.sourceUrl);
        return { ...meta, source: "RG", text };
      }
      throw new BadRequestException(
        "Bu RG belgesi PDF; metin önizlemesi yok. Künye üzerinden karar verin ya da belgeyi kaynaktan okuyun.",
      );
    }

    throw new BadRequestException(
      "Bu kayıtta metin yok ve kaynağı bilinen bir konektörle eşleşmiyor.",
    );
  }

  /**
   * ONAY — havuza yazım tek kapıdan (LegislationPoolService).
   *
   *  - TOHUM kaydı: konsolide metin mevzuat.gov.tr'den çekilir, maddelere
   *    ayrıştırılır, Statute havuzuna girer.
   *  - RG KANUN kaydı: değişikliğin etkilediği kanun(lar)ın konsolide metni
   *    çekilir, madde sürüm farkı işlenir.
   *  - RG diğer kayıtları: belge metniyle Legislation platform havuzuna girer.
   */
  async approveItem(user: PlatformAuthUser, id: string): Promise<{
    item: { status: string };
    poolOutcome: string;
    statuteResults?: StatuteImportResult[];
    note?: string;
  }> {
    const item = await this.prisma.client.legislationIngestItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Kuyruk kaydı bulunamadı.");
    if (item.status !== "BEKLIYOR") {
      throw new BadRequestException(`Kayıt zaten ${item.status}; yalnız BEKLIYOR kayıtlar onaylanabilir.`);
    }

    let poolOutcome = "LEGISLATION";
    let statuteResults: StatuteImportResult[] | undefined;
    let note: string | undefined;
    let poolRecordId: string | null = null;

    if (item.sourceKey === TOHUM_SOURCE_KEY) {
      const result = await this.approveSeedItem(user, item);
      poolOutcome = result.outcome;
      statuteResults = result.statuteResults;
      poolRecordId = result.poolRecordId;
    } else if (item.sourceKey === KVKK_SOURCE_KEY) {
      const result = await this.approveKvkkItem(user, item);
      poolOutcome = result.outcome;
      poolRecordId = result.poolRecordId;
      note = result.note;
    } else if (item.sourceKey === REKABET_SOURCE_KEY) {
      // Karar metni PDF'tir: künye (liste künyesi kuyruk kaydında) ile girer.
      const result = await this.pool.importLegislation(user, {
        docType: "DIGER",
        title: item.title,
        number: item.number ?? null,
        fullText: item.fullText ?? null,
        sourceKey: REKABET_SOURCE_KEY,
        sourceUrl: item.sourceUrl ?? null,
        versionNote: item.number
          ? `Rekabet Kurulu Kararı — Karar No ${item.number}`
          : "Rekabet Kurulu Kararı",
      });
      poolOutcome = "LEGISLATION";
      poolRecordId = result.id;
    } else if (item.sourceKey === RG_SOURCE_KEY) {
      const result = await this.approveRgItem(user, item);
      poolOutcome = result.outcome;
      statuteResults = result.statuteResults;
      note = result.note;
      poolRecordId = result.poolRecordId;
    } else {
      throw new BadRequestException(`Bilinmeyen kaynak: ${item.sourceKey}`);
    }

    const updated = await this.prisma.client.legislationIngestItem.update({
      where: { id },
      data: {
        status: "ONAYLANDI",
        reviewedBy: user.id,
        reviewedAt: new Date(),
        poolRecordId,
      },
    });
    return { item: { status: updated.status }, poolOutcome, statuteResults, note };
  }

  /**
   * KVKK Kurul kararı onayı — karar metni çekilir (RG PDF'i ise künyeyle girer),
   * künyeden karar tarihi/no çıkarılır; Legislation platform kaydı olarak yazılır.
   */
  private async approveKvkkItem(
    user: PlatformAuthUser,
    item: {
      id: string;
      title: string;
      sourceUrl: string | null;
      fullText: string | null;
    },
  ) {
    let docText: string | null = item.fullText;
    if (!docText && item.sourceUrl && /\/Icerik\/\d+\//.test(item.sourceUrl)) {
      try {
        docText = await this.kvkk.fetchDecisionText(item.sourceUrl);
      } catch {
        docText = null;
      }
    }
    const meta = docText ? extractKvkkDecisionMeta(docText.slice(0, 4000)) : {};
    const result = await this.pool.importLegislation(user, {
      docType: "DIGER",
      title: item.title,
      fullText: docText,
      sourceKey: KVKK_SOURCE_KEY,
      sourceUrl: item.sourceUrl,
      rgDate: meta.kararTarihi ? parseTrDate(meta.kararTarihi) : undefined,
      versionNote: meta.kararNo
        ? `KVKK Kurul Kararı — Karar No ${meta.kararNo}`
        : "KVKK Kurul Kararı",
    });
    return {
      outcome: "LEGISLATION",
      poolRecordId: result.id,
      note:
        docText && !meta.kararNo
          ? "Karar künyesi metinden çıkarılamadı; başlığı/tarihi kaynakla karşılaştırın."
          : undefined,
    };
  }

  /** Tohum kaydı: konsolide metin → Statute havuzu. */
  private async approveSeedItem(
    user: PlatformAuthUser,
    item: { externalKey: string; title: string; number: string | null; abbrs: string | null; rgDate: Date | null; rgNo: string | null; sourceUrl: string | null },
  ) {
    const doc = await this.mevzuat.fetchDocument(item.externalKey);
    const [mevzuatNo, mevzuatTur, tertip] = item.externalKey.split(".");
    const parsed = parseStatuteText(doc.text);
    const result = await this.pool.importStatute(user, {
      mevzuatNo,
      mevzuatTur: Number(mevzuatTur),
      tertip: Number(tertip),
      title: item.title || doc.text.split("\n")[0]?.trim(),
      abbrs: item.abbrs ?? undefined,
      rgDate: item.rgDate ? item.rgDate.toISOString().slice(0, 10) : null,
      rgNo: item.rgNo,
      fullText: doc.text,
      articles: parsed.articles,
      sourceKey: this.mevzuat.key,
      sourceUrl: doc.sourceUrl,
    });
    return { outcome: result.status, statuteResults: [result], poolRecordId: result.statuteId ?? null };
  }

  /** RG kaydı: değişiklik → etkilenen kanunların sürüm güncellemesi + belge kaydı. */
  private async approveRgItem(
    user: PlatformAuthUser,
    item: {
      id: string;
      docType: string;
      title: string;
      rgDate: Date | null;
      rgNo: string | null;
      sourceUrl: string | null;
      fullText: string | null;
    },
  ) {
    const rgDateKey = item.rgDate ? item.rgDate.toISOString().slice(0, 10) : null;

    // Belge metnini çek (HTML ise) — hem kayıt hem etki analizi için.
    let docText: string | null = item.fullText;
    if (!docText && item.sourceUrl && /\.htm$/i.test(item.sourceUrl)) {
      try {
        docText = await this.rg.fetchDocumentText(item.sourceUrl);
      } catch {
        docText = null;
      }
    }

    // KANUN: etkilenen kanunların konsolide metnini yeniden çek, sürümle.
    if (item.docType === "KANUN") {
      const targets = new Set<string>(extractStatuteNumbers(item.title));
      if (docText) {
        for (const no of extractStatuteNumbers(docText.slice(0, 60_000))) targets.add(no);
      }
      targets.delete("2709"); // Anayasa değişikliği ayrı işleyiş; tohumdaki kaydı ezmez.

      const statuteResults: StatuteImportResult[] = [];
      for (const mevzuatNo of targets) {
        try {
          const doc = await this.mevzuat.fetchDocument(`${mevzuatNo}.1.5`);
          const parsed = parseStatuteText(doc.text);
          statuteResults.push(
            await this.pool.importStatute(user, {
              mevzuatNo,
              mevzuatTur: 1,
              tertip: 5,
              title: parsed.header.mevzuatNo
                ? doc.text.split("\n")[0]?.trim() || `${mevzuatNo} sayılı Kanun`
                : `${mevzuatNo} sayılı Kanun`,
              rgDate: rgDateKey,
              rgNo: item.rgNo,
              fullText: doc.text,
              articles: parsed.articles,
              sourceKey: this.mevzuat.key,
              sourceUrl: doc.sourceUrl,
              changeRgDate: rgDateKey,
              changeRgNo: item.rgNo,
            }),
          );
        } catch (err) {
          statuteResults.push({
            status: "REDDEDILDI",
            reason: `${mevzuatNo} konsolide metni alınamadı: ${(err as Error).message}`,
          });
        }
      }

      const note =
        statuteResults.length === 0
          ? "Değişiklik metninden etkilenen kanun tespit edilemedi; belge kaydı Legislation platform havuzuna yazıldı."
          : undefined;

      const docResult = await this.pool.importLegislation(user, {
        docType: item.docType,
        title: item.title,
        fullText: docText,
        sourceKey: RG_SOURCE_KEY,
        sourceUrl: item.sourceUrl,
        rgDate: rgDateKey,
        rgNo: item.rgNo,
        versionNote: rgDateKey ? `RG ${rgDateKey} — ${item.rgNo ?? "?"} sayılı` : undefined,
      });

      return {
        outcome: statuteResults.some((r) => r.status !== "REDDEDILDI")
          ? "STATUTE_GUNCELLENDI"
          : "LEGISLATION",
        statuteResults: statuteResults.length > 0 ? statuteResults : undefined,
        note,
        poolRecordId: docResult.id,
      };
    }

    // KANUN DIŞI: belge kaydı (yönetmelik/tebliğ/genelge...).
    const result = await this.pool.importLegislation(user, {
      docType: item.docType,
      title: item.title,
      fullText: docText,
      sourceKey: RG_SOURCE_KEY,
      sourceUrl: item.sourceUrl,
      rgDate: rgDateKey,
      rgNo: item.rgNo,
      versionNote: rgDateKey ? `RG ${rgDateKey} — ${item.rgNo ?? "?"} sayılı` : undefined,
    });
    return { outcome: "LEGISLATION", poolRecordId: result.id };
  }

  /** RED — gerekçe ZORUNLU; aynı belge bir daha kuyruğa girmez. */
  async rejectItem(user: PlatformAuthUser, id: string, reason: string) {
    const item = await this.prisma.client.legislationIngestItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Kuyruk kaydı bulunamadı.");
    if (item.status !== "BEKLIYOR") {
      throw new BadRequestException(`Kayıt zaten ${item.status}; yalnız BEKLIYOR kayıtlar reddedilebilir.`);
    }
    const updated = await this.prisma.client.legislationIngestItem.update({
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
      action: "LEGISLATION_INGEST_REJECT",
      entity: "LegislationIngestItem",
      entityId: id,
      detail: `${item.title} — ${reason}`,
    });
    return updated;
  }
}
