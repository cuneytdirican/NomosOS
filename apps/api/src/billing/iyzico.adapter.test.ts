/**
 * iyzico adaptörü SÖZLEŞME testleri — kayıtlı yanıt fixture'ları (Checkout Form
 * initialize/retrieve) + IYZWSv2 ve Webhook V3 imza matematiği. Sandbox hesabı gerekmez.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import * as ai from "@nomosos/ai";
import { IyzicoAdapter, iyzicoAuthHeader, iyzicoConfigFromEnv, iyzicoSignature, iyzicoWebhookSignature } from "./iyzico.adapter";

vi.mock("@nomosos/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@nomosos/ai")>();
  return { ...mod, fetchWithTimeout: vi.fn() };
});
const fetchMock = ai.fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;
afterEach(() => fetchMock.mockReset());

const CFG = { apiKey: "sandbox-api", secretKey: "sandbox-secret", baseUrl: "https://sandbox-api.iyzipay.com" };
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

describe("imza", () => {
  it("IYZWSv2: HMAC-SHA256(secret, randomKey + uriPath + body) hex; Authorization base64", () => {
    const sig = iyzicoSignature("s", "rnd", "/payment/x", "{}");
    expect(sig).toBe(createHmac("sha256", "s").update("rnd/payment/x{}").digest("hex"));
    const header = iyzicoAuthHeader({ ...CFG, secretKey: "s" }, "rnd", "/payment/x", "{}");
    expect(header.startsWith("IYZWSv2 ")).toBe(true);
    expect(Buffer.from(header.slice(8), "base64").toString()).toBe(`apiKey:sandbox-api&randomKey:rnd&signature:${sig}`);
  });

  it("webhook V3: HMAC(secret, secret+eventType+paymentId+conversationId+status); sabit zamanlı doğrulama", () => {
    const body = { iyziEventType: "CHECKOUT_FORM_AUTH", paymentId: 123, paymentConversationId: "abc", status: "SUCCESS", token: "t" };
    const sig = iyzicoWebhookSignature("sandbox-secret", body);
    const adapter = new IyzicoAdapter(CFG);
    expect(adapter.verifyWebhookSignature({ "x-iyz-signature-v3": sig.toUpperCase() }, body)).toBe(true);
    expect(adapter.verifyWebhookSignature({ "x-iyz-signature-v3": "deadbeef" }, body)).toBe(false);
    expect(adapter.verifyWebhookSignature({}, body)).toBe(false);
  });

  it("env: iki anahtar da gerekli; baseUrl varsayılan sandbox", () => {
    expect(iyzicoConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(iyzicoConfigFromEnv({ IYZICO_API_KEY: "a", IYZICO_SECRET_KEY: "b" } as NodeJS.ProcessEnv)).toEqual({ apiKey: "a", secretKey: "b", baseUrl: "https://sandbox-api.iyzipay.com" });
  });
});

describe("Checkout Form", () => {
  it("initialize: doğru uç, conversationId=checkoutToken, tutarlar; token + paymentPageUrl", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: "success", token: "TKN1", paymentPageUrl: "https://sandbox-cpp.iyzipay.com?token=TKN1", checkoutFormContent: "<script/>" }));
    const res = await new IyzicoAdapter(CFG).initializeCheckoutForm({
      checkoutToken: "co-1",
      amount: "7200.00",
      currency: "TRY",
      description: "Abonelik",
      buyer: { id: "u1", name: "Ayşe Yılmaz", email: "a@b.tr", ip: "1.1.1.1", address: null, taxNumber: null },
      callbackUrl: "https://api/x/callback",
    });
    expect(res).toEqual({ token: "TKN1", paymentPageUrl: "https://sandbox-cpp.iyzipay.com?token=TKN1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/auth/ecom");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ conversationId: "co-1", price: "7200.00", paidPrice: "7200.00", currency: "TRY", callbackUrl: "https://api/x/callback", buyer: { name: "Ayşe", surname: "Yılmaz" } });
    const h = init.headers as Record<string, string>;
    expect(h.authorization.startsWith("IYZWSv2 ")).toBe(true);
    expect(h["x-iyzi-rnd"]).toBeTruthy();
  });

  it("initialize failure → hata (sahte token yok)", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: "failure", errorCode: "1001", errorMessage: "Geçersiz istek" }));
    await expect(
      new IyzicoAdapter(CFG).initializeCheckoutForm({ checkoutToken: "c", amount: "1.00", currency: "TRY", description: "x", buyer: { id: "u", name: "A", email: "", ip: "" }, callbackUrl: "cb" }),
    ).rejects.toThrow("Geçersiz istek");
  });

  it("retrieve: SUCCESS → BASARILI + tutar/para birimi/conversationId; FAILURE → BASARISIZ", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: "success", paymentStatus: "SUCCESS", paymentId: 9001, paidPrice: 7200, price: 7200, currency: "TRY", conversationId: "co-1", token: "TKN1" }));
    const ok = await new IyzicoAdapter(CFG).retrieveCheckoutForm("TKN1");
    expect(ok).toMatchObject({ status: "BASARILI", ref: "9001", paidPrice: "7200", currency: "TRY", conversationId: "co-1" });
    fetchMock.mockResolvedValueOnce(json(200, { status: "success", paymentStatus: "FAILURE", conversationId: "co-1", errorMessage: "Yetersiz bakiye" }));
    const bad = await new IyzicoAdapter(CFG).retrieveCheckoutForm("TKN1");
    expect(bad.status).toBe("BASARISIZ");
  });
});
