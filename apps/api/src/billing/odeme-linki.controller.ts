import { Controller, Get, Param, Post } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { OdemeLinkiService } from "./odeme-linki.service";

/**
 * E8 — ÖDEME BAĞLAMASI UÇLARI.
 *
 * Büro tarafı JWT ister (PaymentsService ile aynı yetki hattı);
 * `/portal/odeme/*` uçları HERKESAÇIKTIR — token (32 bayt rastgele) bağlantının
 * kendisi yetkidir; bağlantıya sahip olan müvekkil öder.
 */
@Controller()
export class OdemeLinkiController {
  constructor(private readonly odemeLinki: OdemeLinkiService) {}

  /** POST /billing/invoices/:id/odeme-linki — bağlantı üretimi (büro). */
  @Post("billing/invoices/:id/odeme-linki")
  create(@CurrentUser() user: AuthUser, @Param("id") invoiceId: string) {
    return this.odemeLinki.create(user, invoiceId);
  }

  /** GET /portal/odeme/:token — fatura bilgisi (public). */
  @Get("portal/odeme/:token")
  @Public()
  view(@Param("token") token: string) {
    return this.odemeLinki.view(token);
  }

  /** POST /portal/odeme/:token/ode — ödeme (public; sağlayıcı SIMULASYON/503). */
  @Post("portal/odeme/:token/ode")
  @Public()
  pay(@Param("token") token: string) {
    return this.odemeLinki.pay(token);
  }
}
