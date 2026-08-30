-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PARTNER', 'AVUKAT', 'STAJYER', 'SEKRETER');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('GERCEK_KISI', 'TUZEL_KISI');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('DAVA', 'ICRA', 'ARABULUCULUK', 'CEZA', 'DANISMANLIK');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('ACIK', 'DERDEST', 'KARAR', 'ISTINAF', 'TEMYIZ', 'KESINLESTI', 'ICRADA', 'KAPANDI', 'ARSIV');

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('DAVACI', 'DAVALI', 'MUDAHIL', 'ALACAKLI', 'BORCLU', 'SANIK', 'MUSTEKI', 'KATILAN', 'TANIK', 'DIGER');

-- CreateEnum
CREATE TYPE "HearingType" AS ENUM ('DURUSMA', 'ON_INCELEME', 'KESIF', 'E_DURUSMA', 'MUZAKERE', 'DIGER');

-- CreateEnum
CREATE TYPE "HearingStatus" AS ENUM ('PLANLANDI', 'YAPILDI', 'ERTELENDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "DeadlineSource" AS ENUM ('MANUEL', 'KURAL', 'AI_ONERISI');

-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'TAMAMLANDI', 'KACIRILDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('ACIK', 'DEVAM_EDIYOR', 'KONTROLDE', 'ONAY_BEKLIYOR', 'TAMAMLANDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('DUSUK', 'NORMAL', 'YUKSEK', 'KRITIK');

-- CreateEnum
CREATE TYPE "DocumentClass" AS ENUM ('DILEKCE', 'TENSIP_ZAPTI', 'ARA_KARAR', 'GEREKCELI_KARAR', 'BILIRKISI_RAPORU', 'DURUSMA_TUTANAGI', 'TEBLIGAT', 'MUZEKKERE', 'VEKALETNAME', 'SOZLESME', 'DELIL', 'FATURA', 'ICRA_EVRAKI', 'DIGER');

-- CreateEnum
CREATE TYPE "FinancialEntryType" AS ENUM ('TAHAKKUK', 'TAHSILAT', 'AVANS', 'MASRAF', 'HARC', 'VEKALET_UCRETI', 'DANISMANLIK', 'IADE');

-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('ANTHROPIC', 'OPENAI_COMPAT', 'OLLAMA', 'GEMINI', 'CUSTOM');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "barNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "name" TEXT NOT NULL,
    "tckn" TEXT,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "iban" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "responsibleUserId" TEXT,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'ACIK',
    "title" TEXT NOT NULL,
    "courtName" TEXT,
    "fileNumber" TEXT,
    "judgeName" TEXT,
    "subject" TEXT,
    "amount" DECIMAL(18,2),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseParty" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "role" "PartyRole" NOT NULL,
    "name" TEXT NOT NULL,
    "isClient" BOOLEAN NOT NULL DEFAULT false,
    "lawyerName" TEXT,
    "notes" TEXT,

    CONSTRAINT "CaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hearing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "HearingType" NOT NULL DEFAULT 'DURUSMA',
    "status" "HearingStatus" NOT NULL DEFAULT 'PLANLANDI',
    "date" TIMESTAMP(3) NOT NULL,
    "courtroom" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "source" "DeadlineSource" NOT NULL DEFAULT 'MANUEL',
    "status" "DeadlineStatus" NOT NULL DEFAULT 'ONAYLANDI',
    "legalBasis" TEXT,
    "computeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'ACIK',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT,
    "name" TEXT NOT NULL,
    "class" "DocumentClass" NOT NULL DEFAULT 'DIGER',
    "classSource" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "aiSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerOfAttorney" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "notary" TEXT,
    "number" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "scope" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerOfAttorney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "caseId" TEXT,
    "type" "FinancialEntryType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AiProviderType" NOT NULL,
    "encryptedApiKey" TEXT,
    "baseUrl" TEXT,
    "defaultModel" TEXT NOT NULL,
    "headersJson" TEXT,
    "mappingJson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTaskRoute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "model" TEXT NOT NULL,

    CONSTRAINT "AiTaskRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "providerConfigId" TEXT,
    "taskType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER,
    "piiMasked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

-- CreateIndex
CREATE INDEX "Client_tenantId_name_idx" ON "Client"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "Case_tenantId_idx" ON "Case"("tenantId");

-- CreateIndex
CREATE INDEX "Case_tenantId_status_idx" ON "Case"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Case_clientId_idx" ON "Case"("clientId");

-- CreateIndex
CREATE INDEX "CaseParty_caseId_idx" ON "CaseParty"("caseId");

-- CreateIndex
CREATE INDEX "Hearing_tenantId_date_idx" ON "Hearing"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Hearing_caseId_idx" ON "Hearing"("caseId");

-- CreateIndex
CREATE INDEX "Deadline_tenantId_dueDate_idx" ON "Deadline"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "Deadline_caseId_idx" ON "Deadline"("caseId");

-- CreateIndex
CREATE INDEX "Task_tenantId_status_idx" ON "Task"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_caseId_idx" ON "Task"("caseId");

-- CreateIndex
CREATE INDEX "Document_tenantId_idx" ON "Document"("tenantId");

-- CreateIndex
CREATE INDEX "Document_caseId_idx" ON "Document"("caseId");

-- CreateIndex
CREATE INDEX "TimelineEvent_caseId_date_idx" ON "TimelineEvent"("caseId", "date");

-- CreateIndex
CREATE INDEX "PowerOfAttorney_tenantId_idx" ON "PowerOfAttorney"("tenantId");

-- CreateIndex
CREATE INDEX "PowerOfAttorney_clientId_idx" ON "PowerOfAttorney"("clientId");

-- CreateIndex
CREATE INDEX "FinancialEntry_tenantId_date_idx" ON "FinancialEntry"("tenantId", "date");

-- CreateIndex
CREATE INDEX "FinancialEntry_clientId_idx" ON "FinancialEntry"("clientId");

-- CreateIndex
CREATE INDEX "FinancialEntry_caseId_idx" ON "FinancialEntry"("caseId");

-- CreateIndex
CREATE INDEX "AiProviderConfig_tenantId_idx" ON "AiProviderConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskRoute_tenantId_taskType_key" ON "AiTaskRoute"("tenantId", "taskType");

-- CreateIndex
CREATE INDEX "AiUsageLog_tenantId_createdAt_idx" ON "AiUsageLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerOfAttorney" ADD CONSTRAINT "PowerOfAttorney_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerOfAttorney" ADD CONSTRAINT "PowerOfAttorney_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderConfig" ADD CONSTRAINT "AiProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTaskRoute" ADD CONSTRAINT "AiTaskRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTaskRoute" ADD CONSTRAINT "AiTaskRoute_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
