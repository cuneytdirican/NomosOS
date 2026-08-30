-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('BEKLIYOR', 'TAMAM', 'BASARISIZ', 'GEREKSIZ');

-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('BEKLIYOR', 'CALISIYOR', 'TAMAM', 'BASARISIZ', 'KISMI');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('GOREV', 'SURE', 'SAFAHAT', 'MUVEKKIL_BILGILENDIRME', 'DOSYA_ESLESTIRME', 'DURUSMA_GUNCELLEME');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI', 'UYGULANDI');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('GENEL', 'DURUSMA_HAZIRLIK', 'STRATEJI', 'HATIRLATMA');

-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('MANUEL', 'AI');

-- CreateEnum
CREATE TYPE "PetitionType" AS ENUM ('DAVA_DILEKCESI', 'CEVAP', 'CEVABA_CEVAP', 'IKINCI_CEVAP', 'ISTINAF', 'TEMYIZ', 'ITIRAZ', 'DELIL_LISTESI', 'ISLAH', 'BILIRKISI_ITIRAZ', 'ICRA_TAKIP_TALEBI', 'SIKAYET', 'BEYAN', 'DIGER');

-- CreateEnum
CREATE TYPE "PetitionStatus" AS ENUM ('TASLAK', 'TEYIT_EDILIYOR', 'TEYIT_EDILDI', 'INCELEMEDE', 'HAZIR', 'DISA_AKTARILDI', 'GONDERILDI');

-- CreateEnum
CREATE TYPE "RefStatus" AS ENUM ('ADAY', 'KABUL', 'RED');

