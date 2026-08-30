/**
 * KİRACI KREDİ UÇLARI — `/api/v1/credits/*`
 *
 * Bu uçların HİÇBİRİ AI çağırmaz; hiçbiri kredi tüketmez. Kredi göstergesinin
 * kendisi krediye bağlanamaz.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { CreditService } from "./credit.service";
import { MAX_CREDITS_PER_REQUEST } from "./credit-plans";
import {
  autoTopUpSchema,
  estimateCreditsSchema,
  purchaseCreditsSchema,
  type AutoTopUpInput,
  type EstimateCreditsInput,
  type PurchaseCreditsInput,
} from "./credits.dto";

@Controller("credits")
export class CreditsController {
  constructor(private readonly credits: CreditService) {}

  /** Bakiye, dönem, kullanım yüzdesi. Her role açık — gösterge herkes içindir. */
  @Get("wallet")
  wallet(@CurrentUser() user: AuthUser) {
    return this.credits.getWallet(user.tenantId);
  }

  /** Hareket dökümü (PARTNER / ADMIN). */
  @Get("transactions")
  transactions(
    @CurrentUser() user: AuthUser,
    @Query()
    query: {
      type?: string;
      taskType?: string;
      userId?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    },
  ) {
    return this.credits.listTransactions(user, query);
  }

  /** Dönemsel tüketim kırılımı — görev tipi, kullanıcı ve gün bazında. */
  @Get("usage")
  usage(@CurrentUser() user: AuthUser) {
    return this.credits.usageBreakdown(user);
  }

  /**
   * Görev başına kredi fiyat listesi.
   * ÜCRETSİZ LİSTESİ BURADAN OKUNUR — arayüz `isFree` alanına bakar, koda
   * gömülü bir liste tutmaz (iş kuralı 3).
   */
  @Get("costs")
  async costs() {
    const rows = await this.credits.listCosts();
    return {
      istekBasinaTavan: MAX_CREDITS_PER_REQUEST,
      items: rows.map((r) => ({
        taskType: r.taskType,
        credits: r.isFree ? 0 : r.credits,
        isFree: r.isFree,
        description: r.description,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /** `{taskType, caseId?}` → tahmini kredi. LLM'e hiçbir şey gitmez. */
  @Post("estimate")
  @HttpCode(200)
  estimate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(estimateCreditsSchema)) body: EstimateCreditsInput,
  ) {
    return this.credits.estimateForCase(user, body.taskType, body.caseId, body.contextChars);
  }

  /** Satın alınabilir paketler (PARTNER / ADMIN). */
  @Get("packages")
  packages(@CurrentUser() user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "kredi paketlerini görüntüleme");
    return this.credits.listPackages();
  }

  /** Ek paket satın alma → `InvoiceRecord` (platform faturası) üretir. */
  @Post("purchase")
  purchase(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(purchaseCreditsSchema)) body: PurchaseCreditsInput,
  ) {
    return this.credits.purchase(user, body.packageKey);
  }

  /** Otomatik yükleme aç/kapat. Açarken AÇIK ONAY zorunludur (iş kuralı 12). */
  @Patch("auto-topup")
  autoTopUp(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(autoTopUpSchema)) body: AutoTopUpInput,
  ) {
    if (body.packageKey && body.onay !== true) {
      throw new BadRequestException(
        "Otomatik yükleme açılırken açık onay gerekir (onay: true). Bu ayar, bakiye " +
          "bittiğinde sizin adınıza ücretli paket satın alır ve fatura üretir.",
      );
    }
    return this.credits.setAutoTopUp(user, body.packageKey);
  }

  /*
   * KALDIRILDI — `POST /credits/renew` (KRİTİK denetim bulgusu: kredi basma).
   *
   * Uç kiracıya açıktı ve gövdesinde `force: true` kabul ediyordu. Bir büro
   * PARTNER'ı kotasını tükettiği anda ucu çağırıp `includedConsumed = 0`
   * yaptırıyor ve tam kotayı geri alıyordu; döngünün sınırı yoktu. Kotanın
   * yenilenmesi FATURALAMA tarafının kararıdır; kotayı tüketen tarafın değil.
   * docs/moduller/26 §API Uçları tablosunda böyle bir kiracı ucu zaten yoktur.
   *
   * Yenileme bugün YALNIZ platform tarafından, dört-göz onaylı
   * `adminAdjustCreditsSchema.renewPeriod` alanıyla yapılır. Faz 6'nın
   * zamanlayıcısı `CreditService.renewPeriod`'u doğrudan çağıracaktır; HTTP
   * ucuna ihtiyacı yoktur.
   */

  /** Mutabakat: hareket defteri toplamı ile cüzdan bakiyesi (kabul kriteri 9). */
  @Get("reconcile")
  reconcile(@CurrentUser() user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "kredi mutabakatını görüntüleme");
    return this.credits.reconcile(user.tenantId);
  }
}
