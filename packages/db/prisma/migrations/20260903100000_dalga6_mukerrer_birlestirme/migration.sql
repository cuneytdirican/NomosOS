-- D6 — mükerrer müvekkil birleştirme günlüğü (Modül 01 kural 10).
-- Birleştirme geri alınamaz; birleştirilen kart PASSIVE olur (silinmez).

CREATE TABLE "ClientMergeLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "survivingClientId" TEXT NOT NULL,
    "mergedClientId" TEXT NOT NULL,
    "countsJson" TEXT NOT NULL,
    "mergedById" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientMergeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientMergeLog_tenantId_mergedAt_idx" ON "ClientMergeLog"("tenantId", "mergedAt");
CREATE INDEX "ClientMergeLog_survivingClientId_idx" ON "ClientMergeLog"("survivingClientId");

-- AddForeignKey
ALTER TABLE "ClientMergeLog" ADD CONSTRAINT "ClientMergeLog_survivingClientId_fkey"
  FOREIGN KEY ("survivingClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientMergeLog" ADD CONSTRAINT "ClientMergeLog_mergedClientId_fkey"
  FOREIGN KEY ("mergedClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
