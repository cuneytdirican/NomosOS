/**
 * Atıf biçimi tanıma — Türk yargı künyeleri ve mevzuat atıfları.
 *
 * Amaç: modelin ürettiği serbest metinden içtihat/mevzuat atıflarını
 * DETERMİNİSTİK olarak çıkarmak ve Teyit Ajanı'na (CITATION_VERIFY) vermek.
 * Bu katman "doğrulama" yapmaz, yalnızca "burada bir künye var" der.
 */

export type CaseLawSource = "YARGITAY" | "DANISTAY" | "BAM" | "AYM" | "AIHM" | "UYUSMAZLIK" | "BILINMIYOR";

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

/**
 * Künye numarası: "2023/1234" ve HGK/İBBGK biçimi "2021/9-123".
 *
 * Denetim bulgusu K-10: dairesiz/dairelı ayrımı yapan HGK künyesi
 * ("Yargıtay HGK 2021/9-123 E. 2022/456 K.") eski kalıba UYMUYORDU ve çıkarıcı
 * onu hiç görmüyordu — kapı da bu yüzden hiç tetiklenmiyordu.
 */
const NUM = String.raw`\d{4}\s*\/\s*\d{1,6}(?:\s*-\s*\d{1,6})?`;

/** Biçim A: "2023/1234 E. 2024/5678 K." */
const CASELAW_FORM_A = new RegExp(
  `(${NUM})\\s*(?:E\\.|Esas(?:\\s*No)?\\.?)\\s*,?\\s*(${NUM})\\s*(?:K\\.|Karar(?:\\s*No)?\\.?)`,
  "gi",
);

/** Biçim B: "E. 2021/456, K. 2022/789" */
const CASELAW_FORM_B = new RegExp(
  `(?:E\\.|Esas(?:\\s*No)?\\.?)\\s*:?\\s*(${NUM})\\s*,?\\s*(?:K\\.|Karar(?:\\s*No)?\\.?)\\s*:?\\s*(${NUM})`,
  "gi",
);

/**
 * Biçim C — YALNIZ ESAS NUMARASI: "Yargıtay 9. HD'nin 2023/4512 E. sayılı kararı".
 *
 * Denetim bulgusu K-10: bu biçim uygulamada en sık yazılanlardan biridir ve
 * eski kalıplar KARAR numarasını da ZORUNLU kıldığı için tamamen kaçıyordu.
 * Kaçan künye `citations=[]` üretiyor, kapı `ok:true` diyor, dilekçe
 * "teyit çalıştırıldı" damgasıyla UDF'e dönüşüyordu.
 *
 * YANLIŞ POZİTİF KORUMASI: "E." NOKTALI olmalıdır ("2026/145 esas sayılı
 * dosyamız" eşleşmez) VE solundaki pencerede bir YÜKSEK MAHKEME adı geçmelidir
 * (kendi dosya esas numaramız içtihat atfı değildir).
 */
const CASELAW_FORM_C = new RegExp(`(${NUM})\\s*(?:E\\.|Esas\\s*No\\.?\\s*:?)`, "g");

/**
 * Biçim D — AYM BİREYSEL BAŞVURU: "2019/12345 başvuru numaralı karar".
 * AYM bireysel başvuru künyesinde karar numarası yoktur; esas/karar arayan
 * kalıplara hiç uymaz.
 */
const CASELAW_FORM_D = new RegExp(
  `(${NUM})\\s*(?:sayılı\\s*)?başvuru\\s*(?:numaralı|numarası|no\\.?)`,
  "gi",
);

/** Mahkeme/kaynak belirteçleri (künyenin solunda aranır). */
const COURT_TOKEN =
  /(Yargıtay|Yarg\.|Danıştay|Dan\.|Bölge Adliye Mahkemesi|BAM|Anayasa Mahkemesi|AYM|AİHM|AIHM|Uyuşmazlık Mahkemesi|Uyuşmazlık)/gi;

/**
 * YÜKSEK MAHKEME İZLERİ — negatif tarama için (denetim bulgusu K-10).
 *
 * `COURT_TOKEN`'dan farkı: kurul kısaltmalarını (HGK, İBBGK, CGK) ve
 * "yerleşik içtihat" gibi künyesiz atıf ifadelerini de kapsar. Metinde bunlardan
 * biri geçtiği hâlde tek bir YAPILANDIRILMIŞ künye çıkarılamadıysa, atıf
 * doğrulanamaz demektir ve kapı FAIL-CLOSED davranmalıdır.
 */
const HIGH_COURT_SIGNAL =
  /(Yargıtay|Yarg\.|Danıştay|Dan(?:\.|ıştay)|Bölge Adliye Mahkemesi|BAM|Anayasa Mahkemesi|AYM|AİHM|AIHM|HGK|Hukuk Genel Kurulu|İBBGK|İçtihadı Birleştirme|CGK|Ceza Genel Kurulu|Uyuşmazlık Mahkemesi|Uyuşmazlık)/gi;

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

