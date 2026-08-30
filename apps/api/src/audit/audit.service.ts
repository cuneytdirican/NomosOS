import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface AuditEntry {
  tenantId: string;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Kritik yazma işlemleri için denetim kaydı. Hata olursa iş akışını bozmaz. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: entry.tenantId,
          userId: entry.userId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          detail: entry.detail,
        },
      });
    } catch (err) {
      this.logger.warn(`Denetim kaydı yazılamadı (${entry.action}): ${(err as Error).message}`);
    }
  }
}
