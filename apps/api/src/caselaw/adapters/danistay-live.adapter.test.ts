/**
 * FAZ 8D — Danıştay canlı kaynağı (aynı sınıf, üçüncü yapılandırma).
 *
 * Korunan sözleşme:
 *  1. Arama gövdesi anahtar kelime DİZİLERİ ile gider (andKelimeler), /arama ön-adımı atlanır;
 *     tek POST /aramalist. Satırlar Danıştay öneki + DANISTAY_CANLI kaynak anahtarıyla döner.
 *  2. Belge çekimi ortak getDokuman zarfını kullanır (JSON `data` içinde HTML → temiz metin).
 *  3. Kaynak 5xx → hata fırlatır (arama servisi diğer kaynakları düşürmeden bunu raporlar).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DANISTAY_LIVE_CONFIG, YargitayLiveAdapter } from "./yargitay-live.adapter";

afterEach(() => vi.restoreAllMocks());

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 503,
    headers: { get: () => null, getSetCookie: () => [] },
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as Response;
}

describe("Faz 8D: Danıştay canlı adaptörü", () => {
  it("andKelimeler gövdesi, /arama atlanır, DANISTAY_CANLI + 'Danıştay ' öneki", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/")) return jsonResponse({});
      return jsonResponse({
        data: {
          data: [{ id: 12345, daire: "13. Daire", esasNo: "2023/1234", kararNo: "2024/567", kararTarihi: "12.03.2024" }],
          recordsFiltered: 1,
        },
      });
    });
    const adapter = new YargitayLiveAdapter(DANISTAY_LIVE_CONFIG);
    const res = await adapter.search("idari para cezası", 10, 1);
    expect(calls.some((c) => c.url.endsWith("/arama"))).toBe(false);
    const list = calls.find((c) => c.url.endsWith("/aramalist"));
    expect(list?.url.startsWith("https://karararama.danistay.gov.tr")).toBe(true);
    expect(JSON.parse(list!.body!)).toMatchObject({ data: { andKelimeler: ["idari para cezası"], pageNumber: 1, pageSize: 10 } });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]).toMatchObject({ externalId: "12345", court: "Danıştay 13. Daire", sourceAdapter: "DANISTAY_CANLI", sourceKind: "CANLI" });
  });

  it("getDokuman zarfı → temiz metin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: "<html><body><p>T.C. DANIŞTAY</p><p>ONÜÇÜNCÜ DAİRE</p><p>Esas No: 2023/1234 Karar No: 2024/567 — davanın reddine karar verildi. Bu bir deneme metnidir.</p></body></html>" }));
    const adapter = new YargitayLiveAdapter(DANISTAY_LIVE_CONFIG);
    const doc = await adapter.fetchDocument("12345");
    expect(doc.text).toContain("T.C. DANIŞTAY");
    expect(doc.text).not.toContain("<p>");
    expect(doc.sourceUrl).toBe("https://karararama.danistay.gov.tr/getDokuman?id=12345");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe("https://karararama.danistay.gov.tr/getDokuman?id=12345&arananKelime=karar");
  });

  it("style/script blokları metne sızmaz; HTML hata sayfası → hata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: "<html><head><style>.highlight{background:yellow}</style><script>var HOST_URL='x'</script></head><body><h1>Karar İçeriği</h1><p>T.C. DANIŞTAY 13. Daire — davanın reddine. Bu metin yeterince uzun bir karar metnidir.</p></body></html>" }));
    const adapter = new YargitayLiveAdapter(DANISTAY_LIVE_CONFIG);
    const doc = await adapter.fetchDocument("5");
    expect(doc.text).not.toMatch(/highlight|HOST_URL/);
    expect(doc.text).toContain("Karar İçeriği");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, status: 200, text: async () => "<html><body><h3>Hata!</h3><p>Hata tarafımıza ulaşmış olup, ilgili birim tarafından kontroller başlatılmıştır.</p><a>Ana sayfaya gitmek için tıklayınız.</a><script>var KTAppSetting = {}</script></body></html>" } as unknown as Response);
    await expect(adapter.fetchDocument("1")).rejects.toThrow(/hata sayfası/);
  });

  it("HTML-kaçışlı gövde (&lt;html&gt;) ikinci turda temizlenir", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: "<html><body><h1>Karar İçeriği</h1><div>&lt;html&gt;&lt;body font=\"Verdana\"&gt;&lt;p&gt;T.C. DANIŞTAY&lt;/p&gt;&lt;p&gt;ONÜÇÜNCÜ DAİRE — davanın reddine karar verildi. Yeterince uzun metin.&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;</div></body></html>" }));
    const adapter = new YargitayLiveAdapter(DANISTAY_LIVE_CONFIG);
    const doc = await adapter.fetchDocument("7");
    expect(doc.text).not.toMatch(/<html|<p>|&lt;/);
    expect(doc.text).toContain("T.C. DANIŞTAY");
    expect(doc.text).toContain("ONÜÇÜNCÜ DAİRE");
  });

  it("kaynak 503 → hata (fail-closed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, false));
    const adapter = new YargitayLiveAdapter(DANISTAY_LIVE_CONFIG);
    await expect(adapter.search("vergi", 10, 1)).rejects.toThrow();
  });
});
