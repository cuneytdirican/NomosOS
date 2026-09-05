/**
 * FAZ 7A — E-POSTA İLE BELGE GİRİŞİ (IMAP).
 *
 * Büro, tebligat/karar/evrak gelen posta kutusunu bağlar; iş 5 dakikada bir yeni
 * iletilerin eklerini belge hattına verir. Eşleme kuralı DETERMİNİSTİKTİR:
 *   konu ya da gövdede "2026/145" biçiminde bir dosya numarası → o dosya
 *   (kiracıda tek eşleşme şartı; birden fazla dosya aynı numaradaysa TRİYAJ)
 *   yoksa `defaultCaseId` → o dosya; o da yoksa dosyasız (triyaj kuyruğu).
 * Tahmin yok: yanlış dosyaya belge yazmak, hiç yazmamaktan tehlikelidir.
 *
 * Parola AES-256-GCM ile mühürlü (`MASTER_ENCRYPTION_KEY`); API yanıtlarına ASLA dönmez.
 */

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@nomosos/ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DocumentsService } from "../documents/documents.service";
import { validateUpload } from "../documents/documents.dto";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { IMAP_CLIENT, MAX_MESSAGES_PER_SYNC, type FetchedMessage, type ImapClient, type ImapConnection } from "./imap-client";

export const mailIngestConfigSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().min(3).max(200),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  username: z.string().trim().min(1).max(200),
  /** Boş bırakılırsa mevcut parola korunur. */
  password: z.string().min(1).max(500).nullable().optional(),
  folder: z.string().trim().min(1).max(100).default("INBOX"),
  defaultCaseId: z.string().uuid().nullable().optional(),
});
export type MailIngestConfigInput = z.infer<typeof mailIngestConfigSchema>;

