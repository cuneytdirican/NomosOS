/**
 * UYUŞMAZLIK MAHKEMESİ CANLI ADAPTÖRÜ — kararlar.uyusmazlik.gov.tr
 * (Uyuşmazlık Mahkemesi Karar Arama Uygulaması).
 *
 * UÇ NOKTA AKIŞI CANLI DOĞRULANMIŞTIR (uydurma entegrasyon yasağı):
 * ASP.NET WebForms iki adımlı akış — çerez/captcha GEREKMEZ:
 *
 *  1. GET / → gizli alanlar: __VIEWSTATE, __VIEWSTATEGENERATOR,
 *     __EVENTVALIDATION (HTML'den ayrıştırılır).
 *  2. POST / (application/x-www-form-urlencoded):
 *     { ...gizli alanlar, txtSearch: künye, btnSearch: "Ara",
 *       rblSearchScope: "EsasNo" | "KararNo" | "All" }
 *     Yanıt HTML: "Arama sonuçları: N dosya bulundu." + sonuç satırları
 *     <td>2026/366</td><td>2026/343</td><td>15/06/2026</td> + PDF bağlantısı
 *     (Uploads/{esas}-{karar}.pdf — PDF'ler metin olarak ÇEKİLMEZ).
 *
 * KAPSAM KARARI (AYM adaptörüyle aynı): canSearch = false — kararlar yalnızca
 * PDF'tir, metin okunamaz; bu yüzden adaptör yalnızca KÜNYE TEYİDİ sağlar.
 * Kayıt HAVUZA YAZILMAZ: CaseLawDocument biçiminde okuma kaydı döner
 * (id = "uyusmazlik:{esas}E{karar}").
 */

import { Injectable } from "@nestjs/common";
import type { CaseLawDocument } from "@nomosos/db";
import type {
  CaseLawAdapterHealth,
  CaseLawCitationLookup,
  CaseLawCitationQuery,
  CaseLawFilters,
  CaseLawHit,
  CaseLawSourceAdapter,
} from "./types";

const BASE_URL = "https://kararlar.uyusmazlik.gov.tr/";
const REQUEST_TIMEOUT_MS = 12_000;
/** Ardışık istekler arası asgari boşluk — resmî kaynağı yormamak için. */
const MIN_REQUEST_GAP_MS = 800;
const MAX_BODY_CHARS = 10_000_000;

export const UYUSMAZLIK_ADAPTER_KEY = "UYUSMAZLIK_CANLI";

/** WebForms gizli alanları (GET sayfasından ayrıştırılır). */
const HIDDEN_FIELDS = ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"] as const;

export interface UyusmazlikRow {
  esasNo: string;
  kararNo: string;
  kararTarihi?: string;
  pdfUrl?: string;
}

/** "15/06/2026" → "2026-06-15" (ISO; çevrilemeyen değer undefined). */
function trDateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
}

export interface UyusmazlikSearchOutcome {
  /** lblSearchStatus: "Arama sonuçları: N dosya bulundu." (kaynağın sayacı). */
  reportedCount: number | null;
  rows: UyusmazlikRow[];
}

/**
 * Arama yanıtını ayrıştırır. DİKKAT: EsasNo araması KISMİ eşleşir
 * ("1999/1" sorgusu "1999/10", "1999/11"... de getirir — canlı
 * doğrulandı). Birebir eşleşme çağıran tarafın filtresidir.
 */
export function parseUyusmazlikSearch(html: string): UyusmazlikSearchOutcome {
  const countText = /Arama sonuçları:\s*(\d+)\s*dosya bulundu/.exec(html);
  return {
    reportedCount: countText ? Number(countText[1]) : null,
    rows: parseUyusmazlikRows(html),
  };
}

