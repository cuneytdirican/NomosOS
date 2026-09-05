import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { NotificationsService, type NotificationPreferenceInput } from "./notifications.service";

const preferencesSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.string().min(1).max(60),
        inApp: z.boolean(),
        email: z.boolean(),
        push: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * `/api/v1/notifications` — KİRACI bildirim uçları.
 *
 * Global `JwtAuthGuard` (aud: "tenant") geçerlidir; `@Public()` YOKTUR.
 * Platform ve portal kimlikleri bu uçlara giremez — üç kimlik alanı karışmaz.
 *
 * ROL KISITI YOKTUR VE OLMAMALIDIR: bildirim kişiye özeldir; kullanıcı zaten
 * yalnız KENDİ bildirimlerini görür. Bir stajyerin kendi görev bildirimini
 * görmesini engellemek anlamsız olurdu. İçerik kısıtı ÜRETİM tarafındadır:
 * bildirim yalnız ilgili kişiye yazılır.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.notifications.list(user, { status, kind, unreadOnly, page, limit });
  }

  /**
   * Faz 2 — platform duyuruları (Announcement) kiracıya ulaşır: yayınlanmış,
   * süresi dolmamış ve hedefi bu büroyu (TUM / PLAN_BAZLI / TENANT_BAZLI) kapsayan
   * duyurular. Web şeridi bunu gösterir; kapatma istemci tarafında (yerel).
   */
  @Get("announcements")
  announcements(@CurrentUser() user: AuthUser) {
    return this.notifications.activeAnnouncements(user.tenantId);
  }

  /** Bildirim tercihleri — tür × kanal (Enterprise++). */
  @Get("preferences")
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user);
  }

  @Put("preferences")
  setPreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(preferencesSchema)) body: { items: NotificationPreferenceInput[] },
  ) {
    return this.notifications.setPreferences(user, body.items);
  }

  /** Rozet sayacı — liste ucunu çekmeden okunmamış adedini verir. */
  @Get("unread-count")
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { unreadCount: await this.notifications.unreadCount(user) };
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Patch(":id/read")
  markRead(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.notifications.markRead(user, id);
  }
}
