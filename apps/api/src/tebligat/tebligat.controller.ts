import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { TebligatService, createTebligatSchema, updateTebligatSchema, type CreateTebligatInput, type UpdateTebligatInput } from "./tebligat.service";

/**
 * Faz 6 — tebligat kayıtları.
 *   GET    /cases/:caseId/tebligatlar
 *   POST   /cases/:caseId/tebligatlar     (tebliğ tarihi + kural → süre otomatik)
 *   PATCH  /tebligatlar/:id · DELETE /tebligatlar/:id
 *   GET    /tebligatlar/saglayici          (KEP/UETS adaptör durumu)
 */
@Controller()
export class TebligatController {
  constructor(private readonly tebligat: TebligatService) {}

  @Get("cases/:caseId/tebligatlar")
  list(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.tebligat.list(user, caseId);
  }

  @Post("cases/:caseId/tebligatlar")
  create(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string, @Body(new ZodValidationPipe(createTebligatSchema)) body: CreateTebligatInput) {
    return this.tebligat.create(user, caseId, body);
  }

  @Get("tebligatlar/saglayici")
  saglayici() {
    return this.tebligat.saglayici();
  }

  @Patch("tebligatlar/:id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(updateTebligatSchema)) body: UpdateTebligatInput) {
    return this.tebligat.update(user, id, body);
  }

  @Delete("tebligatlar/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tebligat.remove(user, id);
  }
}
