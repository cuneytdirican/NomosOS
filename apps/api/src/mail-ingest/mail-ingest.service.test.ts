/**
 * FAZ 7A — e-posta ile belge girişi.
 *
 * Korunan taahhütler:
 *  1. Dosya numarası çıkarımı deterministik ("2026/145"); telefon/tarih gibi sayılar eşleşmez.
 *  2. Tek eşleşen dosya → o dosya; birden çok dosya aynı numarada → TRİYAJ (tahmin yok);
 *     eşleşme yoksa varsayılan dosya, o da yoksa triyaj.
 *  3. İzin verilmeyen uzantı (.exe) atlanır; ek yoksa ileti atlanır; UID imleci ilerler.
 *  4. Parola yanıtlarda dönmez; ilk kurulumda parola zorunlu; IMAP hatası lastError'a yazılır, iş düşmez.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { MailIngestService, extractFileNumbers } from "./mail-ingest.service";
import type { FetchedMessage, ImapClient } from "./imap-client";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { DocumentsService } from "../documents/documents.service";
import type { AuthUser } from "../common/types";

process.env.MASTER_ENCRYPTION_KEY ??= "a".repeat(64);

const ADMIN = { userId: "u-admin", tenantId: "buro-A", role: "ADMIN" } as AuthUser;

function msg(uid: number, subject: string, attachments: Array<{ fileName: string; contentType: string }>, text = ""): FetchedMessage {
  return { uid, messageId: `<m${uid}>`, from: "mahkeme@uyap.gov.tr", subject, date: new Date(), text, attachments: attachments.map((a) => ({ ...a, content: Buffer.from("x"), size: 1 })) };
}

function harness(opts: { messages?: FetchedMessage[]; cases?: Array<{ id: string; fileNumber: string }>; imapError?: string } = {}) {
  let config: Record<string, unknown> | null = null;
  const uploads: Record<string, unknown>[] = [];
  const client = {
    mailIngestConfig: {
      findUnique: vi.fn(async () => config),
      findMany: vi.fn(async () => (config && config.enabled ? [config] : [])),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        config = { id: "cfg-1", lastUid: 0, lastSyncAt: null, lastError: null, lastSummary: null, updatedAt: new Date(), ...data };
        return config;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        config = { ...(config ?? {}), ...data };
        return config;
      }),
      delete: vi.fn(async () => ({})),
    },
    case: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (opts.cases ?? []).find((c) => c.id === where.id) ?? null),
      findMany: vi.fn(async ({ where, take }: { where: { fileNumber: string }; take: number }) => (opts.cases ?? []).filter((c) => c.fileNumber === where.fileNumber).slice(0, take)),
    },
  };
  const imap: ImapClient = {
    test: vi.fn(async () => ({ ok: true, message: "ok" })),
    fetchNew: vi.fn(async () => {
      if (opts.imapError) throw new Error(opts.imapError);
      return opts.messages ?? [];
    }),
  };
  const documents = {
    upload: vi.fn(async (_u: AuthUser, file: { originalname: string }, input: Record<string, unknown>) => {
      uploads.push({ name: file.originalname, ...input });
      return { duplicate: false, document: { id: `doc-${uploads.length}` } };
    }),
  };
  const svc = new MailIngestService({ client } as unknown as PrismaService, { log: vi.fn(async () => undefined) } as unknown as AuditService, documents as unknown as DocumentsService, imap);
  return { svc, uploads, getConfig: () => config, imap };
}

describe("Faz 7A: extractFileNumbers", () => {
  it("dosya numarası biçimini yakalar, telefon/tarih gibi sayılara takılmaz", () => {
    expect(extractFileNumbers("Konu: 2026/145 E. sayılı dosya")).toEqual(["2026/145"]);
    expect(extractFileNumbers("E.2025/12 ve 2026/145 — tel 0532/123")).toEqual(["2025/12", "2026/145"]);
    expect(extractFileNumbers("Toplantı 12/03/2026, 1234567/8")).toEqual([]);
    expect(extractFileNumbers("")).toEqual([]);
  });
});

describe("Faz 7A: MailIngestService", () => {
  it("ilk kurulumda parola zorunlu; yanıt parolayı taşımaz", async () => {
    const h = harness();
    await expect(h.svc.upsert(ADMIN, { enabled: true, host: "imap.ornek.tr", port: 993, secure: true, username: "tebligat@buro.tr", folder: "INBOX" })).rejects.toBeInstanceOf(BadRequestException);
    const res = await h.svc.upsert(ADMIN, { enabled: true, host: "imap.ornek.tr", port: 993, secure: true, username: "tebligat@buro.tr", password: "gizli-parola", folder: "INBOX" });
    expect(JSON.stringify(res)).not.toContain("gizli-parola");
    expect(res).toMatchObject({ configured: true, hasPassword: true, host: "imap.ornek.tr" });
    expect(String(h.getConfig()?.passwordEnc)).not.toContain("gizli-parola");
  });

  it("eşleme: tek dosya → bağlı; çift dosya → triyaj (varsayılan olsa da); eşleşme yok → varsayılan dosya; .exe atlanır", async () => {
    const h = harness({
      cases: [
        { id: "case-1", fileNumber: "2026/145" },
        { id: "case-2a", fileNumber: "2026/7" },
        { id: "case-2b", fileNumber: "2026/7" },
        { id: "case-def", fileNumber: "2020/1" },
      ],
      messages: [
        msg(11, "2026/145 E. tebligat", [{ fileName: "tebligat.pdf", contentType: "application/pdf" }]),
        msg(12, "2026/7 karar", [{ fileName: "karar.pdf", contentType: "application/pdf" }]),
        msg(13, "ilgisiz", [{ fileName: "virus.exe", contentType: "application/octet-stream" }, { fileName: "ek.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]),
        msg(14, "eksiz ileti", []),
      ],
    });
    await h.svc.upsert(ADMIN, { enabled: true, host: "h", port: 993, secure: true, username: "u", password: "p", folder: "INBOX", defaultCaseId: "case-def" });
    const out = await h.svc.runNow(ADMIN);
    expect(out).toMatchObject({ messages: 4, documents: 3, matched: 2, triage: 1, skipped: 2 });
    expect(h.uploads.map((u) => [u.name, u.caseId])).toEqual([
      ["tebligat.pdf", "case-1"],
      ["karar.pdf", undefined], // numara GERÇEK dosyalarla çakışıyor → varsayılana değil TRİYAJA (tahmin yok)
      ["ek.docx", "case-def"], // eşleşme yok → varsayılan dosya
    ]);
    expect(h.uploads[0]).toMatchObject({ source: "EPOSTA", folderPath: "/E-posta" });
    expect(h.getConfig()?.lastUid).toBe(14);
    expect(h.getConfig()?.lastError).toBeNull();
  });

  it("varsayılan dosya yoksa belirsiz/eşleşmeyen ileti TRİYAJA gider", async () => {
    const h = harness({ cases: [{ id: "a", fileNumber: "2026/7" }, { id: "b", fileNumber: "2026/7" }], messages: [msg(1, "2026/7", [{ fileName: "x.pdf", contentType: "application/pdf" }])] });
    await h.svc.upsert(ADMIN, { enabled: true, host: "h", port: 993, secure: true, username: "u", password: "p", folder: "INBOX" });
    const out = await h.svc.runNow(ADMIN);
    expect(out).toMatchObject({ documents: 1, matched: 0, triage: 1 });
    expect(h.uploads[0].caseId).toBeUndefined();
  });

  it("IMAP hatası işi düşürmez; lastError yazılır ve UID imleci ilerlemez", async () => {
    const h = harness({ imapError: "AUTHENTICATIONFAILED" });
    await h.svc.upsert(ADMIN, { enabled: true, host: "h", port: 993, secure: true, username: "u", password: "p", folder: "INBOX" });
    const out = await h.svc.runNow(ADMIN);
    expect(out.errors[0]).toContain("AUTHENTICATIONFAILED");
    expect(h.getConfig()?.lastError).toContain("AUTHENTICATIONFAILED");
    expect(h.getConfig()?.lastUid).toBe(0);
    const all = await h.svc.syncAll();
    expect(all.tenants).toBe(1);
  });
});
