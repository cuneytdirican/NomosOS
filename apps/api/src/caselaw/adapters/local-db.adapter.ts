/**
 * LocalDbAdapter — kendi ortak içtihat havuzumuzda (CaseLawDocument) arama.
 *
 * Bu adaptör DIŞ BİR SERVİSE BAĞLANMAZ. Havuza kayıtlar yalnızca (a) elle giriş
 * (ManualEntryAdapter), (b) seed demo verisi ve (c) ileride eklenecek gerçek
 * kaynak adaptörleri üzerinden düşer. Böylece "sistemin bulduğu" her kayıt,
 * kaynağı (sourceAdapter) belli, gerçekten var olan bir satırdır — Teyit
 * Ajanı'nın DOGRULANDI kararı bu satıra dayanır.
 *
 * Arama tekniği: Postgres ILIKE (Prisma `contains` + `mode: "insensitive"`) ile
 * aday kümesi çekilir, skorlama JS tarafında DETERMİNİSTİK yapılır. pgvector /
 * gömme tabanlı benzerlik Faz 3'e bırakılmıştır (ortak teknik karar 2).
 *
 * KİRACI NOTU: CaseLawDocument'ta tenantId YOKTUR (içtihat kamusal veridir,
 * havuz tüm bürolarca paylaşılır). Kiracı izolasyonu CaseLawReference üzerinden
 * kurulur; buraya kiracıya özgü hiçbir veri yazılmaz.
 */

