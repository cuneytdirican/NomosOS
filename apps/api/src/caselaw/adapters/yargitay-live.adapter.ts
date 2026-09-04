/**
 * CANLI YARGITAY KARAR ARAMA (karararama.yargitay.gov.tr).
 *
 * GERÇEK, resmî uç noktaları kullanır (uydurma entegrasyon yasağı — buradaki
 * her uç tarayıcı üzerinden birebir doğrulanmıştır):
 *   POST /arama     {data:{aranan, arananKelime}}                    → aramayı başlatır
 *   POST /aramalist {data:{aranan, arananKelime, pageSize, pageNumber}} → JSON sonuç listesi
 *   GET  /getDokuman?id=<kararId>                                    → karar belgesi
 *
 * Canlı sonuçlar:
 *  - HAVUZA YAZILMAZ (yazım için kasıtlı toplama hattı: caselaw-ingest onayı).
 *  - sourceKind = "CANLI" işaretlenir; künye alanları birebir resmî yanıttan gelir.
 *  - Kaynak bağlantısı karararama.yargitay.gov.tr belge sayfasına gider.
 *  - Hata olursa arama DÜŞMEZ: liveError döner, veritabanı sonuçları aynen listelenir.
 */

const BASE_URL = "https://karararama.yargitay.gov.tr";
const ARAMA_TIMEOUT_MS = 12_000;

export interface LiveCaseLawHit {
  /** Resmî kayıt kimliği (getDokuman?id= için) — havuz kimliği DEĞİLDİR. */
  externalId: string;
  court: string;
  chamber?: string;
  caseNumber: string;
  decisionNumber: string;
  decisionDate?: string;
  sourceUrl: string;
  sourceKind: "CANLI";
  sourceAdapter: "YARGITAY_CANLI";
  totalFound?: number;
}

interface YargitayListRow {
  id: string;
  daire: string;
  esasNo: string;
  kararNo: string;
  kararTarihi: string;
}

export class YargitayLiveAdapter {
  /** Canlı arama: resmî /arama + /aramalist zinciri. */
  async search(query: string, limit = 5): Promise<{ hits: LiveCaseLawHit[]; totalFound?: number }> {
    const q = query.trim();
    if (q.length < 3) return { hits: [] };

    // 0) Oturum açma: resmî site çerezsiz POST'a HTML hata sayfası döndürür —
    // önce ana sayfa GET'lenir ve Set-CCookie zinciri yakalanır.
    const cookie = await this.openSession();

    // 1) /arama — oturumu başlatır. Bu uç HER ZAMAN HTML döndürür (sonuç sayfası
    //    kabuğu); gövdesi kullanılmaz, yalnız 200 beklenir — JSON çözümlenmez.
    await this.postText(`${BASE_URL}/arama`, { data: { aranan: q, arananKelime: q } }, cookie);

    // 2) /aramalist — sonuç listesi (JSON).
    const res = await this.post(
      `${BASE_URL}/aramalist`,
      { data: { aranan: q, arananKelime: q, pageSize: limit, pageNumber: 1 } },
      cookie,
    );
    const payload = (res.data ?? {}) as {
      data?: YargitayListRow[];
      recordsFiltered?: number;
    };
    const body = payload.data;
    const totalFound = typeof payload.recordsFiltered === "number" ? payload.recordsFiltered : undefined;
    const rows = Array.isArray(body) ? body.slice(0, limit) : [];

    return {
      totalFound,
      hits: rows.map((r) => ({
        externalId: String(r.id),
        court: `Yargıtay ${r.daire}`,
        chamber: r.daire,
        caseNumber: r.esasNo,
        decisionNumber: r.kararNo,
        decisionDate: r.kararTarihi,
        sourceUrl: `${BASE_URL}/getDokuman?id=${r.id}`,
        sourceKind: "CANLI",
        sourceAdapter: "YARGITAY_CANLI",
      })),
    };
  }

  /** Ana sayfayı GET'ler ve Set-Cookie zincirini "k=v; k2=v2" biçiminde döner. */
  private async openSession(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARAMA_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}/`, {
        signal: controller.signal,
        headers: { accept: "text/html" },
      });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      const pairs = setCookies
        .map((line) => line.split(";")[0]?.trim())
        .filter((kv): kv is string => Boolean(kv));
      return pairs.join("; ");
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST → gövdeyi METİN olarak tüketir (HTML dönen uçlar için — /arama). */
  private async postText(url: string, body: unknown, cookie?: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARAMA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          accept: "text/html, */*",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`karararama.yargitay.gov.tr ${res.status} döndü.`);
      }
      await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(
    url: string,
    body: unknown,
    cookie?: string,
  ): Promise<Record<string, unknown> & { data?: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARAMA_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`karararama.yargitay.gov.tr ${res.status} döndü.`);
      }
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }
}
