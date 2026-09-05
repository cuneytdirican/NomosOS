import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { createCaseSchema, type CreateCaseInput } from "@nomosos/shared";
import { CasesService } from "./cases.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  changeCaseStatusSchema,
  createCaseDecisionSchema,
  createCaseNoteSchema,
  createCasePartySchema,
  createTimelineEventSchema,
  setCaseMembersSchema,
  updateCaseNoteSchema,
  updateCaseSchema,
  type ChangeCaseStatusInput,
  type CreateCaseDecisionInput,
  type CreateCaseNoteInput,
  type CreateCasePartyInput,
  type CreateTimelineEventInput,
  type SetCaseMembersInput,
  type UpdateCaseInput,
  type UpdateCaseNoteInput,
} from "./cases.dto";

@Controller("cases")
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("q") q?: string,
    @Query("clientId") clientId?: string,
    @Query("responsibleUserId") responsibleUserId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string
  ) {
    return this.casesService.list(user.tenantId, { status, type, q, clientId, responsibleUserId, page, limit }, user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createCaseSchema)) body: CreateCaseInput) {
    return this.casesService.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.casesService.detail(user.tenantId, id, user);
  }

  // ---------- Gizli dosya erişim listesi (Enterprise++) ----------

  @Get(":id/members")
  listMembers(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.casesService.listMembers(user, id);
  }

  @Put(":id/members")
  setMembers(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setCaseMembersSchema)) body: SetCaseMembersInput
  ) {
    return this.casesService.setMembers(user, id, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCaseSchema)) body: UpdateCaseInput
  ) {
    return this.casesService.update(user, id, body);
  }

  @Patch(":id/status")
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(changeCaseStatusSchema)) body: ChangeCaseStatusInput
  ) {
    return this.casesService.changeStatus(user, id, body);
  }

  // ---------- Safahat ----------

  @Get(":id/timeline")
  listTimeline(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.casesService.listTimeline(user.tenantId, id);
  }

  @Post(":id/timeline")
  createTimelineEvent(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createTimelineEventSchema)) body: CreateTimelineEventInput
  ) {
    return this.casesService.createTimelineEvent(user, id, body);
  }

  // ---------- Notlar ----------

  @Get(":id/notes")
  listNotes(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.casesService.listNotes(user.tenantId, id);
  }

  @Post(":id/notes")
  createNote(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCaseNoteSchema)) body: CreateCaseNoteInput
  ) {
    return this.casesService.createNote(user, id, body);
  }

  // ---------- Kararlar ----------

  @Get(":id/decisions")
  listDecisions(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.casesService.listDecisions(user.tenantId, id);
  }

  @Post(":id/decisions")
  createDecision(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCaseDecisionSchema)) body: CreateCaseDecisionInput
  ) {
    return this.casesService.createDecision(user, id, body);
  }

  // ---------- Taraflar ----------

  @Post(":id/parties")
  createParty(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCasePartySchema)) body: CreateCasePartyInput
  ) {
    return this.casesService.createParty(user, id, body);
  }
}

/** Not kayıtları dosyadan bağımsız da adreslenir: /notes/:id */
@Controller("notes")
export class CaseNotesController {
  constructor(private readonly casesService: CasesService) {}

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCaseNoteSchema)) body: UpdateCaseNoteInput
  ) {
    return this.casesService.updateNote(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.casesService.removeNote(user, id);
  }
}
