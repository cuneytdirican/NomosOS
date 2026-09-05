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
import { DocumentExtrasService, shareLinkSchema, type ShareLinkInput } from "./document-extras.service";
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
  constructor(
    private readonly documents: DocumentsService,
    private readonly extras: DocumentExtrasService,
  ) {}

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
      folderPath?: string;
      versions?: string;
    }
  ) {
    return this.documents.list(user.tenantId, query, user);
  }

  /** Faz 7: GET /documents/folders?caseId= — klasör yolları + sayılar (":id"den ÖNCE). */
  @Get("folders")
  folders(@CurrentUser() user: AuthUser, @Query("caseId") caseId?: string) {
    return this.extras.folders(user, caseId);
  }

  /** Faz 7: DELETE /documents/shares/:shareId — paylaşım bağlantısını iptal et (":id"den ÖNCE). */
  @Delete("shares/:shareId")
  revokeShare(@CurrentUser() user: AuthUser, @Param("shareId") shareId: string) {
    return this.extras.revokeShare(user, shareId);
  }

  /** Faz 7: GET /documents/:id/versions — sürüm zinciri. */
  @Get(":id/versions")
  versions(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.extras.versions(user, id);
  }

  /** Faz 7: POST /documents/:id/versions — yeni sürüm (multipart `file`, isteğe bağlı `note`). */
  @Post(":id/versions")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  newVersion(@CurrentUser() user: AuthUser, @Param("id") id: string, @UploadedFile() file: Express.Multer.File, @Body() body: { note?: string }) {
    return this.extras.newVersion(user, id, file, body?.note ?? null);
  }

  /** Faz 7: POST /documents/:id/move — klasör yolu değiştir. */
  @Post(":id/move")
  @HttpCode(200)
  move(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: { folderPath?: string }) {
    return this.extras.move(user, id, body?.folderPath ?? "/");
  }

  /** Faz 7: POST /documents/:id/share — süreli paylaşım bağlantısı üret. */
  @Post(":id/share")
  @HttpCode(200)
  share(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(shareLinkSchema)) body: ShareLinkInput) {
    return this.extras.createShare(user, id, body);
  }

  /** Faz 7: GET /documents/:id/shares — paylaşım bağlantıları (jetonsuz). */
  @Get(":id/shares")
  shares(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.extras.listShares(user, id);
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
