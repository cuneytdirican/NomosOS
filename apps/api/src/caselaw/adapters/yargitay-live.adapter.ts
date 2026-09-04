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

/**
 * Resmî belge gövdesini (XML zarfı + gömülü HTML) TEMİZ METNE çevirir.
 *
 * Girdi biçimi (getDokuman): `<data><html>…<br>…</html></data>` — künye
 * koyu `<b>` bloğunda, karar metni `<p>` içinde. Dönüşüm:
 *  1. XML bildirimi/zarfları düşür, yalnız HTML gövdesini al
 *  2. Blok etiketlerini satır sonuna çevir (`<br>`, `</p>`, `</li>`…)
 *  3. Kalan etiketleri düşür, HTML varlıklarını çöz
 *  4. Ardışık boş satırları tek satıra indir
 */
export function cleanOfficialDocument(raw: string): string {
  let s = raw;
  // XML bildirimi ve zarflar.
  s = s.replace(/<\?xml[^>]*\?>/gi, "");
  s = s.replace(/<\/?data[^>]*>/gi, "");
  // Künye/karar blokları satır sonuna.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|ul|ol|tr|h[1-6])>/gi, "\n");
  // Kalan tüm etiketler düşer.
  s = s.replace(/<[^>]+>/g, "");
  // HTML varlıkları.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  // Boşluk/satır düzeni.
  s = s.replace(/\r/g, "");
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export interface LiveCaseLawDocument {
  externalId: string;
  /** Temizlenmiş karar metni (XML/HTML etiketlerinden arındırılmış). */
  text: string;
  sourceUrl: string;
}

export class YargitayLiveAdapter {
  /**
   * Canlı karar BELGESİ — GET /getDokuman?id=.
   *
   * Resmî uç, kararı XML zarfı içinde gömülü HTML olarak döndürür
   * (`<data><html>…</html></data>`); tarayıcıda bu HAM görünür (kullanıcı
   * "XML'i gösteriyor" bulgusu). Burada çekilip TEMİZ METNE çevrilir:
   * etiketler düşer, HTML varlıkları çözülür, satır yapısı korunur.
   */
  async fetchDocument(externalId: string): Promise<LiveCaseLawDocument> {
    if (!/^\d{1,20}$/.test(externalId)) {
      throw new Error("Geçersiz karar kimliği.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARAMA_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}/getDokuman?id=${externalId}`, {
        signal: controller.signal,
        // İÇERİK UZLAŞMASI: resmî uç Accept başlığına bakar — application/json
        // istenirse {"data":"<html>…"} döner; text/xml istenirse HAM XML.
        // JSON zarfı istiyoruz (temizleme hattı buna göre çalışır).
        headers: { accept: "application/json, text/html, */*" },
      });
      if (!res.ok) {
        throw new Error(`karararama.yargitay.gov.tr ${res.status} döndü.`);
      }
      const raw = await res.text();
      // Resmî uç JSON zarfı döndürür: {"data":"<html>…</html>", "metadata":{…}} —
      // karar metni `data` alanında HTML olarak gelir. Zarf JSON değilse gövde
      // doğrudan XML/HTML varsayılır (iki biçime de dayanıklı).
      let html = raw;
      try {
        const parsed = JSON.parse(raw) as { data?: unknown };
        if (typeof parsed.data === "string" && parsed.data.trim().length > 0) {
          html = parsed.data;
        }
      } catch {
        // JSON değil — gövdeyi olduğu gibi temizle.
      }
      const text = cleanOfficialDocument(html);
      if (text.trim().length < 40) {
        throw new Error("Karar belgesi boş ya da okunamadı.");
      }
      return { externalId, text, sourceUrl: `${BASE_URL}/getDokuman?id=${externalId}` };
    } finally {
      clearTimeout(timer);
    }
  }

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
