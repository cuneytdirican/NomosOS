/**
 * AYM CANLI ADAPTÖR TESTLERİ.
 *
 * Korunan taahhütler:
 *  1. Bireysel başvuru künyesi (karar no YOK) basvuruNo ile birebir doğrulanır.
 *  2. Norm denetimi künyesi esasNo+kararNo ile doğrulanır.
 *  3. Kaynak hatası SEARCH_FAILED (fail-closed); NOT_FOUND yalnız sağlıklı
 *     yanıtta künye yoksa üretilir.
 *  4. Ürün arama yüzeyi kapalıdır (canSearch=false → search boş döner).
 *  5. Kayıt CaseLawDocument biçimindedir; id "aym:" önekli, havuza YAZILMAZ.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AymLiveAdapter } from "./aym-live.adapter";

const BIREYSEL_ROW = {
  kararTipi: "BireyselBasvuru",
  id: "4ecaf1ae-6e5b-4a7b-a9fa-98169a2f5f5c",
  basvuruNo: "2013/1821",
  kararTarihi: "2014-11-05",
  basvuruAdi: "ÖZKAN KART",
  kararKonusu: "<p>Cezaevinde kitap bulundurma sınırı nedeniyle ifade &ouml;zg&uuml;rl&uuml;ğ&uuml;n&uuml;n ihlal edildiği iddiası.</p>",
  kararTuruBasvuruSonucuLabel: "Esas (İhlal Olmadığı)",
  kararVerenBirimLabel: "Birinci Bölüm",
};

const NORM_ROW = {
  kararTipi: "NormDenetimi",
  id: "f111baff-954e-c0e3-9a2f-33e664151321",
  esasNo: "2022/129",
  kararNo: "2023/189",
  kararTarihi: "2023-11-08",
  kararVerenBirimLabel: "İkinci Bölüm",
};

function mockSearch(payload: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    text: async () => JSON.stringify(payload),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchByCitation — bireysel başvuru", () => {
  it("karar no olmadan da künye birebir doğrulanır (FOUND + canlı kaynak notu)", async () => {
    const fetchMock = mockSearch({ total: 1, data: [BIREYSEL_ROW] });
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({
      tenantId: "t-1",
      source: "AYM",
      caseNumber: "2013 / 1821",
      decisionNumber: "",
    });

    expect(res.outcome).toBe("FOUND");
    expect(res.ambiguous).toBeFalsy();
    expect(res.record).toMatchObject({
      court: "Anayasa Mahkemesi",
      caseNumber: "2013/1821",
      decisionNumber: "",
      sourceAdapter: "AYM_CANLI",
    });
    expect(res.record?.id).toMatch(/^aym:/);
    expect(res.record?.summary).toContain("ifade özgürlüğünün");
    // İstek gövdesinde basvuruNo filtresi.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.basvuruNo).toBe("2013/1821");
  });
});

describe("fetchByCitation — norm denetimi", () => {
  it("esas+karar künyesi esasNo/kararNo ile doğrulanır", async () => {
    const fetchMock = mockSearch({ total: 1, data: [NORM_ROW] });
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({
      tenantId: "t-1",
      source: "AYM",
      caseNumber: "2022/129",
      decisionNumber: "2023/189",
    });

    expect(res.outcome).toBe("FOUND");
    expect(res.record).toMatchObject({ caseNumber: "2022/129", decisionNumber: "2023/189" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.esasNo).toBe("2022/129");
    expect(body.kararNo).toBe("2023/189");
  });
});

describe("fail-closed davranış", () => {
  it("sağlıklı yanıt + künye yok → NOT_FOUND", async () => {
    mockSearch({ total: 0, data: [] });
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "AYM", caseNumber: "2099/1", decisionNumber: "" });
    expect(res.outcome).toBe("NOT_FOUND");
  });

  it("HTTP hatası → SEARCH_FAILED (doğrulanmış sayılmaz)", async () => {
    mockSearch({}, false);
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "AYM", caseNumber: "2013/1821", decisionNumber: "" });
    expect(res.outcome).toBe("SEARCH_FAILED");
  });

  it("AYM künye biçimi değilse dürüst SEARCH_FAILED", async () => {
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "AYM", caseNumber: "E. 2013/1821", decisionNumber: "x" });
    expect(res.outcome).toBe("SEARCH_FAILED");
    expect(res.note).toContain("YYYY/NNNNN");
  });
});

describe("Ürün yüzeyi kapsamı", () => {
  it("canSearch kapalı — search boş döner (canlı arama sonuçları havuza yazılmaz)", async () => {
    const adapter = new AymLiveAdapter();
    expect(adapter.canSearch).toBe(false);
    expect(adapter.canFetchByCitation).toBe(true);
    expect(await adapter.search("ifade özgürlüğü", { tenantId: "t-1" })).toEqual([]);
  });

  it("healthCheck örnek künyeyle yoklar", async () => {
    mockSearch({ total: 1, data: [BIREYSEL_ROW] });
    const adapter = new AymLiveAdapter();
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain("2013/1821");
  });
});

describe("fetchByCitation — KAYNAK KAPISI", () => {
  it("künye AYM'yi adlandırmıyorsa (Yargıtay) ağa ÇIKMAZ ve NOT_FOUND döner", async () => {
    const fetchMock = mockSearch({ total: 1, data: [NORM_ROW] });
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({
      tenantId: "t-1",
      source: "YARGITAY",
      caseNumber: "2022/129",
      decisionNumber: "2023/189",
    });
    expect(res.outcome).toBe("NOT_FOUND");
    expect(res.note).toContain("ağ isteği yok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mahkeme adı hiç yoksa (source tanımsız) da aramaz — çıplak künye AYM'de doğrulanamaz", async () => {
    const fetchMock = mockSearch({ total: 1, data: [NORM_ROW] });
    const adapter = new AymLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", caseNumber: "2022/129", decisionNumber: "2023/189" });
    expect(res.outcome).toBe("NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
