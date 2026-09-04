import { Body, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { CaselawIngestService } from "./caselaw-ingest.service";
import {
  ingestItemsQuerySchema,
  ingestRejectSchema,
  sourceUpsertSchema,
  type IngestItemsQuery,
  type IngestRejectInput,
  type SourceUpsertInput,
} from "./caselaw-ingest.schemas";

/**
 * `/api/admin/v1/caselaw-ingest` — içtihat toplama hattı yönetimi.
 *
 * Zamanlanmış işin (caselaw-ingest-daily) çektiği kayıtların onay kuyruğu,
 * kaynak yapılandırması ve elle çekim. Havuza yazım tek kapıdır:
 * CaselawPoolService (/caselaw-pool/import) — bu denetleyici havuza
 * DOĞRUDAN yazmaz.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/caselaw-ingest`)
export class CaselawIngestController {
  constructor(private readonly ingest: CaselawIngestService) {}

  /** Kaynak listesi + kaynak başına bekleyen kayıt sayısı. */
  @Get("sources")
  @ReadPermission("aiProvider.view")
  sources() {
    return this.ingest.listSources();
  }

  /** Kaynak kaydet/güncelle (upsert by key). */
  @Put("sources")
  @WritePermission("aiProvider.manage")
  upsertSource(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(sourceUpsertSchema)) body: SourceUpsertInput
  ) {
    return this.ingest.upsertSource(user, body);
  }

  /** Onay kuyruğu — BEKLIYOR/ONAYLANDI/REDDEDILDI süzgeçli. */
  @Get("items")
  @ReadPermission("aiProvider.view")
  items(@Query(new ZodValidationPipe(ingestItemsQuerySchema)) query: IngestItemsQuery) {
    return this.ingest.listItems(query);
  }

  /** Elle "şimdi topla" — zamanlanmış işin aynısını çalıştırır. */
  @Post("run")
  @WritePermission("aiProvider.manage")
  async run(@CurrentPlatformUser() user: PlatformAuthUser) {
    const summaries = await this.ingest.runAllSources(new Date(), user.id);
    return {
      summaries,
      totals: {
        queued: summaries.reduce((sum, s) => sum + s.queued, 0),
        skippedDuplicate: summaries.reduce((sum, s) => sum + s.skippedDuplicate, 0),
        rejected: summaries.reduce((sum, s) => sum + s.rejected, 0),
        failedSources: summaries.filter((s) => !s.ok).length,
      },
    };
  }

  /** Kuyruk kaydını ONAYLA → havuza yazar (tek kapı: CaselawPoolService). */
  @Post("items/:id/approve")
  @WritePermission("aiProvider.manage")
  approve(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.ingest.approveItem(user, id);
  }

  /** Kuyruk kaydını REDDET — gerekçe zorunlu. */
  @Post("items/:id/reject")
  @WritePermission("aiProvider.manage")
  reject(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ingestRejectSchema)) body: IngestRejectInput
  ) {
    return this.ingest.rejectItem(user, id, body.reason);
  }
}
