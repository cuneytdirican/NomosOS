/**
 * Sözleşme modülü HTTP uçları (prefix /api/v1).
 *
 *   GET  /contracts/renewals                    · yenileme/fesih takvimi
 *   GET/POST      /contracts
 *   GET/PATCH/DEL /contracts/:id
 *   POST /contracts/:id/transition              · durum makinesi
 *   GET/POST /contracts/:id/versions            · sürümler (IMMUTABLE)
 *   GET  /contract-versions/:id                 · metin dâhil tek sürüm
 *   POST /contracts/:id/review                  · CONTRACT_REVIEW (kredili)
 *   POST /contracts/:id/signature-request       · e-imza süreci başlat
 *   GET  /contracts/:id/signature-requests
 *   GET  /signature-requests/:id/status
 *   POST /signature-requests/:id/cancel
 *   GET  /signature-providers/health            · Ayarlar → E-imza
 *
 * ROTA SIRASI KRİTİKTİR: "renewals" sabit yolu `:id` rotalarından ÖNCE
 * tanımlanır; aksi hâlde bir sözleşme kimliği sanılır.
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
import { ContractRenewalService } from "./contract-renewal.service";
import { ContractsAiService } from "./contracts-ai.service";
import { ContractsSignatureService } from "./contracts-signature.service";
import { ContractsService } from "./contracts.service";
import {
  cancelSignatureRequestSchema,
  createContractSchema,
  createSignatureRequestSchema,
  createVersionSchema,
  reviewContractSchema,
  transitionContractSchema,
  updateContractSchema,
  type CancelSignatureRequestInput,
  type CreateContractInput,
  type CreateSignatureRequestInput,
  type CreateVersionInput,
  type ReviewContractInput,
  type TransitionContractInput,
  type UpdateContractInput,
} from "./contracts.dto";

@Controller("contracts")
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly renewal: ContractRenewalService,
    private readonly signature: ContractsSignatureService,
    private readonly ai: ContractsAiService,
  ) {}

  /* ---------------- Sabit yollar (`:id`den ÖNCE) ---------------- */

  /**
   * Yaklaşan yenileme/fesih takvimi. HESAP DETERMİNİSTİKTİR — AI yok, kredi
   * tüketilmez, kayıt AÇILMAZ.
   */
  @Get("renewals")
  renewals(@CurrentUser() user: AuthUser, @Query("days") days?: string) {
    return this.renewal.upcoming(user, days ? Number(days) : undefined);
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
    return this.contracts.list(user, { clientId, caseId, status, type, q, page, limit });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createContractSchema)) body: CreateContractInput,
  ) {
    return this.contracts.create(user, body);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.contracts.detail(user, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateContractSchema)) body: UpdateContractInput,
  ) {
    return this.contracts.update(user, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.contracts.remove(user, id);
  }

  /* ------------------------ Durum makinesi ---------------------- */

  /**
   * Durum geçişi. Geçersiz geçiş 400 + izin verilen geçişlerin listesi döner.
   * YURURLUKTE'ye çıkış için imzalı süreç ya da `manualApproval` + açıklama şart.
   */
  @Post(":id/transition")
  @HttpCode(200)
  transition(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(transitionContractSchema)) body: TransitionContractInput,
  ) {
    return this.contracts.transition(user, id, body);
  }

  /* --------------------------- Sürümler ------------------------- */

  @Get(":id/versions")
  listVersions(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.contracts.listVersions(user, id);
  }

  /** Yeni sürüm — DEĞİŞTİRİLEMEZ. İmza sürecindeyken 409 döner. */
  @Post(":id/versions")
  @HttpCode(201)
  createVersion(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createVersionSchema)) body: CreateVersionInput,
  ) {
    return this.contracts.createVersion(user, id, body);
  }

  /* ---------------------------- E-imza -------------------------- */

  /**
   * E-imza süreci başlat. Sağlayıcı yapılandırılmamışsa 503 + "Ayarlar →
   * E-imza" yönlendirmesi döner; SÖZLEŞME IMZAYA_HAZIR'DA KALIR ve
   * `SignatureRequest` kaydı AÇILMAZ (sahte süreç bırakılmaz).
   *
   * İKİ YOL: koleksiyona POST (`/signature-requests`) REST açısından asıl
   * biçimdir ve büro paneli bunu çağırır; tekil yol (`/signature-request`)
   * eşdeğer bir takma addır. İkisi de AYNI metoda gider — davranış tek yerde
   * kalır, iki uygulama sürüklenmesi olmaz.
   */
  @Post([":id/signature-requests", ":id/signature-request"])
  @HttpCode(201)
  createSignatureRequest(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSignatureRequestSchema))
    body: CreateSignatureRequestInput,
  ) {
    return this.signature.createRequest(user, id, body);
  }

  @Get(":id/signature-requests")
  listSignatureRequests(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.signature.listForContract(user, id);
  }

  /* ------------------------- AI incelemesi ---------------------- */

  /**
   * CONTRACT_REVIEW — kredi hattından geçer (`AiTaskCost`: 20 kredi).
   *
   * BAĞLAM UZUNLUĞU: kredi kapısı `parentCaseId` ile dosya bağlamını çözebilir
   * ama "CONTRACT" üst kayıt türü kredi motorunda TANIMLI DEĞİLDİR (o dosya
   * başka bir ajanın sahipliğindedir). Bu yüzden tahmin gövdeden yapılır ve
   * taban fiyata düşer; mahsuplaşma gerçek token'a göre yapıldığından fatura
   * yine doğrudur, yalnızca ÖN REZERVASYON düşük kalır.
   */
  @Post(":id/review")
  @AiThrottle(1)
  @AiCredits("CONTRACT_REVIEW")
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reviewContractSchema)) body: ReviewContractInput,
  ) {
    return this.ai.review(user, id, body);
  }
}

/** Sürüm metnini tek başına okuma ucu: /contract-versions/:id */
@Controller("contract-versions")
export class ContractVersionsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.contracts.versionDetail(user, id);
  }
}

/** İmza süreci kayıtları: /signature-requests */
@Controller("signature-requests")
export class SignatureRequestsController {
  constructor(private readonly signature: ContractsSignatureService) {}

  /** Sağlayıcıdan güncel durumu okur ve yerel kaydı durum makinesinden geçirir. */
  @Get(":id/status")
  status(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.signature.status(user, id);
  }

  /** Süreci iptal eder; sözleşme IMZADA ise IMZAYA_HAZIR'a geri döner. */
  @Post(":id/cancel")
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelSignatureRequestSchema))
    body: CancelSignatureRequestInput,
  ) {
    return this.signature.cancel(user, id, body);
  }
}

/** Ayarlar → E-imza ekranı: /signature-providers/health */
@Controller("signature-providers")
export class SignatureProvidersController {
  constructor(private readonly signature: ContractsSignatureService) {}

  @Get("health")
  health() {
    return this.signature.health();
  }
}
