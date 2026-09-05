/**
 * KANUN METNİ AYRIŞTIRICI — konsolide mevzuat metninden madde listesi.
 *
 * Girdi: mevzuat.gov.tr konsolide metni (MevzuatFihristDetayIframe çıktısı
 * temizlenmiş düz metin). Metin biçimi tarayıcı üzerinden birebir doğrulanmıştır:
 *
 *   TÜRK CEZA KANUNU
 *   Kanun Numarası        : 5237
 *   Kabul Tarihi          : 26/9/2004
 *   Yayımlandığı Resmî Gazete : Tarih : 12/10/2004  Sayı : 25611
 *   ...
 *   Madde 1- (1) Ceza Kanununun amacı; ...
 *   Madde 2- (1) Kanunun açıkça suç saymadığı ...
 *
 * Bu modül DETERMİNİSTİKTİR — hiçbir AI katmanı içermez. Ayrıştırılamayan
 * madde yok sayılmaz: parseWarnings'e yazılır ve çağıran taraf kuyrukta
 * "manuel inceleme gerekli" olarak işaretler.
 */

/** Ayrıştırılmış tek madde. */
export interface ParsedStatuteArticle {
  /** Madde numarası: "86". Ek/geçici maddelerde "EK 1", "GECICI 3". */
  articleNo: string;
  /** "Madde 86- (1) ..." biçiminde madde başlığıyla birlikte tam metin. */
  text: string;
}

/** Konsolide metnin künye başlığından çıkarılan alanlar (varsa). */
export interface ParsedStatuteHeader {
  mevzuatNo?: string;
  kabulTarihi?: string;
  rgTarihi?: string;
  rgSayisi?: string;
}

export interface StatuteParseResult {
  header: ParsedStatuteHeader;
  articles: ParsedStatuteArticle[];
  /** İnsan-okur uyarıları (ayrıştırılamayan yapı, aykırı numara...). */
  warnings: string[];
}

/**
 * Madde başlığı kalıbı. Konsolide metinde "Madde 86-", RG özgün metinlerinde
 * "Madde 86 ncı -" biçimi de görülür; ikisi de desteklenir. Ek/geçici/mükerrer
 * madde başlıkları tanınır ve articleNo'ya önek olarak taşınır.
 */
const ARTICLE_RE =
  /^\s*(?:(EK|Ek|GEÇİCİ|Geçici|MÜKERRER|Mükerrer)\s+)?(?:MADDE|Madde)\s+(\d{1,4})(?:\s*(?:ncı|nci|nı|ni|uncu|üncü|ıncı|inci))?\s*[-–—:]\s*/;

/** Künye başlığı alanları ("AlanAdı : değer" — çok sayıda boşlukla). */
const HEADER_FIELD_RE = (label: string) =>
  new RegExp(`^\\s*${label}\\s*:?\\s*(.+?)\\s*$`, "m");

/** Madde numarasını normalize eder: "Ek 1" → "EK 1", "GEÇİCİ 3" → "GECICI 3". */
function normalizeArticleNo(prefix: string | undefined, no: string): string {
  if (!prefix) return no;
  const p = prefix.toLocaleUpperCase("tr-TR");
  return `${p === "GEÇİCİ" ? "GECICI" : p} ${no}`;
}

