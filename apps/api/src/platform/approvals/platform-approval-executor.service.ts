import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type PlatformApprovalRequest, type PlatformRole, type SupportScope } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { adjustmentRejection } from "../../credits/credit-plans";
import { PlatformAuditService } from "../platform-audit.service";
import { MAINTENANCE_SETTING_KEY, SUPPORT_GRANT_MAX_HOURS } from "../platform.constants";
import { ADMIN_ROLES } from "../platform-permissions";
import { superAdminFloorViolation } from "../users/super-admin-floor";
import { PURGE_ESCAPE_HATCH_GUC } from "../audit/append-only";
import { topologicalDeleteOrder, type ForeignKeyEdge } from "../tenants/tenant-purge-order";
import { assertTransition } from "../subscriptions/subscription-state";
import type { PlatformAuthUser } from "../platform.types";
import {
  APPROVAL_ACTIONS,
  type AuditExportPayload,
  type CreditManualAdjustPayload,
  type FeatureFlagGlobalPayload,
  type MaintenanceLockPayload,
  type PaymentRefundPayload,
  type PlanCreatePayload,
  type PlanPriceChangePayload,
  type PlatformUserCreatePayload,
  type PlatformUserCredentialResetPayload,
  type SubscriptionCancelPayload,
  type SubscriptionPlanChangePayload,
  type SuperAdminPayload,
  type SupportAccessPayload,
  type TenantDeletePayload,
  type TenantStatusPayload,
} from "./approval-actions";

/** `SupportScope` enum'unun çalışma zamanı beyaz listesi (kontrolsüz cast yok). */
const SUPPORT_SCOPES: readonly SupportScope[] = [
  "SADECE_USTVERI",
  "YAPILANDIRMA",
  "ICERIK_MASKELI",
];

/**
 * ONAYLANAN DÖRT-GÖZ TALEBİNİ GERÇEKTEN UYGULAYAN KATMAN.
 *
 * NEDEN AYRI SINIF: onay servisi tenant/abonelik/ödeme/sistem servislerinin
 * hepsine bağımlı olsaydı dairesel bağımlılık zinciri doğardı (her servis de
 * talep açmak için onay servisine ihtiyaç duyar). Executor yalnızca Prisma ve
 * denetim servisini tanır; kimseyi geri çağırmaz.
 *
 * Onay bir "niyet beyanı" değil, İŞLEMİN KENDİSİDİR: payload burada uygulanır,
 * sonuç PlatformAuditLog'a yazılır (spec kabul kriteri 4 ve 5).
 */
