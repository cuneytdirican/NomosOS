import { Injectable, Logger } from "@nestjs/common";
import type { NotificationKind } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";

export interface OutboxEntry {
  tenantId: string;
  /** Alıcı kullanıcı. Zamanlanmış işler DAİMA somut bir alıcı yazar. */
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  /** Olay kimliği — `dedupe-key.ts` üretir. */
  dedupeKey: string;
  scheduledFor?: Date;
}

export type OutboxOutcome = "yazildi" | "atlandi";

/** Prisma benzersizlik ihlali (P2002) mi? */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * BİLDİRİM GİDEN KUTUSU YAZICISI.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TEK KURAL: ÇİFT BİLDİRİM ÜRETMEK, HİÇ BİLDİRİM ÜRETMEMEKTEN KÖTÜDÜR.
 * Bir avukata aynı süre için iki kez "3 gün kaldı" gitmesi, bildirim
 * sisteminin güvenilirliğini tümden bitirir; insanlar okumayı bırakır.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NEDEN "ÖNCE BAK, SONRA YAZ" DEĞİL:
 *   `findUnique` + `create` iki ayrı işlemdir. İki API örneği (ya da elle
 *   tetikleme ile cron) aynı anda çalıştığında ikisi de "yok" görüp ikisi de
 *   yazar. Tek güvenilir koruma veritabanındaki `@@unique([tenantId,
 *   dedupeKey])` kısıtıdır: ikinci yazma P2002 alır. Burada o hata YAKALANIR,
 *   `atlandi` olarak raporlanır ve HATA SAYILMAZ.
 *
 * NEDEN `upsert` DEĞİL:
 *   `upsert` mevcut kaydı GÜNCELLERDİ. Kullanıcının okuduğu (`OKUNDU`) bir
 *   bildirim, işin ertesi koşusunda yeniden `BEKLIYOR`a dönüp okunmamış gibi
 *   görünürdü. Giden kutusu APPEND-ONLY davranır: bir olay bir kez yazılır ve
 *   bir daha üzerine yazılmaz.
 */
@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(entry: OutboxEntry): Promise<OutboxOutcome> {
    try {
      await this.prisma.client.notificationOutbox.create({
        data: {
          tenantId: entry.tenantId,
          userId: entry.userId,
          kind: entry.kind,
          title: entry.title,
          body: entry.body,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          dedupeKey: entry.dedupeKey,
          scheduledFor: entry.scheduledFor ?? null,
        },
      });
      return "yazildi";
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Beklenen ve SAĞLIKLI durum: olay zaten kuyruğa girmiş.
        this.logger.debug(`Bildirim atlandı (zaten var): ${entry.dedupeKey}`);
        return "atlandi";
      }
      throw err;
    }
  }

  /**
   * Toplu yazım. Tek bir kaydın patlaması diğerlerini engellemez — gecelik iş
   * yüzlerce bildirim üretir ve tek bozuk satır yüzünden hiçbirinin
   * yazılmaması kabul edilemez.
   */
  async enqueueMany(
    entries: OutboxEntry[]
  ): Promise<{ created: number; skipped: number; failed: number; errors: string[] }> {
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      try {
        const outcome = await this.enqueue(entry);
        if (outcome === "yazildi") created += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        const message = `${entry.dedupeKey}: ${(err as Error).message}`;
        if (errors.length < 5) errors.push(message);
        this.logger.warn(`Bildirim yazılamadı — ${message}`);
      }
    }

    return { created, skipped, failed, errors };
  }
}
