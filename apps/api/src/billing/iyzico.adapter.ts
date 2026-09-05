/**
 * IYZICO ADAPTÖRÜ (Faz 3) — Checkout Form (ödeme sayfası) akışı.
 *
 * Belge: https://docs.iyzico.com — Checkout Form Initialize / Retrieve, HMAC-SHA256
 * (IYZWSv2) imzası ve Webhook V3 imzası. Sözleşme testleri kayıtlı yanıt
 * fixture'larıyla koşar; canlı doğrulama SANDBOX anahtarlarıyla yapılır
 * (`IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`).
 *
 * İMZA (IYZWSv2):
 *   randomKey = zaman damgası + rastgele
 *   signature = HMAC_SHA256(secretKey, randomKey + uriPath + requestBody) (hex)
 *   Authorization: IYZWSv2 base64("apiKey:" + apiKey + "&randomKey:" + randomKey + "&signature:" + signature)
 *   x-iyzi-rnd: randomKey
 *
 * WEBHOOK V3: `X-IYZ-SIGNATURE-V3` = HMAC_SHA256(secretKey,
 *   secretKey + iyziEventType + paymentId + paymentConversationId + status) (hex, küçük harf).
 *   Doğrulama sabit zamanlıdır; imzasız/uyumsuz bildirim İŞLENMEZ.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fetchWithTimeout } from "@nomosos/ai";
import type { CheckoutInput, CheckoutOutcome } from "./odeme-saglayici";

export interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

export function iyzicoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IyzicoConfig | null {
  const apiKey = env.IYZICO_API_KEY?.trim();
  const secretKey = env.IYZICO_SECRET_KEY?.trim();
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey, baseUrl: (env.IYZICO_BASE_URL?.trim() || "https://sandbox-api.iyzipay.com").replace(/\/+$/, "") };
}

export function iyzicoSignature(secretKey: string, randomKey: string, uriPath: string, body: string): string {
  return createHmac("sha256", secretKey).update(randomKey + uriPath + body).digest("hex");
}

export function iyzicoAuthHeader(cfg: IyzicoConfig, randomKey: string, uriPath: string, body: string): string {
  const sig = iyzicoSignature(cfg.secretKey, randomKey, uriPath, body);
  return `IYZWSv2 ${Buffer.from(`apiKey:${cfg.apiKey}&randomKey:${randomKey}&signature:${sig}`).toString("base64")}`;
}

export function iyzicoWebhookSignature(secretKey: string, body: { iyziEventType?: string; paymentId?: string | number; paymentConversationId?: string; status?: string }): string {
  const material = `${secretKey}${body.iyziEventType ?? ""}${body.paymentId ?? ""}${body.paymentConversationId ?? ""}${body.status ?? ""}`;
  return createHmac("sha256", secretKey).update(material).digest("hex");
}

interface InitializeResponse {
  status: "success" | "failure";
  token?: string;
  paymentPageUrl?: string;
  checkoutFormContent?: string;
  errorMessage?: string;
  errorCode?: string;
}

interface RetrieveResponse {
  status: "success" | "failure";
  paymentStatus?: "SUCCESS" | "FAILURE" | "INIT_THREEDS" | "CALLBACK_THREEDS" | "BKM_POS_SELECTED";
  paymentId?: string | number;
  paidPrice?: string | number;
  price?: string | number;
  currency?: string;
  conversationId?: string;
  token?: string;
  errorMessage?: string;
  [k: string]: unknown;
}

export class IyzicoAdapter {
  constructor(private readonly cfg: IyzicoConfig, private readonly timeoutMs = 20_000) {}

  private async post<T>(uriPath: string, payload: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify(payload);
    const randomKey = `${Date.now()}${randomBytes(6).toString("hex")}`;
    const res = await fetchWithTimeout(
      `${this.cfg.baseUrl}${uriPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: iyzicoAuthHeader(this.cfg, randomKey, uriPath, body),
          "x-iyzi-rnd": randomKey,
          "x-iyzi-client-version": "nomosos-1.0",
        },
        body,
      },
      this.timeoutMs,
    );
    const json = (await res.json().catch(() => ({}))) as T & { status?: string; errorMessage?: string };
    if (!res.ok) throw new Error(`iyzico HTTP ${res.status}: ${json.errorMessage ?? "bilinmeyen hata"}`);
    return json;
  }

  async initializeCheckoutForm(input: CheckoutInput): Promise<{ token: string; paymentPageUrl: string }> {
    const [firstName, ...rest] = input.buyer.name.trim().split(/\s+/);
    const payload = {
      locale: "tr",
      conversationId: input.checkoutToken,
      price: input.amount,
      paidPrice: input.amount,
      currency: input.currency,
      basketId: input.checkoutToken,
      paymentGroup: "SUBSCRIPTION",
      callbackUrl: input.callbackUrl,
      enabledInstallments: [1],
      buyer: {
        id: input.buyer.id,
        name: firstName || "Büro",
        surname: rest.join(" ") || "Yetkilisi",
        email: input.buyer.email,
        identityNumber: input.buyer.taxNumber || "11111111111",
        registrationAddress: input.buyer.address || "Adres belirtilmedi",
        ip: input.buyer.ip,
        city: "Istanbul",
        country: "Turkey",
      },
      billingAddress: { contactName: input.buyer.name, city: "Istanbul", country: "Turkey", address: input.buyer.address || "Adres belirtilmedi" },
      basketItems: [{ id: input.checkoutToken, name: input.description.slice(0, 200), category1: "NomosOS", itemType: "VIRTUAL", price: input.amount }],
    };
    const res = await this.post<InitializeResponse>("/payment/iyzipos/checkoutform/initialize/auth/ecom", payload);
    if (res.status !== "success" || !res.token || !res.paymentPageUrl) {
      throw new Error(`iyzico checkout başlatılamadı: ${res.errorMessage ?? res.errorCode ?? "yanıt eksik"}`);
    }
    return { token: res.token, paymentPageUrl: res.paymentPageUrl };
  }

  async retrieveCheckoutForm(token: string): Promise<CheckoutOutcome> {
    const res = await this.post<RetrieveResponse>("/payment/iyzipos/checkoutform/auth/ecom/detail", { locale: "tr", token });
    const status: CheckoutOutcome["status"] =
      res.status === "success" && res.paymentStatus === "SUCCESS" ? "BASARILI" : res.paymentStatus === "FAILURE" || res.status === "failure" ? "BASARISIZ" : "BEKLIYOR";
    return {
      status,
      ref: String(res.paymentId ?? token),
      paidPrice: res.paidPrice !== undefined ? String(res.paidPrice) : null,
      currency: res.currency ?? null,
      conversationId: res.conversationId ?? null,
      raw: res as Record<string, unknown>,
    };
  }

  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): boolean {
    const given = headers["x-iyz-signature-v3"];
    const sig = (Array.isArray(given) ? given[0] : given)?.trim().toLowerCase();
    if (!sig) return false;
    const expected = iyzicoWebhookSignature(this.cfg.secretKey, body as never);
    if (sig.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }
}
