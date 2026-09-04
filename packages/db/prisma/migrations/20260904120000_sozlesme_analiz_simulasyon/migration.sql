-- SÖZLEŞME ANALİZİ VE SİMÜLASYON (plans/sozlesme-analiz-ve-simulasyon-modulu-plani.md)
--
-- Mevcut contracts modülü (Contract + ContractVersion + CONTRACT_REVIEW) üzerine
-- genişletme: iki taraflı kalıcı analiz koşuları, avukat şerhleri, sürüm farkları,
-- süreç akışı ve müvekkil bildirim kipi.
--
-- İLKELER:
--  · overallRiskScore SUNUCUDA hesaplanır (KRITIK=10 / ORTA=5 / DUSUK=2, 100'e
--    normalize) — model skoru yazamaz.
--  · Şerh gerekçesi (explanation) ZORUNLUDUR; alıntı metinde birebir doğrulanır.
--  · ContractEvent APPEND-ONLY'dir; değiştirme/silme ucu hiçbir zaman açılmaz.

-- E-imza süreci değil, ANALİZ koşusu: ILK / REVIZYON / NIHAI.
CREATE TYPE "ContractAnalysisMode" AS ENUM ('ILK', 'REVIZYON', 'NIHAI');

CREATE TYPE "ContractAnnotationSeverity" AS ENUM ('KRITIK', 'ORTA', 'DUSUK');

CREATE TYPE "ContractAnnotationStatus" AS ENUM ('ACIK', 'KAPALI', 'SUPERSEDED');

CREATE TYPE "ContractEventType" AS ENUM (
    'YUKLENDI',
    'GONDERILDI',
    'REVIZYON_ALINDI',
    'ANALIZ',
    'SHERH_KAPANDI',
    'MUVEKKIL_BILGILENDIRILDI',
    'IMZALANDI'
);

CREATE TYPE "ContractNotifyMode" AS ENUM ('MANUAL', 'OTOMATIK');

-- Bir analiz koşusu — SimulationRun deseni; koşular DEĞİŞTİRİLEMEZ.
CREATE TABLE "ContractAnalysisRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "mode" "ContractAnalysisMode" NOT NULL,
    "ourSideJson" TEXT NOT NULL,
    "otherSideJson" TEXT NOT NULL,
    "overallRiskScore" INTEGER NOT NULL,
    "model" TEXT,
    "durationMs" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractAnalysisRun_tenantId_createdAt_idx" ON "ContractAnalysisRun"("tenantId", "createdAt");
CREATE INDEX "ContractAnalysisRun_contractId_createdAt_idx" ON "ContractAnalysisRun"("contractId", "createdAt");
CREATE INDEX "ContractAnalysisRun_versionId_idx" ON "ContractAnalysisRun"("versionId");

-- ŞERH — tek gerçek kaynak; AI önerir, avukat komutuyla kalıcılaşır.
CREATE TABLE "ContractClauseAnnotation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "clauseRef" TEXT,
    "severity" "ContractAnnotationSeverity" NOT NULL,
    "explanation" TEXT NOT NULL,
    "quote" TEXT,
    "proposedFix" TEXT,
    "status" "ContractAnnotationStatus" NOT NULL DEFAULT 'ACIK',
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractClauseAnnotation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractClauseAnnotation_contractId_status_idx" ON "ContractClauseAnnotation"("contractId", "status");
CREATE INDEX "ContractClauseAnnotation_runId_idx" ON "ContractClauseAnnotation"("runId");
CREATE INDEX "ContractClauseAnnotation_tenantId_status_idx" ON "ContractClauseAnnotation"("tenantId", "status");

-- İki sürüm arasındaki fark — SUNUCUDA üretilir (satır bazlı basit LCS).
CREATE TABLE "ContractVersionDiff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionAId" TEXT NOT NULL,
    "versionBId" TEXT NOT NULL,
    "addedCount" INTEGER NOT NULL,
    "removedCount" INTEGER NOT NULL,
    "changedCount" INTEGER NOT NULL,
    "addedJson" TEXT NOT NULL,
    "removedJson" TEXT NOT NULL,
    "changedJson" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractVersionDiff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractVersionDiff_versionAId_versionBId_key" ON "ContractVersionDiff"("versionAId", "versionBId");
CREATE INDEX "ContractVersionDiff_contractId_createdAt_idx" ON "ContractVersionDiff"("contractId", "createdAt");

-- Süreç akışı — APPEND-ONLY.
CREATE TABLE "ContractEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" "ContractEventType" NOT NULL,
    "detail" TEXT,
    "actorJson" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractEvent_contractId_createdAt_idx" ON "ContractEvent"("contractId", "createdAt");
CREATE INDEX "ContractEvent_tenantId_createdAt_idx" ON "ContractEvent"("tenantId", "createdAt");

-- Müvekkil kritik şerh bildirimi kipi (varsayılan MANUAL).
CREATE TABLE "ContractNotifySetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "mode" "ContractNotifyMode" NOT NULL DEFAULT 'MANUAL',
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractNotifySetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractNotifySetting_contractId_key" ON "ContractNotifySetting"("contractId");
CREATE INDEX "ContractNotifySetting_tenantId_mode_idx" ON "ContractNotifySetting"("tenantId", "mode");

ALTER TABLE "ContractAnalysisRun" ADD CONSTRAINT "ContractAnalysisRun_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractAnalysisRun" ADD CONSTRAINT "ContractAnalysisRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractClauseAnnotation" ADD CONSTRAINT "ContractClauseAnnotation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ContractAnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractClauseAnnotation" ADD CONSTRAINT "ContractClauseAnnotation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractVersionDiff" ADD CONSTRAINT "ContractVersionDiff_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractEvent" ADD CONSTRAINT "ContractEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractNotifySetting" ADD CONSTRAINT "ContractNotifySetting_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- KRİTİK şerh bildirimi (yalnızca OTOMATIK kipinde üretilir).
ALTER TYPE "NotificationKind" ADD VALUE 'SOZLESME_KRITIK_SHERH';
