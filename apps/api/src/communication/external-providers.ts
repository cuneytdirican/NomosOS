/**
 * GERÇEK KANAL ADAPTÖRLERİ (Faz 2) — kayıt kararı ortam değişkenleriyle.
 *
 *  - EPOSTA  → `SmtpChannelProvider` (MailService; SMTP_* tanımlıysa).
 *  - SMS     → `NetgsmSmsProvider` (Netgsm REST; SMS_PROVIDER_BASE_URL/API_KEY/SENDER_TITLE).
 *              Netgsm, Türkiye'de İYS uyumlu en yaygın toplu SMS API'sidir; başka
 *              sağlayıcı aynı arayüzle eklenir.
 *  - WHATSAPP→ `WhatsAppCloudProvider` (Meta Cloud API v20; onaylı şablon adı
 *              `templateKey` ile gelir, yoksa serbest metin 24 saat penceresinde).
 *
 * Hiçbiri bağlantıyı yutmaz: sağlayıcı 2xx dışı yanıt verirse hata fırlatılır,
 * mesaj ONAYLANDI durumunda kalır ve yeniden gönderilebilir (outbound.service).
 * Sözleşme testleri kayıtlı HTTP fixture'larıyla koşar (sms/wa hesabı gerekmez).
 */

import { fetchWithTimeout } from "@nomosos/ai";
import type { MailService } from "../mail/mail.service";
import type { ChannelSendPayload, ChannelSendResult, MessageChannelProvider } from "./channel-providers";

const HTTP_TIMEOUT_MS = 15_000;

export class SmtpChannelProvider implements MessageChannelProvider {
  readonly channel = "EPOSTA" as const;
  readonly name = "SMTP e-posta";

  constructor(private readonly mail: MailService) {}

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    const result = await this.mail.send({
      to: payload.to,
      subject: payload.subject?.trim() || "NomosOS — bilgilendirme",
      text: payload.body,
    });
    if (!result.sent) throw new Error(result.reason ?? "E-posta gönderilemedi.");
    return { providerRef: result.messageId ?? `smtp:${Date.now().toString(36)}`, note: "SMTP ile gönderildi." };
  }
}

export interface NetgsmConfig {
  baseUrl: string;
  apiKey: string;
  senderTitle: string;
}

export function netgsmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NetgsmConfig | null {
  const baseUrl = env.SMS_PROVIDER_BASE_URL?.trim();
  const apiKey = env.SMS_PROVIDER_API_KEY?.trim();
  const senderTitle = env.SMS_SENDER_TITLE?.trim();
  if (!baseUrl || !apiKey || !senderTitle) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, senderTitle };
}

/** Türkiye GSM numarasını 90XXXXXXXXXX biçimine getirir. */
export function normalizeTrMsisdn(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `9${digits}`;
  if (digits.length === 10) return `90${digits}`;
  return digits;
}

export class NetgsmSmsProvider implements MessageChannelProvider {
  readonly channel = "SMS" as const;
  readonly name = "Netgsm SMS";

  constructor(private readonly config: NetgsmConfig) {}

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    // Netgsm REST v2: POST /sms/rest/v2/send — Authorization: Basic (kullanıcı:şifre) ya da apikey.
    const res = await fetchWithTimeout(
      `${this.config.baseUrl}/sms/rest/v2/send`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(this.config.apiKey).toString("base64")}` },
        body: JSON.stringify({
          msgheader: this.config.senderTitle,
          encoding: "TR",
          iysfilter: "11",
          messages: [{ msg: payload.body, no: normalizeTrMsisdn(payload.to) }],
        }),
      },
      HTTP_TIMEOUT_MS,
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`SMS sağlayıcısı hata döndü (HTTP ${res.status}): ${text.slice(0, 200)}`);
    let jobid = "";
    try {
      const json = JSON.parse(text) as { code?: string; jobid?: string; description?: string };
      if (json.code && json.code !== "00") throw new Error(`Netgsm kodu ${json.code}: ${json.description ?? ""}`);
      jobid = json.jobid ?? "";
    } catch (err) {
      if ((err as Error).message.startsWith("Netgsm kodu")) throw err;
      // Eski uç düz metin "00 <jobid>" döner.
      const m = /^00\s+(\S+)/.exec(text.trim());
      if (!m) throw new Error(`SMS sağlayıcısı beklenmeyen yanıt: ${text.slice(0, 120)}`);
      jobid = m[1];
    }
    return { providerRef: `netgsm:${jobid}`, note: `SMS gönderildi (${this.config.senderTitle}).` };
  }
}

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  apiVersion: string;
}

export function whatsappConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const businessAccountId = env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  if (!phoneNumberId || !accessToken || !businessAccountId) return null;
  return { phoneNumberId, accessToken, businessAccountId, apiVersion: env.WHATSAPP_API_VERSION?.trim() || "v20.0" };
}

export class WhatsAppCloudProvider implements MessageChannelProvider {
  readonly channel = "WHATSAPP" as const;
  readonly name = "WhatsApp Cloud API";

  constructor(private readonly config: WhatsAppConfig, private readonly graphBase = "https://graph.facebook.com") {}

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    const to = normalizeTrMsisdn(payload.to);
    // Onaylı şablon varsa şablon mesajı (24 saat penceresi dışında zorunlu); yoksa metin.
    const body = payload.templateKey
      ? { messaging_product: "whatsapp", to, type: "template", template: { name: payload.templateKey, language: { code: "tr" }, components: [{ type: "body", parameters: [{ type: "text", text: payload.body }] }] } }
      : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: payload.body } };
    const res = await fetchWithTimeout(
      `${this.graphBase}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.config.accessToken}` }, body: JSON.stringify(body) },
      HTTP_TIMEOUT_MS,
    );
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
    if (!res.ok || json.error) throw new Error(`WhatsApp Cloud API hatası (HTTP ${res.status}): ${json.error?.message ?? "bilinmeyen"}`);
    const id = json.messages?.[0]?.id ?? `wa:${Date.now().toString(36)}`;
    return { providerRef: id, note: payload.templateKey ? `WhatsApp şablon mesajı (${payload.templateKey}).` : "WhatsApp metin mesajı (24 saat penceresi)." };
  }
}
