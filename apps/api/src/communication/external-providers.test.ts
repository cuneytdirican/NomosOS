/**
 * Kanal adaptörü SÖZLEŞME testleri — sağlayıcı hesabı gerekmez; HTTP yanıtları
 * kayıtlı fixture'lardır (Netgsm REST v2 / Meta Graph v20 belgeleriyle uyumlu).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ai from "@nomosos/ai";
import type { MailService } from "../mail/mail.service";
import {
  NetgsmSmsProvider,
  SmtpChannelProvider,
  WhatsAppCloudProvider,
  netgsmConfigFromEnv,
  normalizeTrMsisdn,
  whatsappConfigFromEnv,
} from "./external-providers";

vi.mock("@nomosos/ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@nomosos/ai")>();
  return { ...mod, fetchWithTimeout: vi.fn() };
});
const fetchMock = ai.fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

afterEach(() => fetchMock.mockReset());

describe("normalizeTrMsisdn", () => {
  it("0532…, +90 532…, 532… → 90532…", () => {
    expect(normalizeTrMsisdn("0532 123 45 67")).toBe("905321234567");
    expect(normalizeTrMsisdn("+90 (532) 123-45-67")).toBe("905321234567");
    expect(normalizeTrMsisdn("5321234567")).toBe("905321234567");
  });
});

describe("env yapılandırması", () => {
  it("eksik değişken → null; tam → config (sondaki / kırpılır)", () => {
    expect(netgsmConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(netgsmConfigFromEnv({ SMS_PROVIDER_BASE_URL: "https://api.netgsm.com.tr/", SMS_PROVIDER_API_KEY: "u:p", SMS_SENDER_TITLE: "NOMOSOS" } as NodeJS.ProcessEnv))
      .toEqual({ baseUrl: "https://api.netgsm.com.tr", apiKey: "u:p", senderTitle: "NOMOSOS" });
    expect(whatsappConfigFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "1" } as NodeJS.ProcessEnv)).toBeNull();
    expect(whatsappConfigFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_BUSINESS_ACCOUNT_ID: "b" } as NodeJS.ProcessEnv))
      .toMatchObject({ apiVersion: "v20.0" });
  });
});

describe("SmtpChannelProvider", () => {
  it("MailService'e konu+gövde ile gönderir; başarısızlık fırlatır (ONAYLANDI'da kalır)", async () => {
    const send = vi.fn(async () => ({ sent: true, messageId: "<x>" }));
    const p = new SmtpChannelProvider({ send } as unknown as MailService);
    const r = await p.send({ to: "a@b.tr", subject: "Duruşma", body: "Yarın 10:00", templateKey: null } as never);
    expect(r.providerRef).toBe("<x>");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@b.tr", subject: "Duruşma", text: "Yarın 10:00" }));
    const bad = new SmtpChannelProvider({ send: async () => ({ sent: false, reason: "SMTP kapalı" }) } as unknown as MailService);
    await expect(bad.send({ to: "a@b.tr", subject: "S", body: "B" } as never)).rejects.toThrow("SMTP kapalı");
  });
});

describe("NetgsmSmsProvider (fixture)", () => {
  const p = new NetgsmSmsProvider({ baseUrl: "https://api.netgsm.com.tr", apiKey: "user:pass", senderTitle: "NOMOSOS" });

  it("REST v2 gövdesi: msgheader + messages[{msg,no}] + Basic auth; JSON 00 yanıtı → jobid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: "00", jobid: "123456789", description: "Başarılı" }));
    const r = await p.send({ to: "0532 123 45 67", subject: null, body: "Merhaba" } as never);
    expect(r.providerRef).toBe("netgsm:123456789");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.netgsm.com.tr/sms/rest/v2/send");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ msgheader: "NOMOSOS", messages: [{ msg: "Merhaba", no: "905321234567" }] });
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  it("düz metin '00 jobid' eski biçimini de anlar", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, "00 987654"));
    const r = await p.send({ to: "5321234567", body: "x" } as never);
    expect(r.providerRef).toBe("netgsm:987654");
  });

  it("hata kodu (30 = geçersiz kullanıcı) ve HTTP 4xx fırlatır", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: "30", description: "Geçersiz kullanıcı adı" }));
    await expect(p.send({ to: "5321234567", body: "x" } as never)).rejects.toThrow("Netgsm kodu 30");
    fetchMock.mockResolvedValueOnce(jsonResponse(401, "Unauthorized"));
    await expect(p.send({ to: "5321234567", body: "x" } as never)).rejects.toThrow("HTTP 401");
  });
});

describe("WhatsAppCloudProvider (fixture)", () => {
  const p = new WhatsAppCloudProvider({ phoneNumberId: "PN1", accessToken: "TOK", businessAccountId: "BA1", apiVersion: "v20.0" });

  it("metin mesajı: /v20.0/PN1/messages + Bearer; yanıt messages[0].id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messaging_product: "whatsapp", contacts: [{ wa_id: "905321234567" }], messages: [{ id: "wamid.ABC" }] }));
    const r = await p.send({ to: "+90 532 123 45 67", body: "Merhaba", templateKey: null } as never);
    expect(r.providerRef).toBe("wamid.ABC");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v20.0/PN1/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer TOK");
    expect(JSON.parse(init.body as string)).toMatchObject({ messaging_product: "whatsapp", to: "905321234567", type: "text", text: { body: "Merhaba" } });
  });

  it("templateKey varsa şablon mesajı (tr) gönderir", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: "wamid.T" }] }));
    const r = await p.send({ to: "5321234567", body: "12.09.2026", templateKey: "durusma_hatirlatma" } as never);
    expect(r.note).toContain("durusma_hatirlatma");
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ type: "template", template: { name: "durusma_hatirlatma", language: { code: "tr" } } });
  });

  it("Graph hata zarfı fırlatır", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } }));
    await expect(p.send({ to: "5321234567", body: "x" } as never)).rejects.toThrow("131030");
  });
});
