/**
 * Büro içi mesajlaşma servisi.
 *
 * VARLIK DURUMU: lastSeenAt kalp atışıyla (POST /chat/heartbeat) tazelenir;
 * ONLINE_WINDOW_MS içinde vuruş varsa kullanıcı "çevrimiçi" görünür.
 *
 * "YAZIYOR…" göstergesi: süreç içi Map (peer → son yazma anı), TTL'li.
 *
 * EKLER: Document olarak saklanır (kota sayacına işler). İki yol:
 *   1) presign + yükleyip attachment.meta gönderme,
 *   2) multipart doğrudan yükleme.
 *
 * ARAMA: WebRTC sinyalleri OfficeCallSignal tablosunda kuyruklanır; istemciler
 * polling ile çeker. Ortam akışı P2P'dir (STUN ile NAT aşılır; TURN yoktur).
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@nomosos/db";
import type { AuthUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { DiskQuotaService } from "../disk-quota/disk-quota.service";
import { AuditService } from "../audit/audit.service";
import type { SendMessageInput } from "./chat.controller";

export const ONLINE_WINDOW_MS = 60_000;
export const TYPING_TTL_MS = 4_000;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const HISTORY_LIMIT = 100;

/** süreç içi "yazıyor" durumu: `${tenantId}:${userId}` → peer → son an. */
const typingUntil = new Map<string, Map<string, number>>();

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly diskQuota: DiskQuotaService,
    private readonly audit: AuditService,
  ) {}

  /* --------------------------- Kişiler / durum --------------------------- */

  private typingKey(user: AuthUser) {
    return `${user.tenantId}:${user.userId}`;
  }

  typing(user: AuthUser, peerId: string): void {
    let peers = typingUntil.get(this.typingKey(user));
    if (!peers) {
      peers = new Map();
      typingUntil.set(this.typingKey(user), peers);
    }
    peers.set(peerId, Date.now());
  }

  private isTypingTo(tenantId: string, userId: string, peerId: string): boolean {
    const peers = typingUntil.get(`${tenantId}:${userId}`);
    if (!peers) return false;
    const until = peers.get(peerId);
    if (until === undefined) return false;
    if (until < Date.now()) {
      peers.delete(peerId);
      return false;
    }
    return true;
  }

  async heartbeat(user: AuthUser) {
    await this.prisma.client.user.update({
      where: { id: user.userId },
      data: { lastSeenAt: new Date() },
    });
    return { ok: true, at: new Date().toISOString() };
  }

  private async usersWithPresence(tenantId: string) {
    const now = Date.now();
    const users = await this.prisma.client.user.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        fullName: true,
        role: true,
        avatarStorageKey: true,
        lastSeenAt: true,
      },
      orderBy: { fullName: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      hasAvatar: u.avatarStorageKey !== null,
      online: u.lastSeenAt !== null && now - u.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
      lastSeenAt: u.lastSeenAt,
    }));
  }

  async contacts(user: AuthUser) {
    const users = await this.usersWithPresence(user.tenantId);
    return users.filter((u) => u.id !== user.userId);
  }

  /* ------------------------------ Sohbetler ------------------------------ */

  /** Sohbet listesi: her eş için son mesaj, okunmamış sayısı, durum. */
  async threads(user: AuthUser) {
    const peers = await this.usersWithPresence(user.tenantId);

    // Son 30 günün mesajları üzerinden son mesaj + okunmamış hesabı (hızlı yol).
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const recent = await this.prisma.client.officeMessage.findMany({
      where: {
        tenantId: user.tenantId,
        createdAt: { gte: since },
        OR: [{ senderId: user.userId }, { recipientId: user.userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 800,
    });

    const readStates = await this.prisma.client.officeReadState.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
    });
    const lastReadAtByPeer = new Map(readStates.map((r) => [r.peerId, r.lastReadAt]));

    interface ThreadAgg {
      lastMessageAt: Date;
      lastMessageId: string;
      lastContent: string | null;
      lastFromMe: boolean;
      unread: number;
      hasAttachment: boolean;
    }
    const threads = new Map<string, ThreadAgg>();
    for (const m of recent) {
      const peerId = m.senderId === user.userId ? m.recipientId : m.senderId;
      if (peerId === user.userId) continue; // kendine mesaj yok
      const existing = threads.get(peerId);
      const unreadInc =
        m.recipientId === user.userId &&
        m.createdAt > (lastReadAtByPeer.get(peerId) ?? new Date(0))
          ? 1
          : 0;
      if (!existing) {
        threads.set(peerId, {
          lastMessageAt: m.createdAt,
          lastMessageId: m.id,
          lastContent: m.content,
          lastFromMe: m.senderId === user.userId,
          unread: unreadInc,
          hasAttachment: m.attachmentId !== null,
        });
      } else {
        existing.unread += unreadInc;
      }
    }

    return peers
      .filter((p) => p.id !== user.userId)
      .map((p) => {
        const t = threads.get(p.id);
        return {
          peer: p,
          lastMessage: t
            ? {
                id: t.lastMessageId,
                content: t.lastContent,
                fromMe: t.lastFromMe,
                hasAttachment: t.hasAttachment,
                createdAt: t.lastMessageAt,
              }
            : null,
          unread: t?.unread ?? 0,
          typing: this.isTypingTo(user.tenantId, p.id, user.userId),
        };
      })
      .sort((a, b) => {
        if (a.lastMessage === null && b.lastMessage === null) return a.peer.fullName.localeCompare(b.peer.fullName, "tr");
        if (a.lastMessage === null) return 1;
        if (b.lastMessage === null) return -1;
        return b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime();
      });
  }

  /** Mesaj geçmişi — before (sayfalama) veya after (artımlı polling). */
  async messages(
    user: AuthUser,
    params: { peerId: string; before?: string; after?: string; limit?: string },
  ) {
    const peer = await this.prisma.client.user.findFirst({
      where: { id: params.peerId, tenantId: user.tenantId, isActive: true },
      select: { id: true, fullName: true, role: true, avatarStorageKey: true, lastSeenAt: true },
    });
    if (!peer) throw new NotFoundException("Kullanıcı bulunamadı.");

    const limit = Math.min(Math.max(parseInt(params.limit ?? "50", 10) || 50, 1), HISTORY_LIMIT);
    const where: Prisma.OfficeMessageWhereInput = {
      tenantId: user.tenantId,
      OR: [
        { senderId: user.userId, recipientId: peer.id },
        { senderId: peer.id, recipientId: user.userId },
      ],
      ...(params.before ? { createdAt: { lt: new Date(params.before) } } : {}),
      ...(params.after ? { createdAt: { gt: new Date(params.after) } } : {}),
    };
    const rows = await this.prisma.client.officeMessage.findMany({
      where,
      orderBy: { createdAt: params.after ? "asc" : "desc" },
      take: limit,
      include: {
        attachment: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
      },
    });
    const ordered = params.after ? rows : rows.slice().reverse();

    const now = Date.now();
    return {
      peer: {
        id: peer.id,
        fullName: peer.fullName,
        role: peer.role,
        hasAvatar: peer.avatarStorageKey !== null,
        online: peer.lastSeenAt !== null && now - peer.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
        typing: this.isTypingTo(user.tenantId, peer.id, user.userId),
      },
      messages: ordered.map((m) => ({
        id: m.id,
        fromMe: m.senderId === user.userId,
        content: m.content,
        attachment: m.attachmentId
          ? {
              documentId: m.attachment!.id,
              name: m.attachment!.name,
              mimeType: m.attachment!.mimeType,
              sizeBytes: m.attachment!.sizeBytes,
            }
          : null,
        createdAt: m.createdAt,
      })),
      hasMoreBefore: !params.after && rows.length === limit,
    };
  }

  /* ------------------------------ Gönderme ------------------------------ */

  async presignAttachment(
    user: AuthUser,
    input: { fileName: string; mimeType: string; sizeBytes: number },
  ) {
    if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException("Ek en fazla 50 MB olabilir.");
    }
    // Kota kapısı — ek de disk kotasına işler.
    await this.diskQuota.assertCanStore(user.tenantId, input.sizeBytes);
    const key = `chat/${user.tenantId}/${Date.now()}-${randomBytes(6).toString("hex")}-${input.fileName.replace(/[^\w.\-ğüşöçıİĞÜŞÖÇ ]/g, "_").slice(0, 120)}`;
    const uploadUrl = await this.storage.getPresignedUploadUrl(key, 600, input.mimeType);
    return {
      uploadUrl,
      method: "PUT" as const,
      headers: { "Content-Type": input.mimeType },
      storageKey: key,
      expiresIn: 600,
    };
  }

  async send(user: AuthUser, input: SendMessageInput, file?: Express.Multer.File) {
    const peer = await this.prisma.client.user.findFirst({
      where: { id: input.peerId, tenantId: user.tenantId, isActive: true },
      select: { id: true },
    });
    if (!peer) throw new NotFoundException("Alıcı bulunamadı.");
    if (peer.id === user.userId) {
      throw new BadRequestException("Kendinize mesaj gönderemezsiniz.");
    }

    let documentId: string | null = null;
    let attachmentMeta: { fileName: string; mimeType: string; sizeBytes: number } | null = null;

    if (file) {
      await this.sendAttachmentFromBuffer(user, {
        fileName: file.originalname,
        mimeType: file.mimetype || "application/octet-stream",
        sizeBytes: file.size,
        buffer: file.buffer,
      }).then((d) => {
        documentId = d.documentId;
      });
    } else if (input.attachment) {
      const doc = await this.sendAttachmentFromMeta(user, input.attachment);
      documentId = doc.documentId;
      attachmentMeta = doc.meta;
    }

    const message = await this.prisma.client.officeMessage.create({
      data: {
        tenantId: user.tenantId,
        senderId: user.userId,
        recipientId: peer.id,
        content: input.content ?? null,
        attachmentId: documentId,
      },
    });
    void attachmentMeta;
    return {
      id: message.id,
      fromMe: true,
      content: message.content,
      attachment: documentId ? { documentId } : null,
      createdAt: message.createdAt,
    };
  }

  private async sendAttachmentFromMeta(
    user: AuthUser,
    meta: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number },
  ): Promise<{ documentId: string; meta: typeof meta }> {
    if (!meta.storageKey.startsWith(`chat/${user.tenantId}/`)) {
      throw new ForbiddenException("Ek anahtarı bu büroya ait değil.");
    }
    await this.diskQuota.assertCanStore(user.tenantId, meta.sizeBytes);
    const doc = await this.createAttachmentDocument(user, meta.storageKey, meta);
    return { documentId: doc.id, meta };
  }

  private async sendAttachmentFromBuffer(
    user: AuthUser,
    meta: { fileName: string; mimeType: string; sizeBytes: number; buffer: Buffer },
  ): Promise<{ documentId: string }> {
    if (meta.sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException("Ek en fazla 50 MB olabilir.");
    }
    await this.diskQuota.assertCanStore(user.tenantId, meta.sizeBytes);
    const key = `chat/${user.tenantId}/${Date.now()}-${randomBytes(6).toString("hex")}-${meta.fileName.replace(/[^\w.\-ğüşöçıİĞÜŞÖÇ ]/g, "_").slice(0, 120)}`;
    await this.storage.putObject(key, meta.buffer, meta.mimeType);
    const doc = await this.createAttachmentDocument(user, key, meta);
    return { documentId: doc.id };
  }

  private async createAttachmentDocument(
    user: AuthUser,
    storageKey: string,
    meta: { fileName: string; mimeType: string; sizeBytes: number },
  ) {
    const doc = await this.prisma.client.document.create({
      data: {
        tenantId: user.tenantId,
        caseId: null,
        name: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        storageKey,
        source: "SISTEM",
      },
      select: { id: true },
    });
    await this.diskQuota.recordUsage(user.tenantId, meta.sizeBytes);
    return doc;
  }

  /* ------------------------------- Okundu ------------------------------- */

  async markRead(user: AuthUser, input: { peerId: string; lastReadMessageId: string }) {
    const message = await this.prisma.client.officeMessage.findFirst({
      where: {
        id: input.lastReadMessageId,
        tenantId: user.tenantId,
        OR: [{ senderId: user.userId }, { recipientId: user.userId }],
      },
      select: { id: true, createdAt: true },
    });
    if (!message) throw new NotFoundException("Mesaj bulunamadı.");

    await this.prisma.client.officeReadState.upsert({
      where: {
        tenantId_userId_peerId: {
          tenantId: user.tenantId,
          userId: user.userId,
          peerId: input.peerId,
        },
      },
      create: {
        tenantId: user.tenantId,
        userId: user.userId,
        peerId: input.peerId,
        lastReadMessageId: message.id,
        lastReadAt: message.createdAt,
      },
      update: {
        lastReadMessageId: message.id,
        lastReadAt: message.createdAt,
      },
    });
    return { ok: true };
  }

  /* ---------------------------- Video arama ---------------------------- */

  async startCall(user: AuthUser, calleeId: string) {
    const callee = await this.prisma.client.user.findFirst({
      where: { id: calleeId, tenantId: user.tenantId, isActive: true },
      select: { id: true, fullName: true },
    });
    if (!callee) throw new NotFoundException("Aranship yapmak istediğiniz kullanıcı bulunamadı.");
    if (callee.id === user.userId) {
      throw new BadRequestException("Kendinizi arayamazsınız.");
    }
    const existing = await this.prisma.client.officeCall.findFirst({
      where: {
        tenantId: user.tenantId,
        status: "RINGING",
        OR: [{ callerId: user.userId }, { calleeId: user.userId }],
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException("Zaten çalan bir aramanız var. Önce onu kapatın.");
    }
    const call = await this.prisma.client.officeCall.create({
      data: {
        tenantId: user.tenantId,
        callerId: user.userId,
        calleeId,
      },
    });
    return { callId: call.id, callee: { id: callee.id, fullName: callee.fullName } };
  }

  private async loadCall(user: AuthUser, id: string) {
    const call = await this.prisma.client.officeCall.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!call) throw new NotFoundException("Arama bulunamadı.");
    if (call.callerId !== user.userId && call.calleeId !== user.userId) {
      throw new ForbiddenException("Bu aramanın tarafı değilsiniz.");
    }
    return call;
  }

  async incomingCalls(user: AuthUser) {
    // 60 sn'den eski RINGING aramalar MISSED sayılır.
    const staleBefore = new Date(Date.now() - 60_000);
    const expired = await this.prisma.client.officeCall.updateMany({
      where: { tenantId: user.tenantId, status: "RINGING", createdAt: { lt: staleBefore } },
      data: { status: "MISSED", endedAt: new Date() },
    });
    if (expired.count > 0) {
      this.logger.log(`${expired.count} cevapsız arama MISSED olarak kapatıldı.`);
    }
    const rows = await this.prisma.client.officeCall.findMany({
      where: { tenantId: user.tenantId, calleeId: user.userId, status: "RINGING" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { caller: { select: { id: true, fullName: true } } },
    });
    return rows.map((c) => ({
      callId: c.id,
      from: c.caller,
      createdAt: c.createdAt,
    }));
  }

  async callStatus(user: AuthUser, id: string) {
    const call = await this.loadCall(user, id);
    return {
      callId: call.id,
      status: call.status,
      isCaller: call.callerId === user.userId,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
    };
  }

  async acceptCall(user: AuthUser, id: string) {
    const call = await this.loadCall(user, id);
    if (call.calleeId !== user.userId) throw new ForbiddenException("Sadece aranan kişi açabilir.");
    if (call.status !== "RINGING") throw new BadRequestException("Arama zaten kapalı.");
    return this.prisma.client.officeCall.update({
      where: { id },
      data: { status: "ACTIVE", startedAt: new Date() },
    });
  }

  async rejectCall(user: AuthUser, id: string) {
    const call = await this.loadCall(user, id);
    if (call.calleeId !== user.userId) throw new ForbiddenException("Sadece aranan kişi reddedebilir.");
    if (call.status !== "RINGING") throw new BadRequestException("Arama zaten kapalı.");
    return this.prisma.client.officeCall.update({
      where: { id },
      data: { status: "REJECTED", endedAt: new Date() },
    });
  }

  async endCall(user: AuthUser, id: string) {
    await this.loadCall(user, id);
    return this.prisma.client.officeCall.update({
      where: { id },
      data: { status: "ENDED", endedAt: new Date() },
    });
  }

  async postSignal(
    user: AuthUser,
    id: string,
    input: { kind: "OFFER" | "ANSWER" | "CANDIDATE"; payload: string },
  ) {
    const call = await this.loadCall(user, id);
    if (call.status !== "RINGING" && call.status !== "ACTIVE") {
      throw new BadRequestException("Kapalı aramaya sinyal gönderilemez.");
    }
    const signal = await this.prisma.client.officeCallSignal.create({
      data: {
        callId: id,
        fromUserId: user.userId,
        kind: input.kind,
        payloadJson: input.payload,
      },
    });
    return { id: signal.id };
  }

  async getSignals(user: AuthUser, id: string, after?: string) {
    await this.loadCall(user, id);
    const rows = await this.prisma.client.officeCallSignal.findMany({
      where: {
        callId: id,
        fromUserId: { not: user.userId },
        ...(after ? { createdAt: { gt: new Date(after) } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return {
      signals: rows.map((s) => ({
        id: s.id,
        kind: s.kind,
        payload: s.payloadJson,
        createdAt: s.createdAt,
      })),
    };
  }
}
