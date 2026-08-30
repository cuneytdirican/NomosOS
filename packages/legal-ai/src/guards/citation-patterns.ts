/**
 * Atıf biçimi tanıma — Türk yargı künyeleri ve mevzuat atıfları.
 *
 * Amaç: modelin ürettiği serbest metinden içtihat/mevzuat atıflarını
 * DETERMİNİSTİK olarak çıkarmak ve Teyit Ajanı'na (CITATION_VERIFY) vermek.
 * Bu katman "doğrulama" yapmaz, yalnızca "burada bir künye var" der.
 */

export type CaseLawSource = "YARGITAY" | "DANISTAY" | "BAM" | "AYM" | "AIHM" | "BILINMIYOR";

export interface ExtractedCitation {
  kind: "ICTIHAT" | "MEVZUAT";
  /** Metinden çıkarılan ham künye (varsa mahkeme öneki dahil). */
  raw: string;
  source?: CaseLawSource;
  chamber?: string;
  esasNo?: string;
  kararNo?: string;
  /** Mevzuat atfında kanun kısaltması/adı ("HMK", "4857 sayılı Kanun"). */
  statuteRef?: string;
  /** Mevzuat atfında madde (ve varsa fıkra/bent): "281", "20/2", "25/II-b". */
  articleNo?: string;
  /** Metindeki başlangıç konumu. */
  index: number;
}

/** Türkçe harfleri de içeren "kelime karakteri" sınıfı (JS \b ASCII olduğu için gerekli). */
const WORD_CHARS = "A-Za-zÇĞİÖŞÜÎÂÛçğıöşüîâû0-9";

/** Biçim A: "2023/1234 E. 2024/5678 K." */
const CASELAW_FORM_A =
  /(\d{4}\s*\/\s*\d{1,6})\s*(?:E\.|Esas(?:\s*No)?\.?)\s*,?\s*(\d{4}\s*\/\s*\d{1,6})\s*(?:K\.|Karar(?:\s*No)?\.?)/gi;

/** Biçim B: "E. 2021/456, K. 2022/789" */
const CASELAW_FORM_B =
  /(?:E\.|Esas(?:\s*No)?\.?)\s*:?\s*(\d{4}\s*\/\s*\d{1,6})\s*,?\s*(?:K\.|Karar(?:\s*No)?\.?)\s*:?\s*(\d{4}\s*\/\s*\d{1,6})/gi;

/** Mahkeme/kaynak belirteçleri (künyenin solunda aranır). */
const COURT_TOKEN =
  /(Yargıtay|Yarg\.|Danıştay|Dan\.|Bölge Adliye Mahkemesi|BAM|Anayasa Mahkemesi|AYM|AİHM|AIHM)/gi;

/** Daire ifadesi: "9. HD", "10. Daire", "27. Hukuk Dairesi", "3. CD" */
const CHAMBER_PATTERN =
  /(\d{1,3})\.\s*(H\.?\s?D\.?|C\.?\s?D\.?|Hukuk Dairesi|Ceza Dairesi|Daire(?:si)?|D\.)/i;

/** Bilinen mevzuat adları/kısaltmaları — uzun adlar önce (alternation sırası önemlidir). */
export const TR_STATUTE_REFS = [
  "Hukuk Muhakemeleri Kanunu",
  "Ceza Muhakemesi Kanunu",
  "İcra ve İflas Kanunu",
  "Türk Medeni Kanunu",
  "Türk Borçlar Kanunu",
  "Türk Ticaret Kanunu",
  "Türk Ceza Kanunu",
  "İş Kanunu",
  "AATUHK",
  "HUMK",
  "HUAK",
  "İYUK",
  "IYUK",
  "KVKK",
  "TKHK",
  "HMK",
  "TMK",
  "TBK",
  "TTK",
  "TCK",
  "CMK",
  "İİK",
  "IIK",
  "SGK",
  "VUK",
  "GVK",
  "KVK",
  "İşK",
  "İK",
  "MK",
  "BK",
  "AY",
] as const;

const STATUTE_PATTERN = new RegExp(
  `(?<![${WORD_CHARS}])(?:(${TR_STATUTE_REFS.join("|")})|(\\d{3,5})\\s*sayılı(?:\\s+[^\\s.,;()]+){0,4})(?![${WORD_CHARS}])\\s*(?:m\\.|md\\.|madde)\\s*(\\d{1,4})((?:\\s*\\/\\s*[0-9IVX]{1,4})?(?:\\s*-\\s*[a-zçğıöşü])?)`,
  "gi",
);