/** Sonuç HTML'inden karar satırlarını ayrıştırır (doğrulanmış tablo biçimi). */
export function parseUyusmazlikRows(html: string): UyusmazlikRow[] {
  const rows: UyusmazlikRow[] = [];
  // Üç sütunlu künye hücreleri: esas | karar | tarih. PDF bağlantısı aynı
  // satırın devamında (200 karakter penceresinde) aranır.
  const ROW_RE =
    /<td[^>]*>\s*(\d{4}\s*\/\s*\d{1,4})\s*<\/td>\s*<td[^>]*>\s*(\d{4}\s*\/\s*\d{1,4})\s*<\/td>\s*<td[^>]*>\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = ROW_RE.exec(html)) !== null) {
    const pdf = /Uploads\/[\w.-]+\.pdf/.exec(html.slice(m.index, m.index + 400))?.[0];
    rows.push({
      esasNo: m[1].replace(/\s+/g, ""),
      kararNo: m[2].replace(/\s+/g, ""),
      kararTarihi: m[3],
      pdfUrl: pdf ? new URL(pdf, BASE_URL).toString() : undefined,
    });
  }
  return rows;
}

/** CaseLawDocument BİÇİMİNDE okuma kaydı (veritabanına YAZILMAZ). */
function toRecord(row: UyusmazlikRow): CaseLawDocument {
  const iso = trDateToIso(row.kararTarihi);
  return {
    id: `uyusmazlik:${row.esasNo}E${row.kararNo}`,
    court: "Uyuşmazlık Mahkemesi",
    chamber: null,
    caseNumber: row.esasNo,
    decisionNumber: row.kararNo,
    decisionDate: iso ? new Date(`${iso}T00:00:00Z`) : null,
    summary: null,
    fullText: null,
    sourceUrl: row.pdfUrl ?? null,
    sourceAdapter: UYUSMAZLIK_ADAPTER_KEY,
    fetchedAt: new Date(),
    createdByTenantId: null,
    authorityLevel: 9,
    references: [],
  } as unknown as CaseLawDocument;
}

/** Bu adaptörün yanıt verdiği künye kaynağı (kaynak kapısı — bkz. AymLiveAdapter). */
const UYUSMAZLIK_SOURCE = "UYUSMAZLIK";

@Injectable()
export class UyusmazlikLiveAdapter implements CaseLawSourceAdapter {
  readonly key = UYUSMAZLIK_ADAPTER_KEY;
  readonly name = "Uyuşmazlık Mahkemesi Karar Arama (canlı künye teyidi)";
  readonly canSearch = false;
  readonly canFetchByCitation = true;

  private lastRequestAt = 0;

