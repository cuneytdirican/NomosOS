/**
 * SÖZLEŞME SÜREÇ AKIŞI — append-only olay yazıcısı.
 *
 * ContractEvent kayıtları yalnızca OLUŞTURULUR; bu dosyada (ve modülde)
 * update/delete YOKTUR ve hiçbir zaman olmayacaktır — zaman çizelgesi
 * müzakere geçmişinin kanıtıdır.
 *
 * Olay yazımı ANA AKIŞI BOZMAZ (AuditService ile aynı tolerans): olay
 * yazılamazsa işlem GERİ ALINMAZ, hata günlüğe düşer. Bir sözleşmenin
 * sürüm yüklenmesi, olay satırı patladığı için reddedilemez.
 */

import { Logger } from "@nestjs/common";
import type { ContractEventType, Prisma } from "@nomosos/db";
import type { AuthUser } from "../common/types";

const logger = new Logger("ContractEvent");

export interface ContractEventInput {
  tenantId: string;
  contractId: string;
  type: ContractEventType;
  detail?: string | null;
  /** Olayı tetikleyen kullanıcı — aktr kaydı JSON'a düşer. */
  user: Pick<AuthUser, "userId" | "role">;
}

/** Prisma istemcisi ya da transaction istemcisi — her ikisi de kabul edilir. */
type DbClient = Pick<Prisma.TransactionClient, "contractEvent"> | Prisma.TransactionClient;

export async function appendContractEvent(db: DbClient, input: ContractEventInput): Promise<void> {
  try {
    await db.contractEvent.create({
      data: {
        tenantId: input.tenantId,
        contractId: input.contractId,
        type: input.type,
        detail: input.detail ?? null,
        actorJson: JSON.stringify({ userId: input.user.userId, role: input.user.role }),
        createdBy: input.user.userId,
      },
    });
  } catch (err) {
    logger.warn(
      `Sözleşme olayı yazılamadı (${input.contractId}/${input.type}): ${(err as Error).message}`,
    );
  }
}
