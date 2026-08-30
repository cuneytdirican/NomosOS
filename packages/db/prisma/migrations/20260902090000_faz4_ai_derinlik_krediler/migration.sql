-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('TASLAK', 'GUNCEL', 'BAYAT');

-- CreateEnum
CREATE TYPE "StrategyNodeType" AS ENUM ('KARSI_ARGUMAN', 'BIZIM_ARGUMAN', 'DELIL', 'HUKUKI_DAYANAK', 'ZAYIF_NOKTA', 'KARSI_CEVAP', 'SENARYO', 'RISK');

-- CreateEnum
CREATE TYPE "SimulationMode" AS ENUM ('KARSI_TARAF_AVUKATI', 'HAKIM_GOZU', 'KAYBETTIREN_HUSUSLAR', 'KARSI_DILEKCE_ZAYIFLIK', 'BILIRKISI_ODAGI');

-- CreateEnum
CREATE TYPE "RiskDimension" AS ENUM ('GENEL', 'HUKUKI', 'SURE', 'DELIL', 'TAHSILAT', 'USUL', 'ICTIHAT', 'KARSI_TARAF');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('DUSUK', 'ORTA', 'YUKSEK');

-- CreateEnum
CREATE TYPE "ClaimSide" AS ENUM ('BIZ', 'KARSI_TARAF');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('ACIK', 'DESTEKLENIYOR', 'ZAYIF', 'CURUTULDU');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('BELGE', 'FOTOGRAF', 'VIDEO', 'SES', 'TANIK', 'BILIRKISI', 'KESIF', 'DIGER');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('PLANLANAN', 'TOPLANDI', 'SUNULDU', 'KABUL', 'RED');

-- CreateEnum
CREATE TYPE "ExpertReportType" AS ENUM ('ASIL', 'EK', 'UZMAN_MUTALAASI');

-- CreateEnum
CREATE TYPE "ObjectionStatus" AS ENUM ('TASLAK', 'SUNULDU', 'KABUL', 'RED');

-- CreateEnum
CREATE TYPE "ConflictResult" AS ENUM ('TEMIZ', 'DIKKAT', 'CAKISMA');

-- CreateEnum
CREATE TYPE "ConflictDecision" AS ENUM ('DEVAM', 'REDDEDILDI', 'BEKLEMEDE');

-- CreateEnum
CREATE TYPE "ConflictMatchType" AS ENUM ('MEVCUT_MUVEKKIL', 'KARSI_TARAF', 'ESKI_MUVEKKIL', 'BAGLI_SIRKET', 'DOSYADA_GECEN', 'BENZER_AD');

-- CreateEnum
CREATE TYPE "CreditTxType" AS ENUM ('TAHSIS', 'TUKETIM', 'SATIN_ALMA', 'IADE', 'DUZELTME', 'SURESI_DOLDU');

