/**
 * MEVZUAT BİLGİ SİSTEMİ KONEKTÖRÜ — mevzuat.gov.tr
 * (T.C. Cumhurbaşkanlığı Hukuk ve Mevzuat Genel Müdürlüğü).
 *
 * UÇ NOKTALAR TARAYICI AĞI ÜZERİNDEN BİREBİR DOĞRULANMIŞTIR (uydurma entegrasyon
 * yasağı). İki uç:
 *
 *  1. ARAMA — POST /anasayfa/MevzuatDatatable
 *     İstek başlıkları: content-type: application/json; charset=UTF-8,
 *     x-requested-with: XMLHttpRequest, x-kl-ajax-request: Ajax_Request.
 *     Gövde: DataTables zarfı; parameters.AranacakIfade = base64(UTF-8 bayt).
 *     ÇEREZ GEREKMEZ (çerezsiz istemle doğrulanmıştır).
 *     Yanıt: { recordsFiltered, data: [{ mevzuatNo, mevAdi, kabulTarih,
 *     resmiGazeteTarihi, resmiGazeteSayisi, mevzuatTertip, mevzuatTur, url }] }
 *
 *  2. KONSOLİDE METİN — GET /anasayfa/MevzuatFihristDetayIframe
 *     ?MevzuatTur=&MevzuatNo=&MevzuatTertip= → tam kanun metni (HTML).
 *
 * Ayrıca statik dosyalar: /MevzuatMetin/{TUR}.{TERTIP}.{NO}.doc|.pdf.
 *
 * HIZ LİMITİ: resmî kaynağı yormamak için ardışık istekler arasında
 * MIN_REQUEST_GAP_MS beklenir; zaman aşımı REQUEST_TIMEOUT_MS.
 */

import { Injectable } from "@nestjs/common";
import { cleanOfficialDocument } from "../../caselaw/adapters/yargitay-live.adapter";
import { govCaExpiryWarning, govFetch, isTlsChainError } from "./gov-tls";
import type {
  LegislationSourceConnector,
  MevzuatAramaYer,
  MevzuatConnectorHealth,
  MevzuatDocument,
  MevzuatSearchFilters,
  MevzuatSearchHit,
} from "./types";

const BASE_URL = "https://www.mevzuat.gov.tr";
const REQUEST_TIMEOUT_MS = 15_000;
/** Ardışık istekler arası asgari boşluk — resmî kaynağı yormamak için. */
const MIN_REQUEST_GAP_MS = 700;
/** Tek yanıtta kabul edilen en büyük gövde (32 MB). */
const MAX_BODY_CHARS = 32_000_000;

