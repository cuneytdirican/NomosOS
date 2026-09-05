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

/** Dinleyicilere iletilen kayıt (webhook fan-out — Enterprise++ entegrasyonlar). */
export type AuditListenerEntry = AuditEntry;
export type AuditListener = (entry: AuditListenerEntry) => Promise<unknown> | unknown;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  private readonly listeners: AuditListener[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Denetim kaydı dinleyicisi (webhook olay kaynağı). Dinleyici hatası denetim
   * kaydını ve iş akışını BOZMAZ — her dinleyici kendi try/catch'i içinde.
   */
  subscribe(listener: AuditListener): void {
    this.listeners.push(listener);
  }

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
    for (const listener of this.listeners) {
      try {
        await listener(entry);
      } catch (err) {
        this.logger.warn(`Denetim dinleyicisi hata verdi (${entry.action}): ${(err as Error).message}`);
      }
    }
  }
}