import { Injectable } from "@nestjs/common";
import type { CaseLawDocument, Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import {
  isDemoRecord,
  tenantVisibility,
  type CaseLawAdapterHealth,
  type CaseLawCitationLookup,
  type CaseLawCitationQuery,
  type CaseLawFilters,
  type CaseLawHit,
  type CaseLawSourceAdapter,
} from "./types";

export const LOCAL_DB_ADAPTER_KEY = "YEREL_HAVUZ";

/**
 * Skorlamaya giren alanlar. `fullText` BİLEREK YOK: DTO 200.000 karaktere izin
 * verir ve her aramada iki adaptörden 400 satırı tam metniyle çekmek istek başına
 * onlarca MB ayırıyordu. Tam metin eşleşmesi artık DB'de (where `contains` +
 * pg_trgm GIN indeksi) yapılır; JS yalnızca sıralar.
 */
const SCORING_SELECT = {
  id: true,
  court: true,
  chamber: true,
  caseNumber: true,
  decisionNumber: true,
  decisionDate: true,
  summary: true,
  sourceUrl: true,
  sourceAdapter: true,
  createdByTenantId: true,
} as const;

type ScoringRecord = {
  id: string;
  court: string;
  chamber: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate: Date | null;
  summary: string | null;
  sourceUrl: string | null;
  sourceAdapter: string;
};

/** Alan bazlı ağırlıklar — künye eşleşmesi en güçlü sinyaldir. */
const FIELD_WEIGHTS = {
  caseNumber: 5,
  decisionNumber: 5,
  court: 3,
  chamber: 3,
  summary: 2,
  fullText: 1,
} as const;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
/** Skorlama için DB'den çekilecek aday tavanı. */
const CANDIDATE_CAP = 50;

/** Sorguyu aranabilir terimlere ayırır: "2024/1183" gibi künye parçaları korunur. */
export function tokenizeQuery(query: string): string[] {
  const raw = query
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    // Künye parçası (2024/1183) her uzunlukta anlamlıdır; kelimelerde 3 harf sınırı var.
    const isCitationPart = /^\d{4}\/\d{1,6}$/.test(token);
    if (!isCitationPart && token.length < 3) continue;
    const key = token.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function contains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLocaleLowerCase("tr-TR").includes(needle.toLocaleLowerCase("tr-TR"));
}

/**
 * Kayıt için deterministik skor + eşleşen terimler.
 *
 * `fullText` opsiyoneldir: arama yolunda tam metin DB'den ÇEKİLMEZ (bellek).
 * Bu durumda `fullTextMatchedInDb` bayrağı kullanılır — aday kümesi zaten
 * `where ... contains` ile süzülmüş olduğu için, hiçbir seçili alanda eşleşme
 * yoksa eşleşmenin tam metinde olduğu KESİNDİR ve en düşük ağırlık verilir.
 */
export function scoreRecord(
  record: Pick<CaseLawDocument, "court" | "chamber" | "caseNumber" | "decisionNumber" | "summary"> & {
    fullText?: string | null;
  },
  terms: readonly string[],
  fullTextMatchedInDb = false,
): { score: number; matchedTerms: string[] } {
  if (terms.length === 0) return { score: 0, matchedTerms: [] };

  let total = 0;
  const matched: string[] = [];
  for (const term of terms) {
    let best = 0;
    if (contains(record.caseNumber, term)) best = Math.max(best, FIELD_WEIGHTS.caseNumber);
    if (contains(record.decisionNumber, term)) best = Math.max(best, FIELD_WEIGHTS.decisionNumber);
    if (contains(record.court, term)) best = Math.max(best, FIELD_WEIGHTS.court);
    if (contains(record.chamber, term)) best = Math.max(best, FIELD_WEIGHTS.chamber);
    if (contains(record.summary, term)) best = Math.max(best, FIELD_WEIGHTS.summary);
    if (contains(record.fullText, term)) best = Math.max(best, FIELD_WEIGHTS.fullText);
    if (best > 0) {
      total += best;
      matched.push(term);
    }
  }

  if (total === 0 && fullTextMatchedInDb) {
    // Eşleşme yalnızca tam metinde; kayıt kaybolmasın diye taban ağırlık.
    total = FIELD_WEIGHTS.fullText;
    matched.push("(karar tam metni)");
  }

  const maxPossible = terms.length * FIELD_WEIGHTS.caseNumber;
  return { score: Math.min(1, total / maxPossible), matchedTerms: matched };
}

/** Künye numarasını "YYYY/N" biçimine indirger (baştaki sıfırlar ve boşluklar atılır). */
export function normalizeDocketNumber(value: string): string {
  const compact = value.replace(/\s+/g, "");
  const m = /^(\d{4})\/0*(\d{1,6})$/.exec(compact);
  return m ? `${m[1]}/${m[2]}` : compact;
}

@Injectable()
export class LocalDbCaseLawAdapter implements CaseLawSourceAdapter {
  readonly key = LOCAL_DB_ADAPTER_KEY;
  readonly name = "Yerel İçtihat Havuzu";
  readonly canSearch = true;
  readonly canFetchByCitation = true;

  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, filters: CaseLawFilters): Promise<CaseLawHit[]> {
    const terms = tokenizeQuery(query);
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // KİRACI GÖRÜNÜRLÜĞÜ: başka büronun elle girdiği kayıt aramada çıkmaz.
    const and: Prisma.CaseLawDocumentWhereInput[] = [tenantVisibility(filters.tenantId)];
    if (filters.court) {
      and.push({ court: { contains: filters.court, mode: "insensitive" } });
    }
    if (filters.from || filters.to) {
      and.push({
        decisionDate: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      });
    }
    if (terms.length > 0) {
      and.push({
        OR: terms.flatMap((term) => [
          { court: { contains: term, mode: "insensitive" as const } },
          { chamber: { contains: term, mode: "insensitive" as const } },
          { caseNumber: { contains: term, mode: "insensitive" as const } },
          { decisionNumber: { contains: term, mode: "insensitive" as const } },
          { summary: { contains: term, mode: "insensitive" as const } },
          { fullText: { contains: term, mode: "insensitive" as const } },
        ]),
      });
    }

    const candidates = await this.prisma.client.caseLawDocument.findMany({
      where: { AND: and },
      // `fullText` SEÇİLMEZ: 200.000 karakterlik alanı 50 satır için belleğe
      // taşımanın anlamı yok; eşleşme zaten DB'de yapıldı.
      select: SCORING_SELECT,
      orderBy: [{ decisionDate: "desc" }, { id: "asc" }],
      take: CANDIDATE_CAP,
    });

    const hits = candidates.map((record) => {
      // Terim varsa kayıt DB süzgecinden geçmiştir; seçili alanlarda eşleşme
      // yoksa eşleşme tam metindedir.
      const { score, matchedTerms } = scoreRecord(record, terms, terms.length > 0);
      return this.toHit(record, score, matchedTerms);
    });

    // Terim verilmediyse (yalnız süzgeçli listeleme) skor 0 kalır; tarih sırası korunur.
    return hits
      .filter((hit) => terms.length === 0 || hit.score > 0)
      .sort((a, b) => b.score - a.score || compareDateDesc(a.decisionDate, b.decisionDate))
      .slice(0, limit);
  }

  async fetchByCitation(query: CaseLawCitationQuery): Promise<CaseLawCitationLookup> {
    const caseNumber = normalizeDocketNumber(query.caseNumber);
    const decisionNumber = normalizeDocketNumber(query.decisionNumber);

    try {
      const matches = await this.prisma.client.caseLawDocument.findMany({
        // TEYİT DE GÖRÜNÜRLÜK SÜZGECİNE TABİDİR: başka bir büronun elle girdiği
        // kayıt bu büronun atfını DOGRULANDI yapamaz (havuz zehirlenmesi savunması).
        where: { caseNumber, decisionNumber, ...tenantVisibility(query.tenantId) },
        orderBy: [{ createdByTenantId: "asc" }, { id: "asc" }],
        take: 5,
      });

      if (matches.length === 0) {
        return {
          outcome: "NOT_FOUND",
          note: `Yerel havuzda ${caseNumber} E. ${decisionNumber} K. künyesine ait kayıt yok.`,
          adapterKey: this.key,
        };
      }

      const narrowed = query.source ? matches.filter((m) => courtMatchesSource(m.court, query.source!)) : matches;
      const pool = narrowed.length > 0 ? narrowed : matches;

      if (pool.length > 1) {
        return {
          outcome: "FOUND",
          record: pool[0],
          ambiguous: true,
          note: `Aynı esas/karar numarasıyla ${pool.length} kayıt bulundu; künye tek bir karara indirgenemedi.`,
          adapterKey: this.key,
        };
      }

      const record = pool[0];
      if (query.source && !courtMatchesSource(record.court, query.source)) {
        return {
          outcome: "FOUND",
          record,
          ambiguous: true,
          note: `Künyedeki mahkeme (${query.source}) havuzdaki kayıtla (${record.court}) uyuşmuyor.`,
          adapterKey: this.key,
        };
      }

      return {
        outcome: "FOUND",
        record,
        note: `${record.court} ${record.caseNumber} E. ${record.decisionNumber} K.${
          isDemoRecord(record) ? " [DEMO VERİ — gerçek karar değildir]" : ""
        }`,
        adapterKey: this.key,
      };
    } catch (err) {
      // FAIL-CLOSED: arama yapılamadıysa "bulunamadı" DEĞİL, "arama yapılamadı" döner.
      return {
        outcome: "SEARCH_FAILED",
        note: `Yerel havuza erişilemedi: ${(err as Error).message}`,
        adapterKey: this.key,
      };
    }
  }

  async healthCheck(): Promise<CaseLawAdapterHealth> {
    const base = {
      key: this.key,
      name: this.name,
      checkedAt: new Date(),
      canSearch: this.canSearch,
      canFetchByCitation: this.canFetchByCitation,
    };
    try {
      const count = await this.prisma.client.caseLawDocument.count();
      return { ...base, healthy: true, message: `Havuzda ${count} karar kaydı var.` };
    } catch (err) {
      return { ...base, healthy: false, message: `Veritabanına erişilemedi: ${(err as Error).message}` };
    }
  }

  private toHit(record: ScoringRecord, score: number, matchedTerms: string[]): CaseLawHit {
    return {
      caseLawId: record.id,
      court: record.court,
      chamber: record.chamber ?? undefined,
      caseNumber: record.caseNumber,
      decisionNumber: record.decisionNumber,
      decisionDate: record.decisionDate ?? undefined,
      summary: record.summary ?? undefined,
      sourceUrl: record.sourceUrl ?? undefined,
      sourceAdapter: record.sourceAdapter,
      score,
      matchedTerms,
      isDemo: isDemoRecord(record),
    };
  }
}

function compareDateDesc(a?: Date, b?: Date): number {
  return (b?.getTime() ?? 0) - (a?.getTime() ?? 0);
}

/** "YARGITAY" gibi kaynak etiketi ile mahkeme adının bağdaşıp bağdaşmadığı. */
export function courtMatchesSource(court: string, source: string): boolean {
  const c = court.toLocaleLowerCase("tr-TR");
  switch (source) {
    case "YARGITAY":
      return c.includes("yargıtay");
    case "DANISTAY":
      return c.includes("danıştay");
    case "BAM":
      return c.includes("bölge adliye") || c.includes("bam");
    case "AYM":
      return c.includes("anayasa");
    case "AIHM":
      return c.includes("aihm") || c.includes("insan hakları");
    default:
      // BILINMIYOR veya tanınmayan etiket kısıtlama üretmez.
      return true;
  }
}
