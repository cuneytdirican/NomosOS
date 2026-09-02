/**
 * LLM ÇIKTISI NORMALİZASYONU — şema doğrulamasından ÖNCE çalışır.
 *
 * NEDEN VAR (sahadan gelen üç hata):
 *   1. İçtihat arama: model "01.01.2023" yazdı, şema YYYY-AA-GG istedi →
 *      TÜM arama planı reddedildi.
 *   2. Dilekçe taslağı: model MEVZUAT atfında kanun kısaltmasını ("TCK")
 *      `source`'a yazdı, enum yalız mahkeme kabul etti → taslak REDDEDİLDİ.
 *   3. Rapor yorumu: biçim sapmaları koşunun tamamını düşürdü.
 *
 * İLKE: ŞEMA SÖZLEŞMEDİR; ama modelin biçim sapması ANLAM kaybı değilse
 * API DÜZELTİR, reddetmez. Anlam taşıyan kısıtlar (uydurma rakam, kaynaksız
 * bulgu) AYNEN KORUNUR — bu katma yalnızca BİÇİM onarır.
 *
 * GÜVENLİK SINIRI: normalizasyon yalnızca KARARLI dönüşümler yapar —
 * belirsiz değer (yalnız yıl "2023", ay adı "Ocak 2023") DÜŞÜRÜLÜR, tahmin
 * EDİLMEZ; zorunlu alanlardaki düşüş şema hatası olarak görünür ve zaten
 * optional olan filtreler (dateFrom/dateTo) temizce silinir.
 */

/** Tarih beklenen alan adı kalıbı (bilinen şema alanları). */
const DATE_KEY_RE = /^(date|dateFrom|dateTo|deadlineDate|dueDate|tarih|baslangicTarihi|bitisTarihi|evrakTarihi)$/i;

/** YYYY-AA-GG. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Mahkeme enum değerleri — CitationSchema.source sözleşmesi. */
const COURT_SOURCES = ["YARGITAY", "DANISTAY", "BAM", "AYM", "AIHM", "BILINMIYOR"] as const;
type CourtSource = (typeof COURT_SOURCES)[number];

/** Türkçe ve sayısal ay adları — ay/yıl girişimlerini tanımak için. */
const MONTH_WORDS =
  /(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Tek bir tarih dizesini YYYY-AA-GG'ye çevirir.
 * Dönüş: `null` = alan düşürülmeli (belirsiz); `undefined` = dokunma.
 */
export function normalizeDateValue(value: string): string | null | undefined {
  const v = value.trim();

  // Zaten doğru biçim — dokunma.
  if (ISO_DATE_RE.test(v)) {
    // Ayın/günün geçersizliği burada fark edilmez; şema/Date katmanı yakalar.
    return undefined;
  }

  // YYYY-AA-GG + saat bileşeni → tarihi kes.
  const isoWithTime = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(v);
  if (isoWithTime) return isoWithTime[1];

  // GG.AA.YYYY veya GG/AA/YYYY → YYYY-AA-GG.
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
  if (dotted) {
    const [, d, m, y] = dotted;
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  // YYYY.AA.GG (nadiren) → YYYY-AA-GG.
  const yFirst = /^(\d{4})[./](\d{1,2})[./](\d{1,2})$/.exec(v);
  if (yFirst) {
    const [, y, m, d] = yFirst;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Yalnız yıl / ay adı / "bilinmiyor" / boş → belirsiz: DÜŞÜR.
  if (/^\d{4}$/.test(v) || MONTH_WORDS.test(v) || v === "") return null;

  // Tanınmayan biçim — dokunma; şema hatası anlamlı kalır.
  return undefined;
}

/** Bir dizenin mahkeme kaynağı mı, yoksa kanun/daire ifadesi mi olduğunu çözümler. */
function resolveCourtSource(value: string): { court: CourtSource; chamber: string | null } | null {
  const v = value.trim().toUpperCase();
  // Tam eşleşme.
  if ((COURT_SOURCES as readonly string[]).includes(v)) {
    return { court: v as CourtSource, chamber: null };
  }
  // "YARGITAY 9. HD" / "YARGITAY 9. HUKUK DAİRESİ" gibi önekler.
  for (const court of COURT_SOURCES) {
    if (v.startsWith(court)) {
      const rest = v.slice(court.length).replace(/^[\s.:_-]+/, "").trim();
      return { court, chamber: rest.length > 0 ? rest : null };
    }
  }
  return null;
}

/** Atıf benzeri nesne mi? (kind alanı ICTIHAT/MEVZUAT taşıyan) */
function isCitationLike(obj: Record<string, unknown>): boolean {
  return obj.kind === "ICTIHAT" || obj.kind === "MEVZUAT";
}

/**
 * TEK atıf nesnesini onarır (yerinde).
 *
 *  - source mahkeme adı/daire içeriyorsa → enum'a + daire `chamber`'a.
 *  - source kanun kısaltmasıysa (TCK, HMK, 4857 s. Kanun...) ve kind=MEVZUAT
 *    ise → `statuteRef`'e taşınır, source silinir.
 */
function normalizeCitationObject(obj: Record<string, unknown>): void {
  const source = obj.source;
  if (typeof source !== "string" || source.trim() === "") {
    if (source !== undefined && typeof source === "string" && source.trim() === "") {
      delete obj.source;
    }
    return;
  }

  const resolved = resolveCourtSource(source);
  if (resolved) {
    obj.source = resolved.court;
    if (resolved.chamber && (typeof obj.chamber !== "string" || !(obj.chamber as string).trim())) {
      obj.chamber = resolved.chamber;
    }
    return;
  }

  // Mahkeme değil — kanun/kaynak adı. MEVZUAT atfında statueRef'e taşınır.
  if (obj.kind === "MEVZUAT") {
    if (typeof obj.statuteRef !== "string" || !(obj.statuteRef as string).trim()) {
      obj.statuteRef = source.trim();
    }
    delete obj.source;
  } else {
    // ICTIHAT ama mahkeme tanınmadı → bilinmiyor; ham değer `raw`da zaten durur.
    obj.source = "BILINMIYOR";
  }
}

/** Nesne ağacını dolaşır; tarih alanlarını ve atıf nesnelerini onarır. */
function normalizeNode(node: unknown, keyName: string): unknown {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = normalizeNode(node[i], "");
    return node;
  }
  if (!isPlainObject(node)) {
    // Tarih alanı ilkeliktir: dize değerli tarih anahtarını onar.
    if (typeof node === "string" && DATE_KEY_RE.test(keyName)) {
      const fixed = normalizeDateValue(node);
      return fixed === null ? undefined : fixed === undefined ? node : fixed;
    }
    return node;
  }
  for (const key of Object.keys(node)) {
    if (DATE_KEY_RE.test(key) && typeof node[key] === "string") {
      const fixed = normalizeDateValue(node[key] as string);
      if (fixed === null) delete node[key];
      else if (fixed !== undefined) node[key] = fixed;
      continue;
    }
    if (isCitationLike(node)) normalizeCitationObject(node);
    const child = node[key];
    if (Array.isArray(child) || isPlainObject(child)) {
      normalizeNode(child, key);
    }
  }
  return node;
}

/**
 * LLM çıktısını (JSON'a çevrilmiş hâlini) yerinde onarır.
 * Yalnızca: tarih alanlarının biçimi ve atıf `source` alanı.
 */
export function normalizeLlmOutput<T>(parsed: T): T {
  normalizeNode(parsed, "");
  return parsed;
}
