/**
 * Çıktı doğrulama katmanı — halüsinasyon savunmasının son kapısı.
 *
 * Dört iş yapar:
 *   (a) ZOD ŞEMA DOĞRULAMASI — çıktı sözleşmeye uyuyor mu?
 *   (b) KAYNAKSIZ İDDİA ELEMESİ — sourceQuote/sourceRefs/citations alanı boş
 *       olan bulgular ELENİR ve kaç tanesinin elendiği raporlanır (Modül 21,
 *       iş kuralı 3: "kaynak gösterme zorunluluğu").
 *   (c) ATIF BİÇİMİ TANIMA — metindeki Yargıtay/Danıştay/BAM/AYM künyeleri ve
 *       mevzuat atıfları regex ile çıkarılır → Teyit Ajanı'na girdi olur.
 *   (d) "AI ÇIKTISI ÖNERİDİR" BAYRAĞI — sonuca eklenir; UI sorumluluk şeridini
 *       bu bayrakla gösterir.
 *
 * Sıra önemlidir: eleme, şema doğrulamasından ÖNCE ham JSON üzerinde yapılır.
 * Aksi halde tek bir kaynaksız bulgu yüzünden koşunun tamamı geçersiz olurdu.
 */

import type { TypeOf, ZodTypeAny } from "zod";
import { AI_ADVISORY_NOTICE } from "../prompts/system-core";
import type { CitationLookupResult } from "../prompts/citation-verify";
import type { CitationVerifyOutput, VerifiedCitation } from "../schemas";
import { dedupeCitations, extractCitations, type ExtractedCitation } from "./citation-patterns";

/** Bir bulgunun "kaynaklı" sayılması için dolu olması gereken alanlar. */
export const DEFAULT_SOURCE_FIELDS = [
  "sourceQuote",
  "sourceRefs",
  "citations",
  "refs",
  "sources",
] as const;

export interface DroppedFinding {
  /** Elenen bulgunun yolu, örn. "detections[2]". */
  path: string;
  reason: "KAYNAKSIZ";
  /** İnsan-okur özet (koşu kaydında gösterilir). */
  label: string;
}

export interface GuardIssue {
  code: "JSON_PARSE" | "SCHEMA" | "EMPTY_OUTPUT";
  message: string;
  path?: string;
}

export interface OutputGuardOptions {
  /**
   * Kaynak zorunluluğunun uygulanacağı dizi yolları (nokta ayraçlı),
   * örn. ["detections"], ["arguments"], ["adjustments"].
   * Boş bırakılırsa eleme yapılmaz (ör. HEARING_PREP'in 9 sabit bölümü elenmez).
   */
  findingPaths?: readonly string[];
  /** Kaynak sayılan alan adları (varsayılan: DEFAULT_SOURCE_FIELDS). */
  sourceFields?: readonly string[];
  /** Atıf çıkarımının yapılacağı ek serbest metin (ör. dilekçe bölümleri). */
  extraTextForCitations?: string;
  /** Atıf çıkarımı kapatılabilir (ör. CITATION_VERIFY'ın kendi çıktısında). */
  extractCitationsFromOutput?: boolean;
}

export interface GuardResult<T> {
  ok: boolean;
  /** Şema doğrulamasından geçen ve kaynaksız bulguları elenmiş çıktı. */
  data?: T;
  issues: GuardIssue[];
  droppedFindings: DroppedFinding[];
  /** Metinden çıkarılan, Teyit Ajanı'na gidecek atıflar. */
  citations: ExtractedCitation[];
  /** (d) "AI çıktısıdır, öneridir" bayrağı. */
  advisory: { isAdvisory: true; notice: string };
}

/** ```json ... ``` sarmalını ve ön/son açıklamaları temizleyip JSON'a çevirir. */
export function parseJsonOutput(raw: string): { value?: unknown; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Model boş yanıt döndürdü." };

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(candidate);
  if (direct !== undefined) return { value: direct };

  // Model önsöz/sonsöz eklediyse ilk { ... son } aralığını dene.
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sliced = tryParse(candidate.slice(first, last + 1));
    if (sliced !== undefined) return { value: sliced };
  }
  return { error: "Model yanıtı geçerli JSON değil." };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Nokta ayraçlı yolda duran diziyi döndürür (yoksa undefined). */
function getArrayAtPath(root: unknown, path: string): { parent: Record<string, unknown>; key: string; array: unknown[] } | undefined {
  const keys = path.split(".");
  let cur: unknown = root;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (!isPlainObject(cur)) return undefined;
  const arr = cur[last];
  if (!Array.isArray(arr)) return undefined;
  return { parent: cur, key: last, array: arr };
}

