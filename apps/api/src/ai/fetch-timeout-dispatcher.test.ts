/**
 * fetchWithTimeout — undici Agent ile başlık/gövde zaman aşımı (canlı bulgu:
 * LM Studio tam analizde ilk baytı 5 dk'dan geç verince global fetch'in 300 sn
 * başlık sınırı UND_ERR_HEADERS_TIMEOUT ile düşürüyordu). Ayrıca `cause` mesaja eklenir.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "@nomosos/ai";

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithTimeout", () => {
  it("isteği zaman aşımına eşlenmiş bir dispatcher ile atar; aynı süre için aynı Agent", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", f);
    await fetchWithTimeout("http://lm/v1/x", {}, 600_000);
    await fetchWithTimeout("http://lm/v1/y", {}, 600_000);
    const inits = f.mock.calls.map((c) => (c as unknown[])[1] as { dispatcher?: { dispatch?: unknown }; signal?: AbortSignal });
    expect(typeof inits[0].dispatcher?.dispatch).toBe("function");
    expect(inits[0].dispatcher).toBe(inits[1].dispatcher);
    expect(inits[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("'fetch failed' hatasına cause kodu eklenir", async () => {
    const err = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.0.0.1:1234" } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw err; }));
    await expect(fetchWithTimeout("http://lm/v1/x", {}, 1000)).rejects.toThrow(/fetch failed \(ECONNREFUSED: connect ECONNREFUSED/);
  });
});