/** DataTables zarfındaki sabit üç sütun tanımı (tarayıcı isteğinden birebir). */
const DATATABLE_COLUMNS = [
  { data: null, name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
  { data: null, name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
  { data: null, name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
];

interface MevzuatDatatableRow {
  mevzuatNo?: string;
  mevAdi?: string;
  kabulTarih?: string | null;
  resmiGazeteTarihi?: string | null;
  resmiGazeteSayisi?: string | null;
  mevzuatTertip?: string;
  mevzuatTur?: number;
  url?: string | null;
}

interface MevzuatDatatableResponse {
  recordsFiltered?: number;
  recordsTotal?: number;
  data?: MevzuatDatatableRow[];
}

/** UTF-8 baytlarının base64 değeri (tarayıcı btoa(unescape(encodeURIComponent(s)) ile aynı). */
function toBase64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** Sonuç başlığındaki vurgu işaretlerini temizler. */
function stripHighlight(title: string): string {
  return title.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function externalKeyOf(mevzuatNo: string, mevzuatTur: number, tertip: number): string {
  return `${mevzuatNo}.${mevzuatTur}.${tertip}`;
}

@Injectable()
export class MevzuatGovConnector implements LegislationSourceConnector {
  readonly key = "MEVZUAT_GOV";
  readonly name = "Mevzuat Bilgi Sistemi (mevzuat.gov.tr)";
  readonly authorityLevel = 10;

  private lastRequestAt = 0;

  async search(filters: MevzuatSearchFilters): Promise<{ hits: MevzuatSearchHit[]; total: number }> {
    const q = filters.query.trim();
    if (q.length < 2) return { hits: [], total: 0 };

    const page = Math.max(1, Math.min(100, filters.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const body = {
      draw: 1,
      columns: DATATABLE_COLUMNS,
      order: [] as unknown[],
      start: (page - 1) * pageSize,
      length: pageSize,
      search: { value: "", regex: false },
      parameters: {
        AranacakIfade: toBase64Utf8(q),
        AranacakYer: (filters.aramaYer ?? "Baslik") satisfies MevzuatAramaYer,
        TamCumle: false,
        MevzuatTur: filters.mevzuatTur ?? 0,
        GenelArama: true,
      },
    };

    const payload = await this.postJson(`${BASE_URL}/anasayfa/MevzuatDatatable`, body);
    const total = typeof payload.recordsFiltered === "number" ? payload.recordsFiltered : 0;
    const hits: MevzuatSearchHit[] = (payload.data ?? [])
      .filter((row) => row.mevzuatNo && row.mevzuatTur)
      .map((row) => {
        const mevzuatTur = Number(row.mevzuatTur);
        const tertip = Number(row.mevzuatTertip ?? 5) || 5;
        return {
          externalKey: externalKeyOf(String(row.mevzuatNo), mevzuatTur, tertip),
          mevzuatNo: String(row.mevzuatNo),
          mevzuatTur,
          tertip,
          title: stripHighlight(String(row.mevAdi ?? "")),
          kabulTarihi: row.kabulTarih ?? null,
          rgTarihi: row.resmiGazeteTarihi ?? null,
          rgSayisi: row.resmiGazeteSayisi ?? null,
          url: row.url ?? "",
          sourceUrl: `${BASE_URL}/mevzuat?MevzuatNo=${row.mevzuatNo}&MevzuatTur=${mevzuatTur}&MevzuatTertip=${tertip}`,
        };
      });
    return { hits, total };
  }

  /** Konsolide tam metin (iframe ucu). Kanunlarda madde ayrıştırma girdisi. */
  async fetchDocument(externalKey: string): Promise<MevzuatDocument> {
    const [mevzuatNo, turRaw, tertipRaw] = externalKey.split(".");
    const mevzuatTur = Number(turRaw);
    const tertip = Number(tertipRaw);
    if (!/^\d{1,5}$/.test(mevzuatNo ?? "") || !mevzuatTur || !tertip) {
      throw new Error(`Geçersiz mevzuat kimliği: ${externalKey}`);
    }

    const url =
      `${BASE_URL}/anasayfa/MevzuatFihristDetayIframe` +
      `?MevzuatTur=${mevzuatTur}&MevzuatNo=${mevzuatNo}&MevzuatTertip=${tertip}`;
    const html = await this.fetchText(url);
    const text = cleanOfficialDocument(html);
    if (text.trim().length < 200) {
      throw new Error(`Mevzuat metni alınamadı (çok kısa): ${externalKey}`);
    }
    return {
      externalKey,
      mevzuatNo,
      mevzuatTur,
      tertip,
      text,
      sourceUrl: url,
    };
  }

  async healthCheck(): Promise<MevzuatConnectorHealth> {
    const checkedAt = new Date();
    try {
      const { total, hits } = await this.search({ query: "5237", mevzuatTur: 1 });
      const found = hits.some((h) => h.mevzuatNo === "5237");
      const caWarning = govCaExpiryWarning(checkedAt);
      return {
        key: this.key,
        name: this.name,
        healthy: found && total >= 1,
        message:
          (found
            ? `Sağlıklı — örnek arama ("5237") TCK'yı buldu (toplam ${total}).`
            : "Uç nokta yanıt verdi ancak örnek arama beklenen kaydı döndürmedi.") +
          (caWarning ? ` UYARI: ${caWarning}` : ""),
        checkedAt,
      };
    } catch (err) {
      const caWarning = govCaExpiryWarning(checkedAt);
      return {
        key: this.key,
        name: this.name,
        healthy: false,
        message: isTlsChainError(err)
          ? `TLS zinciri doğrulanamadı (${(err as { code?: string }).code}): gov-tls.ts sabit CA paketi ` +
            `yenilenmeli. ${caWarning ?? ""}`.trim()
          : `Bağlantı hatası: ${(err as Error).message}${caWarning ? ` UYARI: ${caWarning}` : ""}`,
        checkedAt,
      };
    }
  }

  // ------------------------------------------------------------------ //
  // HTTP altyapı — hız limiti + zaman aşımı bu katmanda zorunludur
  // ------------------------------------------------------------------ //

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }

  private async fetchText(url: string): Promise<string> {
    await this.throttle();
    const res = await govFetch(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        accept: "text/html, */*",
        "user-agent": "NomosOS-LegalDataConnector/1.0 (mevzuat havuzu beslemesi)",
      },
    });
    if (!res.ok) throw new Error(`${url} ${res.status} döndü.`);
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) {
      throw new Error("Yanıt gövdesi boyut sınırını aşıyor.");
    }
    return text;
  }

  private async postJson(url: string, body: unknown): Promise<MevzuatDatatableResponse> {
    await this.throttle();
    const res = await govFetch(url, {
      method: "POST",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "x-kl-ajax-request": "Ajax_Request",
        accept: "application/json, text/javascript, */*; q=0.01",
        "user-agent": "NomosOS-LegalDataConnector/1.0 (mevzuat havuzu beslemesi)",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url} ${res.status} döndü.`);
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) {
      throw new Error("Yanıt gövdesi boyut sınırını aşıyor.");
    }
    try {
      return JSON.parse(text) as MevzuatDatatableResponse;
    } catch {
      throw new Error(
        "Kaynak beklenen JSON tablo yanıtını döndürmedi (uç nokta değişmiş olabilir).",
      );
    }
  }
}