/**
 * Bir kaynak nesnesi ANLAMLI mı?
 *
 * Denetim bulgusu İ-16: `hasSource` yalnız DOLULUĞA bakıyordu ve
 * `"sourceRefs":[{}]` "kaynaklı" sayılıyordu. `SourceRefSchema`'nın BEŞ ALANININ
 * BEŞİ DE `.optional()` olduğu için boş nesne şemadan da geçiyordu; zincir
 * tamdı. Kaynak zorunluluğu, "alan var" değil "alanda bir şey var" demektir.
 */
function isMeaningfulSourceEntry(entry: unknown): boolean {
  if (typeof entry === "string") return entry.trim().length > 0;
  if (!isPlainObject(entry)) return false;
  return Object.values(entry).some((v) => {
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.length > 0;
    return isPlainObject(v) && Object.keys(v).length > 0;
  });
}

function hasSource(item: unknown, sourceFields: readonly string[]): boolean {
  if (!isPlainObject(item)) return false;
  for (const field of sourceFields) {
    const value = item[field];
    if (typeof value === "string" && value.trim().length > 0) return true;
    // İ-16: dizinin DOLU olması yetmez; en az bir elemanın ANLAMLI olması gerekir.
    if (Array.isArray(value) && value.some(isMeaningfulSourceEntry)) return true;
    if (isPlainObject(value) && isMeaningfulSourceEntry(value)) return true;
  }
  return false;
}

function labelOf(item: unknown, index: number): string {
  if (isPlainObject(item)) {
    for (const key of ["title", "eventDescription", "reason", "raw", "content", "detail"]) {
      const v = item[key];
      if (typeof v === "string" && v.trim()) {
        return v.trim().slice(0, 120);
      }
    }
  }
  return `#${index + 1}`;
}

/**
 * (b) Kaynaksız bulgu elemesi — ham JSON üzerinde, şema doğrulamasından önce.
 * Verilen yollardaki dizilerden kaynak alanı boş olan nesneler çıkarılır.
 */
export function dropSourcelessFindings(
  root: unknown,
  findingPaths: readonly string[],
  sourceFields: readonly string[] = DEFAULT_SOURCE_FIELDS,
): { value: unknown; dropped: DroppedFinding[] } {
  const dropped: DroppedFinding[] = [];
  if (!isPlainObject(root) || findingPaths.length === 0) return { value: root, dropped };

  // Sığ kopya yerine derin kopya: çağıranın nesnesi değişmesin.
  const clone = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;

  for (const path of findingPaths) {
    const located = getArrayAtPath(clone, path);
    if (!located) continue;
    const kept: unknown[] = [];
    located.array.forEach((item, index) => {
      if (hasSource(item, sourceFields)) {
        kept.push(item);
      } else {
        dropped.push({
          path: `${path}[${index}]`,
          reason: "KAYNAKSIZ",
          label: labelOf(item, index),
        });
      }
    });
    located.parent[located.key] = kept;
  }

  return { value: clone, dropped };
}

/* ------------------------------------------------------------------ *
 * Teyit Ajanı için FAIL-CLOSED kapı (hukuki denetim, bulgu 4)
 * ------------------------------------------------------------------ */

/** Künye karşılaştırması için kaba normalizasyon (boşluk/noktalama duyarsız). */
function normalizeCitationKey(raw: string): string {
  return raw.toLocaleLowerCase("tr-TR").replace(/[\s.,;:/\\-]+/g, "");
}

export interface CitationEnforcementResult {
  output: CitationVerifyOutput;
  /** AMBIGUOUS'a düşürülen künyeler (koşu kaydına yazılır). */
  downgraded: string[];
}

/**
 * VERIFIED statüsünü DETERMİNİSTİK arama sonucuna bağlar.
 *
 * Şema zaten "VERIFIED ⇒ eşleşme kimliği" kuralını uygular; burada ikinci ve asıl
 * kapı vardır: modelin verdiği kimlik, sistemin gerçekten BULDUĞU kayda ait değilse
 * (lookup yok ya da `outcome !== "FOUND"`) statü zorla `AMBIGUOUS`'a düşürülür.
 * Erişilemeyen/arama yapılamayan kaynak ASLA doğrulanmış sayılmaz (fail-closed).
 *
 * apps/api bu fonksiyonu Teyit Ajanı koşusunda `guardOutput` sonrasında ÇAĞIRMALIDIR.
 */
