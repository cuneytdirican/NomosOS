import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { PetitionsService } from "./petitions.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  changePetitionStatusSchema,
  createPetitionSchema,
  createPetitionVersionSchema,
  exportUdfSchema,
  generatePetitionSchema,
  rewriteSectionSchema,
  type ChangePetitionStatusInput,
  type CreatePetitionInput,
  type CreatePetitionVersionInput,
  type ExportUdfInput,
  type GeneratePetitionInput,
  type RewriteSectionInput,
} from "./petitions.dto";

/** Şablon kütüphanesi: sistem şablonları salt-okunur, büro şablonları listelenir. */
@Controller("petition-templates")
export class PetitionTemplatesController {
  constructor(private readonly petitions: PetitionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("type") type?: string) {
    return this.petitions.listTemplates(user.tenantId, type);
  }
}

/** Dosyanın dilekçeleri: /cases/:caseId/petitions */
@Controller("cases")
export class CasePetitionsController {
  constructor(private readonly petitions: PetitionsService) {}

  @Get(":caseId/petitions")
  list(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.petitions.listForCase(user.tenantId, caseId);
  }
}

@Controller("petitions")
export class PetitionsController {
  constructor(private readonly petitions: PetitionsService) {}

  /** Dilekçe Stüdyosu — büro genesi liste (dosya/ürün/durum/arama süzgeçli). */
  @Get()
  listStudio(
    @CurrentUser() user: AuthUser,
    @Query("caseId") caseId?: string,
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("q") q?: string,
  ) {
    return this.petitions.listStudio(user.tenantId, { caseId, status, type, q });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPetitionSchema)) body: CreatePetitionInput,
  ) {
    return this.petitions.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.petitions.detail(user, id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.petitions.remove(user, id);
  }

  /** Yeni sürüm — sürümler DEĞİŞTİRİLEMEZ; her kayıt sürüm numarasını artırır. */
  @Post(":id/versions")
  createVersion(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPetitionVersionSchema)) body: CreatePetitionVersionInput,
  ) {
    return this.petitions.createVersion(user, id, body);
  }

  /**
   * SÜRÜM FARKI (D5 / cila) — ?from=N&to=M. NOT: bu yol `:versionNo`
   * parametresinden ÖNCE bildirilir; aksi hâlde "diff" sürüm numarası
   * sanılırdı.
   */
  @Get(":id/versions/diff")
  versionDiff(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    const fromNo = Number(from);
    const toNo = Number(to);
    if (!Number.isInteger(fromNo) || !Number.isInteger(toNo) || fromNo < 1 || toNo < 1) {
      throw new BadRequestException("from ve to 1'den büyük tam sürüm numaraları olmalıdır.");
    }
    return this.petitions.versionDiff(user, id, fromNo, toNo);
  }

  /** Eski sürümün salt-okunur görünümü. */
  @Get(":id/versions/:versionNo")
  versionDetail(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("versionNo") versionNo: string,
  ) {
    const no = Number(versionNo);
    if (!Number.isInteger(no) || no < 1) {
      throw new BadRequestException("Sürüm numarası 1'den büyük bir tam sayı olmalıdır.");
    }
    return this.petitions.versionDetail(user, id, no);
  }

  /**
   * Statü değişikliği. HAZIR isteğinde TEYİT KAPISI çalışır ve doğrulanmamış
   * atıf varsa HTTP 422 döner.
   */
  @Patch(":id/status")
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(changePetitionStatusSchema)) body: ChangePetitionStatusInput,
  ) {
    return this.petitions.changeStatus(user, id, body);
  }

  /** Teyit Ajanı'nı güncel sürüm üzerinde çalıştırır (deterministik, LLM yok). */
  @Post(":id/verify")
  @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.petitions.verify(user, id);
  }

  /** PETITION_DRAFT — dosya bağlamından bölüm bölüm AI taslağı. */
  @Post(":id/generate")
  @AiThrottle(2)
  // Taslak dosyanın tamamından üretilir; yolda dilekçe kimliği durur.
  @AiCredits("PETITION_DRAFT", { parentCaseId: { kind: "PETITION", param: "id" } })
  @HttpCode(200)
  generate(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(generatePetitionSchema)) body: GeneratePetitionInput,
  ) {
    return this.petitions.generate(user, id, body);
  }

  /** PETITION_SECTION_REWRITE — yalnızca hedef bölüm değişir. */
  @Post(":id/sections/:key/rewrite")
  @AiThrottle(1)
  @AiCredits("PETITION_SECTION_REWRITE", { parentCaseId: { kind: "PETITION", param: "id" } })
  @HttpCode(200)
  rewriteSection(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(rewriteSectionSchema)) body: RewriteSectionInput,
  ) {
    return this.petitions.rewriteSection(user, id, key, body);
  }

  /** UDF üretimi + ön-imzalı indirme bağlantısı (HAZIR ve sonrası statülerde). */
  @Post(":id/export/udf")
  @HttpCode(200)
  exportUdf(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(exportUdfSchema)) body: ExportUdfInput,
  ) {
    return this.petitions.exportUdf(user, id, body);
  }
}