@Injectable()
export class PlatformApprovalExecutorService {
  private readonly logger = new Logger(PlatformApprovalExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  /** Onaylanan talebi uygular; uygulanamazsa hata fırlatır (talep BEKLIYOR kalır). */
  async execute(request: PlatformApprovalRequest, approver: PlatformAuthUser): Promise<string> {
    const payload = this.parsePayload(request.payloadJson);

    switch (request.action) {
      // denetim bulgusu O-28 -> spec dort-goz listesinin 1. ve 8. maddeleri.
      case APPROVAL_ACTIONS.TENANT_DELETE:
        return this.deleteTenant(payload as TenantDeletePayload, approver);
      case APPROVAL_ACTIONS.AUDIT_EXPORT:
        return this.authorizeAuditExport(request.id, payload as AuditExportPayload, approver);
      // denetim bulgusu K-11 -> fiyatli yeni plan tek imzayla yaratilamaz.
      case APPROVAL_ACTIONS.PLAN_CREATE:
        return this.createPlan(payload as PlanCreatePayload, approver);
      case APPROVAL_ACTIONS.TENANT_SUSPEND:
        return this.setTenantSubscriptionStatus(payload as TenantStatusPayload, "SUSPENDED", approver);
      case APPROVAL_ACTIONS.TENANT_ACTIVATE:
        return this.setTenantSubscriptionStatus(payload as TenantStatusPayload, "ACTIVE", approver);
      case APPROVAL_ACTIONS.SUBSCRIPTION_PLAN_CHANGE:
        return this.changePlan(payload as SubscriptionPlanChangePayload, approver);
      case APPROVAL_ACTIONS.SUBSCRIPTION_CANCEL:
        return this.cancelSubscription(payload as SubscriptionCancelPayload, approver);
      case APPROVAL_ACTIONS.PAYMENT_REFUND:
        return this.refund(payload as PaymentRefundPayload, approver);
      case APPROVAL_ACTIONS.SUPPORT_ACCESS_GRANT:
        return this.grantSupportAccess(payload as SupportAccessPayload, approver);
      case APPROVAL_ACTIONS.SYSTEM_MAINTENANCE_LOCK:
        return this.setMaintenance(payload as MaintenanceLockPayload, approver);
      case APPROVAL_ACTIONS.FEATURE_FLAG_GLOBAL:
        return this.setGlobalFlag(payload as FeatureFlagGlobalPayload, approver);
      case APPROVAL_ACTIONS.PLATFORM_USER_SUPER_ADMIN:
        return this.assignSuperAdmin(payload as SuperAdminPayload, approver);
      case APPROVAL_ACTIONS.PLATFORM_USER_CREATE:
        return this.createPlatformUser(payload as PlatformUserCreatePayload, approver);
      case APPROVAL_ACTIONS.PLATFORM_USER_CREDENTIAL_RESET:
        return this.resetCredentials(payload as PlatformUserCredentialResetPayload, approver);
      case APPROVAL_ACTIONS.PLAN_PRICE_CHANGE:
        return this.changePlanPrice(payload as PlanPriceChangePayload, approver);
      case APPROVAL_ACTIONS.CREDIT_MANUAL_ADJUST:
        return this.adjustCredits(payload as CreditManualAdjustPayload, approver);
      default:
        throw new BadRequestException(
          `Bu onay talebinin işlemi (${request.action}) uygulanabilir değil. ` +
            "Talep reddedilmeli ve işlem elle gözden geçirilmelidir."
        );
    }
  }

  private parsePayload(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new BadRequestException(
        "Onay talebinin işlem parametreleri okunamadı; talep uygulanamaz."
      );
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Tenant askıya alma / aktifleştirme.
   *
   * ÖNEMLİ: `Tenant` tablosunda `status` alanı YOKTUR (Faz 3 şeması). Askı
   * durumu tek yazıcı olan ABONELİK üzerinden ifade edilir: Subscription.status
   * = SUSPENDED. Tenant tarafındaki giriş engeli, abonelik durumunu okuyan bir
   * guard ile Faz 4'te bağlanacaktır (teslim raporunda not düşüldü). Veri
   * SİLİNMEZ — spec §İş Kuralları 9.
   */
  private async setTenantSubscriptionStatus(
    payload: TenantStatusPayload,
    to: "SUSPENDED" | "ACTIVE",
    approver: PlatformAuthUser
  ): Promise<string> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { tenantId: payload.tenantId },
    });
    if (!subscription) {
      throw new NotFoundException("Bu büronun aboneliği bulunamadı; durum değiştirilemedi.");
    }
    assertTransition(subscription.status, to);

    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { status: to },
    });

    const label = to === "SUSPENDED" ? "askıya alındı" : "yeniden aktifleştirildi";
    await this.audit.log({
      actor: approver,
      action: to === "SUSPENDED" ? "TENANT_SUSPEND" : "TENANT_ACTIVATE",
      entity: "Subscription",
      entityId: subscription.id,
      tenantId: payload.tenantId,
      detail: `Abonelik ${subscription.status} → ${to}. Gerekçe: ${payload.reason}`,
    });
    return `Büro aboneliği ${label} (${subscription.status} → ${to}).`;
  }

  private async changePlan(
    payload: SubscriptionPlanChangePayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { id: payload.subscriptionId },
    });
    if (!subscription) throw new NotFoundException("Abonelik bulunamadı.");

    if (payload.planKey) {
      // planKey bir FK DEĞİLDİR (plan silinse abonelik ayakta kalsın diye);
      // bu yüzden geçerliliği UYGULAMA KATMANINDA doğrulanmak zorundadır.
      const plan = await this.prisma.client.planTier.findUnique({
        where: { key: payload.planKey },
      });
      if (!plan) {
        throw new BadRequestException(`"${payload.planKey}" anahtarlı bir plan bulunamadı.`);
      }
      if (!plan.isActive) {
        throw new BadRequestException(
          `"${plan.name}" planı satıştan kaldırılmış; yeni abonelik bu plana geçirilemez.`
        );
      }
    }

    const updated = await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: {
        planKey: payload.planKey ?? subscription.planKey,
        seats: payload.seats ?? subscription.seats,
      },
    });

    await this.audit.log({
      actor: approver,
      action: "SUBSCRIPTION_PLAN_CHANGE",
      entity: "Subscription",
      entityId: subscription.id,
      tenantId: subscription.tenantId,
      detail:
        `Plan ${subscription.planKey} → ${updated.planKey}, koltuk ` +
        `${subscription.seats} → ${updated.seats}. Gerekçe: ${payload.reason}. ` +
        "Fiyat farkı (proration) bu fazda hesaplanmaz; cari dönem sonunda yansır.",
    });
    return `Abonelik güncellendi: plan ${updated.planKey}, ${updated.seats} koltuk.`;
  }

  private async cancelSubscription(
    payload: SubscriptionCancelPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { id: payload.subscriptionId },
    });
    if (!subscription) throw new NotFoundException("Abonelik bulunamadı.");
    assertTransition(subscription.status, "CANCELED");

    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });

    await this.audit.log({
      actor: approver,
      action: "SUBSCRIPTION_CANCEL",
      entity: "Subscription",
      entityId: subscription.id,
      tenantId: subscription.tenantId,
      detail:
        `Abonelik iptal edildi (${subscription.status} → CANCELED). ` +
        `Gerekçe: ${payload.reason}. Veri SİLİNMEZ; saklama süresi sonunda ` +
        "anonimleştirme kuyruğu Faz 6'da devreye girer.",
    });
    return "Abonelik iptal edildi. Büro verisi silinmedi.";
  }

  /**
   * İADE.
   *
   * SAHTE ENTEGRASYON YOK: bu kurulumda gerçek bir ödeme sağlayıcısı (iyzico /
   * Stripe) kimlik bilgisi bulunmadığından sağlayıcıya iletim YAPILMAZ. Kayıt
   * `IADE` durumuna çekilir ve denetim izine "sağlayıcıya iletilmedi" notu
   * düşülür. Muhasebe, iadeyi sağlayıcı panelinden elle tamamlar.
   */
  private async refund(payload: PaymentRefundPayload, approver: PlatformAuthUser): Promise<string> {
    const payment = await this.prisma.client.paymentRecord.findUnique({
      where: { id: payload.paymentId },
    });
    if (!payment) throw new NotFoundException("Ödeme kaydı bulunamadı.");
    if (payment.status === "IADE") {
      throw new BadRequestException("Bu ödeme zaten iade edilmiş.");
    }
    if (payment.status !== "BASARILI") {
      throw new BadRequestException(
        "Yalnızca başarılı tahsilatlar iade edilebilir. Bu kaydın durumu: " + payment.status
      );
    }

    await this.prisma.client.paymentRecord.update({
      where: { id: payment.id },
      data: { status: "IADE" },
    });

    await this.audit.log({
      actor: approver,
      action: "PAYMENT_REFUND",
      entity: "PaymentRecord",
      entityId: payment.id,
      tenantId: payment.tenantId,
      detail:
        `Tutar ${payment.amount.toFixed(2)} ${payment.currency} iade olarak işaretlendi. ` +
        `Gerekçe: ${payload.reason}. ÖDEME SAĞLAYICISINA İLETİLMEDİ ` +
        "(entegratör yapılandırılmamış); iade sağlayıcı panelinden elle tamamlanmalıdır.",
    });
    return (
      `Ödeme iade olarak işaretlendi (${payment.amount.toFixed(2)} ${payment.currency}). ` +
      "Ödeme sağlayıcısı entegrasyonu yapılandırılmadığı için tutarın sağlayıcı tarafında " +
      "elle iade edilmesi gerekir."
    );
  }

  /**
   * DESTEK ERİŞİM PENCERESİ AÇMA.
   *
   * Impersonation YASAKTIR (spec §Güvenlik 5). Burada üretilen şey salt-okur,
   * süreli ve kapsamlı bir penceredir. Kayıt HEM PlatformAuditLog'a HEM de
   * ilgili büronun kendi AuditLog'una yazılır.
   */
  private async grantSupportAccess(
    payload: SupportAccessPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException("Büro (tenant) bulunamadı.");

    const grantee = await this.prisma.client.platformUser.findUnique({
      where: { id: payload.platformUserId },
      select: { id: true, fullName: true, email: true, isActive: true },
    });
    if (!grantee || !grantee.isActive) {
      throw new BadRequestException(
        "Erişim talep eden panel kullanıcısı pasif ya da silinmiş; pencere açılamaz."
      );
    }

    /**
     * PAYLOAD YENİDEN DOĞRULANIR.
     *
     * Talep bugün yalnızca `supportAccessSchema`'dan geçen tek bir uçtan
     * doğuyor; ama üst sınırın TEK savunma hattı o şema olmamalıdır. Payload
     * onay anında yeniden kısıtlanır: pencere 24 saati aşamaz, kapsam enum
     * beyaz listesinden geçmeden yazılmaz (kontrolsüz `as SupportScope` cast'i
     * kaldırıldı — denetim bulgusu 12).
     */
    const hours = Math.min(
      Math.max(1, Math.floor(Number(payload.hours) || 0)),
      SUPPORT_GRANT_MAX_HOURS
    );
    if (!SUPPORT_SCOPES.includes(payload.scope as SupportScope)) {
      throw new BadRequestException(
        `Geçersiz destek erişim kapsamı: "${payload.scope}". Kabul edilenler: ` +
          `${SUPPORT_SCOPES.join(", ")}. Pencere açılmadı.`
      );
    }

    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + hours * 60 * 60 * 1000);
    const grant = await this.prisma.client.supportAccessGrant.create({
      data: {
        tenantId: payload.tenantId,
        platformUserId: payload.platformUserId,
        reason: payload.reason,
        scope: payload.scope as SupportScope,
        grantedAt,
        expiresAt,
      },
    });

    await this.audit.logBoth({
      actor: approver,
      action: "SUPPORT_GRANT_CREATE",
      tenantAction: "PLATFORM_DESTEK_ERISIMI",
      entity: "SupportAccessGrant",
      entityId: grant.id,
      tenantId: payload.tenantId,
      detail:
        `Destek erişimi açıldı: ${grantee.fullName} (${grantee.email}), kapsam ${payload.scope}, ` +
        `${hours} saat, bitiş ${expiresAt.toISOString()}. Gerekçe: ${payload.reason}. ` +
        "Erişim SALT-OKUR ve PII maskelidir; kullanıcı kimliğine bürünme (impersonation) yoktur.",
    });

    return `Destek erişimi açıldı; ${expiresAt.toISOString()} tarihinde kendiliğinden kapanacak.`;
  }

  private async setMaintenance(
    payload: MaintenanceLockPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const value = JSON.stringify({
      enabled: payload.enabled,
      fullLock: payload.enabled,
      message: payload.message ?? "Sistem bakımdadır. Kısa süre sonra tekrar deneyin.",
      updatedAt: new Date().toISOString(),
    });

    await this.prisma.client.systemSetting.upsert({
      where: { key: MAINTENANCE_SETTING_KEY },
      create: {
        key: MAINTENANCE_SETTING_KEY,
        valueJson: value,
        description: "Bakım modu tam kilidi (dört-göz onayı ile değişir).",
        updatedBy: approver.id,
      },
      update: { valueJson: value, updatedBy: approver.id },
    });

    await this.audit.log({
      actor: approver,
      action: "SYSTEM_MAINTENANCE_LOCK",
      entity: "SystemSetting",
      entityId: MAINTENANCE_SETTING_KEY,
      detail: `Bakım tam kilidi ${payload.enabled ? "AÇILDI" : "KAPATILDI"}. Gerekçe: ${payload.reason}`,
    });
    return `Bakım modu tam kilidi ${payload.enabled ? "açıldı" : "kapatıldı"}.`;
  }

  private async setGlobalFlag(
    payload: FeatureFlagGlobalPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const flag = await this.prisma.client.featureFlag.findUnique({ where: { id: payload.flagId } });
    if (!flag) throw new NotFoundException("Özellik bayrağı bulunamadı.");

    await this.prisma.client.featureFlag.update({
      where: { id: flag.id },
      data: { isEnabledGlobally: payload.isEnabledGlobally, updatedBy: approver.id },
    });

    await this.audit.log({
      actor: approver,
      action: "FEATURE_FLAG_GLOBAL",
      entity: "FeatureFlag",
      entityId: flag.id,
      detail:
        `"${flag.key}" bayrağı platform genelinde ` +
        `${payload.isEnabledGlobally ? "AÇILDI" : "KAPATILDI"}. Gerekçe: ${payload.reason}`,
    });
    return `"${flag.key}" bayrağı platform genelinde ${payload.isEnabledGlobally ? "açıldı" : "kapatıldı"}.`;
  }

  /**
   * SUPER_ADMIN atama (iki SUPER_ADMIN kuralı).
   * Yeni kullanıcı oluşturuluyorsa parola talep anında HASH'lenmiştir;
   * payloadJson'da düz parola bulunmaz.
   */
  private async assignSuperAdmin(
    payload: SuperAdminPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    if (payload.targetUserId) {
      const mode = payload.mode ?? "promote";
      if (mode === "promote") {
        const target = await this.prisma.client.platformUser.findUnique({
          where: { id: payload.targetUserId },
        });
        if (!target) throw new NotFoundException("Panel kullanıcısı bulunamadı.");
        await this.prisma.client.platformUser.update({
          where: { id: target.id },
          data: { role: "SUPER_ADMIN" },
        });
        await this.audit.log({
          actor: approver,
          action: "PLATFORM_USER_SUPER_ADMIN",
          entity: "PlatformUser",
          entityId: target.id,
          detail: `${target.email} rolü ${target.role} → SUPER_ADMIN. Gerekçe: ${payload.reason}`,
        });
        return `${target.email} artık SUPER_ADMIN.`;
      }
      return this.demoteSuperAdmin(payload.targetUserId, mode, payload.reason, approver);
    }

    if (!payload.newUser) {
      throw new BadRequestException("Onay talebinde hedef kullanıcı bilgisi yok.");
    }
    const existing = await this.prisma.client.platformUser.findUnique({
      where: { email: payload.newUser.email },
    });
    if (existing) {
      throw new BadRequestException("Bu e-posta ile bir panel kullanıcısı zaten var.");
    }
    const created = await this.prisma.client.platformUser.create({
      data: {
        email: payload.newUser.email,
        fullName: payload.newUser.fullName,
        passwordHash: payload.newUser.passwordHash,
        role: "SUPER_ADMIN",
      },
    });
    await this.audit.log({
      actor: approver,
      action: "PLATFORM_USER_SUPER_ADMIN",
      entity: "PlatformUser",
      entityId: created.id,
      detail: `Yeni SUPER_ADMIN oluşturuldu: ${created.email}. Gerekçe: ${payload.reason}`,
    });
    return `${created.email} SUPER_ADMIN olarak oluşturuldu.`;
  }

  /**
   * SUPER_ADMIN DÜŞÜRME / PASİFLEŞTİRME — denetim bulgusu Ö-02.
   *
   * Spec §Roller madde 7 "yeni SUPER_ADMIN atama / mevcut SUPER_ADMIN'i
   * DÜŞÜRME" der; kodda yalnız atama onaya düşüyordu, düşürme ve pasifleştirme
   * tek imzalıydı.
   *
   * TABAN SAYIMI TRANSACTION İÇİNDEDİR: talep 72 saate kadar bekleyebilir ve
   * bu sürede başka SUPER_ADMIN'ler pasifleşmiş olabilir. Ayrıca aynı anda
   * onaylanan iki talep, ikisi de "geriye yeterli sayı kalıyor" görüp sistemi
   * tabanın altına düşürebilirdi. Sayım ve yazma tek transaction'dadır ve
   * yazma, sayımın dayandığı koşulu kendi WHERE'inde taşır.
   */
  private async demoteSuperAdmin(
    targetUserId: string,
    mode: "demote" | "deactivate",
    reason: string,
    approver: PlatformAuthUser
  ): Promise<string> {
    const message = await this.prisma.client.$transaction(async (tx) => {
      const target = await tx.platformUser.findUnique({ where: { id: targetUserId } });
      if (!target) throw new NotFoundException("Panel kullanıcısı bulunamadı.");
      if (target.role !== "SUPER_ADMIN") {
        throw new BadRequestException(
          `${target.email} zaten SUPER_ADMIN değil; bu talep uygulanamaz.`
        );
      }
      if (mode === "deactivate" && !target.isActive) {
        throw new BadRequestException("Bu hesap zaten pasif.");
      }

      const remaining = await tx.platformUser.count({
        where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } },
      });
      const violation = superAdminFloorViolation(remaining);
      if (violation) throw new BadRequestException(violation);

      const data =
        mode === "deactivate"
          ? { isActive: false, tokenVersion: { increment: 1 } }
          : { role: "OPS_ADMIN" as PlatformRole, tokenVersion: { increment: 1 } };

      const written = await tx.platformUser.updateMany({
        where: { id: target.id, role: "SUPER_ADMIN", isActive: true },
        data,
      });
      if (written.count === 0) {
        throw new BadRequestException(
          "Hedef hesabın durumu talep açıldıktan sonra değişti; talep uygulanamadı."
        );
      }

      return mode === "deactivate"
        ? `${target.email} pasifleştirildi. Geriye ${remaining} aktif SUPER_ADMIN kaldı.`
        : `${target.email} rolü SUPER_ADMIN → OPS_ADMIN. Geriye ${remaining} aktif SUPER_ADMIN kaldı.`;
    });

    await this.audit.log({
      actor: approver,
      action: mode === "deactivate" ? "PLATFORM_USER_DEACTIVATE" : "PLATFORM_USER_SUPER_ADMIN",
      entity: "PlatformUser",
      entityId: targetUserId,
      detail: `${message} DÖRT-GÖZ onayıyla. Gerekçe: ${reason}`,
    });
    return message;
  }

  /**
   * TENANT KALICI SİLME / VERİ İMHASI — spec dört-göz madde 1 (bulgu Ö-28).
   *
   * GERİ ALINAMAZ. Bu yüzden üç kapı vardır:
   *   1. talep anında VE uygulama anında büro adı doğrulaması,
   *   2. silme sırası Postgres'in FK kataloğundan topolojik olarak hesaplanır
   *      (elle taşınan bir tablo listesi bir sonraki migration'da bayatlardı),
   *   3. kiracıya bağlı olup `tenantId` TAŞIMAYAN bir tablo bulunursa işlem
   *      HİÇ BAŞLAMAZ — yarım silinmiş kiracı, silinmemiş kiracıdan kötüdür.
   *
   * Denetim izi silinmez: `PlatformAuditLog.tenantId` FK taşımaz (şema yorumu:
   * "kiracı silinse iz kalır") ve tablo kasten hariç tutulur — 10 yıllık
   * saklama yükümlülüğü kiracının ömründen uzundur.
   */
  private async deleteTenant(
    payload: TenantDeletePayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException("Büro bulunamadı; silme uygulanamadı.");
    if (tenant.name.trim() !== (payload.confirmName ?? "").trim()) {
      throw new BadRequestException(
        `Doğrulama başarısız: talepte "${payload.confirmName}" yazıyor, büronun adı ` +
          `"${tenant.name}". Veri imhası uygulanmadı.`
      );
    }

    const plan = await this.buildTenantPurgePlan();
    if (plan.blockers.length > 0) {
      throw new BadRequestException(
        "Veri imhası BAŞLATILMADI: şu tablolar kiracı verisine bağlı ama `tenantId` " +
          `sütunu taşımıyor, silme sırası güvenle hesaplanamıyor: ${plan.blockers.join(", ")}.`
      );
    }

    const deleted = await this.prisma.client.$transaction(async (tx) => {
      // Ö-27 ile Ö-28'in kesişimi: `RiskScoreHistory` ve `CreditTransaction`
      // append-only tetikleyicisi taşır ama `tenantId` de taşır, yani imha
      // kapsamındadır. `SET LOCAL` yalnız BU transaction için DELETE'i açar;
      // UPDATE hâlâ reddedilir ve `PlatformAuditLog` zaten kapsam dışıdır.
      // Bu, dört-göz onaylı ve denetim izine yazılan tek kaçış deliğidir.
      await tx.$executeRawUnsafe(`SET LOCAL "${PURGE_ESCAPE_HATCH_GUC}" = 'on'`);
      let rows = 0;
      for (const table of plan.order) {
        rows += await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "tenantId" = $1`,
          tenant.id
        );
      }
      rows += await tx.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = $1`, tenant.id);
      return rows;
    });

    await this.audit.log({
      actor: approver,
      action: "TENANT_DELETE",
      entity: "Tenant",
      entityId: tenant.id,
      tenantId: tenant.id,
      detail:
        `"${tenant.name}" bürosu ve tüm verisi KALICI olarak silindi (${deleted} satır, ` +
        `${plan.order.length} tablo). DÖRT-GÖZ onayıyla. Gerekçe: ${payload.reason}. ` +
        "Denetim izi kaydı korunur.",
    });
    return `"${tenant.name}" bürosu kalıcı olarak silindi (${deleted} satır).`;
  }

  /**
   * Silme planını Postgres kataloğundan çıkarır.
   * `PlatformAuditLog` bilinçli olarak hariçtir (10 yıllık saklama).
   */
  private async buildTenantPurgePlan(): Promise<{ order: string[]; blockers: string[] }> {
    const KEEP: readonly string[] = ["PlatformAuditLog", "Tenant"];

    const columns = await this.prisma.client.$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'tenantId'
        AND t.table_type = 'BASE TABLE'
    `;
    const scoped = columns
      .map((r) => r.table_name)
      .filter((name) => /^[A-Za-z0-9_]+$/.test(name) && !KEEP.includes(name));
    const scopedSet = new Set(scoped);

    const fks = await this.prisma.client.$queryRaw<{ dependent: string; referenced: string }[]>`
      SELECT child.relname AS dependent, parent.relname AS referenced
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = 'public'
    `;

    const blockers = [
      ...new Set(
        fks
          .filter((e) => scopedSet.has(e.referenced) && !scopedSet.has(e.dependent))
          .filter((e) => !KEEP.includes(e.dependent))
          .map((e) => e.dependent)
      ),
    ].sort();

    const edges: ForeignKeyEdge[] = fks.filter(
      (e) => scopedSet.has(e.dependent) && scopedSet.has(e.referenced)
    );
    return { order: topologicalDeleteOrder(scoped, edges), blockers };
  }

  /**
   * DENETİM İZİ DIŞA AKTARIMINI YETKİLENDİRİR — spec dört-göz madde 8 (Ö-28).
   *
   * Onay, dosyayı burada ÜRETMEZ: talep 72 saate kadar bekleyebilir ve o sürede
   * yeni kayıtlar oluşur; dondurulmuş bir kopya yanıltıcı olurdu. Onay,
   * `GET /audit/export/:approvalId` ucunu TEK SEFERLİK açar; indirme anı ayrıca
   * denetim izine yazılır ve ikinci indirme reddedilir.
   */
  private async authorizeAuditExport(
    approvalId: string,
    payload: AuditExportPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    await this.audit.log({
      actor: approver,
      action: "AUDIT_EXPORT_APPROVED",
      entity: "PlatformApprovalRequest",
      entityId: approvalId,
      tenantId: payload.tenantId ?? null,
      detail:
        "Platform denetim izi dışa aktarımı DÖRT-GÖZ onayıyla yetkilendirildi. " +
        `Süzgeç: ${payload.from ?? "-"} → ${payload.to ?? "-"}` +
        `${payload.tenantId ? `, büro ${payload.tenantId}` : ""}` +
        `${payload.action ? `, işlem ${payload.action}` : ""}. Gerekçe: ${payload.reason}. ` +
        "İndirme TEK SEFERLİKTİR ve ayrıca loglanır.",
    });
    return (
      "Dışa aktarım yetkilendirildi. Talebi açan kişi " +
      `GET /api/admin/v1/audit/export/${approvalId} ucundan TEK SEFER indirebilir.`
    );
  }

  /**
   * YENİ PLAN OLUŞTURMA — denetim bulgusu K-11.
   *
   * `createPlan` fiyatlı yepyeni bir ürünü tek imzayla yaratıyordu; panel ise
   * aynı işlem için dört-göz rozetini gösteriyordu. Artık onay anında uygulanır
   * ve anahtar çakışması UYGULAMA anında yeniden kontrol edilir.
   */
  private async createPlan(
    payload: PlanCreatePayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const existing = await this.prisma.client.planTier.findUnique({
      where: { key: payload.key },
    });
    if (existing) {
      throw new BadRequestException(
        `"${payload.key}" anahtarlı bir plan talep açıldıktan sonra oluşturulmuş; ` +
          "bu talep uygulanamaz."
      );
    }
    const plan = await this.prisma.client.planTier.create({
      data: {
        key: payload.key,
        name: payload.name,
        monthlyPricePerUser: payload.monthlyPricePerUser,
        maxUsers: payload.maxUsers,
        featuresJson: payload.featuresJson,
        isActive: payload.isActive,
      },
    });
    await this.audit.log({
      actor: approver,
      action: "PLAN_CREATE",
      entity: "PlanTier",
      entityId: plan.id,
      detail:
        `${plan.key} planı DÖRT-GÖZ onayıyla oluşturuldu ` +
        `(${plan.monthlyPricePerUser?.toFixed(2) ?? "fiyatsız"}). Gerekçe: ${payload.reason}`,
    });
    return `${plan.key} planı oluşturuldu.`;
  }

  /**
   * PANEL PERSONELİ AÇMA (SUPER_ADMIN dışı roller).
   *
   * Parola talep anında HASH'lenmiştir; `payloadJson` düz parola taşımaz.
   * Rol, çalışma zamanında beyaz listeye karşı doğrulanır — payload'a güven
   * duyulmaz (talep şemadan geçse bile executor kendi kapısını kurar).
   */
  private async createPlatformUser(
    payload: PlatformUserCreatePayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    if (!payload.newUser?.email || !payload.newUser.passwordHash) {
      throw new BadRequestException("Onay talebinde kullanıcı bilgisi eksik.");
    }
    if (!(ADMIN_ROLES as readonly string[]).includes(payload.newUser.role)) {
      throw new BadRequestException(`Geçersiz panel rolü: "${payload.newUser.role}".`);
    }
    if (payload.newUser.role === "SUPER_ADMIN") {
      // SUPER_ADMIN'in kendi aksiyonu vardır; bu daldan sızmamalı.
      throw new BadRequestException(
        "SUPER_ADMIN ataması bu talep türüyle yapılamaz; PLATFORM_USER_SUPER_ADMIN kullanılır."
      );
    }

    const existing = await this.prisma.client.platformUser.findUnique({
      where: { email: payload.newUser.email },
    });
    if (existing) {
      throw new BadRequestException("Bu e-posta ile bir panel kullanıcısı zaten var.");
    }

    const created = await this.prisma.client.platformUser.create({
      data: {
        email: payload.newUser.email,
        fullName: payload.newUser.fullName,
        passwordHash: payload.newUser.passwordHash,
        role: payload.newUser.role as PlatformRole,
      },
      select: { id: true, email: true, role: true },
    });

    await this.audit.log({
      actor: approver,
      action: "PLATFORM_USER_CREATE",
      entity: "PlatformUser",
      entityId: created.id,
      detail:
        `${created.email} (${created.role}) DÖRT-GÖZ onayıyla oluşturuldu. ` +
        `Gerekçe: ${payload.reason}`,
    });
    return `${created.email} (${created.role}) oluşturuldu.`;
  }

  /**
   * BAŞKASININ PAROLASINI / 2FA KAYDINI SIFIRLAMA.
   *
   * `tokenVersion` ARTIRILIR: hedef kullanıcının açık tüm panel oturumları
   * anında düşer. Sıfırlama, ele geçirilmiş bir oturumu kapatmak için
   * yapıldığında bu şarttır — aksi hâlde saldırganın token'ı 8 saat daha
   * geçerli kalırdı (denetim bulgusu 5).
   */
  private async resetCredentials(
    payload: PlatformUserCredentialResetPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const target = await this.prisma.client.platformUser.findUnique({
      where: { id: payload.targetUserId },
    });
    if (!target) throw new NotFoundException("Panel kullanıcısı bulunamadı.");
    if (target.id === approver.id) {
      throw new BadRequestException(
        "Kendi kimlik bilgilerinizi bu yoldan sıfırlayamazsınız; /auth/change-password kullanın."
      );
    }

    const data: Prisma.PlatformUserUpdateInput = { tokenVersion: { increment: 1 } };
    const done: string[] = [];
    if (payload.passwordHash) {
      data.passwordHash = payload.passwordHash;
      // Sıfırlama aynı zamanda kilidi kaldırır: kilit, unutulan parolanın
      // sonucu olabilir ve yeni parola verilmişken kilit tutmanın anlamı yok.
      data.failedAttempts = 0;
      data.lockedUntil = null;
      done.push("parola değiştirildi");
    }
    if (payload.resetTwoFactor) {
      data.twoFactorSecret = null;
      // Tekrar oynatma sayacı da sıfırlanır: yeni 2FA kurulumu yeni adımlarla
      // başlar, eski sayaç yeni kurulumu bloklamasın (İ-01).
      data.lastTotpCounter = null;
      done.push("2FA kaydı sıfırlandı");
    }
    if (done.length === 0) {
      throw new BadRequestException("Onay talebinde sıfırlanacak bir kimlik bilgisi yok.");
    }

    await this.prisma.client.platformUser.update({ where: { id: target.id }, data });

    await this.audit.log({
      actor: approver,
      action: "PLATFORM_USER_CREDENTIAL_RESET",
      entity: "PlatformUser",
      entityId: target.id,
      detail:
        `${target.email}: ${done.join(", ")} (DÖRT-GÖZ onayıyla). Kullanıcının tüm panel ` +
        `oturumları sonlandırıldı. Gerekçe: ${payload.reason}`,
    });
    return `${target.email} için ${done.join(" ve ")}; açık oturumları sonlandırıldı.`;
  }

  /** PLAN KATALOĞU FİYAT DEĞİŞİKLİĞİ — tüm kiracıları etkiler, iki imza ister. */
  private async changePlanPrice(
    payload: PlanPriceChangePayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const plan = await this.prisma.client.planTier.findUnique({ where: { id: payload.planId } });
    if (!plan) throw new NotFoundException("Plan bulunamadı.");

    const next =
      payload.monthlyPricePerUser === null ? null : new Prisma.Decimal(payload.monthlyPricePerUser);
    const updated = await this.prisma.client.planTier.update({
      where: { id: plan.id },
      data: { monthlyPricePerUser: next },
    });

    const affected = await this.prisma.client.subscription.count({
      where: { planKey: plan.key, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    });

    await this.audit.log({
      actor: approver,
      action: "PLAN_PRICE_CHANGE",
      entity: "PlanTier",
      entityId: plan.id,
      detail:
        `${plan.key} planı fiyatı ${plan.monthlyPricePerUser?.toFixed(2) ?? "-"} → ` +
        `${updated.monthlyPricePerUser?.toFixed(2) ?? "-"}. Etkilenen aktif abonelik: ${affected}. ` +
        `Gerekçe: ${payload.reason}. Mevcut aboneler cari dönem sonuna kadar eski fiyattan devam eder.`,
    });
    return (
      `${plan.key} planı fiyatı güncellendi (${updated.monthlyPricePerUser?.toFixed(2) ?? "-"}). ` +
      `${affected} aktif abonelik cari dönem sonunda etkilenecek.`
    );
  }

  /**
   * MANUEL KREDİ TAHSİSİ / KOTA DÜZELTMESİ (Modül 26, iş kuralı 9).
   *
   * NEDEN BURADA VE PRİSMA İLE: bu sınıfın kuralı "yalnız Prisma ve denetim
   * servisini tanır, kimseyi geri çağırmaz"dır. `CreditService`i çağırmak
   * PlatformModule → CreditsModule → PlatformModule döngüsü yaratırdı
   * (kredi modülü dört-göz talebi açmak için onay servisine ihtiyaç duyar).
   * Cüzdan yazımı birkaç satırdır ve o döngüye değmez.
   *
   * BAKİYE NEGATİFE ÇEKİLEMEZ: onay 72 saate kadar beklemiş olabilir; talebin
   * açıldığı andaki doğrulama BUGÜN hâlâ geçerli olmayabilir. Bu yüzden kapı
   * UYGULAMA ANINDA yeniden kurulur.
   */
  private async adjustCredits(
    payload: CreditManualAdjustPayload,
    approver: PlatformAuthUser
  ): Promise<string> {
    const wallet = await this.prisma.client.creditWallet.findUnique({
      where: { tenantId: payload.tenantId },
    });
    if (!wallet) {
      throw new NotFoundException(
        "Bu büro için kredi cüzdanı bulunamadı; düzeltme uygulanamadı."
      );
    }

    const done: string[] = [];
    const delta = payload.deltaCredits ? Math.trunc(payload.deltaCredits) : 0;
    const rejection = adjustmentRejection(wallet, delta);
    if (rejection) throw new BadRequestException(rejection);

    /**
     * HAREKET DEFTERİ, CÜZDANLA AYNI İŞLEMDE VE AYNI TUTARDA.
     *
     * Denetimde KRİTİK bulgu: bu metot cüzdan bakiyesini değiştirip
     * `CreditTransaction.amount = 0` yazıyordu. `renewPeriod` yolunda
     * `includedConsumed = 0` yapılıyor, yani daha önce TÜKETİLMİŞ kredi
     * bakiyeye geri dönüyor; yanan kota için `SURESI_DOLDU` hareketi hiç
     * yazılmıyordu. Örnek: included=500, consumed=300 → bakiye 200, defter 200
     * (tutarlı). Yenileme sonrası bakiye 500, defter 200 → KALICI +300 sapma
     * ve deftere görünmeden yaratılmış kredi.
     *
     * `CreditService.renewPeriod` aynı işi doğru yapar (`SURESI_DOLDU` +
     * `TAHSIS`) ama bu sınıfın kuralı "yalnız Prisma'yı tanır, kimseyi geri
     * çağırmaz"dır (PlatformModule ↔ CreditsModule döngüsü). Bu yüzden aynı
     * MUHASEBE burada tekrarlanır — eksik değil, birebir.
     *
     * Cüzdan güncellemesi ile hareket yazımı TEK `$transaction` içindedir:
     * ikisi ayrı yazılırken ikincisi düşerse defter eksik kalırdı.
     */
    const ledger: { type: "DUZELTME" | "TAHSIS" | "SURESI_DOLDU"; amount: number; note: string }[] =
      [];

    const data: Prisma.CreditWalletUpdateInput = {};
    if (delta !== 0) {
      data.purchasedCredits = { increment: delta };
      done.push(`${delta > 0 ? "+" : ""}${delta} kredi`);
      ledger.push({
        type: "DUZELTME",
        amount: delta,
        note:
          `PLATFORM DÜZELTMESİ (dört-göz onaylı, onaylayan ${approver.email}). ` +
          `Gerekçe: ${payload.reason}`,
      });
    }

    // Dönem yenileme ile dahil kota değişimi AYNI kovayı oynatır; ikisi birlikte
    // gelirse yenilemenin yeni kotası, ayarlanan `includedCredits` olur.
    const nextIncluded = payload.includedCredits ?? wallet.includedCredits;

    if (payload.renewPeriod) {
      // Dönem yenileme: dahil kota SIFIRLANIR (devretmez), satın alınan KORUNUR.
      const now = new Date();
      data.includedConsumed = 0;
      data.documentUsed = 0;
      data.periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      data.periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      data.includedCredits = nextIncluded;
      done.push("dönem yenilendi (dahil kota sıfırlandı, satın alınan korundu)");

      // 1) Kullanılmayan dahil kota YANAR — deftere negatif olarak geçer.
      const expiring = Math.max(0, wallet.includedCredits - wallet.includedConsumed);
      if (expiring > 0) {
        ledger.push({
          type: "SURESI_DOLDU",
          amount: -expiring,
          note:
            `Dönem sonunda kullanılmayan ${expiring} dahil kredi sıfırlandı (devretmez). ` +
            `Dört-göz onaylı yenileme, onaylayan ${approver.email}.`,
        });
      }
      // 2) Yeni dönemin kotası TAHSİS edilir — deftere pozitif olarak geçer.
      ledger.push({
        type: "TAHSIS",
        amount: nextIncluded,
        note:
          `Dönem başı dahil kota tahsisi: ${nextIncluded} kredi (dört-göz onaylı). ` +
          `Gerekçe: ${payload.reason}`,
      });
    } else if (payload.includedCredits !== undefined) {
      data.includedCredits = payload.includedCredits;
      done.push(`dahil kota ${wallet.includedCredits} → ${payload.includedCredits}`);
      // Yenileme yok: yalnız kotanın FARKI kadar bakiye değişir.
      const diff = payload.includedCredits - wallet.includedCredits;
      if (diff !== 0) {
        ledger.push({
          type: "TAHSIS",
          amount: diff,
          note:
            `Dahil kota ${wallet.includedCredits} → ${payload.includedCredits} olarak ayarlandı ` +
            `(dört-göz onaylı, onaylayan ${approver.email}). Dahil kota DEVRETMEZ; ` +
            `satın alınan krediler korunur. Gerekçe: ${payload.reason}`,
        });
      }
    }

    if (payload.documentQuota !== undefined) {
      data.documentQuota = payload.documentQuota;
      done.push(`belge kotası ${wallet.documentQuota} → ${payload.documentQuota}`);
      // Belge kotası KREDİ DEĞİLDİR; hareket defterine girmez.
    }

    const updated = Object.keys(data).length
      ? await this.prisma.client.$transaction(async (tx) => {
          const row = await tx.creditWallet.update({
            where: { tenantId: payload.tenantId },
            data,
          });
          const balanceAfter =
            row.includedCredits - row.includedConsumed + row.purchasedCredits;
          for (const entry of ledger) {
            await tx.creditTransaction.create({
              data: {
                tenantId: payload.tenantId,
                type: entry.type,
                amount: entry.amount,
                balanceAfter,
                note: entry.note,
              },
            });
          }
          return row;
        })
      : wallet;

    // BYO-LLM muafiyeti — SystemSetting listesine yazılır (kredi kapısının
    // okuduğu tek kaynak). Kredi modülünün önbelleği en geç 30 sn içinde düşer.
    if (payload.byoLlm !== undefined) {
      const key = "credits.byo_llm_tenants";
      const setting = await this.prisma.client.systemSetting.findUnique({ where: { key } });
      let ids: string[] = [];
      try {
        const parsed = setting ? (JSON.parse(setting.valueJson) as { tenantIds?: unknown }) : null;
        if (Array.isArray(parsed?.tenantIds)) {
          ids = parsed.tenantIds.filter((v): v is string => typeof v === "string");
        }
      } catch {
        ids = [];
      }
      const next = new Set(ids);
      if (payload.byoLlm) next.add(payload.tenantId);
      else next.delete(payload.tenantId);
      const valueJson = JSON.stringify({ tenantIds: [...next].sort() });

      await this.prisma.client.systemSetting.upsert({
        where: { key },
        create: {
          key,
          valueJson,
          description:
            "Kredi kapısından MUAF tenant'lar (BYO-LLM). Bu bürolarda AI maliyeti kendi " +
            "sağlayıcı hesaplarındadır; kota uygulanmaz.",
          updatedBy: approver.id,
        },
        update: { valueJson, updatedBy: approver.id },
      });
      done.push(`BYO-LLM muafiyeti ${payload.byoLlm ? "AÇILDI" : "KAPATILDI"}`);
    }

    if (done.length === 0) {
      throw new BadRequestException("Onay talebinde uygulanacak bir kredi değişikliği yok.");
    }

    await this.audit.log({
      actor: approver,
      action: "CREDIT_MANUAL_ADJUST",
      entity: "CreditWallet",
      entityId: updated.id,
      tenantId: payload.tenantId,
      detail: `${done.join(" · ")}. Gerekçe: ${payload.reason}`,
    });

    return `Kredi düzeltmesi uygulandı: ${done.join(" · ")}.`;
  }
}
