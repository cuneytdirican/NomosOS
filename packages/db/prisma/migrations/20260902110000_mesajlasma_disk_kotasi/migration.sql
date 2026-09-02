-- BÜRO İÇİ MESAJLAŞMA + DİSK KOTASI
--
-- Mesajlaşma: OfficeMessage (SİLME YOK — deletedAt bilinçli olarak yok; büro
-- içi yazışma denetim izidir), OfficeReadState (okundu), OfficeCall +
-- OfficeCallSignal (video arama — WebRTC sinyalleri polling ile).
-- User: avatarStorageKey (profil fotoğrafı) + lastSeenAt (çevrimiçi).
-- Disk kotası: DiskQuota (plan dahil + satın alınan), DiskQuotaAdjustment.

-- User: profil fotoğrafı + çevrimiçi durumu
ALTER TABLE "User" ADD COLUMN "avatarStorageKey" TEXT;
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- Mesajlaşma (Office* — AI sohbetinin ChatMessage'ından ayrı)
CREATE TABLE "OfficeMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "content" TEXT,
    "attachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeMessage_tenantId_createdAt_idx" ON "OfficeMessage"("tenantId", "createdAt");
CREATE INDEX "OfficeMessage_tenantId_senderId_recipientId_createdAt_idx" ON "OfficeMessage"("tenantId", "senderId", "recipientId", "createdAt");
CREATE INDEX "OfficeMessage_tenantId_recipientId_createdAt_idx" ON "OfficeMessage"("tenantId", "recipientId", "createdAt");

ALTER TABLE "OfficeMessage" ADD CONSTRAINT "OfficeMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMessage" ADD CONSTRAINT "OfficeMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMessage" ADD CONSTRAINT "OfficeMessage_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Okundu bilgisi
CREATE TABLE "OfficeReadState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeReadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficeReadState_tenantId_userId_peerId_key" ON "OfficeReadState"("tenantId", "userId", "peerId");
CREATE INDEX "OfficeReadState_tenantId_userId_idx" ON "OfficeReadState"("tenantId", "userId");

ALTER TABLE "OfficeReadState" ADD CONSTRAINT "OfficeReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Video arama
CREATE TABLE "OfficeCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RINGING',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeCall_tenantId_calleeId_createdAt_idx" ON "OfficeCall"("tenantId", "calleeId", "createdAt");
CREATE INDEX "OfficeCall_tenantId_callerId_createdAt_idx" ON "OfficeCall"("tenantId", "callerId", "createdAt");

ALTER TABLE "OfficeCall" ADD CONSTRAINT "OfficeCall_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeCall" ADD CONSTRAINT "OfficeCall_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WebRTC sinyal kuyruğu
CREATE TABLE "OfficeCallSignal" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeCallSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeCallSignal_callId_createdAt_idx" ON "OfficeCallSignal"("callId", "createdAt");

ALTER TABLE "OfficeCallSignal" ADD CONSTRAINT "OfficeCallSignal_callId_fkey" FOREIGN KEY ("callId") REFERENCES "OfficeCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Disk kotası
CREATE TABLE "DiskQuota" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "includedBytes" BIGINT NOT NULL DEFAULT 0,
    "purchasedBytes" BIGINT NOT NULL DEFAULT 0,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "recomputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiskQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiskQuota_tenantId_key" ON "DiskQuota"("tenantId");
CREATE INDEX "DiskQuota_tenantId_idx" ON "DiskQuota"("tenantId");

CREATE TABLE "DiskQuotaAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deltaBytes" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'BEKLIYOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiskQuotaAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiskQuotaAdjustment_tenantId_createdAt_idx" ON "DiskQuotaAdjustment"("tenantId", "createdAt");

-- Satılabilir disk paketleri (CreditPackage deseni)
CREATE TABLE "DiskPackage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "gb" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DiskPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiskPackage_key_key" ON "DiskPackage"("key");

-- Başlangıç paketleri (platform panelinden yönetilir)
INSERT INTO "DiskPackage" ("id", "key", "gb", "price", "currency", "isActive") VALUES
  (gen_random_uuid(), 'DISK_10GB',  10,   250.00, 'TRY', true),
  (gen_random_uuid(), 'DISK_50GB',  50,  1000.00, 'TRY', true),
  (gen_random_uuid(), 'DISK_100GB', 100, 1750.00, 'TRY', true);
