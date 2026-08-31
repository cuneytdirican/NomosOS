import { Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { NotificationsService } from "./notifications.service";

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
