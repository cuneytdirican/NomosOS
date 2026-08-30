import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { PlatformAuthUser } from "./platform.types";

export interface PlatformAuditEntry {
  /** İşlemi yapan panel kullanıcısı (başarısız girişte bilinmeyebilir). */
  actor?: Pick<PlatformAuthUser, "id" | "role" | "ip"> | null;
  /** Örn. "TENANT_SUSPEND", "APPROVAL_APPROVE", "SUPPORT_GRANT_CREATE". */
  action: string;
  entity?: string;
  entityId?: string;
  /** İlgili kiracı — FK yoktur, kiracı silinse bile iz kalır. */
  tenantId?: string | null;
  detail?: string;
  ipAddress?: string;
}

/**
 * PLATFORM DENETİM İZİ.
 *
 * Spec §Güvenlik 8: her mutasyon VE her hassas okuma (destek görüntülemesi,
 * ödeme detayı açma, dışa aktarım) loglanır; kayıt append-only'dir ve asgari
 * 10 yıl saklanır.
 *
 * Kayıt yazımı iş akışını DÜŞÜRMEZ (tenant AuditService ile aynı sözleşme):
 * denetim kaydı yazılamazsa uyarı loglanır, kullanıcının işlemi iptal edilmez.
 * Bunun tersi tercih edilseydi, denetim tablosundaki geçici bir arıza tüm
 * paneli kilitlerdi.
 */
@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantAudit: AuditService
  ) {}

  async log(entry: PlatformAuditEntry): Promise<void> {
    try {
      await this.prisma.client.platformAuditLog.create({
        data: {
          platformUserId: entry.actor?.id ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          tenantId: entry.tenantId ?? null,
          detail: truncate(entry.detail),
          ipAddress: entry.ipAddress ?? entry.actor?.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Platform denetim kaydı yazılamadı (${entry.action}): ${(err as Error).message}`
      );
    }
  }

  /**
   * ÇİFT TARAFLI KAYIT — destek erişimi için zorunludur (spec §Güvenlik 6):
   * pencerenin açılışı/kapanışı hem PlatformAuditLog'a hem İLGİLİ KİRACININ
   * kendi AuditLog'una yazılır. Böylece büro, kendisine kimin ne zaman
   * baktığını KENDİ denetim izinde görür (VERBİS uyumu).
   */
  async logBoth(entry: PlatformAuditEntry & { tenantId: string; tenantAction: string }): Promise<void> {
    await this.log(entry);
    await this.tenantAudit.log({
      tenantId: entry.tenantId,
      // Tenant AuditLog.userId bir TENANT kullanıcısını gösterir; platform
      // personeli oraya yazılamaz (yanlış faile atıf olurdu). Kim olduğu
      // `detail` alanında açıkça belirtilir.
      action: entry.tenantAction,
      entity: entry.entity,
      entityId: entry.entityId,
      detail: truncate(entry.detail),
    });
  }
}

/** Denetim detayının sınırsız büyümesini engeller. */
function truncate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 2000 ? `${value.slice(0, 1997)}...` : value;
}