export function enforceCitationLookups(
  output: CitationVerifyOutput,
  lookups: readonly CitationLookupResult[],
): CitationEnforcementResult {
  const byRaw = new Map<string, CitationLookupResult>();
  for (const lookup of lookups) byRaw.set(normalizeCitationKey(lookup.raw), lookup);

  const downgraded: string[] = [];
  const citations: VerifiedCitation[] = output.citations.map((citation) => {
    if (citation.status !== "VERIFIED") return citation;
    const lookup = byRaw.get(normalizeCitationKey(citation.raw));
    const matchedId = citation.matchedCaseLawId ?? citation.matchedStatuteVersionId;
    const lookupId = lookup?.caseLawId ?? lookup?.statuteVersionId;
    const idAgrees = matchedId !== undefined && lookupId !== undefined && matchedId === lookupId;

    if (lookup?.outcome === "FOUND" && idAgrees) return citation;

    downgraded.push(citation.raw);
    const reason =
      lookup === undefined
        ? "bu künye için deterministik arama sonucu bulunmadığından"
        : lookup.outcome === "SEARCH_FAILED"
          ? "kaynak adaptörüne erişilemediğinden"
          : lookup.outcome === "NOT_FOUND"
            ? "deterministik arama bu künyeyi bulamadığından"
            : "bildirilen eşleşme kimliği arama sonucuyla uyuşmadığından";
    return {
      raw: citation.raw,
      status: "AMBIGUOUS" as const,
      verdict: citation.verdict,
      note: `Sistem doğrulaması: ${reason} statü AMBIGUOUS'a düşürüldü. Model notu: ${citation.note}`,
    };
  });

  const verifiedCount = citations.filter((c) => c.status === "VERIFIED").length;
  const overallStatus: CitationVerifyOutput["overallStatus"] =
    citations.length > 0 && verifiedCount === citations.length
      ? "PASSED"
      : verifiedCount > 0
        ? "PARTIAL"
        : "FAILED";

  return { output: { citations, overallStatus }, downgraded };
}

/** Nesnedeki tüm string değerleri tek metinde toplar (atıf taraması için). */
function collectStrings(value: unknown, acc: string[], depth = 0): void {
  if (depth > 12) return;
  if (typeof value === "string") {
    acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    for (const v of Object.values(value)) collectStrings(v, acc, depth + 1);
  }
}

/**
 * Tam çıktı doğrulama hattı.
 *
 * @param schema  Görevin zod çıktı şeması.
 * @param raw     Modelin ham yanıtı (string) veya önceden ayrıştırılmış nesne.
 */
export function guardOutput<TSchema extends ZodTypeAny>(
  schema: TSchema,
  raw: string | unknown,
  options: OutputGuardOptions = {},
): GuardResult<TypeOf<TSchema>> {
  const {
    findingPaths = [],
    sourceFields = DEFAULT_SOURCE_FIELDS,
    extraTextForCitations,
    extractCitationsFromOutput = true,
  } = options;

  const advisory = { isAdvisory: true as const, notice: AI_ADVISORY_NOTICE };
  const issues: GuardIssue[] = [];

  // 1) JSON'a çevir
  let parsed: unknown;
  if (typeof raw === "string") {
    const result = parseJsonOutput(raw);
    if (result.error !== undefined) {
      issues.push({ code: "JSON_PARSE", message: result.error });
      return { ok: false, issues, droppedFindings: [], citations: [], advisory };
    }
    parsed = result.value;
  } else {
    parsed = raw;
  }

  if (parsed === null || parsed === undefined) {
    issues.push({ code: "EMPTY_OUTPUT", message: "Model boş yanıt döndürdü." });
    return { ok: false, issues, droppedFindings: [], citations: [], advisory };
  }

  // 2) Kaynaksız bulguları ele (şemadan ÖNCE)
  const { value: pruned, dropped } = dropSourcelessFindings(parsed, findingPaths, sourceFields);

  // 3) Şema doğrulaması
  const validation = schema.safeParse(pruned);
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      issues.push({
        code: "SCHEMA",
        message: issue.message,
        path: issue.path.join("."),
      });
    }
    return { ok: false, issues, droppedFindings: dropped, citations: [], advisory };
  }

  // 4) Atıf biçimi tanıma → Teyit Ajanı girdisi
  let citations: ExtractedCitation[] = [];
  if (extractCitationsFromOutput) {
    const strings: string[] = [];
    collectStrings(validation.data, strings);
    if (extraTextForCitations) strings.push(extraTextForCitations);
    citations = dedupeCitations(extractCitations(strings.join("\n")));
  } else if (extraTextForCitations) {
    citations = dedupeCitations(extractCitations(extraTextForCitations));
  }

  return {
    ok: true,
    data: validation.data as TypeOf<TSchema>,
    issues,
    droppedFindings: dropped,
    citations,
    advisory,
  };
}
