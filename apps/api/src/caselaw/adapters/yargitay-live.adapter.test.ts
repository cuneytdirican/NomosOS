/** Canlı Yargıtay adaptörü — sözleşme ve hata taşımaları. */

import { describe, expect, it, vi } from "vitest";
import { YargitayLiveAdapter } from "./yargitay-live.adapter";

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
});
