/**
 * Vekaletname modülü HTTP uçları (prefix /api/v1).
 *
 *   GET  /power-of-attorney/scope-catalog          · standart özel yetki kataloğu
 *   GET  /power-of-attorney/warnings               · deterministik uyarı listesi
 *   GET/POST      /power-of-attorney
 *   GET/PATCH/DEL /power-of-attorney/:id
 *   POST /power-of-attorney/:id/revoke             · azil / istifa / süre dolumu
 *   POST /power-of-attorney/:id/scope-check        · POA_SCOPE_ANALYSIS (kredili)
 *   GET  /power-of-attorney/:id/scope-checks       · geçmiş analizler
 *   GET  /cases/:caseId/poa-status                 · dosyanın vekalet durumu
 *
 * ROTA SIRASI KRİTİKTİR: "scope-catalog" ve "warnings" sabit yolları `:id`
 * rotalarından ÖNCE tanımlanır; aksi hâlde birer kayıt kimliği sanılırlar.
 *
 * NOT: NestJS modül kaydı (app.module.ts) Entegrasyon ajanının işidir.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AiCredits } from "../credits/ai-credits.decorator";
import type { AuthUser } from "../common/types";
import { PoaScopeService } from "./poa-scope.service";
import { PoaWarningsService } from "./poa-warnings.service";
import { PoaService } from "./poa.service";
import {
  createPoaSchema,
  poaScopeCheckSchema,
  revokePoaSchema,
  updatePoaSchema,
  type CreatePoaInput,
  type PoaScopeCheckInput,
  type RevokePoaInput,
  type UpdatePoaInput,
} from "./poa.dto";

@Controller("power-of-attorney")
export class PoaController {
  constructor(
    private readonly poa: PoaService,
    private readonly warnings: PoaWarningsService,
    private readonly scope: PoaScopeService,
  ) {}

  /* ---------------- Sabit yollar (`:id`den ÖNCE) ---------------- */

  /** Arayüzün özel yetki onay kutularını ürettiği sabit katalog. */
  @Get("scope-catalog")
  catalog() {
    return this.poa.scopeCatalog();
  }

  /**
   * Süre/azil uyarıları. HESAP DETERMİNİSTİKTİR — AI kullanılmaz, kredi
   * tüketilmez ve `Deadline` kaydı ÜRETİLMEZ (bkz. PoaWarningsService).
   */
  @Get("warnings")
  listWarnings(@CurrentUser() user: AuthUser, @Query("days") days?: string) {
    return this.warnings.list(user, days ? Number(days) : undefined);
  }

  /* ---------------------------- CRUD ---------------------------- */

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId?: string,
    @Query("caseId") caseId?: string,
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.poa.list(user, { clientId, caseId, status, type, q, page, limit });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPoaSchema)) body: CreatePoaInput,
  ) {
    return this.poa.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.poa.detail(user, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePoaSchema)) body: UpdatePoaInput,
  ) {
    return this.poa.update(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.poa.remove(user, id);
  }

  /* ------------------------ Azil / istifa ----------------------- */

  /**
   * Azil / istifa / süre dolumu kaydı. GERİ ALINAMAZ; ikinci çağrı 409 döner.
   * SEKRETER bu uçta 403 alır (iş kuralı 6).
   */
  @Post(":id/revoke")
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(revokePoaSchema)) body: RevokePoaInput,
  ) {
    return this.poa.revoke(user, id, body);
  }

  /* ------------------------ Kapsam analizi ---------------------- */

  /**
   * POA_SCOPE_ANALYSIS — kredi hattından geçer (`AiTaskCost`: 10 kredi).
   *
   * `caseIdFrom`: dosya kimliği GÖVDEDEDİR; kredi kapısı bağlam uzunluğunu
   * o dosyadan ölçsün diye bildirilir. Gövde kapıya HAM gelir (pipe'lardan
   * önce), bu yüzden okuma savunmacıdır.
   *
   * DİKKAT: süresi dolmuş/azledilmiş vekaletnamede servis modele HİÇ gitmez;
   * o durumda `settle()` çağrı görmediği için rezervasyon iade edilir ve
   * kredi düşmez.
   */
  @Post(":id/scope-check")
  @AiThrottle(1)
  @AiCredits("POA_SCOPE_ANALYSIS", {
    caseIdFrom: (body) => {
      const b = body as { caseId?: unknown } | undefined;
      return typeof b?.caseId === "string" ? b.caseId : undefined;
    },
  })
  @HttpCode(201)
  scopeCheck(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(poaScopeCheckSchema)) body: PoaScopeCheckInput,
  ) {
    return this.scope.check(user, id, body);
  }

  @Get(":id/scope-checks")
  scopeHistory(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.scope.history(user, id);
  }
}

/**
 * Dosya ekranındaki vekalet durumu bandı.
 *
 * Yol `/cases/:caseId/poa-status`tır; mevcut `cases` controller'ına
 * DOKUNULMAZ (dosya sahipliği), ayrı bir controller aynı ön eki paylaşır.
 */
@Controller("cases")
export class CasePoaController {
  constructor(private readonly warnings: PoaWarningsService) {}

  @Get(":caseId/poa-status")
  status(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.warnings.caseStatus(user, caseId);
  }
}
