-- DALGA 4 (geliştirme planı D4 / A6): icra derinliği — kıymet takdiri,
-- satış/artırma kaydı, konkordato/iflas süreç takibi.
--
-- DÜRÜSTLÜK: otomatik yasal süre üretimi bilinçli olarak YOKTUR — süre
-- hükümleri (İİK m.106/3, m.286-293) koşullu ve içtihatlıdır; süreleri
-- avukat mevcut süre motorundan elle kurar. Bu tablolar GERÇEK kayıt
-- tutar, hesap uydurmaz.

CREATE TABLE "AssetValuation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "appraiserType" TEXT NOT NULL,
    "appraiserName" TEXT,
    "appraisedValue" DECIMAL(18,2) NOT NULL,
    "appraisedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetValuation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetValuation_assetId_idx" ON "AssetValuation"("assetId");
CREATE INDEX "AssetValuation_tenantId_appraisedAt_idx" ON "AssetValuation"("tenantId", "appraisedAt");

ALTER TABLE "AssetValuation" ADD CONSTRAINT "AssetValuation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AssetRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AssetSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "saleType" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "minimumBid" DECIMAL(18,2),
    "depositRatio" DECIMAL(5,2),
    "result" TEXT NOT NULL,
    "soldAmount" DECIMAL(18,2),
    "buyerName" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetSale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetSale_assetId_idx" ON "AssetSale"("assetId");
CREATE INDEX "AssetSale_tenantId_result_idx" ON "AssetSale"("tenantId", "result");

ALTER TABLE "AssetSale" ADD CONSTRAINT "AssetSale_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AssetRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ConcordatoProcess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT,
    "processType" TEXT NOT NULL DEFAULT 'CONCORDATO',
    "status" TEXT NOT NULL DEFAULT 'BASVURU',
    "court" TEXT,
    "fileNo" TEXT,
    "stageAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConcordatoProcess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConcordatoProcess_tenantId_status_idx" ON "ConcordatoProcess"("tenantId", "status");
CREATE INDEX "ConcordatoProcess_tenantId_caseId_idx" ON "ConcordatoProcess"("tenantId", "caseId");

ALTER TABLE "ConcordatoProcess" ADD CONSTRAINT "ConcordatoProcess_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
