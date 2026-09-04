import { Body, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PlatformController } from "../decorators/platform-controller.decorator";
import { CurrentPlatformUser } from "../decorators/current-platform-user.decorator";
import { ReadPermission, WritePermission } from "../decorators/platform-permission.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform.constants";
import type { PlatformAuthUser } from "../platform.types";
import { CaselawPoolService } from "./caselaw-pool.service";
import {
  poolImportSchema,
  poolRecordsQuerySchema,
  type PoolImportInput,
  type PoolRecordsQuery,
} from "./caselaw-pool.schemas";

/**
 * `/api/admin/v1/caselaw-pool` — içtihat havuz yönetimi (ai-egitim-stratejisi.md D1).
 *
 * Türk hukuku "eğitimi"nin kamusal tarafı: RAG havuzunun Super Admin eliyle
 * doldurulması. Yetki aiProvider.view/manage (BYO-LLM isteyen büro kullanıcıları
 * bu uçlara ULAŞAMAZ; yalnız platform yönetimi).
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/caselaw-pool`)
export class CaselawPoolController {
  constructor(private readonly pool: CaselawPoolService) {}

  /** Havuz sağlık durumu — toplam, kaynak ve daire kırılımı. */
  @Get()
  @ReadPermission("aiProvider.view")
  stats() {
    return this.pool.stats();
  }

  /** Son kayıtlar — kaynak süzgeçli. */
  @Get("records")
  @ReadPermission("aiProvider.view")
  records(@Query(new ZodValidationPipe(poolRecordsQuerySchema)) query: PoolRecordsQuery) {
    return this.pool.records(query);
  }

  /** Toplu içe aktarım — biçim ön doğrulamalı; tek kayıt hatası partiyi düşürmez. */
  @Post("import")
  @WritePermission("aiProvider.manage")
  @HttpCode(200)
  importRecords(
    @CurrentPlatformUser() user: PlatformAuthUser,
    @Body(new ZodValidationPipe(poolImportSchema)) body: PoolImportInput
  ) {
    return this.pool.importRecords(user, body);
  }
}
