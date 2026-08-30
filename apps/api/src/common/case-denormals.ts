import type { PrismaClient } from "@nomosos/db";

/**
 * Case.nextHearingAt (ilk gelecek PLANLANDI duruşma) ve Case.lastActivityAt alanlarını tazeler.
 * Duruşma/safahat/not/karar/süre yazımlarından sonra çağrılır.
 */
export async function refreshCaseDenormals(
  prisma: PrismaClient,
  caseId: string,
  activityAt: Date = new Date()
): Promise<void> {
  const next = await prisma.hearing.findFirst({
    where: { caseId, status: "PLANLANDI", date: { gte: new Date() } },
    orderBy: { date: "asc" },
    select: { date: true },
  });

  await prisma.case.update({
    where: { id: caseId },
    data: { nextHearingAt: next?.date ?? null, lastActivityAt: activityAt },
  });
}

/** Yalnızca son hareket zamanını günceller (duruşma değişmediyse). */
export async function touchCase(
  prisma: PrismaClient,
  caseId: string,
  activityAt: Date = new Date()
): Promise<void> {
  await prisma.case.update({ where: { id: caseId }, data: { lastActivityAt: activityAt } });
}
