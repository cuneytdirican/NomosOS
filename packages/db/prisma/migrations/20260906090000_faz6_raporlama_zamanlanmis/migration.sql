-- CreateEnum
CREATE TYPE "ReportScope" AS ENUM ('KISISEL', 'BURO');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('EKRAN', 'CSV', 'PDF');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('BASARILI', 'BASARISIZ', 'CALISIYOR', 'ATLANDI');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SURE_YAKLASIYOR', 'SURE_GECTI', 'DURUSMA_YARIN', 'GOREV_ATANDI', 'ONAY_BEKLIYOR', 'KREDI_AZALDI', 'SOZLESME_YENILEME', 'VEKALET_SURESI');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('BEKLIYOR', 'GONDERILDI', 'OKUNDU', 'IPTAL');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "scope" "ReportScope" NOT NULL DEFAULT 'KISISEL',
    "createdBy" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "rowCount" INTEGER,
    "durationMs" INTEGER,
    "format" "ReportFormat" NOT NULL DEFAULT 'EKRAN',
    "runBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "JobStatus",
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "JobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsProcessed" INTEGER,
    "errorMessage" TEXT,
    "detailJson" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReport_tenantId_scope_idx" ON "SavedReport"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "SavedReport_tenantId_reportKey_idx" ON "SavedReport"("tenantId", "reportKey");

-- CreateIndex
CREATE INDEX "SavedReport_tenantId_createdBy_idx" ON "SavedReport"("tenantId", "createdBy");

-- CreateIndex
CREATE INDEX "ReportRun_tenantId_createdAt_idx" ON "ReportRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_tenantId_reportKey_createdAt_idx" ON "ReportRun"("tenantId", "reportKey", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_tenantId_runBy_createdAt_idx" ON "ReportRun"("tenantId", "runBy", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_key_key" ON "ScheduledJob"("key");

-- CreateIndex
CREATE INDEX "ScheduledJob_isEnabled_nextRunAt_idx" ON "ScheduledJob"("isEnabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "JobRun_jobKey_startedAt_idx" ON "JobRun"("jobKey", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_tenantId_startedAt_idx" ON "JobRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_status_scheduledFor_idx" ON "NotificationOutbox"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_userId_status_idx" ON "NotificationOutbox"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "NotificationOutbox_tenantId_kind_createdAt_idx" ON "NotificationOutbox"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_tenantId_dedupeKey_key" ON "NotificationOutbox"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "DeviceToken_tenantId_userId_isActive_idx" ON "DeviceToken"("tenantId", "userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
