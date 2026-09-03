-- D7 — vergi dairesi kataloğu (yargı kataloğu deseniyle aynı hiyerarşi:
-- SEED temsilî → SYNC resmî liste → MANUAL panel).

CREATE TABLE "TaxOffice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "il" TEXT NOT NULL,
    "ilce" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxOffice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxOffice_name_key" ON "TaxOffice"("name");
CREATE INDEX "TaxOffice_il_idx" ON "TaxOffice"("il");
