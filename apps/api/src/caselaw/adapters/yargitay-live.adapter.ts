/**
 * CANLI KARAR ARAMA - COK KAYNAKLI (ayni resmi API sozlesmesi).
 *
 * GERCEK, resmi uc noktalari kullanir (uydurma entegrasyon yasagi - her uc
 * tarayici uzerinden birebir dogrulanmistir). Iki kaynak AYNI sozlesmeyi
 * paylasir (POST /arama, POST /aramalist -> JSON, GET /getDokuman ->
 * {"data":"<html>...","metadata":{...}}):
 *   - karararama.yargitay.gov.tr - yalniz YARGITAY kararlar?
 *   - emsal.uyap.gov.tr          - TUM mahkeme dereceleri (istinaf + asliye;
 *                                  847 binden fazla karar; `durum` alani ekstra)
 *
 * Canli sonuclar:
 *  - HAVUZA YAZILMAZ (yazim icin kasitli toplama hatti: caselaw-ingest onayi).
 *  - sourceKind = "CANLI"; sourceAdapter kaynagi ayirt eder (rozet/rota).
 *  - Kunye alanlari birebir resmi yanittan gelir; kayit baglantisi kaynagin
 *    belge sayfasina gider.
 *  - Hata olursa arama DUSMEZ: liveError doner, veritabani sonuclari aynen
 *    listelenir.
 */

const ARAMA_TIMEOUT_MS = 12_000;

export interface LiveCaseLawHit {
  /** Resmi kayit kimligi (getDokuman?id= icin) - havuz kimligi DEGILDIR. */
  externalId: string;
  court: string;
  chamber?: string;
  caseNumber: string;
  decisionNumber: string;
  decisionDate?: string;
  /** Emsal (UYAP) kayitlarinda karar?n durumu: KESINLASTI / KESINLESMEDI. */
  status?: string;
  sourceUrl: string;
  sourceKind: "CANLI";
  sourceAdapter: "YARGITAY_CANLI" | "EMSAL_UYAP";
  totalFound?: number;
}

interface LiveListRow {
  id: string;
  daire: string;
  esasNo: string;
  kararNo: string;
  kararTarihi: string;
  /** Emsal ucunda eklenen alan. */
  durum?: string;
}

/** Cok kaynakli yapilandirma - her ornek kendi taban adresini tasir. */
export interface LiveAdapterConfig {
  baseUrl: string;
  /** Hit'lerde tasinan kaynak anahtari (rozet/rota icin). */
  adapterKey: "YARGITAY_CANLI" | "EMSAL_UYAP";
  /** `daire` alaninin basina eklenen ek (Yargitay'da "Yargitay "; Emsal'da tam ad gelir). */
  courtPrefix: string;
}

/** Kaynak 1: Yargitay Karar Arama. */
export const YARGITAY_LIVE_CONFIG: LiveAdapterConfig = {
  baseUrl: "https://karararama.yargitay.gov.tr",
  adapterKey: "YARGITAY_CANLI",
  courtPrefix: "Yarg\u0131tay ",
};

/** Kaynak 2: Emsal (UYAP) - tum mahkeme dereceleri. */
export const EMSAL_LIVE_CONFIG: LiveAdapterConfig = {
  baseUrl: "https://emsal.uyap.gov.tr",
  adapterKey: "EMSAL_UYAP",
  courtPrefix: "",
};

/** DI anahtari: Emsal orneklemesi (ayni sinif, farkli yapilandirma). */
export const EMSAL_LIVE = "EMSAL_LIVE_ADAPTER";

/**
 * Resmi belge govdesini (XML zarfi + gomulu HTML) TEMIZ METNE cevirir.
 *
 * Girdi bicimi (getDokuman): `<html>...</html>` - kunye koyu `<b>` blogunda,
 * karar metni `<p>` icinde. Donusum:
 *  1. XML bildirimi/zarflari dusur, yalniz HTML govdesini al
 *  2. Blok etiketlerini satir sonuna cevir (`<br>`, `</p>`, `</li>` ...)
 *  3. Kalan etiketleri dusur, HTML varliklarini coz
 *  4. Ardisik bos satirlari tek satira indir
 */
export function cleanOfficialDocument(raw: string): string {
  let s = raw;
  // XML bildirimi ve zarflar.
  s = s.replace(/<\?xml[^>]*\?>/gi, "");
  s = s.replace(/<\/?data[^>]*>/gi, "");
  // Kunye/karar bloklari satir sonuna.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|ul|ol|tr|h[1-6])>/gi, "\n");
  // Kalan tum etiketler dusar.
  s = s.replace(/<[^>]+>/g, "");
  // HTML varliklari.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  // Bosluk/satir duzeni.
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
  /** Temizlenmis karar metni (XML/HTML etiketlerinden arindirilmis). */
  text: string;
  sourceUrl: string;
}

/**
 * Canli adaptor - hem Yargitay Karar Arama hem Emsal (UYAP) icin TEK sinif:
 * iki uc da ayni sozlesmeyi kullanir. Yapilandirmayi kurucudan alir
 * (varsayilan: Yargitay).
 */
export class YargitayLiveAdapter {
  private readonly cfg: LiveAdapterConfig;

  constructor(config: LiveAdapterConfig = YARGITAY_LIVE_CONFIG) {
    this.cfg = config;
  }