-- CreateEnum
CREATE TYPE "CitationStatus" AS ENUM ('DOGRULANDI', 'BULUNAMADI', 'BELIRSIZ');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "chunkStatus" "ProcessingStatus",
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "ocrStatus" "ProcessingStatus",
ADD COLUMN     "ocrText" TEXT,
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caseId" TEXT,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "embedding" DOUBLE PRECISION[],
    "embeddingModel" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "PipelineStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "stepsJson" TEXT,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentActionProposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "caseId" TEXT,
    "type" "ProposalType" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'BEKLIYOR',
    "title" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,
    "sourceQuote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caseId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citationsJson" TEXT,
    "model" TEXT,
    "aiUsageLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT,
    "content" TEXT NOT NULL,
    "kind" "NoteKind" NOT NULL DEFAULT 'GENEL',
    "source" "NoteSource" NOT NULL DEFAULT 'MANUEL',
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAnalysisReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "model" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAnalysisReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetitionTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "petitionType" "PetitionType" NOT NULL,
    "sectionsJson" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetitionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Petition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT,
    "type" "PetitionType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PetitionStatus" NOT NULL DEFAULT 'TASLAK',
    "currentVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Petition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetitionVersion" (
    "id" TEXT NOT NULL,
    "petitionId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "sectionsJson" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseLawDocument" (
    "id" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "chamber" TEXT,
    "caseNumber" TEXT NOT NULL,
    "decisionNumber" TEXT NOT NULL,
    "decisionDate" TIMESTAMP(3),
    "summary" TEXT,
    "fullText" TEXT,
    "sourceUrl" TEXT,
    "sourceAdapter" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLawDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseLawReference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseLawId" TEXT NOT NULL,
    "status" "RefStatus" NOT NULL DEFAULT 'ADAY',
    "relevanceNote" TEXT,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLawReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rawCitation" TEXT NOT NULL,
    "status" "CitationStatus" NOT NULL,
    "note" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentChunk_tenantId_documentId_idx" ON "DocumentChunk"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentChunk_caseId_idx" ON "DocumentChunk"("caseId");

-- CreateIndex
CREATE INDEX "PipelineRun_tenantId_startedAt_idx" ON "PipelineRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "PipelineRun_documentId_idx" ON "PipelineRun"("documentId");

-- CreateIndex
CREATE INDEX "PipelineRun_tenantId_status_idx" ON "PipelineRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DocumentActionProposal_tenantId_status_idx" ON "DocumentActionProposal"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DocumentActionProposal_documentId_idx" ON "DocumentActionProposal"("documentId");

-- CreateIndex
CREATE INDEX "DocumentActionProposal_caseId_idx" ON "DocumentActionProposal"("caseId");

-- CreateIndex
CREATE INDEX "ChatSession_tenantId_userId_updatedAt_idx" ON "ChatSession"("tenantId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_caseId_idx" ON "ChatSession"("caseId");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "SmartNote_tenantId_caseId_idx" ON "SmartNote"("tenantId", "caseId");

-- CreateIndex
CREATE INDEX "SmartNote_caseId_kind_idx" ON "SmartNote"("caseId", "kind");

-- CreateIndex
CREATE INDEX "SmartNote_tenantId_isApproved_idx" ON "SmartNote"("tenantId", "isApproved");

-- CreateIndex
CREATE INDEX "CaseAnalysisReport_tenantId_caseId_createdAt_idx" ON "CaseAnalysisReport"("tenantId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "PetitionTemplate_tenantId_idx" ON "PetitionTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "PetitionTemplate_petitionType_idx" ON "PetitionTemplate"("petitionType");

-- CreateIndex
CREATE UNIQUE INDEX "PetitionTemplate_tenantId_key_key" ON "PetitionTemplate"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Petition_tenantId_status_idx" ON "Petition"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Petition_caseId_updatedAt_idx" ON "Petition"("caseId", "updatedAt");

-- CreateIndex
CREATE INDEX "PetitionVersion_petitionId_createdAt_idx" ON "PetitionVersion"("petitionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PetitionVersion_petitionId_versionNo_key" ON "PetitionVersion"("petitionId", "versionNo");

-- CreateIndex
CREATE INDEX "CaseLawDocument_court_idx" ON "CaseLawDocument"("court");

-- CreateIndex
CREATE INDEX "CaseLawDocument_decisionDate_idx" ON "CaseLawDocument"("decisionDate");

-- CreateIndex
CREATE UNIQUE INDEX "CaseLawDocument_court_caseNumber_decisionNumber_key" ON "CaseLawDocument"("court", "caseNumber", "decisionNumber");

-- CreateIndex
CREATE INDEX "CaseLawReference_tenantId_status_idx" ON "CaseLawReference"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CaseLawReference_caseLawId_idx" ON "CaseLawReference"("caseLawId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseLawReference_caseId_caseLawId_key" ON "CaseLawReference"("caseId", "caseLawId");

-- CreateIndex
CREATE INDEX "CitationCheck_tenantId_sourceType_sourceId_idx" ON "CitationCheck"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CitationCheck_tenantId_status_idx" ON "CitationCheck"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Document_tenantId_hash_idx" ON "Document"("tenantId", "hash");

-- CreateIndex
CREATE INDEX "Document_tenantId_ocrStatus_idx" ON "Document"("tenantId", "ocrStatus");

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentActionProposal" ADD CONSTRAINT "DocumentActionProposal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentActionProposal" ADD CONSTRAINT "DocumentActionProposal_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartNote" ADD CONSTRAINT "SmartNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAnalysisReport" ADD CONSTRAINT "CaseAnalysisReport_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Petition" ADD CONSTRAINT "Petition_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Petition" ADD CONSTRAINT "Petition_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PetitionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetitionVersion" ADD CONSTRAINT "PetitionVersion_petitionId_fkey" FOREIGN KEY ("petitionId") REFERENCES "Petition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseLawReference" ADD CONSTRAINT "CaseLawReference_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseLawReference" ADD CONSTRAINT "CaseLawReference_caseLawId_fkey" FOREIGN KEY ("caseLawId") REFERENCES "CaseLawDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