function normalizeNumber(value: string): string {
  return value.replace(/\s+/g, "");
}

function detectSourceAndChamber(prefix: string): {
  source?: CaseLawSource;
  chamber?: string;
  courtStart?: number;
} {
  COURT_TOKEN.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = COURT_TOKEN.exec(prefix)) !== null) {
    last = m;
  }
  if (!last) {
    // Mahkeme adı yok ama daire ifadesi olabilir (ör. "9. HD 2023/1234 E. ...")
    const chamberOnly = CHAMBER_PATTERN.exec(prefix);
    if (chamberOnly) {
      return { chamber: chamberOnly[0].trim(), courtStart: chamberOnly.index };
    }
    return {};
  }

  const token = last[1].toLocaleLowerCase("tr");
  let source: CaseLawSource = "BILINMIYOR";
  if (token.startsWith("yarg")) source = "YARGITAY";
  else if (token.startsWith("dan")) source = "DANISTAY";
  else if (token === "bam" || token.startsWith("bölge")) source = "BAM";
  else if (token === "aym" || token.startsWith("anayasa")) source = "AYM";
  // Türkçe küçültmede "AİHM" → "aihm", "AIHM" → "aıhm" olur.
  else if (token === "aihm" || token === "aıhm") source = "AIHM";

  const after = prefix.slice(last.index + last[0].length);
  const chamberMatch = CHAMBER_PATTERN.exec(after);
  return {
    source,
    chamber: chamberMatch ? chamberMatch[0].trim() : undefined,
    courtStart: last.index,
  };
}

interface Range {
  start: number;
  end: number;
}

function overlaps(ranges: readonly Range[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

/** Metindeki içtihat künyelerini çıkarır. */
export function extractCaseLawCitations(text: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  const covered: Range[] = [];

  const collect = (regex: RegExp, esasGroup: number, kararGroup: number): void => {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (overlaps(covered, start, end)) continue;
      covered.push({ start, end });

      // Künyenin solundaki 80 karakterde (aynı satırda) mahkeme/daire ara.
      const windowStart = Math.max(0, start - 80);
      let prefix = text.slice(windowStart, start);
      const nl = prefix.lastIndexOf("\n");
      const prefixOffset = windowStart + (nl >= 0 ? nl + 1 : 0);
      if (nl >= 0) prefix = prefix.slice(nl + 1);

      const { source, chamber, courtStart } = detectSourceAndChamber(prefix);
      const rawStart = courtStart !== undefined ? prefixOffset + courtStart : start;

      out.push({
        kind: "ICTIHAT",
        raw: text.slice(rawStart, end).trim(),
        source: source ?? (chamber ? "BILINMIYOR" : undefined),
        chamber,
        esasNo: normalizeNumber(m[esasGroup]),
        kararNo: normalizeNumber(m[kararGroup]),
        index: rawStart,
      });
    }
  };

  collect(CASELAW_FORM_A, 1, 2);
  collect(CASELAW_FORM_B, 1, 2);

  return out.sort((a, b) => a.index - b.index);
}

/** Metindeki mevzuat atıflarını çıkarır ("HMK m.281", "4857 sayılı Kanun m.25"). */
export function extractStatuteCitations(text: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  STATUTE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATUTE_PATTERN.exec(text)) !== null) {
    const abbrev = m[1];
    const numbered = m[2];
    const article = m[3];
    const suffix = (m[4] ?? "").replace(/\s+/g, "");
    const statuteRef = abbrev ?? `${numbered} sayılı`;
    out.push({
      kind: "MEVZUAT",
      raw: m[0].trim(),
      statuteRef: statuteRef.trim(),
      articleNo: `${article}${suffix}`,
      index: m.index,
    });
  }
  return out;
}

/** İçtihat + mevzuat atıflarını birlikte çıkarır (konum sırasına göre). */
export function extractCitations(text: string): ExtractedCitation[] {
  if (!text) return [];
  return [...extractCaseLawCitations(text), ...extractStatuteCitations(text)].sort(
    (a, b) => a.index - b.index,
  );
}

/** Aynı künyeyi bir kez döndürür (esas/karar veya kanun/madde bazında). */
export function dedupeCitations(citations: readonly ExtractedCitation[]): ExtractedCitation[] {
  const seen = new Set<string>();
  const out: ExtractedCitation[] = [];
  for (const c of citations) {
    const key =
      c.kind === "ICTIHAT"
        ? `I:${c.source ?? ""}|${c.chamber ?? ""}|${c.esasNo ?? ""}|${c.kararNo ?? ""}`
        : `M:${c.statuteRef ?? ""}|${c.articleNo ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
