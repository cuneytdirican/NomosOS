/**
 * Türkçe metin normalizasyonu ve UYAP biçimlerinin ayrıştırılması.
 * Saf fonksiyonlar — DOM/chrome bağımlılığı yoktur, doğrudan test edilir.
 */

const TR_CHAR_MAP: Record<string, string> = {
  "ı": "i", // ı
  "İ": "i", // İ
  I: "i",
  "ğ": "g", // ğ
  "Ğ": "g", // Ğ
  "ü": "u", // ü
  "Ü": "u", // Ü
  "ş": "s", // ş
  "Ş": "s", // Ş
  "ö": "o", // ö
  "Ö": "o", // Ö
  "ç": "c", // ç
  "Ç": "c", // Ç
  "â": "a", // â
  "Â": "a", // Â
  "î": "i", // î
  "û": "u", // û
};

const TR_CHAR_PATTERN = /[ıİIğĞüÜşŞöÖçÇâÂîû]/g;

/** Fazla boşlukları temizler (NBSP ve dar boşluklar dahil). */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/[\u00a0\u2007\u202f\u200b]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Sütun başlığı eşleştirmesi için Türkçe duyarsız anahtar üretir.
 * "Açılış Tarihi" → "acilis tarihi"
 */
export function normalizeTr(input: string | null | undefined): string {
  if (!input) return "";
  const mapped = input.replace(TR_CHAR_PATTERN, (ch) => TR_CHAR_MAP[ch] ?? ch);
  return mapped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** UYAP'ta kullanılan Türkiye saat dilimi — yıl boyu UTC+03:00. */
export const TR_UTC_OFFSET = "+03:00";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

/** "14.02.2026" | "14/02/2026" | "14-02-2026" → "2026-02-14"; çözülemezse null. */
export function parseTrDate(input: string | null | undefined): string | null {
  const text = cleanText(input);
  const match = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** "18.02.2026 09:41" → "2026-02-18T09:41:00+03:00"; saat yoksa null. */
export function parseTrDateTime(input: string | null | undefined): string | null {
  const text = cleanText(input);
  const match =
    /(\d{1,2})[./-](\d{1,2})[./-](\d{4})[\sT]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (!isValidYmd(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${TR_UTC_OFFSET}`;
}

/**
 * Önce tarih-saat, olmazsa yalnız tarih dener.
 * Dönüş ISO 8601'dir: saat varsa ofsetli tam damga, yoksa "YYYY-MM-DD".
 */
export function parseTrTemporal(input: string | null | undefined): string | null {
  return parseTrDateTime(input) ?? parseTrDate(input);
}

/** İki ayrı hücreden gelen tarih ve saati birleştirir. */
export function combineDateAndTime(
  dateText: string | null | undefined,
  timeText: string | null | undefined,
): string | null {
  const date = parseTrDate(dateText);
  if (!date) return null;
  const time = /(\d{1,2})[:.](\d{2})/.exec(cleanText(timeText));
  if (!time) return date;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return date;
  return `${date}T${pad2(hour)}:${pad2(minute)}:00${TR_UTC_OFFSET}`;
}

/** "12.500,75" → 12500.75; çözülemezse null. */
export function parseTrNumber(input: string | null | undefined): number | null {
  const text = cleanText(input).replace(/[^\d.,-]/g, "");
  if (!text) return null;
  const normalized = text.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Tam sayı bekleyen alanlar için (sıra numarası vb.). */
export function parseIntOrNull(input: string | null | undefined): number | null {
  const text = cleanText(input);
  const match = /-?\d+/.exec(text);
  if (!match) return null;
  const value = Number.parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bayt: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/** "1,2 MB" → 1258291; çözülemezse null. */
export function parseSizeToBytes(input: string | null | undefined): number | null {
  const text = cleanText(input);
  const match = /([\d.,]+)\s*(bayt|byte|[kmg]?b)\b/i.exec(text);
  if (!match) return null;
  const value = parseTrNumber(match[1]);
  if (value === null) return null;
  const unit = SIZE_UNITS[match[2].toLowerCase()] ?? 1;
  return Math.round(value * unit);
}

/** UYAP dosya numarası biçimi: "2026/145". */
export const DOSYA_NO_PATTERN = /(\d{4})\s*\/\s*(\d{1,7})/;

export interface DosyaNoParts {
  readonly dosyaNo: string;
  readonly yil: number;
  readonly sira: number;
}

/** Metinden dosya numarasını çıkarır; biçim tutmuyorsa null (tahmin YOK). */
export function parseDosyaNo(input: string | null | undefined): DosyaNoParts | null {
  const text = cleanText(input);
  const match = DOSYA_NO_PATTERN.exec(text);
  if (!match) return null;
  const yil = Number(match[1]);
  const sira = Number(match[2]);
  if (!Number.isFinite(yil) || !Number.isFinite(sira)) return null;
  if (yil < 1950 || yil > 2200) return null;
  return { dosyaNo: `${yil}/${sira}`, yil, sira };
}

/** URL'den sorgu parametresi okur (mutlak veya göreli URL). */
export function readQueryParam(url: string, name: string, base?: string): string | null {
  try {
    const parsed = new URL(url, base ?? "https://avukat.uyap.gov.tr/");
    return parsed.searchParams.get(name);
  } catch {
    return null;
  }
}

/** Göreli bağlantıyı mutlak adrese çevirir; çevrilemezse null. */
export function toAbsoluteUrl(href: string | null | undefined, base: string): string | null {
  const text = cleanText(href);
  if (!text || text.toLowerCase().startsWith("javascript:") || text === "#") return null;
  try {
    return new URL(text, base).toString();
  } catch {
    return null;
  }
}

/** Dosya adından uzantı çıkarır ("tensip.udf" → "udf"). */
export function fileExtension(name: string | null | undefined): string | null {
  const text = cleanText(name).toLowerCase();
  const match = /\.([a-z0-9]{1,5})$/.exec(text);
  return match ? match[1] : null;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  udf: "application/x-udf",
  pdf: "application/pdf",
  tif: "image/tiff",
  tiff: "image/tiff",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  txt: "text/plain",
};

/** Uzantıya göre MIME türü tahmini; bilinmiyorsa octet-stream. */
export function guessMimeType(fileName: string | null | undefined): string {
  const ext = fileExtension(fileName);
  if (!ext) return "application/octet-stream";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

/** Dosya adı olarak güvenli hale getirir (yol ayıraçları ve kontrol karakterleri temizlenir). */
export function safeFileName(input: string, fallback: string): string {
  const cleaned = cleanText(input)
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : fallback;
}
