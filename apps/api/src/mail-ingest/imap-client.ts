/**
 * FAZ 7A — IMAP istemci adaptörü (imapflow + mailparser).
 *
 * Arayüz test edilebilirlik içindir: iş ve servis `ImapClient`'a bağlıdır, gerçek
 * bağlantı yalnız `ImapFlowClient` içindedir. Sözleşme: `lastUid`'den büyük UID'li
 * iletileri ekleriyle döner; işaretleme (\Seen) çağıranın kararıdır.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface ImapConnection {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  folder: string;
}

export interface FetchedAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
  size: number;
}

export interface FetchedMessage {
  uid: number;
  messageId: string | null;
  from: string | null;
  subject: string;
  date: Date | null;
  text: string;
  attachments: FetchedAttachment[];
}

export interface ImapClient {
  /** Bağlantı + klasör doğrulaması; hata metni döner (parola yanlış vb.). */
  test(conn: ImapConnection): Promise<{ ok: boolean; message: string; exists?: number }>;
  /** `afterUid`'den büyük UID'li iletileri (en çok `limit`) getirir. */
  fetchNew(conn: ImapConnection, afterUid: number, limit: number): Promise<FetchedMessage[]>;
}

export const IMAP_CLIENT = Symbol("IMAP_CLIENT");

/** Bağlantı başına üst sınır — bir posta kutusu yüz binlerce ileti içerebilir. */
export const MAX_MESSAGES_PER_SYNC = 25;
/** Tek iletiden alınan ek sayısı ve toplam bayt sınırı. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class ImapFlowClient implements ImapClient {
  private open(conn: ImapConnection): ImapFlow {
    return new ImapFlow({
      host: conn.host,
      port: conn.port,
      secure: conn.secure,
      auth: { user: conn.username, pass: conn.password },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
  }

  async test(conn: ImapConnection): Promise<{ ok: boolean; message: string; exists?: number }> {
    const client = this.open(conn);
    try {
      await client.connect();
      const box = await client.mailboxOpen(conn.folder, { readOnly: true });
      return { ok: true, message: `Bağlantı başarılı; "${conn.folder}" klasöründe ${box.exists} ileti.`, exists: box.exists };
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 300) };
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async fetchNew(conn: ImapConnection, afterUid: number, limit: number): Promise<FetchedMessage[]> {
    const client = this.open(conn);
    const out: FetchedMessage[] = [];
    try {
      await client.connect();
      const lock = await client.getMailboxLock(conn.folder);
      try {
        const range = `${afterUid + 1}:*`;
        const uids = (await client.search({ uid: range }, { uid: true })) || [];
        const picked = uids.filter((u) => u > afterUid).sort((a, b) => a - b).slice(0, limit);
        for (const uid of picked) {
          const msg = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const attachments: FetchedAttachment[] = [];
          let total = 0;
          for (const a of parsed.attachments ?? []) {
            if (attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
            const size = a.size ?? a.content?.length ?? 0;
            if (!a.content || size === 0 || total + size > MAX_ATTACHMENT_BYTES) continue;
            total += size;
            attachments.push({ fileName: a.filename ?? `ek-${attachments.length + 1}`, contentType: a.contentType ?? "application/octet-stream", content: a.content, size });
          }
          const fromValue = Array.isArray(parsed.from) ? parsed.from[0] : parsed.from;
          out.push({
            uid,
            messageId: parsed.messageId ?? null,
            from: fromValue?.text ?? null,
            subject: parsed.subject ?? "",
            date: parsed.date ?? null,
            text: (parsed.text ?? "").slice(0, 20_000),
            attachments,
          });
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }
}
