/**
 * Çatışma kontrolü HTTP uçları (prefix /api/v1).
 *
 *   POST /conflict-check            → tarama başlat
 *   POST /conflict-check/:id/decide → kararı gerekçesiyle kaydet (PARTNER/ADMIN)
 *   GET  /conflict-checks           → geçmiş taramalar
 *   GET  /conflict-checks/:id       → bulgularıyla tek tarama
 *   GET  /conflict-checks/pending/warnings → karar bekleyen çatışmalı taramalar
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ConflictService } from "./conflict.service";
import {
  decideConflictSchema,
  runConflictCheckSchema,
  type DecideConflictInput,
  type RunConflictCheckInput,
} from "./conflict.dto";

/** Tarama ve karar: /conflict-check */
@Controller("conflict-check")
export class ConflictCheckController {
  constructor(private readonly conflict: ConflictService) {}

  /**
   * Tarama başlat. Deterministik katman her hâlükârda çalışır; `useAi=true`
   * verilirse gri bölge için ek AI çıkarımı yapılır (kredili).
   *
   * Hız sınırı yalnızca AI katmanı için anlamlıdır ama uç tek olduğundan
   * dekoratör uca konur; deterministik taramanın maliyeti düşüktür.
   */
  @Post()
  @AiThrottle(1)
  // Tarama AĞIRLIKLI DETERMİNİSTİKTİR ve varsayılan olarak AI'sız çalışır;
  // kredi yalnız useAi:true gönderildiğinde devreye girer.
  @AiCredits("CONFLICT_INFERENCE", {
    when: (body) => (body as { useAi?: unknown } | undefined)?.useAi === true,
  })
  @HttpCode(200)
  run(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(runConflictCheckSchema)) body: RunConflictCheckInput,
  ) {
    return this.conflict.run(user, body);
  }

  /** Karar kaydı — ENGELLEME DEĞİL, kayıt. Gerekçe zorunludur. */
  @Post(":id/decide")
  @HttpCode(200)
  decide(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideConflictSchema)) body: DecideConflictInput,
  ) {
    return this.conflict.decide(user, id, body);
  }
}

/** Geçmiş: /conflict-checks */
@Controller("conflict-checks")
export class ConflictChecksController {
  constructor(private readonly conflict: ConflictService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("result") result?: string,
    @Query("decision") decision?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.conflict.list(user, { result, decision, q, page, limit });
  }

  /**
   * Karar bekleyen çatışmalı taramalar — yeni dosya/müvekkil açılışında
   * gösterilecek uyarı bandının kaynağı.
   *
   * SIRA ÖNEMLİ: bu rota `:id` rotasından ÖNCE tanımlanmalıdır, aksi hâlde
   * "pending" bir kayıt kimliği sanılır.
   */
  @Get("pending/warnings")
  pending(@CurrentUser() user: AuthUser) {
    return this.conflict.pendingWarnings(user);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.conflict.detail(user, id);
  }
}
