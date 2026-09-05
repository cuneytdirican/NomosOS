/**
 * KVKK KURUM İSTEMCİSİ — Kişisel Verileri Koruma Kurumu Kurul Kararları
 * (kvkk.gov.tr).
 *
 * UÇ NOKTALAR TARAYICI ÜZERİNDEN BİREBİR DOĞRULANMIŞTIR (uydurma entegrasyon
 * yasağı); Node'dan çerezsiz çalıştığı duman testiyle doğrulanmıştır:
 *
 *  - LİSTE: GET /Icerik/5419/kurul-kararlari?page=N → `.members__item` blokları:
 *    başlık (h2/h3/h4) + bağlantı (karar detay sayfası /Icerik/{id}/{slug} ya da
 *    doğrudan RG PDF). Sayfalama ?page=N.
 *  - DETAY: /Icerik/{id}/{slug} → karar tarihi ("Karar Tarihi : dd/mm/yyyy"),
 *    karar no ("Karar No : yyyy/nnnn"), konu özeti ve metin.
 *  - ARAMA: GET /search-decision?parent=5419&q={sorgu} → "Toplam: N sonuç
 *    bulundu." + `.members__item` blokları.
 *
 * Bu istemci HİÇBİŞEY YAZMAZ: kuyruğa yazım legislation-ingest hattındadır
 * (onay kuyruğu ilkesi). RG PDF bağlantıları metin olarak çekilmez.
 */

import { Injectable } from "@nestjs/common";

const BASE_URL = "https://www.kvkk.gov.tr";
const LIST_URL = `${BASE_URL}/Icerik/5419/kurul-kararlari`;
const REQUEST_TIMEOUT_MS = 12_000;
const MIN_REQUEST_GAP_MS = 700;
const MAX_BODY_CHARS = 10_000_000;

/** Kurul kararı künyesi (liste satırı). */
export interface KvkkDecisionItem {
  /** Karar başlığı (liste başlığı). */
  title: string;
  /** Detay sayfası (kvkk.gov.tr/Icerik/...) ya da RG PDF adresi. */
  url: string;
  /** PDF ise metin çekilemez (künye kuyruğa taşınır). */
  isPdf: boolean;
}

/** Liste/detay HTML'inden karar satırlarını ayrıştırır (doğrulanmış biçim). */
export function parseKvkkDecisionList(html: string): KvkkDecisionItem[] {
  const items: KvkkDecisionItem[] = [];
  const seen = new Set<string>();
  // Her members__item bloğu: başlık + ilk bağlantı.
  const BLOCK_RE = /class="members__item[^"]*"[\s\S]*?<\/div>\s*<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html)) !== null) {
    const block = m[0];
    const heading = /<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>/i.exec(block)?.[1];
    const href = /<a\s+href="([^"]+)"/i.exec(block)?.[1];
    if (!heading || !href) continue;
    const title = heading
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;|&rsquo;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (!title || seen.has(href)) continue;
    seen.add(href);
    const isPdf = /\.pdf(\?|$)/i.test(href);
    items.push({
      title,
      url: href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`,
      isPdf,
    });
  }
  return items;
}

/** KVKK karar sayfasından "Karar Tarihi : dd/mm/yyyy" ve "Karar No : yyyy/nnnn" çıkarır. */
export function extractKvkkDecisionMeta(text: string): {
  kararTarihi?: string;
  kararNo?: string;
} {
  const tarih = /Karar Tarihi\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(text)?.[1];
  const no = /Karar No\s*:\s*(\d{4}\s*\/\s*\d{1,5})/.exec(text)?.[1]?.replace(/\s+/g, "");
  return { kararTarihi: tarih, kararNo: no };
}

@Injectable()
export class KvkkClient {
  private lastRequestAt = 0;

  /** Kurul kararları listesi (sayfa 1'den başlar; izleyici ilk sayfaları tarar). */
  async fetchDecisionList(page = 1): Promise<KvkkDecisionItem[]> {
    const html = await this.fetchHtml(`${LIST_URL}?page=${Math.max(1, page)}`);
    return parseKvkkDecisionList(html);
  }

  /** Karar detay sayfasının temiz metni (PDF bağlantıları için hata fırlatır). */
  async fetchDecisionText(url: string): Promise<string> {
    if (!url.startsWith(`${BASE_URL}/`) || !/\/Icerik\/\d+\//.test(url)) {
      throw new Error("Yalnızca KVKK karar detay sayfaları metin olarak çekilebilir (PDF değil).");
    }
    const html = await this.fetchHtml(url);
    let text = html
      .replace(/<head>[\s\S]*?<\/head>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td|h[1-6])>/gi, "\n")
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
      throw new Error("KVKK karar metni alınamadı (çok kısa ya da boş).");
    }
    return text;
  }

  private async fetchHtml(url: string): Promise<string> {
    const now = Date.now();
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "text/html, */*",
          "user-agent": "NomosOS-LegalDataConnector/1.0 (KVKK kurul kararlari izleyici)",
        },
      });
      if (!res.ok) throw new Error(`KVKK sayfası ${res.status} döndü (${url}).`);
      const text = await res.text();
      if (text.length > MAX_BODY_CHARS) throw new Error("KVKK sayfası boyut sınırını aşıyor.");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
