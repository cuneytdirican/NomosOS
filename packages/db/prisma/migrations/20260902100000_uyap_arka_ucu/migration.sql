-- UYAP Köprüsü arka ucu — eklentinin çağırdığı uçların veri modelleri.
--
-- Eklenti (apps/uyap-extension) tamamen yazıldı ama arka ucu yoktu; pazarlama
-- bu yüzden "geliştirme aşamasında" diyordu. Bu geçiş arka ucu kurar:
--   UyapPairing        — web arayüzünde üretilen eşleştirme kodları
--   UyapExtensionToken  — eşleştirilmiş tarayıcı eklentileri (token hash'li)
--   UyapCaseLink        — UYAP dosya no ↔ NomosOS dosyası bağlantısı
--   UyapMatchQueue      — eşleşmeyen dosyaların bekleme kuyruğu
--   UyapEventRecord     — UYAP safahat/duruşma kayıtları (idempotent)

CREATE TABLE "UyapPairing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UyapPairing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UyapPairing_code_key" ON "UyapPairing"("code");
CREATE INDEX "UyapPairing_tenantId_createdAt_idx" ON "UyapPairing"("tenantId", "createdAt");

CREATE TABLE "UyapExtensionToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "extensionVersion" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UyapExtensionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UyapExtensionToken_accessTokenHash_key" ON "UyapExtensionToken"("accessTokenHash");
CREATE UNIQUE INDEX "UyapExtensionToken_refreshTokenHash_key" ON "UyapExtensionToken"("refreshTokenHash");
CREATE INDEX "UyapExtensionToken_tenantId_userId_idx" ON "UyapExtensionToken"("tenantId", "userId");

CREATE TABLE "UyapCaseLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uyapDosyaNo" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "matchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UyapCaseLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UyapCaseLink_tenantId_uyapDosyaNo_key" ON "UyapCaseLink"("tenantId", "uyapDosyaNo");

ALTER TABLE "UyapCaseLink" ADD CONSTRAINT "UyapCaseLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UyapMatchQueue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uyapDosyaNo" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedCaseId" TEXT,

    CONSTRAINT "UyapMatchQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UyapMatchQueue_tenantId_uyapDosyaNo_key" ON "UyapMatchQueue"("tenantId", "uyapDosyaNo");

CREATE TABLE "UyapEventRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT,
    "uyapDosyaNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalHash" TEXT NOT NULL,
    "tarih" TIMESTAMP(3) NOT NULL,
    "islem" TEXT NOT NULL,
    "aciklama" TEXT,
    "birim" TEXT,
    "sira" INTEGER,
    "salon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UyapEventRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UyapEventRecord_tenantId_externalHash_key" ON "UyapEventRecord"("tenantId", "externalHash");
CREATE INDEX "UyapEventRecord_tenantId_caseId_idx" ON "UyapEventRecord"("tenantId", "caseId");
CREATE INDEX "UyapEventRecord_tenantId_createdAt_idx" ON "UyapEventRecord"("tenantId", "createdAt");
