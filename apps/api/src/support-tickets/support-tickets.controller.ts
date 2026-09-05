import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  SupportTicketsService,
  createTicketSchema,
  ticketMessageSchema,
  type CreateTicketInput,
  type TicketMessageInput,
} from "./support-tickets.service";

/** FAZ 8C — /support/tickets: büro destek talepleri (kiracı tarafı). */
@Controller("support/tickets")
export class SupportTicketsController {
  constructor(private readonly tickets: SupportTicketsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.tickets.list(user, status);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput) {
    return this.tickets.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tickets.detail(user, id);
  }

  @Post(":id/messages")
  @HttpCode(200)
  message(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ticketMessageSchema)) body: TicketMessageInput) {
    return this.tickets.addMessage(user, id, body);
  }

  @Post(":id/close")
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tickets.close(user, id);
  }
}
