/**
 * ICS (RFC 5545) takvim beslemesi — Google Takvim / Outlook / Apple Takvim
 * "URL ile abone ol" için. Yalnız OKUMA; senkron tek yönlüdür (NomosOS → takvim).
 *
 * Kurallar:
 *  - Duruşma/randevu: saatli (DTSTART UTC, 1 saat varsayılan süre).
 *  - Süre/görev teslimi: tüm gün (VALUE=DATE) — son gün hatırlatması.
 *  - UID kararlıdır (`<kind>-<id>@nomosos`): yeniden çekmede kopya oluşmaz.
 *  - Metin alanları RFC 5545 §3.3.11 kaçışlarıyla yazılır, satırlar 75 oktette katlanır.
 */

export interface IcsEvent {
  id: string;
  kind: "DURUSMA" | "RANDEVU" | "SURE" | "GOREV";
  title: string;
  /** ISO 8601. */
  date: string;
  endAt?: string;
  caseTitle?: string | null;
  clientName?: string | null;
  location?: string | null;
  note?: string | null;
  legalBasis?: string | null;
}

const KIND_LABEL: Record<IcsEvent["kind"], string> = {
  DURUSMA: "Duruşma",
  RANDEVU: "Randevu",
  SURE: "Süre (son gün)",
  GOREV: "Görev teslimi",
};

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: satırlar 75 oktetten uzun olamaz; devam satırı boşlukla başlar. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // Çok baytlı karakteri ortadan bölme: devam baytı (10xxxxxx) görürsen geri çekil.
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join("\r\n");
}

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

function nextDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildIcs(events: IcsEvent[], calendarName = "NomosOS Ajanda", now = new Date()): string {
  const stamp = utcStamp(now.toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NomosOS//Ajanda//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-WR-TIMEZONE:Europe/Istanbul",
  ];
  for (const e of events) {
    const summary = `${KIND_LABEL[e.kind]}: ${e.title}`;
    const description = [e.caseTitle ? `Dosya: ${e.caseTitle}` : null, e.clientName ? `Müvekkil: ${e.clientName}` : null, e.legalBasis ? `Dayanak: ${e.legalBasis}` : null, e.note ?? null]
      .filter((v): v is string => Boolean(v))
      .join("\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.kind.toLowerCase()}-${e.id}@nomosos`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.kind === "SURE" || e.kind === "GOREV") {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(e.date)}`);
    } else {
      const end = e.endAt ?? new Date(new Date(e.date).getTime() + 3_600_000).toISOString();
      lines.push(`DTSTART:${utcStamp(e.date)}`);
      lines.push(`DTEND:${utcStamp(end)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
    lines.push(`CATEGORIES:${escapeIcsText(KIND_LABEL[e.kind])}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
