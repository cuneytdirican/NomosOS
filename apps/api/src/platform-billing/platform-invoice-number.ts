import type { Prisma } from "@nomosos/db";

/**
 * Platform fatura numarası: `NOM-YYYY-000001`. `InvoiceRecord.number` GLOBAL
 * unique'tir; çağıran taraf P2002'de yeniden dener (eşzamanlı üretim yarışı).
 */
export async function nextPlatformInvoiceNumber(
  tx: Pick<Prisma.TransactionClient, "invoiceRecord">,
  year: number,
): Promise<string> {
  const prefix = `NOM-${year}-`;
  const last = await tx.invoiceRecord.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = last?.number ? Number.parseInt(last.number.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(next).padStart(6, "0")}`;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
