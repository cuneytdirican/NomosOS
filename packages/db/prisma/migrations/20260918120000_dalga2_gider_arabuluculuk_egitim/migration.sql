-- DALGA 2 (geliştirme planı D2): dosya giderleri, arabuluculuk süreci,
-- AI eğitim verisi + kiracı opt-in rızası.
--
-- A1 CaseExpense: dosyanın gerçek maliyeti (harç/bilirkişi/tebligat/yol);
--    İİK m.202 gider avansı iadesi dosya kapatma hesabında bu kayıtlardan
--    üretilir.
-- A2 Mediation: dava şartı arabuluculuk süreç kaydı; ANLASMA_YOK geçişinde
--    6325 s.K. m.18 2 haftalık dava süresi üretilir.
-- C3 AiTrainingSample + Tenant.aiTrainingOptIn (varsayılan KAPALI):
--    onay/ret/düzeltme örnekleri, yalnız opt-in kiracıdan toplanır.

CREATE TABLE "CaseExpense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "spentAt" DATE NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidFrom" TEXT NOT NULL DEFAULT 'AVANS',
    "refundable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseExpense_tenantId_caseId_idx" ON "CaseExpense"("tenantId", "caseId");
CREATE INDEX "CaseExpense_tenantId_spentAt_idx" ON "CaseExpense"("tenantId", "spentAt");

ALTER TABLE "CaseExpense" ADD CONSTRAINT "CaseExpense_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Mediation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DAVET',
    "meetingAt" TIMESTAMP(3),
    "finalProtocolAt" TIMESTAMP(3),
    "settlementAmount" DECIMAL(18,2),
    "note" TEXT,
    "lawsuitDeadlineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mediation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Mediation_tenantId_status_idx" ON "Mediation"("tenantId", "status");
CREATE INDEX "Mediation_tenantId_caseId_idx" ON "Mediation"("tenantId", "caseId");

ALTER TABLE "Mediation" ADD CONSTRAINT "Mediation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AiTrainingSample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "feedbackJson" TEXT,
    "exportStatus" TEXT NOT NULL DEFAULT 'YENI',
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTrainingSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiTrainingSample_tenantId_taskType_kind_idx" ON "AiTrainingSample"("tenantId", "taskType", "kind");
CREATE INDEX "AiTrainingSample_tenantId_exportStatus_idx" ON "AiTrainingSample"("tenantId", "exportStatus");

-- Kiracı rızası: AI eğitim verisi toplanması (varsayılan KAPALI).
ALTER TABLE "Tenant" ADD COLUMN "aiTrainingOptIn" BOOLEAN NOT NULL DEFAULT false;
