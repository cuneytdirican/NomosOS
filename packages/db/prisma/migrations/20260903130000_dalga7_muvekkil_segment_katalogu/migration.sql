-- D7/M3 — müvekkil segment kataloğu (kiracı bazlı yönetilen liste).
-- Client.category bu listeden seçilir; kod sabiti değil, büronun kendi
-- segmentasyonudur.

CREATE TABLE "ClientSegment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientSegment_tenantId_label_key" ON "ClientSegment"("tenantId", "label");
CREATE INDEX "ClientSegment_tenantId_isActive_idx" ON "ClientSegment"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "ClientSegment" ADD CONSTRAINT "ClientSegment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
