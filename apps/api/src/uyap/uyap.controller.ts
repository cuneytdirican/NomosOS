/**
 * UYAP Köprüsü denetleyicisi.
 *
 * İKİ DÜNYA, tek modül:
 *   1. Eklenti uçları (@Public + UyapTokenGuard): pair, refresh, sync, belge.
 *      Eklenti NomosOS web oturumuna erişemez — kendi extension token'ıyla gelir.
 *   2. Web uçları (normal kiracı JWT'si): eşleştirme kodu üretimi, cihaz
 *      yönetimi, eşleştirme kuyruğu. Bunlar büro arayüzünden kullanılır.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { createCaseFromQueueSchema, type CreateCaseFromQueueInput } from "./uyap.dto";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { UyapService } from "./uyap.service";
import { UyapTokenGuard, type UyapTokenRequest } from "./uyap.guard";
import {
  commitSchema,
  pairSchema,
  presignSchema,
  refreshSchema,
  resolveMatchSchema,
  syncEventsSchema,
  syncFilesSchema,
  type CommitInput,
  type PairInput,
  type PresignInput,
  type RefreshInput,
  type SyncEventsInput,
  type SyncFilesInput,
} from "./uyap.dto";

/* ------------------------- 1) EKLENTİ UÇLARI ------------------------- */

/**
 * @Public() kiracı JwtAuthGuard zincirini atlar; korumayı UyapTokenGuard üstlenir.
 * pair ve pair/refresh kimliksizdir (kod ve refresh jetonu kendisi kimliktir).
 */
@Public()
@Controller("uyap")
export class UyapExtensionController {
  constructor(private readonly uyap: UyapService) {}

  @Post("pair")
  pair(@Body(new ZodValidationPipe(pairSchema)) body: PairInput) {
    return this.uyap.pair(body);
  }

  @Post("pair/refresh")
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.uyap.refresh(body.refreshToken);
  }

  @Post("sync/files")
  @UseGuards(UyapTokenGuard)
  syncFiles(
    @Req() req: UyapTokenRequest,
    @Body(new ZodValidationPipe(syncFilesSchema)) body: SyncFilesInput,
  ) {
    return this.uyap.syncFiles(req.uyapToken!, body);
  }

  @Post("sync/events")
  @UseGuards(UyapTokenGuard)
  syncEvents(
    @Req() req: UyapTokenRequest,
    @Body(new ZodValidationPipe(syncEventsSchema)) body: SyncEventsInput,
  ) {
    return this.uyap.syncEvents(req.uyapToken!, body);
  }

  @Post("documents/presign")
  @UseGuards(UyapTokenGuard)
  presign(
    @Req() req: UyapTokenRequest,
    @Body(new ZodValidationPipe(presignSchema)) body: PresignInput,
  ) {
    return this.uyap.presignDocument(req.uyapToken!, body);
  }

  @Post("documents/commit")
  @UseGuards(UyapTokenGuard)
  commit(
    @Req() req: UyapTokenRequest,
    @Body(new ZodValidationPipe(commitSchema)) body: CommitInput,
  ) {
    return this.uyap.commitDocument(req.uyapToken!, body);
  }

  @Get("status")
  @UseGuards(UyapTokenGuard)
  status(@Req() req: UyapTokenRequest) {
    return this.uyap.status(req.uyapToken!);
  }

  /** Faz 7D — UYAP'a gönderilmeye hazır dilekçeler (HAZIR / DISA_AKTARILDI). */
  @Get("petitions/ready")
  @UseGuards(UyapTokenGuard)
  readyPetitions(@Req() req: UyapTokenRequest) {
    return this.uyap.listReadyPetitions(req.uyapToken!);
  }

  /**
   * Faz 7D — dilekçenin UDF'sini üret ve süreli indirme bağlantısı ver. Eklenti dosyayı
   * kullanıcının diskine indirir; UYAP'a yükleme, e-imza ve gönderim KULLANICININ eylemidir.
   */
  @Post("petitions/:id/udf")
  @UseGuards(UyapTokenGuard)
  petitionUdf(@Req() req: UyapTokenRequest, @Param("id") id: string) {
    return this.uyap.exportPetitionUdf(req.uyapToken!, id);
  }
}

/* ------------------------- 2) WEB (BÜRO) UÇLARI ------------------------- */

@Controller("uyap")
export class UyapWebController {
  constructor(private readonly uyap: UyapService) {}

  /** Eşleştirme kodu üret — eklenti popup'ına 10 dakika içinde girilir. */
  @Post("pairing-code")
  @HttpCode(200)
  createPairingCode(@CurrentUser() user: AuthUser) {
    return this.uyap.createPairingCode(user);
  }

  /** Eşleştirilmiş tarayıcılar — iptal etmek için liste. */
  @Get("devices")
  listDevices(@CurrentUser() user: AuthUser) {
    return this.uyap.listDevices(user);
  }

  /** Cihaz jetonunu iptal et. */
  @Post("devices/:id/revoke")
  @HttpCode(200)
  revokeDevice(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.uyap.revokeDevice(user, id);
  }

  /** Eşleşmeyen UYAP dosyaları — avukatın bağlama kuyruğu. */
  @Get("match-queue")
  matchQueue(@CurrentUser() user: AuthUser) {
    return this.uyap.matchQueue(user);
  }

  /** Kuyruktaki dosyayı NomosOS dosyasına bağla. */
  /** Faz 6 — kuyruktaki UYAP dosyasından yeni dosya aç (müvekkil seçimi zorunlu; onaylı işlem). */
  @Post("match-queue/:id/create-case")
  createCase(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body(new ZodValidationPipe(createCaseFromQueueSchema)) body: CreateCaseFromQueueInput) {
    return this.uyap.createCaseFromQueue(user, id, body);
  }

  @Post("match-queue/:id/resolve")
  @HttpCode(200)
  resolveMatch(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolveMatchSchema)) body: z.infer<typeof resolveMatchSchema>,
  ) {
    return this.uyap.resolveMatch(user, id, body.caseId);
  }

  /** UYAP senkron durum özeti — uygulama içi sayfa için (izlenen dosya, son senkron, cihazlar). */
  @Get("ozet")
  async summary(@CurrentUser() user: AuthUser) {
    return this.uyap.webSummary(user);
  }
}
