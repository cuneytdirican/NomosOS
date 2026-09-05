/**
 * CITATION_VERIFY — Teyit Ajanı'nın ARKA UCU (Modül 23 / Modül 22 teyit kapısı).
 *
 * ÜRÜNÜN EN KRİTİK GÜVEN MEKANİZMASI. Tek cümlelik sözleşmesi:
 *
 *   "Bir atfın var olup olmadığına LLM KARAR VEREMEZ. Yalnızca kayıtlı veriye bakılır."
 *
 * Bu serviste HİÇBİR LLM ÇAĞRISI YOKTUR ve olmayacaktır. Akış tamamen
 * deterministiktir:
 *   1. Ham atıf metni regex ile ayrıştırılır (packages/legal-ai citation-patterns).
 *   2. İçtihat künyesi ise esas/karar numarası BİREBİR eşleşmeyle adaptörlerde aranır.
 *   3. Bulundu → DOGRULANDI · Bulunamadı → BULUNAMADI · Arama yapılamadı/çelişkili → BELIRSIZ.
 *   4. Sonuç CitationCheck'e yazılır (denetim izi).
 *
 * FAIL-CLOSED: erişilemeyen kaynak, tanınmayan biçim, birden çok eşleşme ve
 * mahkeme uyuşmazlığı ASLA DOGRULANDI üretmez.
 *
 * MEVZUAT ATIFLARI: platform kanun havuzu (Statute/StatuteArticleVersion,
 * mevzuat.gov.tr beslemesi) üzerinden DETERMİNİSTİK doğrulanır. Havuz
 * kısmi bir havuzdur: kanun havuzda DEĞİLSE sonuç BULUNAMADI değil BELIRSIZ'dir
 * (havuzun kapsamı dışında olması atfın yanlış olduğu anlamına gelmez);
 * kanun havuzda ama madde yoksa BULUNAMADI'dır (mülga/yanlış numara olası).
 */

import { Injectable } from "@nestjs/common";
import type { CitationStatus } from "@nomosos/db";
import {
  dedupeCitations,
  extractCitations,
  type ExtractedCitation,
} from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { CaseLawAdapterRegistry } from "./adapters/registry.service";
import { isDemoRecord } from "./adapters/types";
import { courtMatchesSource } from "./adapters/local-db.adapter";
import { StatuteLookupService } from "../legislation/statute-lookup.service";
import type { AuthUser } from "../common/types";

/** Atıf türü — TANINMADI, biçimi ayrıştırılamayan ham metindir. */
export type CitationKind = "ICTIHAT" | "MEVZUAT" | "TANINMADI";

/** Eşleşen kanun/madde künyesi (yalnız MEVZUAT DOGRULANDI'sında dolu). */
export interface MatchedStatute {
  id: string;
  title: string;
  mevzuatNo: string;
  articleNo: string;
  versionSeq: number;
  /** Bu madde sürümünün yürürlük başlangıcı (ISO tarih ya da null). */
  effectiveFrom?: string | null;
  /** Bu sürümü doğuran değişiklik RG künyesi (SOURCE LINEAGE). */
  changeRgDate?: string | null;
  changeRgNo?: string | null;
  sourceKey: string;
  sourceUrl?: string | null;
}

export interface CitationVerificationResult {
  /** Doğrulamaya giren ham künye metni. */
  raw: string;
  kind: CitationKind;
  status: CitationStatus;
  /** Eşleşen içtihat havuz kaydı (yalnız ICTIHAT DOGRULANDI'sında dolu). */
  caseLawId?: string;
  matchedRecord?: {
    id: string;
    court: string;
    chamber?: string;
    caseNumber: string;
    decisionNumber: string;
    decisionDate?: string;
    sourceAdapter: string;
  };
  /** Eşleşen kanun/madde künyesi (yalnız MEVZUAT DOGRULANDI'sında dolu). */
  matchedStatute?: MatchedStatute;
  /**
   * Eşleşen kayıt seed/demo verisi mi? Demo kayıt "gerçek karar" değildir;
   * dilekçe teyit kapısı bunu HAZIR statüsüne geçirmez.
   */
  isDemo: boolean;
  note: string;
  /** Hangi adaptör ne dedi — denetim izi. */
  adapterNotes: string[];
}

