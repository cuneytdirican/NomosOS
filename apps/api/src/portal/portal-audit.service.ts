import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface PortalAuditEntry {
  tenantId: string;
  /** PortalUser.id */
  portalUserId: string;
  /** PORTAL_LOGIN | PORTAL_CASE_VIEW | PORTAL_DOCUMENT_DOWNLOAD | ... */
  action: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
}

/**
 * PORTAL DENETİM İZİ — büro `AuditLog`'undan AYRI tablo.
 *
 * NEDEN AYRI: "müvekkil neyi, ne zaman gördü?" sorusu KVKK açısından büro içi
 * işlem izinden bağımsız olarak ispatlanabilir olmalıdır. İki iz tek tabloda
 * karışsaydı, bir müvekkilin erişim kaydını çıkarmak için büro trafiğini de
 * taramak gerekirdi.
 *
 * Denetim kaydı yazılamazsa istek BOZULMAZ (büro `AuditService` ile aynı
 * disiplin): iz tutmanın başarısızlığı, müvekkilin kendi dosyasını görememesi
 * için yeterli bir gerekçe değildir. Hata sunucu günlüğüne düşer.
 */
@Injectable()
export class PortalAuditService {
  private readonly logger = new Logger(PortalAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: PortalAuditEntry): Promise<void> {
    try {
      await this.prisma.client.portalAuditLog.create({
        data: {
          tenantId: entry.tenantId,
          portalUserId: entry.portalUserId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          ipAddress: entry.ipAddress,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Portal denetim kaydı yazılamadı (${entry.action}): ${(err as Error).message}`
      );
    }
  }
}
