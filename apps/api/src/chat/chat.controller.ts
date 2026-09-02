/**
 * BÜRO İÇİ MESAJLAŞMA (WhatsApp tarzı).
 *
 * UÇLAR:
 *   GET  /chat/contacts              — tüm büro kullanıcıları (çevrimiçi + avatar)
 *   GET  /chat/threads               — sohbet listesi (son mesaj, okunmayan, yazıyor, çevrimiçi)
 *   GET  /chat/messages?peerId=      — geçmiş (before/after ile sayfalama/artımlı)
 *   POST /chat/messages              — gönder (metin ve/veya ek)
 *   POST /chat/messages/presign     — ek için ön-imzalı yükleme adresi
 *   PATCH /chat/read                 — okundu işaretle
 *   POST /chat/heartbeat             — çevrimiçi kalp atışı
 *   POST /chat/typing                — "yazıyor…" göstergesi
 *   POST /chat/avatar/presign        — profil fotoğrafı yükleme adresi
 *   PATCH /chat/avatar               — profil fotoğrafını bağla
 *   GET  /chat/users/:id/avatar      — profil fotoğrafı (ön-imzalı indirme)
 *   POST /chat/calls                 — arama başlat (RINGING)
 *   GET  /chat/calls/incoming        — gelen çağrı (polling)
 *   POST /chat/calls/:id/accept|reject|end
 *   GET  /chat/calls/:id             — durum (polling)
 *   POST /chat/calls/:id/signals     — WebRTC sinyali gönder (offer/answer/candidate)
 *   GET  /chat/calls/:id/signals     — WebRTC sinyallerini çek (after= ile)
 *
 * ÜRÜN İLKESİ — MESAJ SİLME YOK. Bu denetleyicide Delete ucu YOKTUR ve
 * OfficeMessage modelinde deletedAt alanı yoktur. Büro içi yazışma denetim
 * izidir; sözleşme testi (chat.contract.test.ts) Delete ucunun yokluğunu ve
 * modelde deletedAt bulunmadığını doğrular.
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Observable } from "rxjs";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ChatService, ONLINE_WINDOW_MS, TYPING_TTL_MS } from "./chat.service";
import { ChatEventsService } from "./chat-events.service";
import { StorageService } from "../storage/storage.service";
import { DiskQuotaService } from "../disk-quota/disk-quota.service";
import { PrismaService } from "../prisma/prisma.service";

const sendMessageSchema = z
  .object({
    peerId: z.string().uuid("Geçerli bir kullanıcı kimliği gönderin."),
    content: z.string().trim().max(5000).optional(),
    attachment: z
      .object({
        storageKey: z.string().trim().min(5).max(500),
        fileName: z.string().trim().min(1).max(300),
        mimeType: z.string().trim().min(3).max(120),
        sizeBytes: z.number().int().positive(),
      })
      .optional(),
  })
  .refine((v) => (v.content && v.content.length > 0) || v.attachment, {
    message: "Mesaj metni veya ek gönderilmelidir.",
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
});

const readSchema = z.object({
  peerId: z.string().uuid("Geçerli bir kullanıcı kimliği gönderin."),
  lastReadMessageId: z.string().uuid("Geçerli bir mesaj kimliği gönderin."),
});

const typingSchema = z.object({
  peerId: z.string().uuid("Geçerli bir kullanıcı kimliği gönderin."),
});

const startCallSchema = z.object({
  calleeId: z.string().uuid("Geçerli bir kullanıcı kimliği gönderin."),
});

const signalSchema = z.object({
  kind: z.enum(["OFFER", "ANSWER", "CANDIDATE"]),
  payload: z.string().min(2).max(20_000),
});

const avatarSchema = z.object({
  storageKey: z.string().trim().min(5).max(500),
});

@Controller("chat")
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly storage: StorageService,
    private readonly diskQuota: DiskQuotaService,
    private readonly prisma: PrismaService,
    private readonly events: ChatEventsService,
  ) {}

  @Get("contacts")
  contacts(@CurrentUser() user: AuthUser) {
    return this.chat.contacts(user);
  }

  @Get("threads")
  threads(@CurrentUser() user: AuthUser) {
    return this.chat.threads(user);
  }

  @Get("messages")
  messages(
    @CurrentUser() user: AuthUser,
    @Query("peerId") peerId?: string,
    @Query("before") before?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string,
  ) {
    if (!peerId) throw new BadRequestException("peerId zorunludur.");
    return this.chat.messages(user, { peerId, before, after, limit });
  }

  @Post("messages")
  @UseInterceptors(FileInterceptor("file"))
  async send(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // Ek DOĞRUDAN yüklemeyi de destekler (multipart): presign atlamak isteyen
    // istemci için. Gövdede attachment varsa oradan, yoksa dosyadan gelir.
    const sent = await this.chat.send(user, body, file);
    // D3 / C4: bağlı istemcilere "yeni mesaj" sinyali — polling beklemesine
    // düşmeden sohbet listesi tazelenir. Sinyal içerik taşımaz (KVKK).
    this.events.publish(user.tenantId, {
      type: "chat.message",
      by: user.userId,
      to: body.peerId,
      at: Date.now(),
    });
    return sent;
  }

  /**
   * D3 / C4 — SSE AKIŞI: GET /chat/stream.
   *
   * KİMLİK: EventSource başlık GÖNDEREMEZ; İ-46 httpOnly oturum çerezi
   * tarayıcı tarafından otomatik taşınır (guard çerezden okur — bkz.
   * jwt-auth.guard.ts). Mobil istemci akışı kullanmaz; polling sürer.
   *
   * YENİDEN BAĞLANMA: EventSource yerel olarak yeniden bağlanır; sunucu
   * tarafında 55 sn'de bir yorum satırı (keep-alive) gönderilir ki ters
   * vekil (nginx 60 sn) boşta bağlantıyı kapatmasın.
   */
  @Sse("stream")
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.events.subscribe(user.tenantId, (event) => {
        subscriber.next({ data: event } as MessageEvent);
      });
      // Keep-alive: 25 sn'de bir yorum — vekil zaman aşımından önce.
      const keepAlive = setInterval(() => {
        subscriber.next({ data: { type: "chat.ping", at: Date.now() } } as MessageEvent);
      }, 25_000);
      return () => {
        clearInterval(keepAlive);
        unsubscribe();
      };
    });
  }

  /** Ek için ön-imzalı yükleme adresi — istemci önce baytı yazar, sonra gönderir. */
  @Post("messages/presign")
  presignAttachment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(presignSchema)) body: z.infer<typeof presignSchema>,
  ) {
    return this.chat.presignAttachment(user, body);
  }

  @Patch("read")
  markRead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(readSchema)) body: z.infer<typeof readSchema>,
  ) {
    return this.chat.markRead(user, body);
  }

  @Post("heartbeat")
  @HttpCode(200)
  heartbeat(@CurrentUser() user: AuthUser) {
    return this.chat.heartbeat(user);
  }

  @Post("typing")
  @HttpCode(204)
  typing(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(typingSchema)) body: z.infer<typeof typingSchema>,
  ) {
    this.chat.typing(user, body.peerId);
  }

  /* ------------------------- Profil fotoğrafı ------------------------- */

  @Post("avatar/presign")
  avatarPresign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(presignSchema)) body: z.infer<typeof presignSchema>,
  ) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(body.mimeType)) {
      throw new BadRequestException("Profil fotoğrafı yalnız JPEG, PNG veya WebP olabilir.");
    }
    if (body.sizeBytes > 5 * 1024 * 1024) {
      throw new BadRequestException("Profil fotoğrafı en fazla 5 MB olabilir.");
    }
    const key = `avatars/${user.tenantId}/${user.userId}/${randomBytes(8).toString("hex")}`;
    return this.storage.getPresignedUploadUrl(key, 300, body.mimeType).then((uploadUrl) => ({
      uploadUrl,
      method: "PUT" as const,
      headers: { "Content-Type": body.mimeType },
      storageKey: key,
      expiresIn: 300,
    }));
  }

  @Patch("avatar")
  async setAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(avatarSchema)) body: z.infer<typeof avatarSchema>,
  ) {
    // Kendi avatarı yalnız kendi önekine yazılabilir (başka kiracının avatarı
    // üzerine geçme denemesi burada kırılır).
    if (!body.storageKey.startsWith(`avatars/${user.tenantId}/${user.userId}/`)) {
      throw new ForbiddenException("Profil fotoğrafı anahtarı kullanıcıya ait değil.");
    }
    await this.prisma.client.user.update({
      where: { id: user.userId },
      data: { avatarStorageKey: body.storageKey },
    });
    return { ok: true };
  }

  @Get("users/:id/avatar")
  async userAvatar(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const target = await this.prisma.client.user.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { avatarStorageKey: true },
    });
    if (!target?.avatarStorageKey) throw new NotFoundException("Profil fotoğrafı yok.");
    const url = await this.storage.getPresignedDownloadUrl(target.avatarStorageKey, 3600);
    return { url };
  }

  /* --------------------------- Video arama ---------------------------- */

  @Post("calls")
  startCall(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(startCallSchema)) body: z.infer<typeof startCallSchema>,
  ) {
    return this.chat.startCall(user, body.calleeId);
  }

  @Get("calls/incoming")
  incomingCalls(@CurrentUser() user: AuthUser) {
    return this.chat.incomingCalls(user);
  }

  @Get("calls/:id")
  callStatus(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.callStatus(user, id);
  }

  @Post("calls/:id/accept")
  @HttpCode(200)
  acceptCall(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.acceptCall(user, id);
  }

  @Post("calls/:id/reject")
  @HttpCode(200)
  rejectCall(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.rejectCall(user, id);
  }

  @Post("calls/:id/end")
  @HttpCode(200)
  endCall(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.endCall(user, id);
  }

  @Post("calls/:id/signals")
  @HttpCode(201)
  postSignal(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(signalSchema)) body: z.infer<typeof signalSchema>,
  ) {
    return this.chat.postSignal(user, id, body);
  }

  @Get("calls/:id/signals")
  getSignals(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("after") after?: string,
  ) {
    return this.chat.getSignals(user, id, after);
  }
}

/** Sözleşme sabitleri — test bunları okur (chat.contract.test.ts). */
export const CHAT_CONTRACT = {
  ONLINE_WINDOW_MS,
  TYPING_TTL_MS,
  /** MESAJ SİLME YOK — bu katalogda delete ucu YOKTUR. */
  hasDeleteEndpoint: false as const,
} as const;