  /**
   * KÜNYE TEYİDİ — esas numarasıyla birebir arama; karar numarası satırla
   * karşılaştırılır. FAIL-CLOSED: kaynak hatası SEARCH_FAILED; NOT_FOUND yalnız
   * kaynak sağlıklı yanıt verip künyeyi bulamadığında üretilir.
   */
  async fetchByCitation(query: CaseLawCitationQuery): Promise<CaseLawCitationLookup> {
    if (query.source !== UYUSMAZLIK_SOURCE) {
      return {
        outcome: "NOT_FOUND",
        note:
          `Künye kaynağı (${query.source ?? "belirtilmemiş"}) Uyuşmazlık Mahkemesi değil; ` +
          "bu adaptör aramadı (ağ isteği yok).",
        adapterKey: this.key,
      };
    }
    const esasNo = query.caseNumber.trim().replace(/\s+/g, "");
    if (!/^\d{4}\/\d{1,4}$/.test(esasNo)) {
      return {
        outcome: "SEARCH_FAILED",
        note: "Uyuşmazlık Mahkemesi künye biçimi beklenmedi (YYYY/NNNN). Canlı doğrulama yapılamadı.",
        adapterKey: this.key,
      };
    }
    try {
      const html = await this.searchForm("EsasNo", esasNo);
      const { reportedCount, rows } = parseUyusmazlikSearch(html);
      // EsasNo araması KISMİ eşleşir — birebir filtre zorunludur.
      const exact = rows.filter((r) => r.esasNo === esasNo);
      if (exact.length === 0) {
        return {
          outcome: "NOT_FOUND",
          note:
            "Uyuşmazlık Mahkemesi karar aramada bu esas numarasıyla karar bulunamadı." +
            (reportedCount !== null && reportedCount > 0
              ? ` (En yakın ${reportedCount} benzer künye vardı; hiçbiri birebir eşleşmedi.)`
              : ""),
          adapterKey: this.key,
        };
      }
      const kararNo = (query.decisionNumber ?? "").trim().replace(/\s+/g, "");
      const withKarar = kararNo ? exact.filter((r) => r.kararNo === kararNo) : exact;
      const pool = withKarar.length > 0 ? withKarar : exact;
      const record = toRecord(pool[0]);
      return {
        outcome: "FOUND",
        record,
        ambiguous: pool.length > 1 || (kararNo.length > 0 && withKarar.length === 0),
        note:
          `Uyuşmazlık Mahkemesi karar aramada birebir eşleşti: ${record.caseNumber} E. ` +
          `${record.decisionNumber} K.` +
          (kararNo && withKarar.length === 0
            ? ` (uyarı: kaynak karar numarası ${exact[0].kararNo} — atıftaki ${kararNo} ile farklı, künyeyi kontrol edin)`
            : "") +
          (pool.length > 1 ? ` (${pool.length} karar aynı esasla eşleşti; ilk kayıt döndürüldü.)` : ""),
        adapterKey: this.key,
      };
    } catch (err) {
      return {
        outcome: "SEARCH_FAILED",
        note: `Uyuşmazlık Mahkemesi aramaya erişilemedi: ${(err as Error).message}`,
        adapterKey: this.key,
      };
    }
  }

  /** Ürün arama yüzeyine kapalı (kararlar yalnızca PDF; metin okunamıyor). */
  async search(_query: string, _filters: CaseLawFilters): Promise<CaseLawHit[]> {
    return [];
  }

  async healthCheck(): Promise<CaseLawAdapterHealth> {
    const base = {
      key: this.key,
      name: this.name,
      checkedAt: new Date(),
      canSearch: this.canSearch,
      canFetchByCitation: this.canFetchByCitation,
    };
    try {
      const html = await this.searchForm("EsasNo", "2026/366");
      const rows = parseUyusmazlikRows(html);
      const found = rows.some((r) => r.esasNo === "2026/366");
      return {
        ...base,
        healthy: found,
        message: found
          ? `Sağlıklı — örnek künye (2026/366) bulundu (${rows.length} satır).`
          : "Uç nokta yanıt verdi ancak örnek künye araması beklenen sonucu vermedi.",
      };
    } catch (err) {
      return { ...base, healthy: false, message: `Bağlantı hatası: ${(err as Error).message}` };
    }
  }

  /** WebForms iki adımlı arama akışı (doğrulanmış): GET gizli alanlar → POST. */
  private async searchForm(scope: "EsasNo" | "KararNo" | "All", term: string): Promise<string> {
    const pageHtml = await this.fetchText("GET", BASE_URL);
    const body = new URLSearchParams();
    for (const name of HIDDEN_FIELDS) {
      const m = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i").exec(pageHtml);
      if (m) body.set(name, m[1]);
    }
    body.set("txtSearch", term);
    body.set("btnSearch", "Ara");
    body.set("rblSearchScope", scope);
    return this.fetchText("POST", BASE_URL, body.toString());
  }

  private async fetchText(method: "GET" | "POST", url: string, formBody?: string): Promise<string> {
    const now = Date.now();
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: "text/html, */*",
          "user-agent": "NomosOS-LegalDataConnector/1.0 (Uyusmazlik kunye teyidi)",
          ...(method === "POST"
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(method === "POST" ? { body: formBody } : {}),
      });
      if (!res.ok) throw new Error(`${url} ${res.status} döndü.`);
      const text = await res.text();
      if (text.length > MAX_BODY_CHARS) throw new Error("Yanıt boyut sınırını aşıyor.");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
