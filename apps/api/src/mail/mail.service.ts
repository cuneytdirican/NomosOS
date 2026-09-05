/**
 * E-POSTA (SMTP) — Faz 2, tek boğum noktası.
 *
 * Sözleşmesiz çalışan tek dış kanal: herhangi bir SMTP hesabı yeter (büro
 * Exchange'i, Google Workspace, Yandex, Mailpit…). Yapılandırma ortam
 * değişkenleriyle (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
 * `SMTP_FROM`, isteğe bağlı `SMTP_SECURE`). Tanımsızsa `configured=false` ve
 * `send()` göndermeden `{ sent: false, reason }` döner — çağıranlar bunu
 * KULLANICIYA söyler, sessizce yutmaz.
 *
 * Kullananlar: kanal sağlayıcısı (müvekkil e-postası), bildirim dağıtım işi
 * (süre/duruşma hatırlatması), parola sıfırlama, demo talebi bildirimi.
 */

import { Injectable, Logger } from "@nestjs/common";

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface MailSendResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

interface Transport {
  sendMail: (opts: Record<string, unknown>) => Promise<{ messageId?: string }>;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const host = env.SMTP_HOST?.trim();
  const port = Number.parseInt(env.SMTP_PORT ?? "", 10);
  const from = env.SMTP_FROM?.trim();
  if (!host || !from || !Number.isFinite(port)) return null;
  return {
    host,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
    from,
  };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport: Transport | null = null;
  private readonly config = smtpConfigFromEnv();

  get configured(): boolean {
    return this.config !== null;
  }

  /** Testler / özel taşıyıcı için. */
  setTransportForTests(transport: Transport | null): void {
    this.transport = transport;
  }

  private async getTransport(): Promise<Transport | null> {
    if (!this.config) return null;
    if (this.transport) return this.transport;
    const nodemailer = (await import("nodemailer")) as unknown as {
      createTransport: (opts: Record<string, unknown>) => Transport;
    };
    this.transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transport;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const transport = await this.getTransport();
    if (!transport || !this.config) {
      return {
        sent: false,
        reason: "SMTP yapılandırılmamış (SMTP_HOST/SMTP_PORT/SMTP_FROM). E-posta gönderilmedi.",
      };
    }
    try {
      const info = await transport.sendMail({
        from: this.config.from,
        to: Array.isArray(message.to) ? message.to.join(", ") : message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
      });
      return { sent: true, messageId: info.messageId };
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.warn(`E-posta gönderilemedi (${message.subject}): ${reason}`);
      return { sent: false, reason };
    }
  }
}
