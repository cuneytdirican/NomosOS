-- Hukuki Veri Kaynağı Besleme Planı — Faz 1
--
-- Platform mevzuat havuzu:
--  * Legislation: tenantId/uploadedBy nullable (platform kayıtları) + kaynak
--    künyesi alanları (sourceKey, sourceUrl, authorityLevel, rgDate, rgNo).
--  * Statute + StatuteArticleVersion: kanun kimliği ve MADDE SÜRÜM zinciri
--    (effectiveFrom/effectiveTo — değişiklik eski metni ezmez).
--  * LegislationIngestItem: mevzuat toplama onay kuyruğu (caselaw-ingest deseni).
--  * CaseLawDocument.authorityLevel: kaynak güven düzeyi (retrieval metadata'sı).

-- AlterTable
ALTER TABLE "CaseLawDocument" ADD COLUMN "authorityLevel" INTEGER;

-- AlterTable
ALTER TABLE "Legislation" ADD COLUMN "authorityLevel" INTEGER,
ADD COLUMN     "rgDate" DATE,
ADD COLUMN     "rgNo" TEXT,
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "uploadedBy" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Statute" (
    "id" TEXT NOT NULL,
    "mevzuatNo" TEXT NOT NULL,
    "mevzuatTur" INTEGER NOT NULL,
    "tertip" INTEGER NOT NULL DEFAULT 5,
    "title" TEXT NOT NULL,
    "abbrs" TEXT,
    "rgDate" DATE,
    "rgNo" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "authorityLevel" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fullText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Statute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatuteArticleVersion" (
    "id" TEXT NOT NULL,
    "statuteId" TEXT NOT NULL,
    "articleNo" TEXT NOT NULL,
    "versionSeq" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "changeRgDate" DATE,
    "changeRgNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatuteArticleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegislationIngestItem" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "number" TEXT,
    "abbrs" TEXT,
    "rgDate" DATE,
    "rgNo" TEXT,
    "sourceUrl" TEXT,
    "fullText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BEKLIYOR',
    "batchId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "poolRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegislationIngestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Statute_title_idx" ON "Statute"("title");

-- CreateIndex
CREATE INDEX "Statute_sourceKey_idx" ON "Statute"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Statute_mevzuatNo_mevzuatTur_key" ON "Statute"("mevzuatNo", "mevzuatTur");

-- CreateIndex
CREATE INDEX "StatuteArticleVersion_statuteId_articleNo_idx" ON "StatuteArticleVersion"("statuteId", "articleNo");

-- CreateIndex
CREATE UNIQUE INDEX "StatuteArticleVersion_statuteId_articleNo_versionSeq_key" ON "StatuteArticleVersion"("statuteId", "articleNo", "versionSeq");

-- CreateIndex
CREATE INDEX "LegislationIngestItem_status_fetchedAt_idx" ON "LegislationIngestItem"("status", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegislationIngestItem_sourceKey_externalKey_key" ON "LegislationIngestItem"("sourceKey", "externalKey");

-- CreateIndex
CREATE INDEX "Legislation_sourceKey_idx" ON "Legislation"("sourceKey");

-- AddForeignKey
ALTER TABLE "StatuteArticleVersion" ADD CONSTRAINT "StatuteArticleVersion_statuteId_fkey" FOREIGN KEY ("statuteId") REFERENCES "Statute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