/** Kanun adı ya da "4857 sayılı …" biçimi (ortak alt kalıp). */
const STATUTE_NAME = `(?:(${TR_STATUTE_REFS.join("|")})|(\\d{3,5})\\s*sayılı(?:\\s+[^\\s.,;()]+){0,4})`;
/** Madde numarası + fıkra/bent eki: "281", "20/2", "25/II-b". */
const ARTICLE_TAIL = `(\\d{1,4})((?:\\s*\\/\\s*[0-9IVX]{1,4})?(?:\\s*-\\s*[a-zçğıöşü])?)`;

/** Biçim 1: "HMK m.281", "4857 sayılı Kanun m.25", "İK md. 20/2". */
const STATUTE_PATTERN = new RegExp(
  `(?<![${WORD_CHARS}])${STATUTE_NAME}(?![${WORD_CHARS}])\\s*(?:m\\.|md\\.|madde)\\s*${ARTICLE_TAIL}`,
  "gi",
);

/**
 * Biçim 2 — EK TAKILI, MADDE SONRA: "İş Kanunu'nun 25. maddesi uyarınca",
 * "HMK'nın 281. maddesinde", "4857 sayılı Kanun'un 25. maddesi".
 *
 * Denetim bulgusu K-10: eski kalıp kanun adından HEMEN SONRA `m.|md.|madde`
 * bekliyordu; araya `'nun` girdiği için Türkçede en doğal yazım biçimi tamamen
 * kaçıyordu. "İş Kanunu'nun 25. maddesi uyarınca" hiçbir atıf üretmiyordu.
 */
const STATUTE_SUFFIX_PATTERN = new RegExp(
  `(?<![${WORD_CHARS}])${STATUTE_NAME}(?:['’’][a-zçğıöşünıae]{1,4})?\\s+${ARTICLE_TAIL}\\s*\\.?\\s*madde`,
  "gi",
);

/**
 * Biçim 3 — ÇIPLAK MADDE/FIKRA: "İİK 89/1 haciz ihbarnamesi", "HMK 114/1".
 *
 * Uygulamada çok yaygın bir kısaltmadır. Yanlış pozitif riski (yıl/esas
 * numarası) madde numarasını 3, fıkra numarasını 2 haneyle sınırlayarak
 * kapatılır: "HMK 2023/1234" EŞLEŞMEZ.
 */
const STATUTE_BARE_PATTERN = new RegExp(
  `(?<![${WORD_CHARS}])(${TR_STATUTE_REFS.join("|")})\\s+(\\d{1,3})\\s*\\/\\s*([0-9IVX]{1,2})(?![${WORD_CHARS}\\/])`,
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
  // Uyuşmazlık Mahkemesi: adli/idari yargı görev-hüküm uyuşmazlıkları.
  else if (token.startsWith("uyuşmazlık")) source = "UYUSMAZLIK";

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

  const collect = (
    regex: RegExp,
    esasGroup: number,
    kararGroup: number | null,
    /** true ise künyenin solunda bir YÜKSEK MAHKEME adı ŞART koşulur. */
    requireCourt = false,
  ): void => {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (overlaps(covered, start, end)) continue;

      // Künyenin solundaki 80 karakterde (aynı satırda) mahkeme/daire ara.
      const windowStart = Math.max(0, start - 80);
      let prefix = text.slice(windowStart, start);
      const nl = prefix.lastIndexOf("\n");
      const prefixOffset = windowStart + (nl >= 0 ? nl + 1 : 0);
      if (nl >= 0) prefix = prefix.slice(nl + 1);

      const { source, chamber, courtStart } = detectSourceAndChamber(prefix);

      // YANLIŞ POZİTİF KORUMASI (yalnız-esas ve AYM başvuru biçimleri için):
      // mahkeme adı yoksa bu bizim kendi dosya numaramız olabilir; atıf sayılmaz.
      if (requireCourt && !source) continue;

      covered.push({ start, end });
      const rawStart = courtStart !== undefined ? prefixOffset + courtStart : start;

      out.push({
        kind: "ICTIHAT",
        raw: text.slice(rawStart, end).trim(),
        source: source ?? (chamber ? "BILINMIYOR" : undefined),
        chamber,
        esasNo: normalizeNumber(m[esasGroup]),
        kararNo: kararGroup === null ? undefined : normalizeNumber(m[kararGroup]),
        index: rawStart,
      });
    }
  };

  // SIRA ÖNEMLİ: tam künyeler (esas + karar) önce toplanır ki, yalnız-esas
  // kalıbı onların içine düşüp mükerrer kayıt üretmesin (`covered` engeller).
  collect(CASELAW_FORM_A, 1, 2);
  collect(CASELAW_FORM_B, 1, 2);
  collect(CASELAW_FORM_D, 1, null, true);
  collect(CASELAW_FORM_C, 1, null, true);

  return out.sort((a, b) => a.index - b.index);
}

