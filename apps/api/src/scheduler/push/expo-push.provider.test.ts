import { afterEach, describe, expect, it, vi } from "vitest";
import * as ai from "@nomosos/ai";
import { EXPO_PUSH_URL, ExpoPushProvider, isExpoPushToken } from "./expo-push.provider";

vi.mock("@nomosos/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@nomosos/ai")>();
  return { ...mod, fetchWithTimeout: vi.fn() };
});
const fetchMock = ai.fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;
afterEach(() => fetchMock.mockReset());

describe("ExpoPushProvider", () => {
  it("yalnız Expo biçimli jetonlara gönderir; metin buildPushPayload'dan (kaynak sızdırmaz)", async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }) });
    const p = new ExpoPushProvider();
    const r = await p.send(
      [{ tenantId: "t", userId: "u", kind: "DURUSMA_YARIN", data: { resourceType: "Hearing", resourceId: "h1" } }],
      [
        { token: "ExponentPushToken[aaa]", platform: "IOS" },
        { token: "ExponentPushToken[bbb]", platform: "ANDROID" },
        { token: "sahte-jeton", platform: "WEB" },
      ],
    );
    expect(r.delivered).toBe(1);
    expect(r.skipped).toBe(1);
    expect(p.invalidTokens).toEqual(["ExponentPushToken[bbb]"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXPO_PUSH_URL);
    const body = JSON.parse(init.body as string) as Array<{ to: string; body: string; data: Record<string, string> }>;
    expect(body).toHaveLength(2);
    expect(body[0].body).toContain("Yarın duruşmanız var");
    expect(body[0].body).not.toContain("h1");
    expect(body[0].data).toEqual({ kind: "DURUSMA_YARIN", resourceType: "Hearing", resourceId: "h1" });
  });

  it("geçerli jeton yoksa ağa çıkmaz", async () => {
    const r = await new ExpoPushProvider().send([{ tenantId: "t", userId: "u", kind: "SURE_YAKLASIYOR" }], [{ token: "x", platform: "WEB" }]);
    expect(r.delivered).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ağ hatası fırlatmaz; skipped sayar", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const r = await new ExpoPushProvider().send([{ tenantId: "t", userId: "u", kind: "SURE_GECTI" }], [{ token: "ExpoPushToken[zzz]", platform: "IOS" }]);
    expect(r).toMatchObject({ delivered: 0, skipped: 1 });
  });

  it("isExpoPushToken", () => {
    expect(isExpoPushToken("ExponentPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("fcm:abc")).toBe(false);
  });
});
