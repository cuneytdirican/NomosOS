import { Controller, Get, Header, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import type { AuthUser } from "../common/types";
import { AgendaService } from "./agenda.service";

/**
 * BİRLEŞİK AJANDA — duruşma, randevu, süre ve görev teslimi tek takvimde.
 *
 * GET /agenda?from=&to=&assigneeId=  — aralık olayları + gün meta verisi
 */
@Controller("agenda")
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  /**
   * Faz 1: ICS takvim aboneliği. Kişisel, uzun ömürlü (365 gün), imzalı bir
   * token üretir; Google/Outlook/Apple takvimi bu adrese "URL ile abone" olur.
   */
  @Post("feed-token")
  @HttpCode(200)
  feedToken(@CurrentUser() user: AuthUser) {
    return this.agenda.issueFeedToken(user);
  }

  /** @Public: takvim istemcisi çerez/başlık taşımaz; kimlik token'dadır. */
  @Public()
  @Get("feed.ics")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Cache-Control", "private, max-age=300")
  async feed(@Query("token") token?: string) {
    if (!token) throw new UnauthorizedException("token gerekli");
    return this.agenda.feedIcs(token);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("assigneeId") assigneeId?: string,
  ) {
    return this.agenda.agenda(user, { from, to, assigneeId });
  }
}
