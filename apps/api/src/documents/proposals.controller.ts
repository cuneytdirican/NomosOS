import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ProposalsService } from "./proposals.service";
import {
  approveProposalSchema,
  rejectProposalSchema,
  type ApproveProposalInput,
  type RejectProposalInput,
} from "./documents.dto";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";

/**
 * ONAY KUYRUĞU UÇLARI.
 *
 * TOPLU ONAY UCU YOKTUR (`apply-all` bilinçli olarak eklenmemiştir): görev ve
 * süre kayıtları meslek sorumluluğu doğurur; her öneri kendi gerekçesi ve
 * kaynak alıntısı okunarak tek tek onaylanır.
 */
@Controller("proposals")
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  /** GET /api/v1/proposals?status=&caseId=&documentId=&type= */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    query: {
      status?: string;
      caseId?: string;
      documentId?: string;
      type?: string;
      page?: string;
      limit?: string;
    }
  ) {
    return this.proposals.list(user.tenantId, query);
  }

  /** GET /api/v1/proposals/:id */
  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.proposals.detail(user.tenantId, id);
  }

  /** POST /api/v1/proposals/:id/approve — öneriyi gerçek kayda çevirir. */
  @Post(":id/approve")
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(approveProposalSchema)) body: ApproveProposalInput
  ) {
    return this.proposals.approve(user, id, body);
  }

  /** POST /api/v1/proposals/:id/reject — gerekçe zorunlu. */
  @Post(":id/reject")
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectProposalSchema)) body: RejectProposalInput
  ) {
    return this.proposals.reject(user, id, body);
  }
}
