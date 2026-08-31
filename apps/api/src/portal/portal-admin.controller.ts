import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RequiredUuidQuery } from "../common/pipes/required-uuid-query.pipe";
import type { AuthUser } from "../common/types";
import { PortalAdminService } from "./portal-admin.service";
import {
  portalBulkPublishSchema,
  portalInviteSchema,
  portalPublishSchema,
  type PortalBulkPublishInput,
  type PortalInviteInput,
  type PortalPublishInput,
} from "./portal.schemas";

/**
 * BÜRO TARAFI PORTAL YÖNETİMİ — `/api/v1/portal-admin/**`
 *
 * DÜZ `@Controller`'DIR, `@PortalController` DEĞİL: burası büro kullanıcısının
 * yüzüdür ve global büro zinciri (`JwtAuthGuard` → `TenantStatusGuard`) aynen
 * uygulanır. `@Public()` YOKTUR — bir portal token'ı bu uçlara ASLA giremez
 * (audience `tenant` beklenir).
 *
 * Yol öneki bilinçli olarak `portal-admin`'dir, `portal/admin` DEĞİL: portal
 * uçlarıyla aynı ağaç altında olsalardı, bir yönlendirme hatası ya da vekil
 * kuralı iki kimlik zincirini kolayca karıştırabilirdi. İki farklı kök, iki
 * farklı güvenlik zinciri.
 */
@Controller("portal-admin")
export class PortalAdminController {
  constructor(private readonly admin: PortalAdminService) {}

  /* ---------------------------- Kullanıcılar ---------------------------- */

  @Get("users")
  listUsers(@CurrentUser() user: AuthUser, @Query("clientId", RequiredUuidQuery("clientId", "Müvekkil")) clientId: string) {
    return this.admin.listUsers(user, clientId);
  }

  /** Davet üretir; HAM TOKEN yanıtta BİR KEZ döner. */
  @Post("invite")
  @HttpCode(201)
  invite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(portalInviteSchema)) body: PortalInviteInput
  ) {
    return this.admin.invite(user, body);
  }

  @Post("users/:id/deactivate")
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.deactivateUser(user, id);
  }

  @Post("users/:id/activate")
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.activateUser(user, id);
  }

  /* ------------------------------ Yayınlar ------------------------------ */

  @Get("publications")
  listPublications(
    @CurrentUser() user: AuthUser,
    @Query("clientId", RequiredUuidQuery("clientId", "Müvekkil")) clientId: string,
    @Query("resourceType") resourceType?: string,
    @Query("includeUnpublished") includeUnpublished?: string
  ) {
    return this.admin.listPublications(user, { clientId, resourceType, includeUnpublished });
  }

  @Post("publications")
  @HttpCode(201)
  publish(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(portalPublishSchema)) body: PortalPublishInput
  ) {
    return this.admin.publish(user, body);
  }

  /** Toplu yayın — yalnızca AÇIKÇA seçilmiş id'ler (en fazla 100). */
  @Post("publications/bulk")
  @HttpCode(201)
  publishBulk(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(portalBulkPublishSchema)) body: PortalBulkPublishInput
  ) {
    return this.admin.publishBulk(user, body);
  }

  /** Yayından kaldırır (kayıt silinmez, `unpublishedAt` damgalanır). */
  @Delete("publications/:id")
  @HttpCode(200)
  unpublish(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.admin.unpublish(user, id);
  }

  /** Yayın adayları: müvekkilin kaynakları + "yayında mı?" işareti. */
  @Get("publishable")
  publishable(
    @CurrentUser() user: AuthUser,
    @Query("clientId", RequiredUuidQuery("clientId", "Müvekkil")) clientId: string,
    @Query("resourceType") resourceType: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.admin.publishable(user, { clientId, resourceType, page, limit });
  }

  /* ------------------------------ Denetim ------------------------------- */

  /** "Müvekkil neyi, ne zaman gördü?" — KVKK denetim izi. */
  @Get("audit")
  auditTrail(
    @CurrentUser() user: AuthUser,
    @Query("clientId", RequiredUuidQuery("clientId", "Müvekkil")) clientId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.admin.auditTrail(user, { clientId, page, limit });
  }
}
