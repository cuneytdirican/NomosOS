import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PlatformApprovalRequest, SupportScope } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { MAINTENANCE_SETTING_KEY } from "../platform.constants";
import { assertTransition } from "../subscriptions/subscription-state";
import type { PlatformAuthUser } from "../platform.types";
import {
  APPROVAL_ACTIONS,
  type FeatureFlagGlobalPayload,
  type MaintenanceLockPayload,
  type PaymentRefundPayload,
  type SubscriptionCancelPayload,
  type SubscriptionPlanChangePayload,
  type SuperAdminPayload,
  type SupportAccessPayload,
  type TenantStatusPayload,
} from "./approval-actions";

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

    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + payload.hours * 60 * 60 * 1000);
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
        `${payload.hours} saat, bitiş ${expiresAt.toISOString()}. Gerekçe: ${payload.reason}. ` +
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
}
