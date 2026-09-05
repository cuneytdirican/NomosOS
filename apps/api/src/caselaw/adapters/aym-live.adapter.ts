/**
 * AYM CANLI ADAPTÖRÜ — Kararlar Bilgi Bankası
 * (kararlarbilgibankasi.anayasa.gov.tr).
 *
 * UÇ NOKTALAR TARAYICI AĞI ÜZERİNDEN BİREBİR DOĞRULANMIŞTIR (uydurma entegrasyon
 * yasağı):
 *
 *   POST /api/core/public/search  (JSON, çerez/captcha GEREKMEZ)
 *     Gövde alanları: `query` (serbest metin) · `basvuruNo` ("2013/1821" —
 *     bireysel başvuru künyesi, BİREBİR) · `esasNo` + `kararNo` (norm denetimi
 *     künyesi) · `page`, `size`.
 *     Yanıt: { total, page, data: [{ kararTipi: "BireyselBasvuru" |
 *     "NormDenetimi", id, basvuruNo, esasNo, kararNo, kararTarihi, basvuruAdi,
 *     kararKonusu, kararTuruBasvuruSonucuLabel, kararVerenBirimLabel,
 *     resmiGazeteTarihi, resmiGazeteSayisi, ... }] }
 *
 * KAPSAM KARARI (doğrulanmayan uç kullanılmaz):
 *  - canSearch = false: serbest metin araması çalışıyor ANCAK kararın TAM
 *    METNİ bugün çekilemiyor (dosyalar ucu `GET /api/core/public/kararlar/{id}/
 *    dosyalar` doğru; döndürdüğü .udf dosya adresi 404 veriyor). Metni
 *    okunamayan canlı arama sonucu üretmek "metni oku" ölü yolu açar; bu yüzden
 *    adaptör yalnızca KÜNYE TEYİDİ (fetchByCitation) sağlar. Dosya ucu
 *    onarıldığında canSearch açılır.
 *  - Kayıt HAVUZA YAZILMAZ: fetchByCitation bir CaseLawDocument BİÇİMİNDE
 *    okuma nesnesi döndürür (id = "aym:{dışKimlik}"); veritabanına yazılmaz.
 *    Teyit Ajanı bu kayıtla DOGRULANDI üretir ve note, canlı kaynağı bildirir.
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

const BASE_URL = "https://kararlarbilgibankasi.anayasa.gov.tr";
const SEARCH_URL = `${BASE_URL}/api/core/public/search`;
const REQUEST_TIMEOUT_MS = 12_000;
/** Ardışık istekler arası asgari boşluk — resmî kaynağı yormamak için. */
const MIN_REQUEST_GAP_MS = 600;
const MAX_BODY_CHARS = 10_000_000;

export const AYM_ADAPTER_KEY = "AYM_CANLI";

interface AymSearchRow {
  kararTipi?: string;
  id?: string;
  basvuruNo?: string;
  esasNo?: string;
  kararNo?: string;
  kararTarihi?: string;
  basvuruAdi?: string;
  kararKonusu?: string;
  kararTuruBasvuruSonucuLabel?: string;
  kararVerenBirimLabel?: string;
}

interface AymSearchResponse {
  total?: number;
  data?: AymSearchRow[];
}

