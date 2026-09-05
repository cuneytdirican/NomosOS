/**
 * UYUŞMAZLIK MAHKEMESİ CANLI ADAPTÖR TESTLERİ.
 *
 * Korunan taahhütler (WebForms akışı tarayıcıda birebir doğrulandı):
 *  1. İki adımlı akış: GET gizli alanlar → POST (txtSearch/btnSearch/rblSearchScope).
 *  2. Esas numarasıyla birebir arama; karar no satırla karşılaştırılır.
 *  3. Kaynak hatası SEARCH_FAILED (fail-closed); NOT_FOUND yalnız sağlıklı
 *     yanıtta künye yoksa.
 *  4. canSearch kapalı — ürün arama yüzeyine sonuç verilmez (PDF-only metin).
 *  5. Kayıt CaseLawDocument biçiminde; havuza YAZILMAZ.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUyusmazlikRows, UyusmazlikLiveAdapter } from "./uyusmazlik-live.adapter";

const PAGE_HTML = [
  "<html><body>",
  '<input type="hidden" name="__VIEWSTATE" value="VS123" />',
  '<input type="hidden" name="__VIEWSTATEGENERATOR" value="GEN9" />',
  '<input type="hidden" name="__EVENTVALIDATION" value="EV456" />',
  "</body></html>",
].join("\n");

function resultHtml(rows: Array<[string, string, string, string]>) {
  return [
    "<html><body>",
    "Arama sonuçları: " + rows.length + " dosya bulundu.",
    ...rows.map(
      ([esas, karar, tarih, pdf]) =>
        `<tr><td>${esas}</td><td>${karar}</td><td>${tarih}</td><td><a href="Uploads/${pdf}">Görüntüle</a></td></tr>`,
    ),
    "</body></html>",
  ].join("\n");
}

function mockWebForms(resultHtmlBody: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        text: async () => resultHtmlBody,
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => PAGE_HTML,
    } as unknown as Response;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchByCitation", () => {
  it("esas+karar künyesi bulunur; POST gövdesinde WebForms alanları ve EsasNo kapsamı taşınır", async () => {
    const fetchMock = mockWebForms(resultHtml([["2026/366", "2026/343", "15/06/2026", "2026-366.pdf"]]));
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({
      tenantId: "t-1",
      source: "UYUSMAZLIK",
      caseNumber: "2026/366",
      decisionNumber: "2026/343",
    });

    expect(res.outcome).toBe("FOUND");
    expect(res.record).toMatchObject({
      court: "Uyuşmazlık Mahkemesi",
      caseNumber: "2026/366",
      decisionNumber: "2026/343",
      sourceAdapter: "UYUSMAZLIK_CANLI",
    });
    expect(res.record?.decisionDate?.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(res.record?.id).toMatch(/^uyusmazlik:/);

    const body = String((fetchMock.mock.calls[1][1] as RequestInit).body);
    expect(body).toContain("__VIEWSTATE=VS123");
    expect(body).toContain("txtSearch=2026%2F366");
    expect(body).toContain("rblSearchScope=EsasNo");
  });

  it("esas bulunur ama karar no farklıysa uyarılı FOUND döner (künye kontrolü çağrıya düşer)", async () => {
    mockWebForms(resultHtml([["2026/366", "2026/999", "15/06/2026", "2026-366.pdf"]]));
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({
      tenantId: "t-1",
      source: "UYUSMAZLIK",
      caseNumber: "2026/366",
      decisionNumber: "2026/343",
    });
    expect(res.outcome).toBe("FOUND");
    expect(res.note).toContain("farklı");
  });

  it("sağlıklı yanıt + birebir künye yok → NOT_FOUND (EsasNo araması KISMİ eşleşir)", async () => {
    // Kaynak "1999/1" için 11 benzer künye döndürebilir (1999/10, 1999/11...);
    // birebir eşleşme yoksa künye YOK sayılır — benzer satır FOUND üretmez.
    mockWebForms(
      resultHtml([
        ["1999/10", "1999/10", "10/01/1999", "1999-10.pdf"],
        ["1999/11", "1999/12", "10/01/1999", "1999-11.pdf"],
      ]),
    );
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "UYUSMAZLIK", caseNumber: "1999/1", decisionNumber: "1999/1" });
    expect(res.outcome).toBe("NOT_FOUND");
    expect(res.note).toContain("birebir");
  });

  it("tamamen boş sonuç → NOT_FOUND", async () => {
    mockWebForms(resultHtml([]));
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "UYUSMAZLIK", caseNumber: "2026/1", decisionNumber: "2026/1" });
    expect(res.outcome).toBe("NOT_FOUND");
  });

  it("HTTP hatası → SEARCH_FAILED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "",
    } as unknown as Response);
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "UYUSMAZLIK", caseNumber: "2026/366", decisionNumber: "2026/343" });
    expect(res.outcome).toBe("SEARCH_FAILED");
  });

  it("künye biçimi değilse dürüst SEARCH_FAILED", async () => {
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", source: "UYUSMAZLIK", caseNumber: "E. 2026/366", decisionNumber: "x" });
    expect(res.outcome).toBe("SEARCH_FAILED");
  });
});

describe("parseUyusmazlikRows — tablo ayrıştırıcı", () => {
  it("doğrulanmış satır biçimini ayrıştırır (esas/karar/tarih/pdf)", () => {
    const rows = parseUyusmazlikRows(resultHtml([["2026/366", "2026/343", "15/06/2026", "2026-366.pdf"]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      esasNo: "2026/366",
      kararNo: "2026/343",
      kararTarihi: "15/06/2026",
      pdfUrl: "https://kararlar.uyusmazlik.gov.tr/Uploads/2026-366.pdf",
    });
  });

  it("sonuç yoksa boş döner (sessiz uydurma yok)", () => {
    expect(parseUyusmazlikRows("<html>boş</html>")).toEqual([]);
  });
});

describe("Kapsam", () => {
  it("canSearch kapalı — search boş döner; healthCheck örnek künyeyle yoklar", async () => {
    mockWebForms(resultHtml([["2026/366", "2026/343", "15/06/2026", "2026-366.pdf"]]));
    const adapter = new UyusmazlikLiveAdapter();
    expect(adapter.canSearch).toBe(false);
    expect(adapter.canFetchByCitation).toBe(true);
    expect(await adapter.search("görev", { tenantId: "t-1" })).toEqual([]);
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });
});

describe("fetchByCitation — KAYNAK KAPISI", () => {
  it("künye Uyuşmazlık Mahkemesi'ni adlandırmıyorsa ağa ÇIKMAZ ve NOT_FOUND döner", async () => {
    const fetchMock = mockWebForms(resultHtml([["2026/366", "2026/343", "15/06/2026", "2026-366.pdf"]]));
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({
      tenantId: "t-1",
      source: "YARGITAY",
      caseNumber: "2026/366",
      decisionNumber: "2026/343",
    });
    expect(res.outcome).toBe("NOT_FOUND");
    expect(res.note).toContain("ağ isteği yok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("source tanımsızken de aramaz", async () => {
    const fetchMock = mockWebForms(resultHtml([["2026/366", "2026/343", "15/06/2026", "2026-366.pdf"]]));
    const adapter = new UyusmazlikLiveAdapter();
    const res = await adapter.fetchByCitation({ tenantId: "t-1", caseNumber: "2026/366", decisionNumber: "2026/343" });
    expect(res.outcome).toBe("NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
