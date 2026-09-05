/**
 * RESMÎ GAZETE İSTEMCİSİ — resmigazete.gov.tr gün sayfası okuyucu.
 *
 * UÇ NOKTA TARAYICI ÜZERİNDEN DOĞRULANMIŞTIR (uydurma entegrasyon yasağı):
 *  - Gün sayfası: GET /eskiler/YYYY/MM/YYYYMMDD.htm
 *    Kodlama: windows-1254 (sayfa charset'i birebir doğrulandı).
 *    Yapı: "<b><u>BÖLÜM/MADDE-TÜR BAŞLIĞI</u></b>" başlıkları; belgeler
 *    "<a href='YYYYMMDD-N.htm'>–– Başlık</a>" biçiminde göreli bağlantılar.
 *    İlan bölümü bağlantıları /ilanlar/ altında ve MUTLAKA hariç tutulur.
 *  - Belge metni: GET /eskiler/YYYY/MM/YYYYMMDD-N.htm (HTML) ya da .pdf.
 *    PDF'ler metin olarak çekilmez; künye kuyruğa taşınır, metin önizlemede
 *    temin edilemezse onay künye üzerinden yapılır.
 *
 * Bu istemci HİÇBİŞEY YAZMAZ: yalnızca okur. Kuyruğa yazım
 * legislation-ingest hattındadır (onay kuyruğu ilkesi).
 */

import { Injectable } from "@nestjs/common";
import { govFetch } from "./gov-tls";

const BASE_URL = "https://www.resmigazete.gov.tr";
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_GAP_MS = 700;
/** Tek yanıtta kabul edilen en büyük gövde (32 MB). */
const MAX_BODY_CHARS = 32_000_000;

/** RG sayfasındaki madde türü başlığı → NomosOS belge türü. */
const SECTION_TO_DOC_TYPE: Array<{ re: RegExp; docType: string }> = [
  // RG gün sayfasında tek kanun "KANUN", birden çok kanun "KANUNLAR" başlığıyla
  // çıkar; ikisi de KANUN sayılmalı — aksi hâlde çoklu kanun günü DIGER'e
  // düşer ve onayda kanun sürümleme yolu (StatuteArticleVersion) hiç çalışmaz.
  { re: /^KANUN(?:LAR)?\s*$/i, docType: "KANUN" },
  { re: /^KANUN HÜKMÜNDE KARARNAME/i, docType: "KHK" },
  { re: /^CUMHURBAŞKANLIĞI KARARNAMESİ/i, docType: "KHK" },
  { re: /^YÖNETMELİK/i, docType: "YONETMELIK" },
  { re: /^TEBLİĞ/i, docType: "TEBLIG" },
  { re: /^GENELGE/i, docType: "GENELGE" },
  { re: /^TÜZÜK/i, docType: "YONETMELIK" },
];

/** Tek gün sayfası maddesi (künye satırı). */
export interface RgDayItem {
  /** Sıra (sayfa içindeki belge sırası). */
  order: number;
  /** RG başlığındaki tür ("YÖNETMELİK" gibi). */
  section: string;
  /** NomosOS belge türü (KANUN | KHK | YONETMELIK | TEBLIG | GENELGE | DIGER). */
  docType: string;
  title: string;
  /** Tam URL (/eskiler/... .htm ya da .pdf). */
  url: string;
  /** Metni HTML olarak mı çekilebilir (PDF değil)? */
  isHtml: boolean;
}

export interface RgDayIssue {
  /** "2026-09-04" */
  date: string;
  /** RG sayı numarası (sayfa başlığından "33360 Sayılı" ifadesinden). */
  rgNo?: string;
  items: RgDayItem[];
}

/** Bölüm başlığı mı ("YÜRÜTME VE İDARE BÖLÜMÜ" gibi) — madde türü değil. */
const BOLUM_RE = /BÖLÜMÜ/i;

function docTypeForSection(section: string): string {
  const s = section.trim();
  for (const { re, docType } of SECTION_TO_DOC_TYPE) {
    if (re.test(s)) return docType;
  }
  return "DIGER";
}

