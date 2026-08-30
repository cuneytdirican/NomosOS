-- CreateEnum
CREATE TYPE "EnforcementType" AS ENUM ('ILAMLI', 'ILAMSIZ', 'KAMBIYO', 'REHNIN_PARAYA_CEVRILMESI', 'IPOTEGIN_PARAYA_CEVRILMESI', 'NAFAKA', 'TAHLIYE');

-- CreateEnum
CREATE TYPE "EnforcementStage" AS ENUM ('TAKIP_TALEBI', 'ODEME_EMRI_TEBLIG', 'ITIRAZ', 'ITIRAZIN_KALDIRILMASI', 'KESINLESME', 'HACIZ', 'SATIS', 'TAHSILAT', 'ACIZ_VESIKASI', 'KAPANDI');

-- CreateEnum
CREATE TYPE "EnforcementActionType" AS ENUM ('TAKIP_TALEBI', 'ODEME_EMRI', 'ITIRAZ', 'ITIRAZIN_IPTALI', 'HACIZ_TALEBI', 'HACIZ_UYGULAMA', 'KIYMET_TAKDIRI', 'SATIS_TALEBI', 'IHALE', 'TAHSILAT', 'HARC_ODEME', 'MASRAF', 'DIGER');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('TASINMAZ', 'ARAC', 'BANKA_HESABI', 'MAAS', 'ALACAK', 'HISSE', 'DIGER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('TESPIT_EDILDI', 'HACZEDILDI', 'SATISA_CIKARILDI', 'SATILDI', 'SERBEST_BIRAKILDI');

-- CreateEnum
CREATE TYPE "CollectionMethod" AS ENUM ('BANKA', 'KASA', 'HACIZ_SATIS', 'MAAS_KESINTISI', 'ANLASMA', 'DIGER');

-- CreateEnum
CREATE TYPE "ScoreBand" AS ENUM ('DUSUK', 'ORTA', 'YUKSEK');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('SABIT', 'SAATLIK', 'BASARI_PRIMI', 'DOSYA_BAZLI', 'AYLIK_DANISMANLIK', 'KARMA');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('TASLAK', 'AKTIF', 'SONA_ERDI', 'FESIH');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('TASLAK', 'GONDERILDI', 'KISMI_ODENDI', 'ODENDI', 'IPTAL', 'IADE');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('YOK', 'BEKLIYOR', 'GONDERILDI', 'KABUL', 'RED', 'IPTAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('HAVALE', 'KREDI_KARTI', 'NAKIT', 'CEK', 'SENET', 'MAHSUP', 'DIGER');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN', 'SUPPORT_AGENT', 'ANALYST_READONLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('BEKLIYOR', 'BASARILI', 'BASARISIZ', 'IADE');

-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('BILGI', 'UYARI', 'KRITIK');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('TUM', 'PLAN_BAZLI', 'TENANT_BAZLI');

-- CreateEnum
CREATE TYPE "SupportScope" AS ENUM ('SADECE_USTVERI', 'YAPILANDIRMA', 'ICERIK_MASKELI');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI', 'SURESI_DOLDU');

-- DropIndex
DROP INDEX "CaseLawDocument_fullText_trgm_idx";

-- DropIndex
DROP INDEX "CaseLawDocument_summary_trgm_idx";

-- DropIndex
DROP INDEX "Document_name_trgm_idx";

-- DropIndex
DROP INDEX "Document_ocrText_trgm_idx";

-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "isBillable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "vatRate" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "EnforcementFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "officeName" TEXT NOT NULL,
    "fileNumber" TEXT NOT NULL,
    "trackingType" "EnforcementType" NOT NULL,
    "stage" "EnforcementStage" NOT NULL DEFAULT 'TAKIP_TALEBI',
    "principalAmount" DECIMAL(18,2) NOT NULL,
    "interestRate" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "requestDate" TIMESTAMP(3) NOT NULL,
    "paymentOrderServedAt" TIMESTAMP(3),
    "objectionDate" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "debtorInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnforcementFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnforcementAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enforcementFileId" TEXT NOT NULL,
    "type" "EnforcementActionType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2),
    "resultNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnforcementAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enforcementFileId" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedValue" DECIMAL(18,2),
    "status" "AssetStatus" NOT NULL DEFAULT 'TESPIT_EDILDI',
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "AssetRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enforcementFileId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "method" "CollectionMethod" NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enforcementFileId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "ScoreBand" NOT NULL,
    "ruleSignalsJson" TEXT NOT NULL,
    "aiCommentary" TEXT,
    "model" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedBy" TEXT,

    CONSTRAINT "CollectionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAgreement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "type" "FeeType" NOT NULL,
    "amount" DECIMAL(18,2),
    "hourlyRate" DECIMAL(18,2),
    "successPercent" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "terms" TEXT,
    "status" "AgreementStatus" NOT NULL DEFAULT 'TASLAK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caseId" TEXT,
    "clientId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "hourlyRate" DECIMAL(18,2),
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceNo" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'TASLAK',
    "eInvoiceStatus" "EInvoiceStatus" NOT NULL DEFAULT 'YOK',
    "eInvoiceUuid" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTier" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyPricePerUser" DECIMAL(18,2),
    "maxUsers" INTEGER,
    "featuresJson" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PlanTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "method" TEXT,
    "providerRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'TASLAK',
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "isEnabledGlobally" BOOLEAN NOT NULL DEFAULT false,
    "enabledTenantIdsJson" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL DEFAULT 'BILGI',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'TUM',
    "targetJson" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "tenantId" TEXT,
    "detail" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "aiCallCount" INTEGER NOT NULL DEFAULT 0,
    "aiInputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "storageBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" "SupportScope" NOT NULL DEFAULT 'SADECE_USTVERI',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnforcementFile_caseId_key" ON "EnforcementFile"("caseId");

-- CreateIndex
CREATE INDEX "EnforcementFile_tenantId_idx" ON "EnforcementFile"("tenantId");

-- CreateIndex
CREATE INDEX "EnforcementFile_tenantId_stage_idx" ON "EnforcementFile"("tenantId", "stage");

-- CreateIndex
CREATE INDEX "EnforcementFile_tenantId_requestDate_idx" ON "EnforcementFile"("tenantId", "requestDate");

-- CreateIndex
CREATE INDEX "EnforcementFile_tenantId_fileNumber_idx" ON "EnforcementFile"("tenantId", "fileNumber");

-- CreateIndex
CREATE INDEX "EnforcementAction_enforcementFileId_date_idx" ON "EnforcementAction"("enforcementFileId", "date");

-- CreateIndex
CREATE INDEX "EnforcementAction_tenantId_date_idx" ON "EnforcementAction"("tenantId", "date");

-- CreateIndex
CREATE INDEX "EnforcementAction_tenantId_type_idx" ON "EnforcementAction"("tenantId", "type");

-- CreateIndex
CREATE INDEX "AssetRecord_enforcementFileId_idx" ON "AssetRecord"("enforcementFileId");

-- CreateIndex
CREATE INDEX "AssetRecord_tenantId_status_idx" ON "AssetRecord"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AssetRecord_tenantId_assetType_idx" ON "AssetRecord"("tenantId", "assetType");

-- CreateIndex
CREATE INDEX "CollectionRecord_enforcementFileId_date_idx" ON "CollectionRecord"("enforcementFileId", "date");

-- CreateIndex
CREATE INDEX "CollectionRecord_tenantId_date_idx" ON "CollectionRecord"("tenantId", "date");

-- CreateIndex
CREATE INDEX "CollectionScore_tenantId_enforcementFileId_computedAt_idx" ON "CollectionScore"("tenantId", "enforcementFileId", "computedAt");

-- CreateIndex
CREATE INDEX "CollectionScore_enforcementFileId_computedAt_idx" ON "CollectionScore"("enforcementFileId", "computedAt");

-- CreateIndex
CREATE INDEX "FeeAgreement_tenantId_status_idx" ON "FeeAgreement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "FeeAgreement_clientId_idx" ON "FeeAgreement"("clientId");

-- CreateIndex
CREATE INDEX "FeeAgreement_caseId_idx" ON "FeeAgreement"("caseId");

-- CreateIndex
CREATE INDEX "FeeAgreement_tenantId_startDate_idx" ON "FeeAgreement"("tenantId", "startDate");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_date_idx" ON "TimeEntry"("tenantId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_userId_date_idx" ON "TimeEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_caseId_idx" ON "TimeEntry"("caseId");

-- CreateIndex
CREATE INDEX "TimeEntry_clientId_idx" ON "TimeEntry"("clientId");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_invoiceId_idx" ON "TimeEntry"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_billable_date_idx" ON "TimeEntry"("tenantId", "billable", "date");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issueDate_idx" ON "Invoice"("tenantId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_eInvoiceStatus_idx" ON "Invoice"("tenantId", "eInvoiceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNo_key" ON "Invoice"("tenantId", "invoiceNo");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_sourceType_sourceId_idx" ON "InvoiceLine"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_date_idx" ON "Payment"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_method_idx" ON "Payment"("tenantId", "method");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "PlatformUser_role_idx" ON "PlatformUser"("role");

-- CreateIndex
CREATE INDEX "PlatformUser_isActive_idx" ON "PlatformUser"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTier_key_key" ON "PlanTier"("key");

-- CreateIndex
CREATE INDEX "PlanTier_isActive_idx" ON "PlanTier"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_planKey_idx" ON "Subscription"("planKey");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "PaymentRecord_tenantId_createdAt_idx" ON "PaymentRecord"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecord_status_createdAt_idx" ON "PaymentRecord"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRecord_subscriptionId_idx" ON "PaymentRecord"("subscriptionId");

-- CreateIndex
CREATE INDEX "InvoiceRecord_tenantId_issueDate_idx" ON "InvoiceRecord"("tenantId", "issueDate");

-- CreateIndex
CREATE INDEX "InvoiceRecord_status_idx" ON "InvoiceRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRecord_number_key" ON "InvoiceRecord"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");

-- CreateIndex
CREATE INDEX "Announcement_severity_idx" ON "Announcement"("severity");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_platformUserId_idx" ON "PlatformAuditLog"("platformUserId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_tenantId_idx" ON "PlatformAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_action_createdAt_idx" ON "PlatformAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "UsageSnapshot_date_idx" ON "UsageSnapshot"("date");

-- CreateIndex
CREATE INDEX "UsageSnapshot_tenantId_date_idx" ON "UsageSnapshot"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UsageSnapshot_tenantId_date_key" ON "UsageSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_tenantId_expiresAt_idx" ON "SupportAccessGrant"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_platformUserId_expiresAt_idx" ON "SupportAccessGrant"("platformUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_expiresAt_idx" ON "SupportAccessGrant"("expiresAt");

-- CreateIndex
CREATE INDEX "PlatformApprovalRequest_status_expiresAt_idx" ON "PlatformApprovalRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PlatformApprovalRequest_requestedBy_idx" ON "PlatformApprovalRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "PlatformApprovalRequest_tenantId_idx" ON "PlatformApprovalRequest"("tenantId");

-- CreateIndex
CREATE INDEX "PlatformApprovalRequest_createdAt_idx" ON "PlatformApprovalRequest"("createdAt");

-- CreateIndex
CREATE INDEX "FinancialEntry_tenantId_invoiceId_idx" ON "FinancialEntry"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "FinancialEntry_tenantId_isBillable_idx" ON "FinancialEntry"("tenantId", "isBillable");

-- AddForeignKey
ALTER TABLE "EnforcementFile" ADD CONSTRAINT "EnforcementFile_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementAction" ADD CONSTRAINT "EnforcementAction_enforcementFileId_fkey" FOREIGN KEY ("enforcementFileId") REFERENCES "EnforcementFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRecord" ADD CONSTRAINT "AssetRecord_enforcementFileId_fkey" FOREIGN KEY ("enforcementFileId") REFERENCES "EnforcementFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRecord" ADD CONSTRAINT "CollectionRecord_enforcementFileId_fkey" FOREIGN KEY ("enforcementFileId") REFERENCES "EnforcementFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionScore" ADD CONSTRAINT "CollectionScore_enforcementFileId_fkey" FOREIGN KEY ("enforcementFileId") REFERENCES "EnforcementFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAgreement" ADD CONSTRAINT "FeeAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAgreement" ADD CONSTRAINT "FeeAgreement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
