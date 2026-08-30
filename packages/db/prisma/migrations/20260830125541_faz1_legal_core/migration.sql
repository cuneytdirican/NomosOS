-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('GUN', 'HAFTA', 'AY', 'YIL');

-- CreateEnum
CREATE TYPE "ServiceMethod" AS ENUM ('ELDEN', 'POSTA', 'ETEBLIGAT', 'DURUSMADA', 'DIGER');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('RESMI_TATIL', 'ADLI_TATIL');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('ARA_KARAR', 'GEREKCELI_KARAR', 'ISTINAF_KARARI', 'TEMYIZ_KARARI', 'KESIN_KARAR');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "nextHearingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "category" TEXT,
ADD COLUMN     "referenceCode" TEXT;

-- AlterTable
ALTER TABLE "Deadline" ADD COLUMN     "ruleKey" TEXT,
ADD COLUMN     "serviceMethod" "ServiceMethod",
ADD COLUMN     "triggerDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Hearing" ADD COLUMN     "prepSummary" TEXT,
ADD COLUMN     "preparedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeadlineRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationValue" INTEGER NOT NULL,
    "durationUnit" "DurationUnit" NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "caseTypes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HolidayType" NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskStatusLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskStatus",
    "toStatus" "TaskStatus" NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "DecisionType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadlineRule_tenantId_idx" ON "DeadlineRule"("tenantId");

-- CreateIndex
CREATE INDEX "DeadlineRule_key_idx" ON "DeadlineRule"("key");

-- CreateIndex
CREATE INDEX "DeadlineRule_isActive_idx" ON "DeadlineRule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DeadlineRule_tenantId_key_key" ON "DeadlineRule"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Holiday_year_idx" ON "Holiday"("year");

-- CreateIndex
CREATE INDEX "Holiday_type_date_idx" ON "Holiday"("type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_type_key" ON "Holiday"("date", "type");

-- CreateIndex
CREATE INDEX "TaskStatusLog_taskId_createdAt_idx" ON "TaskStatusLog"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskStatusLog_userId_idx" ON "TaskStatusLog"("userId");

-- CreateIndex
CREATE INDEX "CaseNote_tenantId_idx" ON "CaseNote"("tenantId");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_createdAt_idx" ON "CaseNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_isPinned_idx" ON "CaseNote"("caseId", "isPinned");

-- CreateIndex
CREATE INDEX "CaseDecision_tenantId_date_idx" ON "CaseDecision"("tenantId", "date");

-- CreateIndex
CREATE INDEX "CaseDecision_caseId_date_idx" ON "CaseDecision"("caseId", "date");

-- CreateIndex
CREATE INDEX "Case_tenantId_nextHearingAt_idx" ON "Case"("tenantId", "nextHearingAt");

-- CreateIndex
CREATE INDEX "Case_tenantId_lastActivityAt_idx" ON "Case"("tenantId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Client_tenantId_category_idx" ON "Client"("tenantId", "category");

-- CreateIndex
CREATE INDEX "Client_tenantId_referenceCode_idx" ON "Client"("tenantId", "referenceCode");

-- CreateIndex
CREATE INDEX "Deadline_tenantId_status_dueDate_idx" ON "Deadline"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Deadline_ruleKey_idx" ON "Deadline"("ruleKey");

-- CreateIndex
CREATE INDEX "Hearing_tenantId_status_date_idx" ON "Hearing"("tenantId", "status", "date");

-- CreateIndex
CREATE INDEX "Task_tenantId_dueDate_idx" ON "Task"("tenantId", "dueDate");

-- AddForeignKey
ALTER TABLE "DeadlineRule" ADD CONSTRAINT "DeadlineRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatusLog" ADD CONSTRAINT "TaskStatusLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatusLog" ADD CONSTRAINT "TaskStatusLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDecision" ADD CONSTRAINT "CaseDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDecision" ADD CONSTRAINT "CaseDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