function decodeWindows1254(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("windows-1254").decode(buffer);
  } catch {
    // Kod çözücü yoksa UTF-8'e düş (en kötü durumda bozuk karakter, akış durmaz).
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/** HTML başlık/bağlantı zincirinden belge satırlarını çıkarır. */
export function parseRgDayHtml(html: string, dateKey: string): RgDayItem[] {
  const items: RgDayItem[] = [];
  // Belge bağlantıları: <a href="YYYYMMDD-N.htm">...başlık...</a>
  const LINK_RE = /<a\s+href="(\d{8}-\d{1,3}\.(?:htm|pdf))"[^>]*>([\s\S]*?)<\/a>/gi;
  // Kalın+altı çizili başlık blokları (bölüm ve madde türleri).
  const HEADER_RE = /<b><u>[\s\S]*?<\/u><\/b>/gi;

  // Tüm olayları (başlık/bağlantı) konum sırasına diz.
  type Ev = { kind: "header" | "link"; at: number; section?: string; match?: RegExpExecArray };
  const events: Ev[] = [];
  let hm: RegExpExecArray | null;
  HEADER_RE.lastIndex = 0;
  while ((hm = HEADER_RE.exec(html)) !== null) {
    const label = hm[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (label && !BOLUM_RE.test(label)) {
      events.push({ kind: "header", at: hm.index, section: label });
    }
  }
  let lm: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((lm = LINK_RE.exec(html)) !== null) {
    events.push({ kind: "link", at: lm.index, match: lm });
  }
  events.sort((a, b) => a.at - b.at);

  let currentSection = "";
  let order = 0;
  for (const ev of events) {
    if (ev.kind === "header") {
      currentSection = ev.section ?? "";
      continue;
    }
    const m = ev.match!;
    const href = m[1];
    const title = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s–—-]+/, "")
      .trim();
    if (!title) continue;
    order += 1;
    items.push({
      order,
      section: currentSection,
      docType: docTypeForSection(currentSection),
      title,
      url: `${BASE_URL}/eskiler/${dateKey.slice(0, 4)}/${dateKey.slice(5, 7)}/${href}`,
      isHtml: href.toLowerCase().endsWith(".htm"),
    });
  }
  return items;
}

@Injectable()
export class ResmiGazeteClient {
  private lastRequestAt = 0;

  /** Belli bir tarihin gün sayfasını okur (yalnızca okuma). */
  async fetchDay(date: Date): Promise<RgDayIssue> {
    const key = toDayKey(date);
    const url = `${BASE_URL}/eskiler/${key.slice(0, 4)}/${key.slice(5, 7)}/${key.replace(/-/g, "")}.htm`;
    const html = await this.fetchHtml(url);
    // Sayı numarası sayfa başlığından: "…33360 Sayılı Resmî Gazete".
    const rgNo = /(\d{4,6})\s*(?:Say[ıi]l[ıi])\s*Resm?\s*[îi]\s*Gazete/i.exec(html)?.[1];
    return { date: key, rgNo, items: parseRgDayHtml(html, key) };
  }

  /** RG belgesinin (HTML) temiz metnini çeker. PDF'ler için hata fırlatır. */
  async fetchDocumentText(url: string): Promise<string> {
    if (!url.startsWith(`${BASE_URL}/`) || !/\.htm$/i.test(url)) {
      throw new Error("Yalnızca Resmî Gazete HTML belgeleri metin olarak çekilebilir (PDF değil).");
    }
    const html = await this.fetchHtml(url);
    let text = html
      .replace(/<head>[\s\S]*?<\/head>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    text = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    text = text
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length < 200) {
      throw new Error("RG belgesi metni alınamadı (çok kısa ya da boş).");
    }
    return text;
  }

  private async fetchHtml(url: string): Promise<string> {
    const now = Date.now();
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();

    const res = await govFetch(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        accept: "text/html, */*",
        "user-agent": "NomosOS-LegalDataConnector/1.0 (Resmî Gazete izleyici)",
      },
    });
    if (!res.ok) throw new Error(`Resmî Gazete sayfası ${res.status} döndü (${url}).`);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_CHARS) {
      throw new Error("RG sayfası boyut sınırını aşıyor.");
    }
    return decodeWindows1254(buffer);
  }
}

/** Date → "2026-09-04" (TR takvim günü; DST yoktur, +03:00). */
function toDayKey(date: Date): string {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