export interface CitationVerificationSummary {
  total: number;
  verified: number;
  notFound: number;
  ambiguous: number;
  /** Modül 23 sözleşmesi: hepsi doğrulandı / bir kısmı / hiçbiri. */
  overall: "PASSED" | "PARTIAL" | "FAILED";
}

export interface CitationVerificationReport {
  results: CitationVerificationResult[];
  summary: CitationVerificationSummary;
  /** Sonuçların CitationCheck'e yazıldığı kaynak (yazıldıysa). */
  persistedTo?: { sourceType: string; sourceId: string };
  /** Kaynak sahipliği doğrulanamadığı için yazma atlandıysa nedeni. */
  persistSkippedReason?: string;
}

const NO_STATUTE_POOL_NOTE =
  "Mevzuat atfı deterministik olarak doğrulanamadı: kanun, platform mevzuat havuzunda " +
  "bulunamadı (havuz kısmi olabilir). Madde numarasını yürürlükteki mevzuattan elle teyit edin.";

@Injectable()
export class CitationVerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: CaseLawAdapterRegistry,
    /** Mevzuat teyidi: Statute/StatuteArticleVersion platform havuzu (Faz 1). */
    private readonly statutes: StatuteLookupService,
  ) {}

  /** Serbest metinden atıfları çıkarır (dilekçe/sohbet/analiz çıktısı için). */
  extractFromText(text: string): ExtractedCitation[] {
    return dedupeCitations(extractCitations(text));
  }

  /**
   * Ham atıf metinlerini deterministik olarak doğrular.
   *
   * @param sourceType PETITION | CHAT | ANALYSIS — CitationCheck.sourceType
   * @param sourceId   Kaynağın kimliği. Dilekçelerde SÜRÜM kimliği verilir; böylece
   *                   içerik değişince eski teyit otomatik olarak geçersiz kalır
   *                   (bayat teyit yasağı, Modül 22 iş kuralı 5).
   */
  async verify(
    user: AuthUser,
    input: {
      citations: readonly string[];
      sourceType?: string;
      sourceId?: string;
    },
  ): Promise<CitationVerificationReport> {
    const unique = dedupeRaw(input.citations);
    const results: CitationVerificationResult[] = [];
    for (const raw of unique) {
      results.push(await this.verifyOne(user.tenantId, raw));
    }

    const summary = summarize(results);

    let persistedTo: CitationVerificationReport["persistedTo"];
    let persistSkippedReason: string | undefined;
    if (input.sourceType && input.sourceId) {
      // [DÜZELTME] `sourceId` SAHİPLİĞİ DOĞRULANIR.
      //
      // Eskiden istemci herhangi bir `sourceId` gönderebiliyordu ve `persist`
      // o kaynağın CitationCheck satırlarını SİLİP kendi sonuçlarını yazıyordu.
      // Aynı kiracıdaki bir kullanıcı, düzenleyemediği bir dilekçenin güncel
      // sürüm kimliğini vererek teyit şeridini ve `readyGate.verificationRun`
      // göstergesini güvenilmez hâle getirebiliyordu.
      const owned = await this.assertSourceOwnership(user.tenantId, input.sourceType, input.sourceId);
      if (owned) {
        await this.persist(user.tenantId, input.sourceType, input.sourceId, results);
        persistedTo = { sourceType: input.sourceType, sourceId: input.sourceId };
      } else {
        persistSkippedReason =
          "Belirtilen kaynak (sourceId) büronuzda bulunamadı; sonuç yalnızca rapor olarak " +
          "döndürüldü, hiçbir teyit kaydı değiştirilmedi.";
      }
    }

    return { results, summary, persistedTo, persistSkippedReason };
  }

  /**
   * `sourceId` gerçekten bu kiracıya ait bir kayda mı işaret ediyor?
   *
   * PETITION  → PetitionVersion (dilekçe kiracıya ait olmalı)
   * ANALYSIS  → CaseAnalysisReport
   * CHAT      → ChatMessage (oturumu kiracıya ait olmalı)
   */
  private async assertSourceOwnership(
    tenantId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<boolean> {
    switch (sourceType) {
      case "PETITION": {
        const version = await this.prisma.client.petitionVersion.findFirst({
          where: { id: sourceId, petition: { tenantId } },
          select: { id: true },
        });
        return version !== null;
      }
      case "ANALYSIS": {
        const report = await this.prisma.client.caseAnalysisReport.findFirst({
          where: { id: sourceId, tenantId },
          select: { id: true },
        });
        return report !== null;
      }
      case "CHAT": {
        const message = await this.prisma.client.chatMessage.findFirst({
          where: { id: sourceId, session: { tenantId } },
          select: { id: true },
        });
        if (message) return true;
        const session = await this.prisma.client.chatSession.findFirst({
          where: { id: sourceId, tenantId },
          select: { id: true },
        });
        return session !== null;
      }
      default:
        return false;
    }
  }

  /** Daha önce yazılmış teyit sonuçlarını okur (dilekçe kapısı bunu kullanır). */
  async readChecks(
    tenantId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<CitationVerificationResult[]> {
    const rows = await this.prisma.client.citationCheck.findMany({
      where: { tenantId, sourceType, sourceId },
      orderBy: { checkedAt: "asc" },
    });
    return rows.map((row) => ({
      raw: row.rawCitation,
      kind: kindFromNote(row.note),
      status: row.status,
      isDemo: (row.note ?? "").includes("[DEMO VERİ]"),
      note: row.note ?? "",
      adapterNotes: [],
    }));
  }

  /** Tek bir ham künyeyi doğrular. */
  private async verifyOne(tenantId: string, raw: string): Promise<CitationVerificationResult> {
    const parsed = extractCitations(raw)[0];

    if (!parsed) {
      return {
        raw,
        kind: "TANINMADI",
        status: "BELIRSIZ",
        isDemo: false,
        note:
          "Atıf biçimi tanınmadı (beklenen: \"... 2023/4512 E. 2023/9981 K.\" veya \"HMK m.317\"). " +
          "Doğrulanamayan atıf doğrulanmış sayılmaz.",
        adapterNotes: [],
      };
    }

    if (parsed.kind === "MEVZUAT") {
      return this.verifyStatute(raw, parsed);
    }

    if (!parsed.esasNo || (!parsed.kararNo && parsed.source !== "AYM")) {
      return {
        raw,
        kind: "ICTIHAT",
        status: "BELIRSIZ",
        isDemo: false,
        note:
          "Künye eksik: esas ve karar numarasının ikisi de olmadan deterministik arama yapılamaz. " +
          "Eksik künye doğrulanmış sayılmaz.",
        adapterNotes: [],
      };
    }

    // AYM bireysel başvuru künyesinde karar numarası YOKTUR ("2019/12345 başvuru
    // numaralı karar"): boş kararNo ile devam edilir; AYM canlı adaptörü
    // başvuru numarasıyla arar, diğer adaptörler eşleşmez.
    const aggregated = await this.adapters.fetchByCitationAll({
      // Görünürlük süzgeci: başka büronun elle girdiği kayıt bu atfı doğrulayamaz.
      tenantId,
      source: parsed.source && parsed.source !== "BILINMIYOR" ? parsed.source : undefined,
      chamber: parsed.chamber,
      caseNumber: parsed.esasNo,
      decisionNumber: parsed.kararNo ?? "",
    });
    const adapterNotes = aggregated.perAdapter.map((r) => `${r.adapterKey}: ${r.outcome} — ${r.note}`);

    if (aggregated.outcome === "SEARCH_FAILED") {
      return {
        raw,
        kind: "ICTIHAT",
        status: "BELIRSIZ",
        isDemo: false,
        note:
          "Kaynak adaptörüne erişilemediği için arama yapılamadı. Erişilemeyen kaynak ASLA " +
          `doğrulanmış sayılmaz (fail-closed). ${aggregated.lookup?.note ?? ""}`.trim(),
        adapterNotes,
      };
    }

    if (aggregated.outcome === "NOT_FOUND") {
      return {
        raw,
        kind: "ICTIHAT",
        status: "BULUNAMADI",
        isDemo: false,
        note:
          "Arama sağlıklı çalıştı ancak bu esas/karar numarasına ait kayıt bulunamadı. " +
          "Atıf büyük olasılıkla hatalı ya da uydurmadır; metinden çıkarın veya doğru " +
          "künyeyle değiştirip kararı sisteme elle ekleyin.",
        adapterNotes,
      };
    }

    const lookup = aggregated.lookup!;
    const record = lookup.record!;
    const demo = isDemoRecord(record);

    if (lookup.ambiguous) {
      return {
        raw,
        kind: "ICTIHAT",
        status: "BELIRSIZ",
        caseLawId: record.id,
        matchedRecord: toMatched(record),
        isDemo: demo,
        note: `Eşleşme belirsiz: ${lookup.note}`,
        adapterNotes,
      };
    }

    // MAHKEME UYUMU — adaptör ne dönerse dönsün burada YENİDEN denetlenir:
    // künye "Yargıtay" diyorsa eşleşen kayıt Anayasa Mahkemesi olamaz. Adaptörler
    // kendi kapılarını uygular; bu satır ikinci kilittir (fail-closed).
    if (parsed.source && parsed.source !== "BILINMIYOR" && !courtMatchesSource(record.court, parsed.source)) {
      return {
        raw,
        kind: "ICTIHAT",
        status: "BELIRSIZ",
        caseLawId: record.id,
        matchedRecord: toMatched(record),
        isDemo: demo,
        note:
          `Künyedeki mahkeme (${parsed.source}) eşleşen kayıtla (${record.court}) uyuşmuyor; ` +
          "aynı numaralı farklı bir mahkemenin kararı olabilir.",
        adapterNotes,
      };
    }

    // Daire bilgisi künyede varsa kayıtla bağdaşmalıdır; bağdaşmıyorsa BELIRSIZ.
    if (parsed.chamber && !chamberAgrees(parsed.chamber, record.chamber, record.court)) {
      return {
        raw,
        kind: "ICTIHAT",
        status: "BELIRSIZ",
        caseLawId: record.id,
        matchedRecord: toMatched(record),
        isDemo: demo,
        note:
          `Künyedeki daire ("${parsed.chamber}") havuzdaki kayıtla ` +
          `("${record.chamber ?? record.court}") bağdaşmıyor; aynı numaralı farklı bir karar olabilir.`,
        adapterNotes,
      };
    }

    return {
      raw,
      kind: "ICTIHAT",
      status: "DOGRULANDI",
      caseLawId: record.id,
      matchedRecord: toMatched(record),
      isDemo: demo,
      note: demo
        ? `[DEMO VERİ] Eşleşen kayıt gerçek bir mahkeme kararı değildir (kaynak: ${record.sourceAdapter}); ` +
          "arayüz denemesi içindir, dilekçede kullanılamaz."
        : record.decisionNumber
          ? `Havuzdaki kayıtla birebir eşleşti: ${record.court} ${record.caseNumber} E. ` +
            `${record.decisionNumber} K. (kaynak: ${record.sourceAdapter})`
          : // AYM bireysel başvurusu gibi karar numarası taşımayan künyeler.
            `Kayıtla birebir eşleşti: ${record.court} ${record.caseNumber} başvuru no ` +
            `(kaynak: ${record.sourceAdapter})`,
      adapterNotes,
    };
  }

  /**
   * MEVZUAT ATFI DOĞRULAMASI — kanun havuzu (Statute) üzerinden deterministik.
   *
   *  - Kanun havuzda yok  → BELIRSIZ (havuz kısmidir; kapsam dışı olmak atfın
   *    yanlış olduğunu KANITLAMAZ — fail-closed, ama iftira da değil).
   *  - Kanun var, madde yok → BULUNAMADI (mülga ya da yanlış madde no).
   *  - İkisi de var → DOGRULANDI; sürüm künyesi (RG tarihi/sayısı) lineage
   *    olarak taşınır.
   */
  private async verifyStatute(
    raw: string,
    parsed: NonNullable<ReturnType<typeof extractCitations>[number]>,
  ): Promise<CitationVerificationResult> {
    const ref = parsed.statuteRef ?? "";
    const articleNo = parsed.articleNo ?? "";

    const lookup = await this.statutes.findArticle(ref, articleNo);
    if (!lookup) {
      return {
        raw,
        kind: "MEVZUAT",
        status: "BELIRSIZ",
        isDemo: false,
        note: `${NO_STATUTE_POOL_NOTE} (Atıf: ${ref || "?"} m.${articleNo || "?"})`,
        adapterNotes: [],
      };
    }

    if (!lookup.article) {
      return {
        raw,
        kind: "MEVZUAT",
        status: "BULUNAMADI",
        isDemo: false,
        note:
          `Kanun havuzda bulundu (${lookup.statute.title}) ancak "${articleNo}" numaralı madde ` +
          "mevcut sürümde yok: madde mülga/ildırılmış ya da madde numarası hatalı olabilir. " +
          "Madde numarasını yürürlükteki metinden teyit edin.",
        adapterNotes: [],
      };
    }

    const a = lookup.article;
    return {
      raw,
      kind: "MEVZUAT",
      status: "DOGRULANDI",
      matchedStatute: {
        id: lookup.statute.id,
        title: lookup.statute.title,
        mevzuatNo: lookup.statute.mevzuatNo,
        articleNo: a.articleNo,
        versionSeq: a.versionSeq,
        effectiveFrom: a.effectiveFrom ? a.effectiveFrom.toISOString().slice(0, 10) : null,
        changeRgDate: a.changeRgDate ? a.changeRgDate.toISOString().slice(0, 10) : null,
        changeRgNo: a.changeRgNo,
        sourceKey: lookup.statute.sourceKey,
        sourceUrl: lookup.statute.sourceUrl,
      },
      isDemo: false,
      note:
        `Havuzdaki kanunla eşleşti: ${lookup.statute.title} m.${a.articleNo} ` +
        `(sürüm ${a.versionSeq}` +
        `${a.effectiveFrom ? `, yürürlük ${a.effectiveFrom.toISOString().slice(0, 10)}` : ""}` +
        `${a.changeRgNo ? `, RG ${a.changeRgNo}` : ""}` +
        `; kaynak: ${lookup.statute.sourceKey})`,
      adapterNotes: [],
    };
  }

  /**
   * Sonuçları CitationCheck'e yazar.
   *
   * Aynı kaynak için önceki satırlar silinir: bu tablo "şu anki teyit durumu"dur,
   * dilekçe kapısı buradan okur. Geçmiş, AuditLog ve sürüm kayıtlarında durur.
   */
  private async persist(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    results: readonly CitationVerificationResult[],
  ): Promise<void> {
    await this.prisma.client.$transaction([
      this.prisma.client.citationCheck.deleteMany({ where: { tenantId, sourceType, sourceId } }),
      this.prisma.client.citationCheck.createMany({
        data: results.map((r) => ({
          tenantId,
          sourceType,
          sourceId,
          rawCitation: r.raw,
          status: r.status,
          // kind bilgisi not'un başına yazılır; readChecks bunu geri okur.
          note: `[${r.kind}] ${r.note}`,
        })),
      }),
    ]);
  }
}

function toMatched(record: {
  id: string;
  court: string;
  chamber: string | null;
  caseNumber: string;
  decisionNumber: string;
  decisionDate: Date | null;
  sourceAdapter: string;
}): NonNullable<CitationVerificationResult["matchedRecord"]> {
  return {
    id: record.id,
    court: record.court,
    chamber: record.chamber ?? undefined,
    caseNumber: record.caseNumber,
    decisionNumber: record.decisionNumber,
    decisionDate: record.decisionDate?.toISOString().slice(0, 10),
    sourceAdapter: record.sourceAdapter,
  };
}

/** "9. HD" ~ "9. Hukuk Dairesi" gibi yazımları bağdaştırır. */
export function chamberAgrees(
  cited: string,
  recordChamber: string | null,
  recordCourt: string,
): boolean {
  const citedNo = /(\d{1,3})\s*\./.exec(cited)?.[1];
  if (!citedNo) return true; // Daire numarası okunamadıysa kısıtlama üretme.
  const haystack = `${recordChamber ?? ""} ${recordCourt}`;
  const recordNo = /(\d{1,3})\s*\./.exec(haystack)?.[1];
  if (!recordNo) return true; // Kayıtta daire yoksa çelişki iddia etme.
  return citedNo === recordNo;
}

function dedupeRaw(citations: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of citations) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("tr-TR").replace(/[\s.,;:/\\-]+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function summarize(results: readonly CitationVerificationResult[]): CitationVerificationSummary {
  const verified = results.filter((r) => r.status === "DOGRULANDI").length;
  const notFound = results.filter((r) => r.status === "BULUNAMADI").length;
  const ambiguous = results.filter((r) => r.status === "BELIRSIZ").length;
  const total = results.length;
  const overall: CitationVerificationSummary["overall"] =
    total === 0 ? "PASSED" : verified === total ? "PASSED" : verified > 0 ? "PARTIAL" : "FAILED";
  return { total, verified, notFound, ambiguous, overall };
}

function kindFromNote(note: string | null): CitationKind {
  if (!note) return "TANINMADI";
  if (note.startsWith("[ICTIHAT]")) return "ICTIHAT";
  if (note.startsWith("[MEVZUAT]")) return "MEVZUAT";
  return "TANINMADI";
}
