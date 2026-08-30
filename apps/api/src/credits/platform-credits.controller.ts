/**
 * PLATFORM KREDİ UÇLARI — `/api/admin/v1/credits/*` ve `/api/admin/v1/model-prices`.
 *
 * Kimlik ve yetki zinciri `@PlatformController` ile kurulur (tenant token'ı
 * burada geçersizdir). Yetki matrisi `platform-permissions.ts`tedir.
 *
 * MANUEL KREDİ TAHSİSİ DÖRT-GÖZDÜR (iş kuralı 9): uç işlemi YAPMAZ, bir
 * `PlatformApprovalRequest` üretir. Talebi açan kişi kendi talebini
 * onaylayamaz; uygulama, farklı bir yetkilinin onayından sonra
 * `PlatformApprovalExecutorService` içinde gerçekleşir.
 */

import { Body, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PlatformController } from "../platform/decorators/platform-controller.decorator";
import { ADMIN_ROUTE_PREFIX } from "../platform/platform.constants";
import { CurrentPlatformUser } from "../platform/decorators/current-platform-user.decorator";
import {
  ReadPermission,
  WritePermission,
} from "../platform/decorators/platform-permission.decorator";
import { PlatformApprovalsService } from "../platform/approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../platform/approvals/approval-actions";
import type { PlatformAuthUser } from "../platform/platform.types";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PlatformCreditsService } from "./platform-credits.service";
import {
  adminAdjustCreditsSchema,
  adminUpdateTaskCostSchema,
  adminUpsertModelPriceSchema,
  type AdminAdjustCreditsInput,
  type AdminUpdateTaskCostInput,
  type AdminUpsertModelPriceInput,
} from "./credits.dto";

@PlatformController(`${ADMIN_ROUTE_PREFIX}/credits`)
export class PlatformCreditsController {
  constructor(
    private readonly credits: PlatformCreditsService,
    private readonly approvals: PlatformApprovalsService,
  ) {}

  /** Tenant başına kota/tüketim. ANALYST'e kapalı, ANALYST marj raporunu ayrıca görür. */
  @Get("tenants")
  @ReadPermission("credits.tenant.view")
  listTenants(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Query() query: { q?: string; mode?: string },
  ) {
    return this.credits.listTenants(actor, query);
  }

  @Get("tenants/:id")
  @ReadPermission("credits.tenant.view")
  tenantDetail(@CurrentPlatformUser() actor: PlatformAuthUser, @Param("id") id: string) {
    return this.credits.tenantDetail(actor, id);
  }

  /**
   * MANUEL KREDİ TAHSİSİ / DÜZELTME — DÖRT-GÖZ.
   *
   * Uç, işlemi uygulamak yerine onay talebi açar ve `approvalRequired: true`
   * döner (kabul kriteri 11). Payload onay anında yeniden doğrulanır.
   */
  @Patch("tenants/:id")
  @WritePermission("credits.tenant.adjust")
  async adjust(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(adminAdjustCreditsSchema)) body: AdminAdjustCreditsInput,
  ) {
    // Cüzdan yoksa açılır; olmayan bir cüzdana onay talebi açmak, onay anında
    // uygulanamayacak bir talep üretirdi.
    await this.credits.ensureWallet(id);
    await this.credits.validateAdjustment(id, body);

    const parts: string[] = [];
    if (body.deltaCredits !== undefined) parts.push(`${body.deltaCredits > 0 ? "+" : ""}${body.deltaCredits} kredi`);
    if (body.includedCredits !== undefined) parts.push(`dahil kota → ${body.includedCredits}`);
    if (body.documentQuota !== undefined) parts.push(`belge kotası → ${body.documentQuota}`);
    if (body.byoLlm !== undefined) parts.push(`BYO-LLM muafiyeti → ${body.byoLlm ? "AÇIK" : "KAPALI"}`);
    if (body.renewPeriod) parts.push("dönem yenileme");

    return this.approvals.request(actor, {
      action: APPROVAL_ACTIONS.CREDIT_MANUAL_ADJUST,
      tenantId: id,
      payload: { tenantId: id, ...body },
      summary: `Kredi düzeltmesi: ${parts.join(" · ")}. Gerekçe: ${body.reason}`,
    });
  }

  /** Görev başına kredi fiyat listesi. */
  @Get("costs")
  @ReadPermission("credits.pricing.view")
  listCosts() {
    return this.credits.listTaskCosts();
  }

  /** Fiyat listesi düzenleme — kod dağıtımı gerektirmez. */
  @Patch("costs")
  @WritePermission("credits.pricing.write")
  updateCost(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(adminUpdateTaskCostSchema)) body: AdminUpdateTaskCostInput,
  ) {
    return this.credits.updateTaskCost(actor, body);
  }

  /** MALİYET / GELİR / MARJ — ANALYST_READONLY takma adlı görür (kabul kriteri 12). */
  @Get("margin")
  @ReadPermission("credits.margin.view")
  margin(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Query() query: { from?: string; to?: string },
  ) {
    return this.credits.margin(actor, query);
  }

  /** Anormal tüketim uyarıları (iş kuralı 11) — kesme değil, uyarı. */
  @Get("anomalies")
  @ReadPermission("credits.tenant.view")
  anomalies() {
    return this.credits.anomalies();
  }
}

/**
 * MODEL FİYAT TABLOSU — iç maliyet, kullanıcıya gösterilmez.
 * Ayrı controller çünkü yolu `/credits` altında değildir (spec §API Uçları).
 */
@PlatformController(`${ADMIN_ROUTE_PREFIX}/model-prices`)
export class PlatformModelPricesController {
  constructor(private readonly credits: PlatformCreditsService) {}

  @Get()
  @ReadPermission("credits.pricing.view")
  list(@Query() query: { providerType?: string; model?: string }) {
    return this.credits.listModelPrices(query);
  }

  /**
   * Fiyat ekleme/güncelleme. GERİYE DÖNÜK UYGULANMAZ: farklı bir
   * `effectiveFrom` ile gönderilen fiyat yeni bir satır açar, eskisi durur.
   */
  @Patch()
  @WritePermission("credits.pricing.write")
  upsert(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(adminUpsertModelPriceSchema)) body: AdminUpsertModelPriceInput,
  ) {
    return this.credits.upsertModelPrice(actor, body);
  }

  /** PATCH ile aynı iş; panelin "yeni fiyat ekle" formu POST kullanır. */
  @Post()
  @WritePermission("credits.pricing.write")
  create(
    @CurrentPlatformUser() actor: PlatformAuthUser,
    @Body(new ZodValidationPipe(adminUpsertModelPriceSchema)) body: AdminUpsertModelPriceInput,
  ) {
    return this.credits.upsertModelPrice(actor, body);
  }
}