  /**
   * Canli karar BELGESI - GET /getDokuman?id=.
   *
   * Resmi uc, karari JSON zarfi icinde gomulu HTML olarak dondurur
   * (`{"data":"<html>...</html>","metadata":...}`); tarayicida bu HAM gorunur
   * (kullanici "XML'i gosteriyor" bulgusu). Burada cekilip TEMIZ METNE
   * cevrilir: etiketler dus(er), HTML varliklari cozulur, satir yapisi korunur.
   */
  async fetchDocument(externalId: string): Promise<LiveCaseLawDocument> {
    if (!/^\d{1,20}$/.test(externalId)) {
      throw new Error("Ge\u00e7ersiz karar kimli\u011fi.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARAMA_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/getDokuman?id=${externalId}`, {
        signal: controller.signal,
        // Icerik uzlasmasi: resmi uc Accept basligina bakar - application/json
        // istenirse JSON zarfi, text/xml istenirse HAM XML doner. Zarf istiyoruz.
        headers: { accept: "application/json, text/html, */*" },
      });
      if (!res.ok) {
        throw new Error(`${this.cfg.baseUrl} ${res.status} d\u00f6nd\u00fc.`);
      }
      const raw = await res.text();
      let html = raw;
      try {
        const parsed = JSON.parse(raw) as {
          data?: unknown;
          metadata?: { FMTY?: string; FMTE?: string; FMU?: string };
        };
        if (typeof parsed.data === "string" && parsed.data.trim().length > 0) {
          html = parsed.data;
        } else if (parsed && typeof parsed === "object" && "data" in parsed) {
          // Zarf VAR ama data yok -> resmi kaynak KAYIT BULAMADI (FMTY:ERROR).
          // Ham JSON'u "metin" olarak GOSTERMEK yerine durust hata firlat.
          const reason =
            parsed.metadata?.FMU ??
            parsed.metadata?.FMTE ??
            "Resmi kaynak bu kimlik i\u00e7in karar belgesi d\u00f6nd\u00fcrmedi.";
          throw new Error(`Karar belgesi al\u0131namad\u0131: ${reason}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Karar belgesi al\u0131namad\u0131")) throw err;
        // JSON degil - govdeyi oldugu gibi temizle.
      }
      const text = cleanOfficialDocument(html);
      if (text.trim().length < 40) {
        throw new Error("Karar belgesi bo\u015f ya da okunamad\u0131.");
      }
      return { externalId, text, sourceUrl: `${this.cfg.baseUrl}/getDokuman?id=${externalId}` };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Canli arama: resmi /arama + /aramalist zinciri. Sayfali: page 1'den baslar. */
  async search(
    query: string,
    limit = 10,
    page = 1,
  ): Promise<{ hits: LiveCaseLawHit[]; totalFound?: number; page?: number }> {
    const q = query.trim();
    if (q.length < 3) return { hits: [] };
    const pageSize = Math.min(Math.max(1, limit), 50);
    const pageNumber = Math.max(1, Math.min(100, page));

    // 0) Oturum acma: karararama cerezsiz POST'a HTML hata sayfasi dondurur -
    //    ana sayfa GET'lenir ve Set-Cookie zinciri yakalanir (Emsal'da cerez
    //    sart degil ama bu adim zararsizdir).
    const cookie = await this.openSession();

    // 1) /arama - oturumu baslatir. Bu uc HER ZAMAN HTML dondurur (sonuc
    //    sayfasi kabugu); govdesi kullanilmaz, yalniz 200 beklenir.
    await this.postText(`${this.cfg.baseUrl}/arama`, { data: { aranan: q, arananKelime: q } }, cookie);

    // 2) /aramalist - sonuc listesi (JSON), ISTENEN SAYFA.
    const res = await this.post(
      `${this.cfg.baseUrl}/aramalist`,
      { data: { aranan: q, arananKelime: q, pageSize: pageNumber * pageSize, pageNumber } },
      cookie,
    );
    const payload = (res.data ?? {}) as {
      data?: LiveListRow[];
      recordsFiltered?: number;
    };
    const body = payload.data;
    const totalFound = typeof payload.recordsFiltered === "number" ? payload.recordsFiltered : undefined;
    // Istenen sayfa penceresini dondur (pageSize*n'in son `pageSize` tanesi).
    const rows = Array.isArray(body)
      ? body.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
      : [];

    return {
      totalFound,
      page: pageNumber,
      hits: rows.map((r) => ({
        externalId: String(r.id),
        court: this.cfg.courtPrefix ? `${this.cfg.courtPrefix}${r.daire}` : r.daire,
        chamber: r.daire,
        caseNumber: r.esasNo,
        decisionNumber: r.kararNo,
        decisionDate: r.kararTarihi,
        status: r.durum,
        sourceUrl: `${this.cfg.baseUrl}/getDokuman?id=${r.id}`,
        sourceKind: "CANLI",
        sourceAdapter: this.cfg.adapterKey,
      })),
    };
  }

  /** Ana sayfayi GET'ler ve Set-Cookie zincirini "k=v; k2=v2" biciminde doner. */
  private async openSession(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARAMA_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/`, {
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

  /** POST -> govdeyi METIN olarak tuketir (HTML donen uclar icin - /arama). */
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
        throw new Error(`${this.cfg.baseUrl} ${res.status} d\u00f6nd\u00fc.`);
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
        throw new Error(`${this.cfg.baseUrl} ${res.status} d\u00f6nd\u00fc.`);
      }
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }
}
