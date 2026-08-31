-- CreateEnum
CREATE TYPE "PoaType" AS ENUM ('GENEL', 'OZEL', 'BOSANMA', 'CEZA', 'ICRA', 'SIRKET', 'DIGER');

-- CreateEnum
CREATE TYPE "PoaVerdict" AS ENUM ('YETERLI', 'YETERSIZ', 'BELIRSIZ');

-- CreateEnum
CREATE TYPE "PortalResourceType" AS ENUM ('DOSYA', 'BELGE', 'DURUSMA', 'SAFAHAT_KAYDI', 'FATURA', 'MESAJ', 'ODEME');

-- CreateEnum
CREATE TYPE "CommDirection" AS ENUM ('GELEN', 'GIDEN');

-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('EPOSTA', 'SMS', 'WHATSAPP', 'TELEFON', 'PORTAL', 'YUZ_YUZE', 'DIGER');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('TASLAK', 'ONAY_BEKLIYOR', 'ONAYLANDI', 'GONDERILDI', 'BASARISIZ', 'IPTAL');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('BEKLIYOR', 'ESLESTI', 'ELLE_ESLESTI', 'ESLESMEDI');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('VEKALET_UCRET', 'DANISMANLIK', 'GIZLILIK', 'HIZMET', 'DIGER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('TASLAK', 'MUZAKERE', 'IMZAYA_HAZIR', 'IMZADA', 'YURURLUKTE', 'SONA_ERDI', 'FESIH');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('OLUSTURULDU', 'GONDERILDI', 'IMZALANDI', 'REDDEDILDI', 'SURESI_DOLDU', 'IPTAL');

-- AlterTable
ALTER TABLE "PowerOfAttorney" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "scopeItemsJson" TEXT,
ADD COLUMN     "type" "PoaType",
ADD COLUMN     "warningSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PoaScopeCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "powerOfAttorneyId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "question" TEXT,
    "verdict" "PoaVerdict" NOT NULL,
    "missingPowersJson" TEXT,
    "aiCommentary" TEXT,
    "model" TEXT,
    "checkedBy" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaScopeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "invitedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalPublication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceType" "PortalResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpublishedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "PortalPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "caseId" TEXT,
    "direction" "CommDirection" NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "contactRef" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "channel" "CommChannel" NOT NULL,
    "templateId" TEXT,
    "subject" TEXT,
    "draftBody" TEXT NOT NULL,
    "finalBody" TEXT,
    "status" "OutboundStatus" NOT NULL DEFAULT 'TASLAK',
    "piiScanJson" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "fromRef" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,
    "caseId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "processedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "caseId" TEXT,
    "title" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'TASLAK',
    "currentVersionId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "renewalNoticeDays" INTEGER,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "contentText" TEXT NOT NULL,
    "documentId" TEXT,
    "changeNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "SignatureStatus" NOT NULL DEFAULT 'OLUSTURULDU',
    "signersJson" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "signedDocumentId" TEXT,
    "failureReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoaScopeCheck_tenantId_checkedAt_idx" ON "PoaScopeCheck"("tenantId", "checkedAt");

-- CreateIndex
CREATE INDEX "PoaScopeCheck_powerOfAttorneyId_idx" ON "PoaScopeCheck"("powerOfAttorneyId");

-- CreateIndex
CREATE INDEX "PoaScopeCheck_caseId_idx" ON "PoaScopeCheck"("caseId");

-- CreateIndex
CREATE INDEX "PortalUser_tenantId_idx" ON "PortalUser"("tenantId");

-- CreateIndex
CREATE INDEX "PortalUser_clientId_idx" ON "PortalUser"("clientId");

-- CreateIndex
CREATE INDEX "PortalUser_tenantId_isActive_idx" ON "PortalUser"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_tenantId_email_key" ON "PortalUser"("tenantId", "email");

-- CreateIndex
CREATE INDEX "PortalInvite_tenantId_expiresAt_idx" ON "PortalInvite"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "PortalInvite_clientId_idx" ON "PortalInvite"("clientId");

-- CreateIndex
CREATE INDEX "PortalInvite_tokenHash_idx" ON "PortalInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalPublication_tenantId_clientId_resourceType_idx" ON "PortalPublication"("tenantId", "clientId", "resourceType");

-- CreateIndex
CREATE INDEX "PortalPublication_tenantId_unpublishedAt_idx" ON "PortalPublication"("tenantId", "unpublishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalPublication_tenantId_resourceType_resourceId_clientId_key" ON "PortalPublication"("tenantId", "resourceType", "resourceId", "clientId");

-- CreateIndex
CREATE INDEX "PortalAuditLog_tenantId_createdAt_idx" ON "PortalAuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalAuditLog_portalUserId_createdAt_idx" ON "PortalAuditLog"("portalUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationLog_tenantId_occurredAt_idx" ON "CommunicationLog"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommunicationLog_clientId_occurredAt_idx" ON "CommunicationLog"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommunicationLog_caseId_occurredAt_idx" ON "CommunicationLog"("caseId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommunicationLog_tenantId_channel_occurredAt_idx" ON "CommunicationLog"("tenantId", "channel", "occurredAt");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_idx" ON "MessageTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "MessageTemplate_channel_idx" ON "MessageTemplate"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_key_key" ON "MessageTemplate"("tenantId", "key");

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_status_createdAt_idx" ON "OutboundMessage"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_clientId_createdAt_idx" ON "OutboundMessage"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_caseId_idx" ON "OutboundMessage"("caseId");

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_providerRef_idx" ON "OutboundMessage"("tenantId", "providerRef");

-- CreateIndex
CREATE INDEX "InboundMessage_tenantId_receivedAt_idx" ON "InboundMessage"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundMessage_tenantId_matchStatus_receivedAt_idx" ON "InboundMessage"("tenantId", "matchStatus", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundMessage_clientId_idx" ON "InboundMessage"("clientId");

-- CreateIndex
CREATE INDEX "InboundMessage_caseId_idx" ON "InboundMessage"("caseId");

-- CreateIndex
CREATE INDEX "Contract_tenantId_status_idx" ON "Contract"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Contract_tenantId_effectiveTo_idx" ON "Contract"("tenantId", "effectiveTo");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "Contract_caseId_idx" ON "Contract"("caseId");

-- CreateIndex
CREATE INDEX "ContractVersion_contractId_createdAt_idx" ON "ContractVersion"("contractId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_contractId_versionNo_key" ON "ContractVersion"("contractId", "versionNo");

-- CreateIndex
CREATE INDEX "SignatureRequest_tenantId_status_idx" ON "SignatureRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SignatureRequest_contractId_idx" ON "SignatureRequest"("contractId");

-- CreateIndex
CREATE INDEX "SignatureRequest_versionId_idx" ON "SignatureRequest"("versionId");

-- CreateIndex
CREATE INDEX "SignatureRequest_tenantId_providerRef_idx" ON "SignatureRequest"("tenantId", "providerRef");

-- CreateIndex
CREATE INDEX "PowerOfAttorney_tenantId_isActive_idx" ON "PowerOfAttorney"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "PowerOfAttorney_tenantId_expiresAt_idx" ON "PowerOfAttorney"("tenantId", "expiresAt");

-- AddForeignKey
ALTER TABLE "PoaScopeCheck" ADD CONSTRAINT "PoaScopeCheck_powerOfAttorneyId_fkey" FOREIGN KEY ("powerOfAttorneyId") REFERENCES "PowerOfAttorney"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScopeCheck" ADD CONSTRAINT "PoaScopeCheck_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalUser" ADD CONSTRAINT "PortalUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalInvite" ADD CONSTRAINT "PortalInvite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalPublication" ADD CONSTRAINT "PortalPublication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractVersion" ADD CONSTRAINT "ContractVersion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