/**
 * NEGATİF TARAMA — "mahkeme adı var, künye yok" (denetim bulgusu K-10).
 *
 * `petition-gate.ts`'in 4 numaralı kuralı ("TANINMAYAN BİÇİM — ayrıştırılamayan
 * atıf da bloklar, fail-closed") YAZILIYDI AMA UYGULANAMIYORDU: `TANINMADI`
 * türü ancak `extractCitations` BİR ŞEY ÇIKARABİLDİĞİNDE doğar. Çıkarıcı hiç
 * görmediyse "tanınmayan biçim" kaydı hiç oluşmuyor, `blocking=[]` kalıyor,
 * kapı `ok:true` diyordu. Yani kural yazılı, uygulaması yoktu.
 *
 * Bu fonksiyon o boşluğu gerçek fail-closed hâline getirir: metinde bir yüksek
 * mahkeme/kurul adı geçtiği hâlde o CÜMLEDE tek bir yapılandırılmış künye
 * çıkarılamadıysa sinyal üretir. Kapı bu sinyalleri bloklayıcı sayar ve
 * avukattan künyeyi standart biçime getirmesini ister.
 *
 * Cümle bazında çalışır: bir paragrafta üç künyeli üç cümle varsa hiçbiri
 * bloklanmaz; künyesiz dördüncü cümle bloklanır.
 */
export interface UnstructuredCitationSignal {
  /** Sinyali üreten cümle (kısaltılmış). */
  sentence: string;
  /** Cümlede geçen mahkeme/kurul adı. */
  court: string;
  index: number;
}

const MAX_SIGNAL_SENTENCE = 240;

export function detectUnstructuredCitationSignals(text: string): UnstructuredCitationSignal[] {
  if (!text) return [];
  const citations = extractCaseLawCitations(text);
  const covered = citations.map((c) => ({ start: c.index, end: c.index + c.raw.length }));
  const out: UnstructuredCitationSignal[] = [];

  // Cümle sınırı: nokta/soru/ünlem + boşluk, ya da satır sonu.
  const sentences: Range[] = [];
  let cursor = 0;
  const boundary = /[.!?]\s+|\n+/g;
  let b: RegExpExecArray | null;
  while ((b = boundary.exec(text)) !== null) {
    const end = b.index + b[0].length;
    // "9. HD" ve "2023/1234 E." gibi kısaltmalardaki nokta cümle sonu değildir;
    // çok kısa parçaları bir sonrakine bağla.
    if (end - cursor < 25) continue;
    sentences.push({ start: cursor, end });
    cursor = end;
  }
  if (cursor < text.length) sentences.push({ start: cursor, end: text.length });

  for (const sentence of sentences) {
    const slice = text.slice(sentence.start, sentence.end);
    HIGH_COURT_SIGNAL.lastIndex = 0;
    const hit = HIGH_COURT_SIGNAL.exec(slice);
    if (!hit) continue;
    // Bu cümlede yapılandırılmış künye var mı?
    if (overlaps(covered, sentence.start, sentence.end)) continue;
    out.push({
      sentence: slice.trim().slice(0, MAX_SIGNAL_SENTENCE),
      court: hit[1],
      index: sentence.start + hit.index,
    });
  }
  return out;
}

/** Metindeki mevzuat atıflarını çıkarır ("HMK m.281", "4857 sayılı Kanun m.25"). */
export function extractStatuteCitations(text: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  const covered: Range[] = [];

  const collect = (regex: RegExp, mode: "named" | "bare"): void => {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Aynı künyeyi iki kalıp yakalayabilir; ilk (en spesifik) kazanır.
      if (overlaps(covered, start, end)) continue;
      covered.push({ start, end });

      let statuteRef: string;
      let articleNo: string;
      if (mode === "bare") {
        statuteRef = m[1].trim();
        articleNo = `${m[2]}/${m[3]}`;
      } else {
        const abbrev = m[1];
        const numbered = m[2];
        const article = m[3];
        const suffix = (m[4] ?? "").replace(/\s+/g, "");
        statuteRef = (abbrev ?? `${numbered} sayılı`).trim();
        articleNo = `${article}${suffix}`;
      }

      out.push({
        kind: "MEVZUAT",
        raw: m[0].trim(),
        statuteRef,
        articleNo,
        index: start,
      });
    }
  };

  // SIRA: en spesifik kalıp önce. "İş Kanunu m.25" hem 1. hem 3. kalıba
  // benzeyebilir; `covered` ikinci eşleşmeyi eler.
  collect(STATUTE_PATTERN, "named");
  collect(STATUTE_SUFFIX_PATTERN, "named");
  collect(STATUTE_BARE_PATTERN, "bare");

  return out.sort((a, b) => a.index - b.index);
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
