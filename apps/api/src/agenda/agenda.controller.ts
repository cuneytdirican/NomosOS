import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
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
