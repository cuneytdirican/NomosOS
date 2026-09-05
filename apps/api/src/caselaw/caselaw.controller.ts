import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { AiThrottle } from "../common/guards/ai-rate-limit.guard";
import { AiCredits } from "../credits/ai-credits.decorator";
import { CaselawService } from "./caselaw.service";
import { CitationVerifyService } from "./citation-verify.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import {
  aiSearchSchema,
  createCaseLawSchema,
  linkCaseLawSchema,
  summarizeCaseLawSchema,
  updateCaseLawReferenceSchema,
  verifyCitationsSchema,
  type AiSearchInput,
  type CreateCaseLawInput,
  type LinkCaseLawInput,
  type SummarizeCaseLawInput,
  type UpdateCaseLawReferenceInput,
  type VerifyCitationsInput,
} from "./caselaw.dto";

/**
 * DİKKAT — ROTA SIRASI: sabit yollar (`search`, `verify`, `ai-search`, `adapters`)
 * `:id` parametreli yoldan ÖNCE tanımlanmalıdır; aksi halde "search" bir kimlik
 * sanılır.
 */
@Controller("caselaw")
export class CaselawController {
  constructor(
    private readonly caselaw: CaselawService,
    private readonly citationVerify: CitationVerifyService,
  ) {}

  /**
   * Klasik (deterministik) arama — LLM kullanılmaz.
   *
   * KİRACI SÜZGECİ: havuz kamusal kayıtlar için paylaşımlıdır, ancak bir büronun
   * ELLE girdiği kayıtlar (serbest metin içerir) yalnızca o büroya görünür.
   */
  @Get("search")
  search(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("court") court?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    /** Canlı katman: sayfa (1+) ve sayfa boyutu (tavan 25). */
    @Query("livePage") livePage?: string,
    @Query("liveLimit") liveLimit?: string,
  ) {
    return this.caselaw.search(user.tenantId, { q, court, from, to, limit, livePage, liveLimit });
  }

  /** Adaptörlerin sağlık durumu (bir kaynak düştüğünde aramanın neden eksik döndüğü). */
  @Get("adapters")
  adapters() {
    return this.caselaw.adapterHealth();
  }

  /**
   * CANLI KARAR BELGESİ — resmî getDokuman yanıtı (JSON zarfı + gömülü HTML)
   * TEMİZ METNE çevrilerek döner. `?source=YARGITAY_CANLI|EMSAL_UYAP|DANISTAY_CANLI` kaynağı
   * seçer (varsayılan Yargıtay). Havuza YAZMAZ.
   */
  @Get("live/:externalId")
  @AiThrottle(2)
  async liveDocument(
    @Param("externalId") externalId: string,
    @Query("source") source?: string,
  ) {
    return this.caselaw.liveDocument(externalId, source);
  }

  /**
   * TEYİT AJANI — atıf doğrulama. TAMAMEN DETERMİNİSTİKTİR:
   * LLM'e "bu karar var mı?" diye SORULMAZ; yalnızca kayıtlı veriye bakılır.
   */
  @Post("verify")
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(verifyCitationsSchema)) body: VerifyCitationsInput,
  ) {
    return this.citationVerify.verify(user, body);
  }

  /**
   * AI destekli arama: sorgu genişletme + yerel havuz araması + karar özeti.
   *
   * MALİYET KAPISI: tek istek 1 + `summarizeTop` (tavan 5) kadar LLM çağrısı
   * üretir ve fatura BYO-LLM olduğu için doğrudan büroya yazılır; bu yüzden
   * hız sınırında 6 çağrı sayılır.
   */
  @Post("ai-search")
  @AiThrottle(6)
  // Dosya bağlamı verilmişse ölçüme katılır: gövde 80 bayt olsa bile çağrı
  // 1 planlama + N özetlemedir ve dosya bağlamıyla beslenir.
  @AiCredits("CASELAW_SEARCH", {
    caseIdFrom: (body) => (body as { caseId?: string } | undefined)?.caseId,
  })
  @HttpCode(200)
  aiSearch(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(aiSearchSchema)) body: AiSearchInput,
  ) {
    return this.caselaw.aiSearch(user, body);
  }

  /** Elle karar girişi (ManualEntryAdapter) — havuzun gerçek verilerle dolduğu yol. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCaseLawSchema)) body: CreateCaseLawInput,
  ) {
    return this.caselaw.createManual(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.caselaw.detail(user.tenantId, id);
  }

  @Post(":id/summarize")
  @AiThrottle(1)
  @AiCredits("CASELAW_SUMMARIZE")
  @HttpCode(200)
  summarize(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(summarizeCaseLawSchema)) body: SummarizeCaseLawInput,
  ) {
    return this.caselaw.summarize(user, id, body);
  }
}

/** Dosya–emsal bağları: /cases/:caseId/caselaw */
@Controller("cases")
export class CaseCaselawController {
  constructor(private readonly caselaw: CaselawService) {}

  @Get(":caseId/caselaw")
  list(@CurrentUser() user: AuthUser, @Param("caseId") caseId: string) {
    return this.caselaw.listCaseReferences(user.tenantId, caseId);
  }

  /** Emsal bağlar — kayıt daima ADAY açılır; kabul kararı avukatındır. */
  @Post(":caseId/caselaw")
  link(
    @CurrentUser() user: AuthUser,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(linkCaseLawSchema)) body: LinkCaseLawInput,
  ) {
    return this.caselaw.linkToCase(user, caseId, body);
  }
}

/** Emsal bağı statü güncellemesi: /caselaw-references/:id */
@Controller("caselaw-references")
export class CaseLawReferencesController {
  constructor(private readonly caselaw: CaselawService) {}

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCaseLawReferenceSchema)) body: UpdateCaseLawReferenceInput,
  ) {
    return this.caselaw.updateReference(user, id, body);
  }
}
