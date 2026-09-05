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
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentsService } from "./documents.service";
import {
  MAX_UPLOAD_BYTES,
  updateDocumentSchema,
  uploadDocumentSchema,
  type UpdateDocumentInput,
  type UploadDocumentInput,
} from "./documents.dto";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * POST /api/v1/documents — multipart yükleme.
   *
   * Alanlar: `file` (zorunlu), `caseId`, `name`, `class`, `source`, `allowDuplicate`.
   * Yükleme tamamlanınca otomatik aksiyon hattı SENKRON koşar; yanıt hattın
   * koşum özetini de taşır.
   */
  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body(new ZodValidationPipe(uploadDocumentSchema)) body: UploadDocumentInput
  ) {
    return this.documents.upload(user, file, body);
  }

  /** GET /api/v1/documents?caseId=&class=&q=&source=&triage=&page=&limit= */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    query: {
      caseId?: string;
      class?: string;
      q?: string;
      source?: string;
      triage?: string;
      page?: string;
      limit?: string;
    }
  ) {
    return this.documents.list(user.tenantId, query, user);
  }

  /** GET /api/v1/documents/:id — meta + hat koşumları + öneriler. */
  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.detail(user.tenantId, id);
  }

  /** GET /api/v1/documents/:id/text — çıkarılmış metin (yoksa nedeni). */
  @Get(":id/text")
  text(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.text(user.tenantId, id);
  }

  /** GET /api/v1/documents/:id/download — süreli imzalı URL (AuditLog yazar). */
  @Get(":id/download")
  download(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.download(user, id);
  }

  /** PATCH /api/v1/documents/:id — sınıf / dosya bağı / ad düzeltme. */
  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema)) body: UpdateDocumentInput
  ) {
    return this.documents.update(user, id, body);
  }

  /** POST /api/v1/documents/:id/reprocess — hattı yeniden oynat. */
  @Post(":id/reprocess")
  @HttpCode(200)
  reprocess(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.reprocess(user, id);
  }

  /** DELETE /api/v1/documents/:id — kayıt + depo nesnesi. */
  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.documents.remove(user, id);
  }
}
