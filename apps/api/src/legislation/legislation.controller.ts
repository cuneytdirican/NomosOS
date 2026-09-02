/**
 * MEVZUAT KÜTÜPHANESİ UÇLARI (geliştirme planı D3 / A4).
 *
 * GET    /legislation?q=&docType=&take= — liste + tam metin arama
 * GET    /legislation/:id               — tam metin dahil detay
 * POST   /legislation                   — yeni mevzuat yükle (HUKUKI)
 * PATCH  /legislation/:id               — güncelle (tam metin değişiyorsa
 *                                         sürüm notu ZORUNLU)
 * DELETE /legislation/:id               — yumuşak silme (HUKUKI)
 *
 * RG otomatik senkron YOKTUR — vaat kısıtı Ö-26 ile uyumlu olarak bu uç
 * büronun kendi yüklemesine açıktır.
 */

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { LEGISLATION_DOC_TYPES, LegislationService } from "./legislation.service";

const createSchema = z.object({
  docType: z.enum(LEGISLATION_DOC_TYPES, {
    errorMap: () => ({ message: "Geçersiz belge türü." }),
  }),
  title: z.string().trim().min(3, "Başlık en az 3 karakter olmalıdır.").max(300),
  number: z.string().trim().max(50).optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  enactedAt: z.string().date().nullable().optional(),
  fullText: z.string().min(50, "Tam metin en az 50 karakter olmalıdır.").max(1_000_000),
  tags: z.string().trim().max(300).optional(),
  versionNote: z.string().trim().max(500).optional(),
});
export type CreateLegislationInput = z.infer<typeof createSchema>;

const updateSchema = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  number: z.string().trim().max(50).nullable().optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  tags: z.string().trim().max(300).nullable().optional(),
  versionNote: z.string().trim().max(500).nullable().optional(),
  fullText: z.string().min(50).max(1_000_000).optional(),
});
export type UpdateLegislationInput = z.infer<typeof updateSchema>;

@Controller("legislation")
export class LegislationController {
  constructor(private readonly legislation: LegislationService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("docType") docType?: string,
    @Query("take") take?: string,
  ) {
    return this.legislation.list(user, {
      q,
      docType,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.legislation.detail(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: CreateLegislationInput,
  ) {
    return this.legislation.create(user, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateLegislationInput,
  ) {
    return this.legislation.update(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.legislation.remove(user, id);
  }
}
