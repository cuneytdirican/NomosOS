/** Canlı Yargıtay adaptörü — sözleşme ve hata taşımaları. */

import { describe, expect, it, vi } from "vitest";
import { YargitayLiveAdapter, cleanOfficialDocument } from "./yargitay-live.adapter";

const LIST = {
  data: {
    data: [
      { id: "235053000", daire: "21. Hukuk Dairesi", esasNo: "2015/13151", kararNo: "2016/6162", kararTarihi: "07.04.2016" },
    ],
    recordsTotal: 1580899,
    recordsFiltered: 1580899,
  },
};

function mockFetch() {
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/arama")) return new Response("{}", { status: 200 });
    if (u.endsWith("/aramalist")) return new Response(JSON.stringify(LIST), { status: 200 });
    if (u.includes("getDokuman")) return new Response("<html>", { status: 200 });
    void init;
    return new Response("{}", { status: 404 });
  };
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
}

describe("YargitayLiveAdapter", () => {
  it("resmî yanıtı CANLI sonuca eşler (künye + kaynak URL)", async () => {
    const m = mockFetch();
    const { hits } = await new YargitayLiveAdapter().search("iş kazası tazminat");
    m.mockRestore();

    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit).toMatchObject({
      court: "Yargıtay 21. Hukuk Dairesi",
      caseNumber: "2015/13151",
      decisionNumber: "2016/6162",
      decisionDate: "07.04.2016",
      sourceKind: "CANLI",
      sourceAdapter: "YARGITAY_CANLI",
    });
    // "Kaynağa git" bağlantısı resmî belge sayfasına gider.
    expect(hit.sourceUrl).toBe("https://karararama.yargitay.gov.tr/getDokuman?id=235053000");
  });

  it("kısa sorgu canlı aramaya gitmez", async () => {
    const m = mockFetch();
    const { hits } = await new YargitayLiveAdapter().search("ab");
    m.mockRestore();
    expect(hits).toHaveLength(0);
  });

  it("kaynak hata verirse istisna taşır — arayan katman liveError'e çevirir", async () => {
    const m = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("karararama.yargitay.gov.tr 503 döndü."));
    await expect(new YargitayLiveAdapter().search("iş kazası tazminat")).rejects.toThrow("503");
    m.mockRestore();
  });

  it("geçersiz dış kimlik reddedilir", async () => {
    await expect(new YargitayLiveAdapter().fetchDocument("../abc")).rejects.toThrow(
      "Geçersiz karar kimliği",
    );
  });

  it("getDokuman JSON zarfından HTML çıkarılıp temizlenir (gerçek biçim)", async () => {
    const html = `<html><body><b>21. HD 2015/13151 E.</b><br><p>Davacı, iş kazası sonucu tazminat istemiştir.</p></body></html>`;
    const body = JSON.stringify({ data: html, metadata: { FMTY: "SUCCESS" } });
    const m = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
    );
    const doc = await new YargitayLiveAdapter().fetchDocument("235053000");
    m.mockRestore();
    expect(doc.text).toContain("21. HD 2015/13151 E.");
    expect(doc.text).toContain("Davacı, iş kazası sonucu tazminat istemiştir.");
    expect(doc.text).not.toMatch(/<[^>]+>/);
    expect(doc.text).not.toContain("SUCCESS");
    expect(doc.sourceUrl).toContain("getDokuman?id=235053000");
  });
});

describe("cleanOfficialDocument — resmî XML/HTML gövdesi temiz metne çevrilir", () => {
  // getDokuman'ın gerçek biçimi: XML zarfı + gömülü HTML + künye <b> bloğu.
  const RAW = `<?xml version="1.0" encoding="UTF-8"?><data><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head> <body leftmargin="25"><b><font face="Verdana" size="2">21. Hukuk Dairesi&nbsp;2015/13151 E. , 2016/6162 K.</font></b><br><b><font face="Verdana" size="2">"İçtihat Metni"</font></b><p align="justify"><font face="Verdana" size="2">MAHKEMESİ :Asliye Hukuk Mahkemesi<br><br>Davacı, iş kazası sonucu tazminat istemiştir.<br>&quot;alıntı&quot; &amp; özel karakter<br><br> K A R A R<br><br>Sonuç: bozma.</font></p></body></html></data>`;

  it("etiketler düşer, metin ve satır yapısı kalır", () => {
    const text = cleanOfficialDocument(RAW);
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toContain("21. Hukuk Dairesi");
    expect(text).toContain("2015/13151 E.");
    expect(text).toContain("Davacı, iş kazası sonucu tazminat istemiştir.");
    expect(text).toContain("K A R A R");
    // Satır sonları korunur (blok etiketler satıra dönüşür).
    expect(text.split("\n").length).toBeGreaterThan(4);
  });

  it("HTML varlıkları çözülür", () => {
    const text = cleanOfficialDocument(RAW);
    expect(text).toContain('"alıntı" & özel karakter');
    expect(text).not.toContain("&nbsp;");
    expect(text).not.toContain("&quot;");
  });

  it("ardışık boş satırlar tek boş satıra iner", () => {
    const text = cleanOfficialDocument(RAW);
    expect(text).not.toMatch(/\n{3,}/);
  });
});
