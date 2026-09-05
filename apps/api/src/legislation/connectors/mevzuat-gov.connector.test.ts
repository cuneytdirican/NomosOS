/**
 * MEVZUAT.GOV.TR KONEKTÖRÜ TESTLERİ — istek sözleşmesi + yanıt eşlemesi.
 *
 * Ağ YOKTUR: govFetch sahtelenir. Korunan taahhütler:
 *  1. Arama gövdesi doğrulanmış DataTables zarfıdır; AranacakIfade base64(UTF-8).
 *  2. Yanıt satırları künyeye eşlenir (externalKey = No.Tur.Tertip, vurgu etiketi düşer).
 *  3. JSON olmayan yanıt DÜRÜST hata verir (boş liste değil).
 *  4. fetchDocument geçersiz kimliği reddeder; kısa metni kabul etmez.
 *  5. healthCheck TLS zinciri hatasını "paket yenilenmeli" olarak adlandırır.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const govFetchMock = vi.fn();
vi.mock("./gov-tls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gov-tls")>();
  return { ...actual, govFetch: (...args: unknown[]) => govFetchMock(...args) };
});

import { MevzuatGovConnector } from "./mevzuat-gov.connector";

function jsonResponse(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => JSON.stringify(payload), arrayBuffer: async () => new ArrayBuffer(0) };
}
function textResponse(text: string, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
}

beforeEach(() => {
  govFetchMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("MevzuatGovConnector.search", () => {
  it("doğrulanmış zarfı gönderir: AranacakIfade base64(UTF-8), MevzuatTur, sayfalama", async () => {
    govFetchMock.mockResolvedValue(jsonResponse({ recordsFiltered: 0, data: [] }));
    const c = new MevzuatGovConnector();
    await c.search({ query: "İş Kanunu", mevzuatTur: 1, page: 2, pageSize: 10 });

    expect(govFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = govFetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
    expect(url).toBe("https://www.mevzuat.gov.tr/anasayfa/MevzuatDatatable");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-requested-with"]).toBe("XMLHttpRequest");
    const body = JSON.parse(opts.body) as { start: number; length: number; parameters: Record<string, unknown> };
    expect(body.start).toBe(10);
    expect(body.length).toBe(10);
    expect(body.parameters.MevzuatTur).toBe(1);
    expect(body.parameters.AranacakYer).toBe("Baslik");
    expect(Buffer.from(String(body.parameters.AranacakIfade), "base64").toString("utf8")).toBe("İş Kanunu");
  });

  it("yanıt satırlarını künyeye eşler; vurgu etiketi düşer; externalKey No.Tur.Tertip", async () => {
    govFetchMock.mockResolvedValue(
      jsonResponse({
        recordsFiltered: 1,
        data: [
          {
            mevzuatNo: "4857",
            mevAdi: "<span class='hl'>İŞ</span> KANUNU",
            kabulTarih: "22.05.2003",
            resmiGazeteTarihi: "10.06.2003",
            resmiGazeteSayisi: "25134",
            mevzuatTertip: "5",
            mevzuatTur: 1,
            url: "mevzuat?MevzuatNo=4857&MevzuatTur=1&MevzuatTertip=5",
          },
          // Numarasız satır (kaynak tarafı boş kayıt) eşlemeye GİRMEZ.
          { mevAdi: "boş", mevzuatTur: 1 },
        ],
      }),
    );
    const c = new MevzuatGovConnector();
    const { hits, total } = await c.search({ query: "4857" });
    expect(total).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      externalKey: "4857.1.5",
      mevzuatNo: "4857",
      mevzuatTur: 1,
      tertip: 5,
      title: "İŞ KANUNU",
      rgTarihi: "10.06.2003",
      rgSayisi: "25134",
      sourceUrl: "https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=4857&MevzuatTur=1&MevzuatTertip=5",
    });
  });

  it("çok kısa sorgu ağa çıkmaz; JSON olmayan yanıt dürüst hata verir", async () => {
    const c = new MevzuatGovConnector();
    expect(await c.search({ query: "a" })).toEqual({ hits: [], total: 0 });
    expect(govFetchMock).not.toHaveBeenCalled();

    govFetchMock.mockResolvedValue(textResponse("<html>bakım sayfası</html>"));
    await expect(c.search({ query: "5237" })).rejects.toThrow(/JSON tablo yanıtını döndürmedi/);
  });

  it("HTTP hatası fırlatılır (boş sonuç uydurulmaz)", async () => {
    govFetchMock.mockResolvedValue(jsonResponse({}, false));
    const c = new MevzuatGovConnector();
    await expect(c.search({ query: "5237" })).rejects.toThrow(/500 döndü/);
  });
});

describe("MevzuatGovConnector.fetchDocument", () => {
  it("geçersiz kimliği ağa çıkmadan reddeder", async () => {
    const c = new MevzuatGovConnector();
    await expect(c.fetchDocument("abc")).rejects.toThrow(/Geçersiz mevzuat kimliği/);
    await expect(c.fetchDocument("5237.x.5")).rejects.toThrow(/Geçersiz mevzuat kimliği/);
    expect(govFetchMock).not.toHaveBeenCalled();
  });

  it("konsolide iframe ucunu çağırır ve temiz metni döner; çok kısa metin hatadır", async () => {
    const body = "<html><body><p>TÜRK CEZA KANUNU</p><p>Kanun Numarası : 5237</p>" +
      "<p>Madde 1- (1) Ceza Kanununun amacı; kişi hak ve özgürlüklerini korumaktır.</p>".repeat(6) +
      "</body></html>";
    govFetchMock.mockResolvedValue(textResponse(body));
    const c = new MevzuatGovConnector();
    const doc = await c.fetchDocument("5237.1.5");
    const [url] = govFetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=5237&MevzuatTertip=5",
    );
    expect(doc.mevzuatNo).toBe("5237");
    expect(doc.text).toContain("Madde 1-");
    expect(doc.text).not.toContain("<p>");

    govFetchMock.mockResolvedValue(textResponse("<html>kısa</html>"));
    await expect(c.fetchDocument("5237.1.5")).rejects.toThrow(/çok kısa/);
  });
});

describe("MevzuatGovConnector.healthCheck", () => {
  it("örnek arama TCK'yı bulursa sağlıklıdır", async () => {
    govFetchMock.mockResolvedValue(
      jsonResponse({ recordsFiltered: 1, data: [{ mevzuatNo: "5237", mevAdi: "TÜRK CEZA KANUNU", mevzuatTur: 1, mevzuatTertip: "5" }] }),
    );
    const h = await new MevzuatGovConnector().healthCheck();
    expect(h.healthy).toBe(true);
    expect(h.message).toContain("TCK");
  });

  it("TLS zinciri hatası 'paket yenilenmeli' olarak adlandırılır", async () => {
    govFetchMock.mockRejectedValue(Object.assign(new Error("unable to verify"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }));
    const h = await new MevzuatGovConnector().healthCheck();
    expect(h.healthy).toBe(false);
    expect(h.message).toContain("TLS zinciri");
    expect(h.message).toContain("gov-tls.ts");
  });
});
