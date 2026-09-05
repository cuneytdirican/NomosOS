-- FAZ 7A — Belge sürümü + klasör yolu + süreli paylaşım bağlantısı + e-posta (IMAP) belge girişi.

-- 1) Document: klasör yolu + sürüm zinciri
ALTER TABLE "Document"
  ADD COLUMN "folderPath" TEXT NOT NULL DEFAULT '/',
  ADD COLUMN "versionNo" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rootDocumentId" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE INDEX "Document_tenantId_rootDocumentId_idx" ON "Document"("tenantId", "rootDocumentId");
CREATE INDEX "Document_tenantId_caseId_folderPath_idx" ON "Document"("tenantId", "caseId", "folderPath");

-- 2) Süreli paylaşım bağlantısı — jeton yalnız SHA-256 özetiyle saklanır.
CREATE TABLE "DocumentShareLink" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxDownloads" INTEGER,
  "downloads" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdBy" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastAccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentShareLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentShareLink_tokenHash_key" ON "DocumentShareLink"("tokenHash");
CREATE INDEX "DocumentShareLink_tenantId_documentId_idx" ON "DocumentShareLink"("tenantId", "documentId");
ALTER TABLE "DocumentShareLink"
  ADD CONSTRAINT "DocumentShareLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) E-posta ile belge girişi (IMAP) — kiracı başına tek posta kutusu; parola AES-GCM ile mühürlü.
CREATE TABLE "MailIngestConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 993,
  "secure" BOOLEAN NOT NULL DEFAULT true,
  "username" TEXT NOT NULL,
  "passwordEnc" TEXT NOT NULL,
  "folder" TEXT NOT NULL DEFAULT 'INBOX',
  "defaultCaseId" TEXT,
  "lastUid" INTEGER NOT NULL DEFAULT 0,
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastSummary" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailIngestConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailIngestConfig_tenantId_key" ON "MailIngestConfig"("tenantId");
