/**
 * FAZ 8E — küçük, bağımlılıksız CSV ayrıştırıcı.
 *  - Ayırıcı otomatik: başlık satırında en çok geçen `;` `,` ya da sekme.
 *  - RFC 4180 tırnak: "a;b" tek hücre, "" → ".
 *  - BOM ve \r temizlenir; boş satırlar atlanır.
 *  - Başlık normalizasyonu: küçük harf, Türkçe aksan katlama, boşluk/tire → `_`.
 */

export interface ParsedCsv {
  delimiter: string;
  headers: string[];
  /** Normalize edilmiş başlıklar (aynı sırada). */
  normalizedHeaders: string[];
  rows: string[][];
}

const TR_FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

export function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/^\uFEFF/, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (ch) => TR_FOLD[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function detectDelimiter(firstLine: string): string {
  const candidates = [";", ",", "\t"];
  let best = ";";
  let bestCount = -1;
  for (const c of candidates) {
    const n = firstLine.split(c).length - 1;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  // Tırnak içi satır sonlarını koru: satırları tırnak dengesine göre birleştir.
  const rawLines = clean.split("\n");
  const lines: string[] = [];
  let buf = "";
  let open = false;
  for (const l of rawLines) {
    buf = open ? `${buf}\n${l}` : l;
    const quotes = (buf.match(/"/g) ?? []).length;
    open = quotes % 2 === 1;
    if (!open) {
      if (buf.trim()) lines.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) lines.push(buf);
  if (lines.length === 0) return { delimiter: ";", headers: [], normalizedHeaders: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitLine(l, delimiter));
  return { delimiter, headers, normalizedHeaders: headers.map(normalizeHeader), rows };
}

/**
 * Tarih ayrıştırma: "12.03.2026", "12.03.2026 09:30", "12/03/2026", "2026-03-12", "2026-03-12T09:30".
 * Saat yoksa 09:00 (Türkiye saati varsayımı için UTC+3 → 06:00Z kullanılmaz; yerel 09:00 UTC olarak yazılır
 * — takvim aynı günü gösterir).
 */
export function parseTrDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), m[4] ? Number(m[4]) : 9, m[5] ? Number(m[5]) : 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 9, m[5] ? Number(m[5]) : 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
