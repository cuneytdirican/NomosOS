/**
 * ADAPTÖR KAYIT DEFTERİ — künye teyidi birleştirme testleri.
 *
 * Korunan taahhütler:
 *  1. Adaptörler PARALEL sorgulanır (toplam süre en yavaş adaptör kadar; toplamı değil).
 *  2. "İlk FOUND kazanır" kuralı adaptör SIRASINA bağlıdır (yerel havuz canlı
 *     kaynaktan önce) — paralellik sırayı bozmaz.
 *  3. SEARCH_FAILED, NOT_FOUND'u bastırır (fail-closed): erişilemeyen kaynak
 *     varken "bulunamadı" denmez.
 *  4. Fırlatan adaptör SEARCH_FAILED olarak kaydedilir; diğerlerini düşürmez.
 */

import { describe, expect, it, vi } from "vitest";
import { CaseLawAdapterRegistry } from "./registry.service";
import type { CaseLawCitationLookup, CaseLawSourceAdapter } from "./types";
import type { LocalDbCaseLawAdapter } from "./local-db.adapter";
import type { ManualEntryCaseLawAdapter } from "./manual-entry.adapter";
import type { AymLiveAdapter } from "./aym-live.adapter";
import type { UyusmazlikLiveAdapter } from "./uyusmazlik-live.adapter";

function fakeAdapter(
  key: string,
  result: CaseLawCitationLookup | Error,
  delayMs = 0,
): CaseLawSourceAdapter {
  return {
    key,
    name: key,
    canSearch: false,
    canFetchByCitation: true,
    search: async () => [],
    fetchByCitation: vi.fn(async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (result instanceof Error) throw result;
      return result;
    }),
    healthCheck: async () => ({
      key,
      name: key,
      healthy: true,
      message: "",
      checkedAt: new Date(),
      canSearch: false,
      canFetchByCitation: true,
    }),
  } as unknown as CaseLawSourceAdapter;
}

function found(adapterKey: string, court: string): CaseLawCitationLookup {
  return {
    outcome: "FOUND",
    adapterKey,
    note: "",
    record: { id: `${adapterKey}:1`, court, caseNumber: "2020/1", decisionNumber: "2021/2" } as never,
  };
}

const NOT_FOUND = (adapterKey: string): CaseLawCitationLookup => ({ outcome: "NOT_FOUND", adapterKey, note: "" });
const FAILED = (adapterKey: string): CaseLawCitationLookup => ({ outcome: "SEARCH_FAILED", adapterKey, note: "kapalı" });

function registry(a: CaseLawSourceAdapter, b: CaseLawSourceAdapter, c: CaseLawSourceAdapter, d: CaseLawSourceAdapter) {
  return new CaseLawAdapterRegistry(
    a as unknown as LocalDbCaseLawAdapter,
    b as unknown as ManualEntryCaseLawAdapter,
    c as unknown as AymLiveAdapter,
    d as unknown as UyusmazlikLiveAdapter,
  );
}

const QUERY = { tenantId: "t-1", caseNumber: "2020/1", decisionNumber: "2021/2" };

describe("CaseLawAdapterRegistry.fetchByCitationAll", () => {
  it("adaptörleri PARALEL sorgular — toplam süre en yavaş adaptör kadardır", async () => {
    const reg = registry(
      fakeAdapter("A", NOT_FOUND("A"), 120),
      fakeAdapter("B", NOT_FOUND("B"), 120),
      fakeAdapter("C", NOT_FOUND("C"), 120),
      fakeAdapter("D", NOT_FOUND("D"), 120),
    );
    const started = Date.now();
    const res = await reg.fetchByCitationAll(QUERY);
    const elapsed = Date.now() - started;
    expect(res.outcome).toBe("NOT_FOUND");
    // Ardışık olsaydı ≥ 480 ms sürerdi; paralelde ~120 ms. Zamanlayıcı sapması için pay.
    expect(elapsed).toBeLessThan(400);
  });

  it("ilk FOUND adaptör SIRASINA göre kazanır — yavaş yerel havuz, hızlı canlı kaynağı yener", async () => {
    const reg = registry(
      fakeAdapter("LOCAL", found("LOCAL", "Yargıtay 9. Hukuk Dairesi"), 60),
      fakeAdapter("MANUAL", NOT_FOUND("MANUAL")),
      fakeAdapter("AYM", found("AYM", "Anayasa Mahkemesi"), 0),
      fakeAdapter("UYS", NOT_FOUND("UYS")),
    );
    const res = await reg.fetchByCitationAll(QUERY);
    expect(res.outcome).toBe("FOUND");
    expect(res.lookup?.adapterKey).toBe("LOCAL");
    expect(res.perAdapter.map((r) => r.adapterKey)).toEqual(["LOCAL", "MANUAL", "AYM", "UYS"]);
  });

  it("bir adaptör SEARCH_FAILED ise sonuç NOT_FOUND olamaz (fail-closed)", async () => {
    const reg = registry(
      fakeAdapter("LOCAL", NOT_FOUND("LOCAL")),
      fakeAdapter("MANUAL", NOT_FOUND("MANUAL")),
      fakeAdapter("AYM", FAILED("AYM")),
      fakeAdapter("UYS", NOT_FOUND("UYS")),
    );
    const res = await reg.fetchByCitationAll(QUERY);
    expect(res.outcome).toBe("SEARCH_FAILED");
    expect(res.lookup?.adapterKey).toBe("AYM");
  });

  it("fırlatan adaptör SEARCH_FAILED'e çevrilir, diğer sonuçlar korunur", async () => {
    const reg = registry(
      fakeAdapter("LOCAL", NOT_FOUND("LOCAL")),
      fakeAdapter("MANUAL", new Error("patladı")),
      fakeAdapter("AYM", NOT_FOUND("AYM")),
      fakeAdapter("UYS", NOT_FOUND("UYS")),
    );
    const res = await reg.fetchByCitationAll(QUERY);
    expect(res.outcome).toBe("SEARCH_FAILED");
    const manual = res.perAdapter.find((r) => r.adapterKey === "MANUAL");
    expect(manual?.outcome).toBe("SEARCH_FAILED");
    expect(manual?.note).toContain("patladı");
    expect(res.perAdapter).toHaveLength(4);
  });

  it("canFetchByCitation=false adaptör hiç çağrılmaz", async () => {
    const skipped = fakeAdapter("SKIP", found("SKIP", "x"));
    (skipped as { canFetchByCitation: boolean }).canFetchByCitation = false;
    const reg = registry(
      fakeAdapter("LOCAL", NOT_FOUND("LOCAL")),
      skipped,
      fakeAdapter("AYM", NOT_FOUND("AYM")),
      fakeAdapter("UYS", NOT_FOUND("UYS")),
    );
    const res = await reg.fetchByCitationAll(QUERY);
    expect(res.outcome).toBe("NOT_FOUND");
    expect(skipped.fetchByCitation).not.toHaveBeenCalled();
    expect(res.perAdapter.map((r) => r.adapterKey)).toEqual(["LOCAL", "AYM", "UYS"]);
  });
});