-- AlterTable
ALTER TABLE "AiUsageLog" ADD COLUMN     "costCurrency" TEXT,
ADD COLUMN     "creditsCharged" INTEGER,
ADD COLUMN     "estimatedCost" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'TASLAK',
    "currentVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "treeJson" TEXT NOT NULL,
    "summary" TEXT,
    "model" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyNode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "parentId" TEXT,
    "nodeType" "StrategyNodeType" NOT NULL,
    "content" TEXT NOT NULL,
    "strength" INTEGER,
    "sourceRef" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "mode" "SimulationMode" NOT NULL,
    "inputSnapshotJson" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "model" TEXT,
    "durationMs" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "dimension" "RiskDimension" NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "RiskBand" NOT NULL,
    "ruleSignalsJson" TEXT NOT NULL,
    "aiAdjustment" INTEGER,
    "aiCommentary" TEXT,
    "model" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedBy" TEXT,

    CONSTRAINT "RiskScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskScoreHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "dimension" "RiskDimension" NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "RiskBand" NOT NULL,
    "ruleSignalsJson" TEXT NOT NULL,
    "aiAdjustment" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "dimension" "RiskDimension" NOT NULL,
    "band" "RiskBand" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "RiskOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "side" "ClaimSide" NOT NULL,
    "text" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "ClaimStatus" NOT NULL DEFAULT 'ACIK',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "documentId" TEXT,
    "witnessName" TEXT,
    "obtainedAt" TIMESTAMP(3),
    "status" "EvidenceStatus" NOT NULL DEFAULT 'PLANLANAN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidenceLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "strength" INTEGER,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLegalBasis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "caseLawId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimLegalBasis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "specialty" TEXT,
    "institution" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "expertId" TEXT,
    "reportType" "ExpertReportType" NOT NULL DEFAULT 'ASIL',
    "documentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "servedAt" TIMESTAMP(3),
    "summary" TEXT,
    "conclusionText" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertObjection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expertReportId" TEXT NOT NULL,
    "petitionId" TEXT,
    "points" TEXT NOT NULL,
    "status" "ObjectionStatus" NOT NULL DEFAULT 'TASLAK',
    "deadlineId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertObjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertReportDiff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "baseReportId" TEXT NOT NULL,
    "compareReportId" TEXT NOT NULL,
    "diffJson" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertReportDiff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "context" TEXT,
    "result" "ConflictResult" NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "decidedBy" TEXT,
    "decision" "ConflictDecision",
    "decisionNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictHit" (
    "id" TEXT NOT NULL,
    "conflictCheckId" TEXT NOT NULL,
    "matchType" "ConflictMatchType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "matchedName" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "caseId" TEXT,
    "note" TEXT,

    CONSTRAINT "ConflictHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "includedCredits" INTEGER NOT NULL,
    "includedConsumed" INTEGER NOT NULL DEFAULT 0,
    "purchasedCredits" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "autoTopUpPackageKey" TEXT,
    "documentQuota" INTEGER NOT NULL,
    "documentUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "CreditTxType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "taskType" TEXT,
    "caseId" TEXT,
    "aiUsageLogId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTaskCost" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPrice" (
    "id" TEXT NOT NULL,
    "providerType" "AiProviderType" NOT NULL,
    "model" TEXT NOT NULL,
    "inputPricePer1M" DECIMAL(12,4) NOT NULL,
    "outputPricePer1M" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPackage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CreditPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Strategy_tenantId_status_idx" ON "Strategy"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Strategy_caseId_updatedAt_idx" ON "Strategy"("caseId", "updatedAt");

-- CreateIndex
CREATE INDEX "StrategyVersion_strategyId_createdAt_idx" ON "StrategyVersion"("strategyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_strategyId_versionNo_key" ON "StrategyVersion"("strategyId", "versionNo");

-- CreateIndex
CREATE INDEX "StrategyNode_tenantId_strategyId_idx" ON "StrategyNode"("tenantId", "strategyId");

-- CreateIndex
CREATE INDEX "StrategyNode_strategyId_parentId_orderIndex_idx" ON "StrategyNode"("strategyId", "parentId", "orderIndex");

-- CreateIndex
CREATE INDEX "SimulationRun_tenantId_createdAt_idx" ON "SimulationRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SimulationRun_caseId_mode_createdAt_idx" ON "SimulationRun"("caseId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "RiskScore_tenantId_dimension_band_idx" ON "RiskScore"("tenantId", "dimension", "band");

-- CreateIndex
CREATE INDEX "RiskScore_tenantId_computedAt_idx" ON "RiskScore"("tenantId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskScore_caseId_dimension_key" ON "RiskScore"("caseId", "dimension");

-- CreateIndex
CREATE INDEX "RiskScoreHistory_tenantId_caseId_dimension_computedAt_idx" ON "RiskScoreHistory"("tenantId", "caseId", "dimension", "computedAt");

-- CreateIndex
CREATE INDEX "RiskScoreHistory_caseId_computedAt_idx" ON "RiskScoreHistory"("caseId", "computedAt");

-- CreateIndex
CREATE INDEX "RiskOverride_tenantId_caseId_dimension_idx" ON "RiskOverride"("tenantId", "caseId", "dimension");

-- CreateIndex
CREATE INDEX "RiskOverride_caseId_createdAt_idx" ON "RiskOverride"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "Claim_tenantId_caseId_idx" ON "Claim"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "Claim_caseId_side_orderIndex_idx" ON "Claim"("caseId", "side", "orderIndex");

-- CreateIndex
CREATE INDEX "Evidence_tenantId_caseId_idx" ON "Evidence"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "Evidence_caseId_status_idx" ON "Evidence"("caseId", "status");

-- CreateIndex
CREATE INDEX "Evidence_documentId_idx" ON "Evidence"("documentId");

-- CreateIndex
CREATE INDEX "ClaimEvidenceLink_tenantId_claimId_idx" ON "ClaimEvidenceLink"("tenantId", "claimId");

-- CreateIndex
CREATE INDEX "ClaimEvidenceLink_evidenceId_idx" ON "ClaimEvidenceLink"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidenceLink_claimId_evidenceId_key" ON "ClaimEvidenceLink"("claimId", "evidenceId");

-- CreateIndex
CREATE INDEX "ClaimLegalBasis_tenantId_claimId_idx" ON "ClaimLegalBasis"("tenantId", "claimId");

-- CreateIndex
CREATE INDEX "ClaimLegalBasis_caseLawId_idx" ON "ClaimLegalBasis"("caseLawId");

-- CreateIndex
CREATE INDEX "Expert_tenantId_fullName_idx" ON "Expert"("tenantId", "fullName");

-- CreateIndex
CREATE INDEX "ExpertReport_tenantId_caseId_idx" ON "ExpertReport"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "ExpertReport_caseId_receivedAt_idx" ON "ExpertReport"("caseId", "receivedAt");

-- CreateIndex
CREATE INDEX "ExpertObjection_tenantId_expertReportId_idx" ON "ExpertObjection"("tenantId", "expertReportId");

-- CreateIndex
CREATE INDEX "ExpertObjection_petitionId_idx" ON "ExpertObjection"("petitionId");

-- CreateIndex
CREATE INDEX "ExpertObjection_deadlineId_idx" ON "ExpertObjection"("deadlineId");

-- CreateIndex
CREATE INDEX "ExpertReportDiff_tenantId_caseId_createdAt_idx" ON "ExpertReportDiff"("tenantId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ExpertReportDiff_baseReportId_compareReportId_idx" ON "ExpertReportDiff"("baseReportId", "compareReportId");

-- CreateIndex
CREATE INDEX "ConflictCheck_tenantId_createdAt_idx" ON "ConflictCheck"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ConflictCheck_tenantId_result_idx" ON "ConflictCheck"("tenantId", "result");

-- CreateIndex
CREATE INDEX "ConflictHit_conflictCheckId_idx" ON "ConflictHit"("conflictCheckId");

-- CreateIndex
CREATE INDEX "ConflictHit_caseId_idx" ON "ConflictHit"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_tenantId_key" ON "CreditWallet"("tenantId");

-- CreateIndex
CREATE INDEX "CreditTransaction_tenantId_createdAt_idx" ON "CreditTransaction"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_tenantId_type_createdAt_idx" ON "CreditTransaction"("tenantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_aiUsageLogId_idx" ON "CreditTransaction"("aiUsageLogId");

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskCost_taskType_key" ON "AiTaskCost"("taskType");

-- CreateIndex
CREATE INDEX "ModelPrice_providerType_model_effectiveFrom_idx" ON "ModelPrice"("providerType", "model", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPrice_providerType_model_effectiveFrom_key" ON "ModelPrice"("providerType", "model", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPackage_key_key" ON "CreditPackage"("key");

-- CreateIndex
CREATE INDEX "AiUsageLog_tenantId_taskType_createdAt_idx" ON "AiUsageLog"("tenantId", "taskType", "createdAt");

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyNode" ADD CONSTRAINT "StrategyNode_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyNode" ADD CONSTRAINT "StrategyNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StrategyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskScore" ADD CONSTRAINT "RiskScore_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceLink" ADD CONSTRAINT "ClaimEvidenceLink_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceLink" ADD CONSTRAINT "ClaimEvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLegalBasis" ADD CONSTRAINT "ClaimLegalBasis_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertReport" ADD CONSTRAINT "ExpertReport_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertObjection" ADD CONSTRAINT "ExpertObjection_expertReportId_fkey" FOREIGN KEY ("expertReportId") REFERENCES "ExpertReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictHit" ADD CONSTRAINT "ConflictHit_conflictCheckId_fkey" FOREIGN KEY ("conflictCheckId") REFERENCES "ConflictCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
