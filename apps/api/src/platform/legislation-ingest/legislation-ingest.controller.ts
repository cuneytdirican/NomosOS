import { Body, Get, Param, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { LegislationIngestService } from "./legislation-ingest.service";
import { LegislationPoolService } from "./legislation-pool.service";
import { MevzuatGovConnector } from "../../legislation/connectors/mevzuat-gov.connector";
import {
  ingestItemsQuerySchema,
  ingestRejectSchema,
  type IngestItemsQueryInput,
  type IngestRejectInput,
} from "./legislation-ingest.schemas";

/**
 * `/api/admin/v1/legislation-ingest` — mevzuat toplama hattı yönetimi.
 *
 * Caselaw-ingest ile aynı sözleşme: kuyruk → onay → tek kapı
 * (LegislationPoolService). Bu denetleyici havuza DOĞRUDAN yazmaz.
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/legislation-ingest`)
export class LegislationIngestController {
  constructor(
    private readonly ingest: LegislationIngestService,
    private readonly pool: LegislationPoolService,
    private readonly mevzuat: MevzuatGovConnector,
  ) {}

  /** Havuz durumu (kanun/madde sürümü/platform belgesi sayıları). */
  @Get("stats")
  @ReadPermission("aiProvider.view")
  stats() {
    return this.pool.stats();
  }

  /** Konektör sağlık kontrolü (mevzuat.gov.tr örnek aramayla yoklanır). */
  @Get("health")
  @ReadPermission("aiProvider.view")
  health() {
    return this.mevzuat.healthCheck();
  }

  /** Onay kuyruğu. */
  @Get("items")
  @ReadPermission("aiProvider.view")
  items(@Query(new ZodValidationPipe(ingestItemsQuerySchema)) query: IngestItemsQueryInput) {
    return this.ingest.listItems(query);
  }

  /** Onay öncesi metin önizlemesi (kuyruk / mevzuat.gov.tr / RG). */
  @Get("items/:id/preview")
  @ReadPermission("aiProvider.view")
  preview(@Param("id") id: string) {
    return this.ingest.preview(id);
  }

  /** Çekirdek kanun tohumunu çalıştır (mevzuat.gov.tr → kuyruk). */
  @Post("run/tohum")
  @WritePermission("aiProvider.manage")
  async runTohum(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.ingest.runCoreSeed(new Date(), user.id);
  }

  /** RG izleyicisini elle çalıştır (zamanlanmış işin aynısı). */
  @Post("run/rg")
  @WritePermission("aiProvider.manage")
  async runRg(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.ingest.runRgWatcher(new Date(), user.id);
  }

  /** KVKK Kurul kararları izleyicisini elle çalıştır (zamanlanmış işin aynısı). */
  @Post("run/kvkk")
  @WritePermission("aiProvider.manage")
  async runKvkk(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.ingest.runKvkkWatcher(new Date(), user.id);
  }

  /** Rekabet Kurulu kararları izleyicisini elle çalıştır (zamanlanmış işin aynısı). */
  @Post("run/rekabet")
  @WritePermission("aiProvider.manage")
  async runRekabet(@CurrentPlatformUser() user: PlatformAuthUser) {
    return this.ingest.runRekabetWatcher(new Date(), user.id);
  }

  /** ONAYLA → tek kapıdan havuza (Statute sürümleri / Legislation platform kaydı). */
  @Post("items/:id/approve")
  @WritePermission("aiProvider.manage")
  approve(@CurrentPlatformUser() user: PlatformAuthUser, @Param("id") id: string) {
    return this.ingest.approveItem(user, id);
  }

  /** REDDET — gerekçe zorunlu. */
  @Post("items/:id/reject")
  @WritePermission("aiProvider.manage")
  reject(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ingestRejectSchema)) body: IngestRejectInput,
  ) {
    return this.ingest.rejectItem(user, id, body.reason);
  }
}
