/**
 * REKABET KURUMU İSTEMCİSİ — Rekabet Kurulu kararları (rekabet.gov.tr).
 *
 * UÇ NOKTALAR CANLI DOĞRULANMIŞTIR (uydurma entegrasyon yasağı); Node'dan
 * çerezsiz çalıştığı duman testiyle doğrulanmıştır:
 *
 *  - LİSTE: GET /tr/Kararlar?page=N → her karar bir `table.yantablo1` bloğu:
 *    Yayımlanma Tarihi / Karar Sayısı / Karar Tarihi / Karar Türü satırları +
 *    kararın tam başlığı (colspan satırındaki bağlantı). Sayfalama ?page=N.
 *  - DETAY: /Karar?kararId={uuid} → doğrudan PDF döner (doğrulandı). Karar
 *    metni PDF'tir; künye ve başlık LİSTEDEN alınır, metin çekilmez.
 *  - GELİŞMİŞ ARAMA: /tr/Arama (q, KararSayisi, KararTarihi, KararTuruID...)
 *    — künye teyidi için gerekirse sonradan eklenebilir.
 *
 * Bu istemci HİÇBİŞEY YAZMAZ: kuyruğa yazım legislation-ingest hattındadır.
 */

import { Injectable } from "@nestjs/common";

const BASE_URL = "https://www.rekabet.gov.tr";
const LIST_URL = `${BASE_URL}/tr/Kararlar`;
const REQUEST_TIMEOUT_MS = 12_000;
const MIN_REQUEST_GAP_MS = 700;
const MAX_BODY_CHARS = 10_000_000;

/** Rekabet Kurulu kararı künyesi (liste satırı). */
export interface RekabetDecisionItem {
  /** Karar başlığı (listenin colspan satırındaki tam başlık). */
  title: string;
  /** "25-44/1086-615" biçiminde karar sayısı. */
  kararSayisi: string;
  /** "27.11.2025" biçiminde karar tarihi. */
  kararTarihi?: string;
  /** "Rekabet İhlali" gibi karar türü. */
  kararTuru?: string;
  /** "1.9.2026" biçiminde yayımlanma tarihi. */
  yayinlanmaTarihi?: string;
  /** Karar detayı (PDF): /Karar?kararId={uuid}. */
  detailUrl: string;
  /** Dış kaynak kimliği: kararId UUID. */
  kararId: string;
}

/** "1.9.2026" ya da "27.11.2025" → ISO tarih; çevrilemezse undefined. */
export function parseRekabetDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
}

/** Liste HTML'inden karar bloklarını ayrıştırır (doğrulanmış tablo biçimi). */
export function parseRekabetDecisionList(html: string): RekabetDecisionItem[] {
  const items: RekabetDecisionItem[] = [];
  const seen = new Set<string>();
  // Her karar bir <table class="table yantablo1">…</table> bloğudur.
  const TABLE_RE = /<table[^>]*class="[^"]*yantablo1[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let m: RegExpExecArray | null;
  while ((m = TABLE_RE.exec(html)) !== null) {
    const block = m[1];
    const kararId = /\/Karar\?kararId=([0-9a-f-]{36})/i.exec(block)?.[1];
    if (!kararId || seen.has(kararId)) continue;
    const cell = (label: string) =>
      new RegExp(`${label}\\s*:?</th>\\s*<td[^>]*>([^<]*)</td>`, "i").exec(block)?.[1]?.trim();
    const yayin = cell("Yayımlanma Tarihi");
    const kararSayisi = cell("Karar Sayısı") ?? "";
    const kararTarihi = cell("Karar Tarihi");
    const kararTuru = cell("Karar Türü");
    // Başlık: colspan satırındaki /Karar?kararId= bağlantısının metni.
    const titleRaw = new RegExp(
      `<a[^>]*href="/Karar\\?kararId=${kararId}"[^>]*>([\\s\\S]*?)</a>`,
      "i",
    ).exec(block)?.[1];
    const title = titleRaw
      ?.replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !kararSayisi) continue;
    seen.add(kararId);
    items.push({
      title,
      kararSayisi,
      kararTarihi,
      kararTuru,
      yayinlanmaTarihi: yayin,
      detailUrl: `${BASE_URL}/Karar?kararId=${kararId}`,
      kararId,
    });
  }
  return items;
}

@Injectable()
export class RekabetClient {
  private lastRequestAt = 0;

  /** Kurul kararları listesi (sayfa 1'den başlar). */
  async fetchDecisionList(page = 1): Promise<RekabetDecisionItem[]> {
    const now = Date.now();
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${LIST_URL}?page=${Math.max(1, page)}`, {
        signal: controller.signal,
        headers: {
          accept: "text/html, */*",
          "user-agent": "NomosOS-LegalDataConnector/1.0 (Rekabet Kurulu kararlari izleyici)",
        },
      });
      if (!res.ok) throw new Error(`Rekabet Kurumu listesi ${res.status} döndü.`);
      const html = await res.text();
      if (html.length > MAX_BODY_CHARS) throw new Error("Yanıt boyut sınırını aşıyor.");
      return parseRekabetDecisionList(html);
    } finally {
      clearTimeout(timer);
    }
  }
}
