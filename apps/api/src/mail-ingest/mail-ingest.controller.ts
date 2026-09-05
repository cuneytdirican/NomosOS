import { Body, Controller, Delete, Get, HttpCode, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { MailIngestService, mailIngestConfigSchema, type MailIngestConfigInput } from "./mail-ingest.service";

/** FAZ 7A — /settings/mail-ingest (ADMIN/PARTNER): IMAP posta kutusu ayarı, test, elle çekim. */
@Controller("settings/mail-ingest")
export class MailIngestController {
  constructor(private readonly mailIngest: MailIngestService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.mailIngest.get(user);
  }

  @Put()
  upsert(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(mailIngestConfigSchema)) body: MailIngestConfigInput) {
    return this.mailIngest.upsert(user, body);
  }

  @Delete()
  remove(@CurrentUser() user: AuthUser) {
    return this.mailIngest.remove(user);
  }

  @Post("test")
  @HttpCode(200)
  test(@CurrentUser() user: AuthUser) {
    return this.mailIngest.test(user);
  }

  @Post("run")
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser) {
    return this.mailIngest.runNow(user);
  }
}