/** Metni karşılaştırma için normalize eder (sürüm farkı hesabı). */
export function normalizeArticleText(text: string): string {
  return text
    .replace(/\[\d+\]/g, "") // dipnot işaretleri
    .replace(/[*]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

/**
 * Konsolide kanun metnini maddelere ayırır.
 *
 * Kural: "Madde N-" satırı yeni madde başlatır; madde metni sonraki başlığa
 * kadar sürer. Metinde HİÇ madde başlığı bulunamazsa articles boştur ve
 * uyarı üretilir — sessizce boş havuz yazmak kabul edilemez.
 */
export function parseStatuteText(fullText: string): StatuteParseResult {
  const warnings: string[] = [];
  const lines = fullText.replace(/\r/g, "").split("\n");

  const header = parseHeader(fullText);

  const marks: Array<{ line: number; articleNo: string; matchLength: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = ARTICLE_RE.exec(lines[i]);
    if (!m) continue;
    marks.push({
      line: i,
      articleNo: normalizeArticleNo(m[1], m[2]),
      matchLength: m[0].length,
    });
  }

  if (marks.length === 0) {
    warnings.push(
      "Metinde tek bir 'Madde N-' başlığı tanımlanamadı; ayrıştırma boş döndü. " +
        "Metin mevzuat.gov.tr konsolide biçiminde değil olabilir.",
    );
    return { header, articles: [], warnings };
  }

  const articles: ParsedStatuteArticle[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < marks.length; k += 1) {
    const start = marks[k].line;
    const end = k + 1 < marks.length ? marks[k + 1].line : lines.length;
    // İlk satırda madde başlığı; ilk madde satırından itibaren metin.
    const first = lines[start].slice(marks[k].matchLength).trim();
    const rest = lines.slice(start + 1, end).join("\n").trim();
    const text = [`Madde ${marks[k].articleNo}- ${first}`.trim(), rest].filter(Boolean).join("\n");
    if (seen.has(marks[k].articleNo)) {
      warnings.push(`"${marks[k].articleNo}" numaralı madde metinde birden çok kez başlıyor; ilk görünen alındı.`);
      continue;
    }
    seen.add(marks[k].articleNo);
    articles.push({ articleNo: marks[k].articleNo, text });
  }

  // Numara sırası denetimi (madde atlamaları uyarıdır, hata değil).
  const numeric = articles.map((a) => parseInt(a.articleNo, 10)).filter((n) => !Number.isNaN(n));
  const sorted = [...numeric].sort((a, b) => a - b);
  if (numeric.length === sorted.length && numeric.length > 0) {
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] > 1) {
        warnings.push(`Madde sırasında atlama var (${sorted[i - 1]}. maddeden ${sorted[i]}. maddeye); metinde ek madde olabilir.`);
        break;
      }
    }
  }

  return { header, articles, warnings };
}

/** Künye başlığından kanun numarası / RG künyesi çıkarır. */
function parseHeader(text: string): ParsedStatuteHeader {
  const header: ParsedStatuteHeader = {};
  const no = HEADER_FIELD_RE("Kanun Numarası").exec(text)?.[1];
  if (no && /^\d{1,5}/.test(no)) header.mevzuatNo = /^\d{1,5}/.exec(no)![0];
  const kabul = HEADER_FIELD_RE("Kabul Tarihi").exec(text)?.[1];
  if (kabul) header.kabulTarihi = kabul;
  const rg = /Yayımlandığı Resmî Gazete\s*:?\s*Tarih\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+Sayı\s*:?\s*(\d{1,6})/.exec(
    text,
  );
  if (rg) {
    header.rgTarihi = rg[1];
    header.rgSayisi = rg[2];
  }
  return header;
}

/** İki sürümün madde farkını çıkarır (değişiklik tespiti). */
export interface StatuteArticleDiff {
  /** Yeni eklenen maddeler. */
  added: ParsedStatuteArticle[];
  /** Metni değişen maddeler (yeni metinle). */
  changed: ParsedStatuteArticle[];
  /** Kaldırılan madde numaraları. */
  removed: string[];
  /** Metni aynı kalan madde sayısı. */
  unchanged: number;
}

/**
 * Sürüm karşılaştırması — RG değişikliği işlendikten sonra hangi maddelerin
 * yeni sürüm alacağını belirler. Karşılaştırma normalizeArticleText üzerinden
 * yapılır (dipnot/biçim farkı değişiklik sayılmaz).
 */
export function diffStatuteArticles(
  current: readonly ParsedStatuteArticle[],
  incoming: readonly ParsedStatuteArticle[],
): StatuteArticleDiff {
  const currentMap = new Map(current.map((a) => [a.articleNo, normalizeArticleText(a.text)]));
  const incomingMap = new Map(incoming.map((a) => [a.articleNo, a]));

  const added: ParsedStatuteArticle[] = [];
  const changed: ParsedStatuteArticle[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const [no, incomingArticle] of incomingMap) {
    const oldText = currentMap.get(no);
    if (oldText === undefined) {
      added.push(incomingArticle);
    } else if (oldText === normalizeArticleText(incomingArticle.text)) {
      unchanged += 1;
    } else {
      changed.push(incomingArticle);
    }
  }
  for (const no of currentMap.keys()) {
    if (!incomingMap.has(no)) removed.push(no);
  }

  return { added, changed, removed, unchanged };
}
