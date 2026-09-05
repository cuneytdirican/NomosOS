import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IMPORT_KINDS, importTemplateCsv, type ImportKind } from "@nomosos/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ImportService, MAX_ZIP_BYTES, importCsvSchema, type ImportCsvInput } from "./import.service";
import { BadRequestException } from "@nestjs/common";

/** FAZ 8E — /import: veri göçü sihirbazı (önizleme = dry-run; çalıştırma ONAY rolü). */
@Controller("import")
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** Şablon CSV (başlık + örnek satır), noktalı virgül ayraçlı, UTF-8 BOM'lu (Excel uyumu). */
  @Get("template/:kind")
  @Header("Content-Type", "text/csv; charset=utf-8")
  template(@Param("kind") kind: string) {
    if (!(IMPORT_KINDS as readonly string[]).includes(kind)) throw new BadRequestException("Geçersiz şablon türü.");
    return `\uFEFF${importTemplateCsv(kind as ImportKind)}`;
  }

  @Post("preview")
  @HttpCode(200)
  preview(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(importCsvSchema)) body: ImportCsvInput) {
    return this.imports.preview(user, body);
  }

  @Post("run")
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(importCsvSchema)) body: ImportCsvInput) {
    return this.imports.run(user, body);
  }

  /** ZIP + isteğe bağlı belgeler.csv; `?dryRun=1` yalnız eşleme planı döner. */
  @Post("zip")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_ZIP_BYTES } }))
  zip(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Query("dryRun") dryRun?: string) {
    return this.imports.importZip(user, file, dryRun === "1" || dryRun === "true");
  }
}
