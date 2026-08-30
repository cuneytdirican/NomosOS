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
import { AssistantService } from "./assistant.service";
import { IndexingService } from "./indexing.service";
import { OfficeQueryService } from "./office-query.service";
import {
  analyzeCaseSchema,
  assistantChatSchema,
  createNoteSchema,
  indexCaseSchema,
  officeQuerySchema,
  type AnalyzeCaseInput,
  type AssistantChatInput,
  type CreateNoteInput,
  type IndexCaseInput,
  type OfficeQueryInput,
} from "./assistant.dto";

/**
 * AI Dosya Asistanı uçları — `/api/v1/assistant/...`
 *
 * Global JwtAuthGuard aktiftir; hiçbir uç @Public değildir.
 * Her uç `user.tenantId` süzgeciyle çalışır.
 */
@Controller("assistant")
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly indexing: IndexingService,
    private readonly officeQuery: OfficeQueryService,
  ) {}

  /* ---------------- İndeksleme (RAG hattı) ---------------- */

  /**
   * Dosyanın belgelerini parçalar, maskeler, (varsa) gömer ve DocumentChunk'a yazar.
   *
   * Toplu gömme çağrısı ürettiği için hız sınırında 5 çağrı sayılır; rol kapısı
   * IndexingService içindedir (en az hukuki rol / stajyer).
   */
  @Post("index/:caseId")
  @AiThrottle(5)
  @HttpCode(200)
  indexCase(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(indexCaseSchema)) body: IndexCaseInput,
  ) {
    return this.indexing.indexCase(user, caseId, body);
  }

  /** Dosyanın indeks durumu — "X belgesi henüz indekslenmedi" uyarısının kaynağı. */
  @Get("index/:caseId")
  indexStatus(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.indexing.indexStatus(user.tenantId, caseId);
  }

  /* ---------------- Sohbet ---------------- */

  @Post("chat")
  @AiThrottle(1)
  // Sohbet dosya bağlamıyla çalışır ama kimlik YOLDA değil GÖVDEDE durur.
  // Bağlam ölçüme katılmazsa 400 belge parçalı bir dosyanın sohbeti de taban
  // fiyattan (2 kredi) geçer ve 50 kredi tavanı hiç tetiklenmez.
  @AiCredits("CASE_CHAT", {
    caseIdFrom: (body) => (body as { caseId?: string } | undefined)?.caseId,
  })
  @HttpCode(200)
  chat(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assistantChatSchema)) body: AssistantChatInput,
  ) {
    return this.assistant.chat(user, body);
  }

  @Get("sessions")
  listSessions(@CurrentUser() user: AuthUser, @Query("caseId") caseId?: string) {
    return this.assistant.listSessions(user, caseId);
  }

  @Get("sessions/:id")
  getSession(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.assistant.getSession(user, id);
  }

  @Delete("sessions/:id")
  deleteSession(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.assistant.deleteSession(user, id);
  }

  /* ---------------- Tam dosya analizi ---------------- */

  @Post("analyze/:caseId")
  @AiThrottle(3)
  @AiCredits("CASE_FULL_ANALYSIS", { caseIdParam: "caseId" })
  @HttpCode(200)
  analyze(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(analyzeCaseSchema)) body: AnalyzeCaseInput,
  ) {
    return this.assistant.analyzeCase(user, caseId, body);
  }

  @Get("analyses/:caseId")
  listAnalyses(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.assistant.listAnalyses(user.tenantId, caseId);
  }

  /* ---------------- Akıllı notlar ---------------- */

  @Get("notes")
  listNotes(
    @CurrentUser() user: AuthUser,
    @Query("caseId") caseId: string,
    @Query("approved") approved?: string,
  ) {
    const onlyApproved = approved === undefined ? undefined : approved === "true";
    return this.assistant.listNotes(user.tenantId, caseId, onlyApproved);
  }

  @Post("notes")
  @AiThrottle(1)
  @AiCredits("SMART_NOTE", {
    caseIdFrom: (body) => (body as { caseId?: string } | undefined)?.caseId,
  })
  createNote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNoteSchema)) body: CreateNoteInput,
  ) {
    return this.assistant.createNote(user, body);
  }

  @Patch("notes/:id/approve")
  approveNote(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.assistant.approveNote(user, id);
  }

  @Delete("notes/:id")
  rejectNote(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.assistant.rejectNote(user, id);
  }

  /* ---------------- Büro geneli sorgu ---------------- */

  /**
   * KVKK VERİ MİNİMİZASYONU: LLM'e yalnızca sorunun metni gider ve LLM yalnızca
   * bir SORGU PLANI üretir; sorguyu API çalıştırır, satır verisi modele hiç
   * gönderilmez. Yanıttaki `dataMinimization` alanı bunu beyan eder.
   */
  @Post("office-query")
  @AiThrottle(1)
  @AiCredits("OFFICE_QUERY")
  @HttpCode(200)
  office(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(officeQuerySchema)) body: OfficeQueryInput,
  ) {
    return this.officeQuery.run(user, body);
  }
}