/** Konu/gövdede dosya numarası: "2026/145", "E.2026/145", "2026/145 E." — ilk eşleşme. */
export function extractFileNumbers(text: string): string[] {
  const found = new Set<string>();
  const re = /(?:^|[^0-9])((?:19|20)\d{2}\/\d{1,6})(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

export interface IngestOutcome {
  messages: number;
  documents: number;
  matched: number;
  triage: number;
  skipped: number;
  errors: string[];
}

@Injectable()
export class MailIngestService {
  private readonly logger = new Logger(MailIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    @Inject(IMAP_CLIENT) private readonly imap: ImapClient,
  ) {}

  async get(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "e-posta belge girişi ayarı");
    const row = await this.prisma.client.mailIngestConfig.findUnique({ where: { tenantId: user.tenantId } });
    return row ? this.serialize(row) : { configured: false, enabled: false };
  }

  async upsert(user: AuthUser, input: MailIngestConfigInput) {
    assertRole(user, ROLE_SETS.ONAY, "e-posta belge girişi ayarı");
    const existing = await this.prisma.client.mailIngestConfig.findUnique({ where: { tenantId: user.tenantId } });
    if (!existing && !input.password) throw new BadRequestException("İlk kurulumda posta kutusu parolası zorunludur.");
    if (input.defaultCaseId) {
      const c = await this.prisma.client.case.findFirst({ where: { id: input.defaultCaseId, tenantId: user.tenantId }, select: { id: true } });
      if (!c) throw new NotFoundException("Varsayılan dosya bulunamadı.");
    }
    const data = {
      enabled: input.enabled,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      folder: input.folder,
      defaultCaseId: input.defaultCaseId ?? null,
      ...(input.password ? { passwordEnc: encryptSecret(input.password), lastUid: 0, lastError: null } : {}),
    };
    const row = existing
      ? await this.prisma.client.mailIngestConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.client.mailIngestConfig.create({ data: { ...data, passwordEnc: encryptSecret(input.password as string), tenantId: user.tenantId, createdBy: user.userId } });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "MAIL_INGEST_CONFIG", entity: "MailIngestConfig", entityId: row.id, detail: `${row.username}@${row.host}:${row.port} ${row.enabled ? "AÇIK" : "KAPALI"}${input.password ? " (parola güncellendi)" : ""}` });
    return this.serialize(row);
  }

  async remove(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "e-posta belge girişi ayarı");
    const existing = await this.prisma.client.mailIngestConfig.findUnique({ where: { tenantId: user.tenantId } });
    if (existing) await this.prisma.client.mailIngestConfig.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  async test(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "e-posta bağlantı testi");
    const row = await this.prisma.client.mailIngestConfig.findUnique({ where: { tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("Posta kutusu ayarı yok.");
    return this.imap.test(this.connectionOf(row));
  }

  /** Elle "şimdi çek" — kiracı için tek tur. */
  async runNow(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "e-posta belge girişi çalıştırma");
    const row = await this.prisma.client.mailIngestConfig.findUnique({ where: { tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("Posta kutusu ayarı yok.");
    return this.syncTenant(row.id);
  }

  /** Zamanlayıcı: etkin tüm kiracılar. */
  async syncAll(): Promise<{ tenants: number; outcomes: Array<{ tenantId: string } & IngestOutcome> }> {
    const rows = await this.prisma.client.mailIngestConfig.findMany({ where: { enabled: true }, select: { id: true, tenantId: true } });
    const outcomes: Array<{ tenantId: string } & IngestOutcome> = [];
    for (const r of rows) {
      outcomes.push({ tenantId: r.tenantId, ...(await this.syncTenant(r.id)) });
    }
    return { tenants: rows.length, outcomes };
  }

  async syncTenant(configId: string): Promise<IngestOutcome> {
    const row = await this.prisma.client.mailIngestConfig.findUnique({ where: { id: configId } });
    if (!row) throw new NotFoundException("Posta kutusu ayarı yok.");
    const outcome: IngestOutcome = { messages: 0, documents: 0, matched: 0, triage: 0, skipped: 0, errors: [] };
    let messages: FetchedMessage[];
    try {
      messages = await this.imap.fetchNew(this.connectionOf(row), row.lastUid, MAX_MESSAGES_PER_SYNC);
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      await this.prisma.client.mailIngestConfig.update({ where: { id: row.id }, data: { lastError: message, lastSyncAt: new Date() } });
      outcome.errors.push(message);
      return outcome;
    }
    // Yükleme, ayarı yapan kullanıcı adına yazılır (denetim izi kişiye bağlanır; kaynak EPOSTA).
    const actor: AuthUser = { userId: row.createdBy, tenantId: row.tenantId, role: "ADMIN" } as AuthUser;
    let maxUid = row.lastUid;
    for (const msg of messages) {
      outcome.messages += 1;
      maxUid = Math.max(maxUid, msg.uid);
      const caseId = await this.resolveCase(row.tenantId, `${msg.subject}\n${msg.text}`, row.defaultCaseId);
      if (msg.attachments.length === 0) {
        outcome.skipped += 1;
        continue;
      }
      for (const att of msg.attachments) {
        if (validateUpload(att.fileName, att.contentType)) {
          outcome.skipped += 1;
          continue;
        }
        try {
          const file = { buffer: att.content, size: att.size, originalname: att.fileName, mimetype: att.contentType } as Express.Multer.File;
          const res = await this.documents.upload(actor, file, {
            caseId: caseId ?? undefined,
            source: "EPOSTA",
            folderPath: "/E-posta",
            name: att.fileName,
          });
          if (res.duplicate) {
            outcome.skipped += 1;
            continue;
          }
          outcome.documents += 1;
          if (caseId) outcome.matched += 1;
          else outcome.triage += 1;
          await this.audit.log({
            tenantId: row.tenantId,
            userId: row.createdBy,
            action: "MAIL_INGEST_DOCUMENT",
            entity: "Document",
            entityId: res.document.id,
            detail: `${att.fileName} ← ${msg.from ?? "?"} · "${msg.subject.slice(0, 120)}"${caseId ? "" : " · TRİYAJ (dosya eşleşmedi)"}`,
          });
        } catch (err) {
          outcome.errors.push(`${att.fileName}: ${(err as Error).message.slice(0, 160)}`);
        }
      }
    }
    await this.prisma.client.mailIngestConfig.update({
      where: { id: row.id },
      data: {
        lastUid: maxUid,
        lastSyncAt: new Date(),
        lastError: outcome.errors.length > 0 ? outcome.errors.slice(0, 3).join(" | ").slice(0, 500) : null,
        lastSummary: `${outcome.messages} ileti, ${outcome.documents} belge (${outcome.matched} dosyaya bağlı, ${outcome.triage} triyaj), ${outcome.skipped} atlandı`,
      },
    });
    return outcome;
  }

  /** Dosya numarası → TEK eşleşen dosya; belirsizlik triyaja gider. */
  private async resolveCase(tenantId: string, text: string, defaultCaseId: string | null): Promise<string | null> {
    for (const fileNumber of extractFileNumbers(text)) {
      const hits = await this.prisma.client.case.findMany({ where: { tenantId, fileNumber }, select: { id: true }, take: 2 });
      if (hits.length === 1) return hits[0].id;
      if (hits.length > 1) {
        this.logger.warn(`E-posta belge girişi: "${fileNumber}" numaralı birden fazla dosya var; triyaja bırakıldı.`);
        return null;
      }
    }
    return defaultCaseId;
  }

  private connectionOf(row: { host: string; port: number; secure: boolean; username: string; passwordEnc: string; folder: string }): ImapConnection {
    return { host: row.host, port: row.port, secure: row.secure, username: row.username, password: decryptSecret(row.passwordEnc), folder: row.folder };
  }

  private serialize(row: { id: string; enabled: boolean; host: string; port: number; secure: boolean; username: string; folder: string; defaultCaseId: string | null; lastUid: number; lastSyncAt: Date | null; lastError: string | null; lastSummary: string | null; updatedAt: Date }) {
    return {
      configured: true,
      id: row.id,
      enabled: row.enabled,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      folder: row.folder,
      defaultCaseId: row.defaultCaseId,
      lastUid: row.lastUid,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
      lastSummary: row.lastSummary,
      updatedAt: row.updatedAt,
      hasPassword: true,
    };
  }
}