/** HTML etiketlerini temizleyip tek boşluğa indirir (kararKonusu HTML geliyor). */
function stripHtml(value: string | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

/** "2019/12345" → "2019/12345"; "2019 / 12345" → aynı biçime indirgenir. */
function normalizeNo(value: string): string {
  const m = /^(\d{4})\s*\/\s*(\d{1,6})$/.exec(value.trim());
  return m ? `${m[1]}/${m[2]}` : value.trim();
}

/** CaseLawDocument BİÇİMİNDE okuma kaydı (veritabanına YAZILMAZ). */
function toRecord(row: AymSearchRow): CaseLawDocument {
  const isNormDenetimi = row.kararTipi === "NormDenetimi";
  return {
    id: `aym:${row.id ?? ""}`,
    court: "Anayasa Mahkemesi",
    chamber: row.kararVerenBirimLabel ?? null,
    caseNumber: normalizeNo(isNormDenetimi ? row.esasNo ?? "" : row.basvuruNo ?? ""),
    decisionNumber: isNormDenetimi ? normalizeNo(row.kararNo ?? "") : "",
    decisionDate: row.kararTarihi ? new Date(`${row.kararTarihi}T00:00:00Z`) : null,
    summary: stripHtml(row.kararKonusu),
    fullText: null,
    sourceUrl: `${BASE_URL}/kbb/pages/search/Tumu?id=${Buffer.from(`kbb:${row.id}`).toString("base64")}&type=${isNormDenetimi ? "NormDenetimi" : "BireyselBasvuru"}`,
    sourceAdapter: AYM_ADAPTER_KEY,
    fetchedAt: new Date(),
    createdByTenantId: null,
    authorityLevel: 9,
    references: [],
  } as unknown as CaseLawDocument;
}

/**
 * Bu adaptörün yanıt verdiği künye kaynağı. KAYNAK KAPISI: künye başka bir
 * mahkemeyi adlandırıyorsa (YARGITAY, DANISTAY…) ya da mahkeme adı HİÇ yoksa
 * ağ isteği YAPILMAZ. Aksi hâlde aynı esas/karar numaralı bir AYM kararı,
 * bir Yargıtay atfını "doğrulanmış" gösterebilirdi (yanlış DOGRULANDI) ve her
 * içtihat atfı için gereksiz dış istek atılırdı.
 */
const AYM_SOURCE = "AYM";

@Injectable()
export class AymLiveAdapter implements CaseLawSourceAdapter {
  readonly key = AYM_ADAPTER_KEY;
  readonly name = "AYM Kararlar Bilgi Bankası (canlı künye teyidi)";
  readonly canSearch = false;
  readonly canFetchByCitation = true;

  private lastRequestAt = 0;

  /**
   * Serbest metin araması — şu an yalnız İÇ kullanım (künye doğrulama yardımı).
   * Ürün yüzeyine açılmaz (bkz. dosya başlığındaki kapsam kararı).
   */
  async searchRaw(query: string, page = 1, size = 20): Promise<{ rows: AymSearchRow[]; total: number }> {
    const payload = await this.postSearch({ query: query.trim(), page, size });
    return { rows: payload.data ?? [], total: payload.total ?? 0 };
  }

  /**
   * KÜNYE TEYİDİ.
   *  - kararNo yok → bireysel başvuru: `basvuruNo` ile birebir arama.
   *  - kararNo var → norm denetimi: `esasNo` + `kararNo` ile birebir arama.
   *
   * FAIL-CLOSED: kaynak hatası SEARCH_FAILED döner; NOT_FOUND yalnızca kaynak
   * sağlıklı yanıt verip künyeyi bulamadığında üretilir.
   */
  async fetchByCitation(query: CaseLawCitationQuery): Promise<CaseLawCitationLookup> {
    if (query.source !== AYM_SOURCE) {
      return {
        outcome: "NOT_FOUND",
        note: `Künye kaynağı (${query.source ?? "belirtilmemiş"}) AYM değil; bu adaptör aramadı (ağ isteği yok).`,
        adapterKey: this.key,
      };
    }
    const caseNumber = normalizeNo(query.caseNumber);
    if (!/^\d{4}\/\d{1,6}$/.test(caseNumber)) {
      return {
        outcome: "SEARCH_FAILED",
        note: "AYM künye biçimi beklenmedi (YYYY/NNNNN). Canlı doğrulama yapılamadı.",
        adapterKey: this.key,
      };
    }
    const decisionNumber = (query.decisionNumber ?? "").trim();
    try {
      const payload = decisionNumber
        ? await this.postSearch({ esasNo: caseNumber, kararNo: normalizeNo(decisionNumber), size: 5 })
        : await this.postSearch({ basvuruNo: caseNumber, size: 5 });

      const rows = payload.data ?? [];
      if (rows.length === 0) {
        return {
          outcome: "NOT_FOUND",
          note: "AYM Kararlar Bilgi Bankası'nda bu künyeye ait karar bulunamadı.",
          adapterKey: this.key,
        };
      }
      if (rows.length > 1) {
        return {
          outcome: "FOUND",
          record: toRecord(rows[0]),
          ambiguous: true,
          note: `Künye ${rows.length} kararla eşleşti; ilk kayıt döndürüldü.`,
          adapterKey: this.key,
        };
      }
      const record = toRecord(rows[0]);
      return {
        outcome: "FOUND",
        record,
        note:
          `AYM Kararlar Bilgi Bankası'nda birebir eşleşti: ${record.court} ` +
          `${rows[0].basvuruAdi ?? ""} — ${rows[0].kararTuruBasvuruSonucuLabel ?? ""}`.trim(),
        adapterKey: this.key,
      };
    } catch (err) {
      return {
        outcome: "SEARCH_FAILED",
        note: `AYM Bilgi Bankası'na erişilemedi: ${(err as Error).message}`,
        adapterKey: this.key,
      };
    }
  }

  /** Ürün arama yüzeyine kapalı (bkz. dosya başlığı). Sözleşme gereği mevcut. */
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
      const payload = await this.postSearch({ basvuruNo: "2013/1821", size: 1 });
      const ok = payload.total === 1;
      return {
        ...base,
        healthy: ok,
        message: ok
          ? "Sağlıklı — örnek künye (2013/1821) birebir bulundu."
          : `Uç nokta yanıt verdi ancak örnek künye araması beklenen sonucu vermedi (total=${payload.total ?? "?"}).`,
      };
    } catch (err) {
      return { ...base, healthy: false, message: `Bağlantı hatası: ${(err as Error).message}` };
    }
  }

  private async postSearch(
    filters: Record<string, string | number>,
  ): Promise<AymSearchResponse> {
    const now = Date.now();
    const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(SEARCH_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          accept: "application/json, text/javascript, */*; q=0.01",
          "user-agent": "NomosOS-LegalDataConnector/1.0 (AYM kunye teyidi)",
        },
        body: JSON.stringify({ _timestamp: Date.now(), page: 1, size: 20, ...filters }),
      });
      if (!res.ok) throw new Error(`${SEARCH_URL} ${res.status} döndü.`);
      const text = await res.text();
      if (text.length > MAX_BODY_CHARS) throw new Error("Yanıt boyut sınırını aşıyor.");
      try {
        return JSON.parse(text) as AymSearchResponse;
      } catch {
        throw new Error("AYM ucu beklenen JSON yanıtını döndürmedi.");
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
