/**
 * Bilirkişi modülü HTTP uçları (prefix /api/v1).
 *
 *   GET/POST      /experts                              · PATCH /experts/:id
 *   GET/POST      /cases/:caseId/expert-reports
 *   GET           /cases/:caseId/expert-report-diffs
 *   GET/PATCH/DEL /expert-reports/:id
 *   POST          /expert-reports/compare               (EXPERT_REPORT_DIFF)
 *   POST          /expert-reports/:id/objection
 *   PATCH         /expert-objections/:id
 *   POST          /expert-objections/:id/draft-petition
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
import { AiCredits } from "../credits/ai-credits.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ExpertDiffService } from "./expert-diff.service";
import { ExpertService } from "./expert.service";
import {
  compareReportsSchema,
  createExpertReportSchema,
  createExpertSchema,
  createObjectionSchema,
  draftPetitionSchema,
  updateExpertReportSchema,
  updateExpertSchema,
  updateObjectionSchema,
  type CompareReportsInput,
  type CreateExpertInput,
  type CreateExpertReportInput,
  type CreateObjectionInput,
  type DraftPetitionInput,
  type UpdateExpertInput,
  type UpdateExpertReportInput,
  type UpdateObjectionInput,
} from "./expert.dto";

/** Büro geneli bilirkişi havuzu: /experts */
@Controller("experts")
export class ExpertsController {
  constructor(private readonly experts: ExpertService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("specialty") specialty?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.experts.listExperts(user, { q, specialty, page, limit });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createExpertSchema)) body: CreateExpertInput,
  ) {
    return this.experts.createExpert(user, body);
  }

  /** Kişi kartı: kimlik/uzmanlık + görev aldığı raporlar + deterministik sayımlar. */
  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.experts.expertDetail(user, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExpertSchema)) body: UpdateExpertInput,
  ) {
    return this.experts.updateExpert(user, id, body);
  }
}

/** Dosya kapsamlı bilirkişi uçları: /cases/:caseId/... */
@Controller("cases")
export class CaseExpertReportsController {
  constructor(
    private readonly experts: ExpertService,
    private readonly diff: ExpertDiffService,
  ) {}

  @Get(":caseId/expert-reports")
  list(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.experts.listReports(user, caseId);
  }

  /** Tebliğ tarihi verilirse itiraz süresi DETERMİNİSTİK hesaplanır (BEKLIYOR). */
  @Post(":caseId/expert-reports")
  create(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(createExpertReportSchema)) body: CreateExpertReportInput,
  ) {
    return this.experts.createReport(user, caseId, body);
  }

  @Get(":caseId/expert-report-diffs")
  listDiffs(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.diff.listDiffs(user, caseId);
  }
}

/** Rapor kayıtları: /expert-reports */
@Controller("expert-reports")
export class ExpertReportsController {
  constructor(
    private readonly experts: ExpertService,
    private readonly diff: ExpertDiffService,
  ) {}

  /**
   * EXPERT_REPORT_DIFF — iki raporu madde madde karşılaştırır.
   *
   * SIRA ÖNEMLİ: bu rota `:id` rotalarından ÖNCE tanımlanmalıdır, aksi hâlde
   * "compare" bir rapor kimliği sanılır.
   */
  @Post("compare")
  @AiThrottle(1)
  // İki TAM bilirkişi raporu metni gider; kimlikler gövdededir, yolda dosya
  // kimliği yoktur. Bağlam uzunluğu raporların bağlı olduğu dosya(lar)dan
  // ölçülür — aksi hâlde 80 baytlık bir gövde taban fiyattan geçerdi.
  @AiCredits("EXPERT_REPORT_DIFF", {
    parentCaseId: {
      kind: "EXPERT_REPORT",
      from: (body) => {
        const b = body as { baseReportId?: unknown; compareReportId?: unknown } | undefined;
        return [b?.baseReportId, b?.compareReportId].filter(
          (v): v is string => typeof v === "string",
        );
      },
    },
  })
  @HttpCode(200)
  compare(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(compareReportsSchema)) body: CompareReportsInput,
  ) {
    return this.diff.compare(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.experts.reportDetail(user, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExpertReportSchema)) body: UpdateExpertReportInput,
  ) {
    return this.experts.updateReport(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.experts.deleteReport(user, id);
  }

  /** Rapora itiraz kaydı (elle veya diff çıktısından üretilen maddelerle). */
  @Post(":id/objection")
  createObjection(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createObjectionSchema)) body: CreateObjectionInput,
  ) {
    return this.experts.createObjection(user, id, body);
  }

  /**
   * Raporun TASLAK itirazından dilekçe taslağı üretir — rapor ekranından tek
   * tıkla çağrılan kısayol. Aynı işi `/expert-objections/:id/draft-petition`
   * de yapar; fark, hangi itirazın seçileceğinin burada rapordan çözülmesidir.
   */
  @Post(":id/objection/draft-petition")
  @HttpCode(201)
  draftPetitionForReport(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(draftPetitionSchema)) body: DraftPetitionInput,
  ) {
    return this.experts.draftPetitionForReport(user, id, body);
  }
}

/** İtiraz kayıtları: /expert-objections */
@Controller("expert-objections")
export class ExpertObjectionsController {
  constructor(private readonly experts: ExpertService) {}

  /** Durum makinesi: TASLAK → SUNULDU → KABUL|RED. Geçersiz geçiş 422. */
  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateObjectionSchema)) body: UpdateObjectionInput,
  ) {
    return this.experts.updateObjection(user, id, body);
  }

  /**
   * İtiraz maddelerinden dilekçe TASLAĞI üretir (Petition + ilk sürüm).
   * Dilekçe modülünün servisine bağımlılık kurulmaz; kayıtlar Prisma ile açılır.
   */
  @Post(":id/draft-petition")
  @HttpCode(201)
  draftPetition(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(draftPetitionSchema)) body: DraftPetitionInput,
  ) {
    return this.experts.draftObjectionPetition(user, id, body);
  }
}
