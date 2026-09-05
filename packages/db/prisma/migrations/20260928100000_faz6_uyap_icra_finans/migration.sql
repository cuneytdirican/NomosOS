-- Faz 6 — UYAP / icra / finans: dönemli faiz oranları, tebligat varlığı, zaman kaydı onayı + kronometre,
-- tahsilat stornosu, platform harç tarifesi.

-- 1) Faiz oranı dönemleri (yasal / avans / ticari temerrüt) — platform yönetir, hesaplar okur.
CREATE TYPE "InterestRateKind" AS ENUM ('YASAL', 'AVANS', 'TICARI_TEMERRUT');
CREATE TABLE "InterestRatePeriod" (
    "id" TEXT NOT NULL,
    "kind" "InterestRateKind" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "ratePercent" DECIMAL(6,2) NOT NULL,
    "source" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterestRatePeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InterestRatePeriod_kind_validFrom_key" ON "InterestRatePeriod"("kind", "validFrom");
-- 3095 s.K. m.1 — kanuni faiz %9 (2005/9831 s. BKK, 01.01.2006'dan itibaren). Avans/ticari oranlar
-- TCMB duyurusundan platform panelinden girilir; burada uydurulmaz.
INSERT INTO "InterestRatePeriod" ("id","kind","validFrom","ratePercent","source")
VALUES ('00000000-0000-4000-8000-0000faiz0001','YASAL','2006-01-01 00:00:00','9.00','3095 s.K. m.1 · 2005/9831 s. BKK');

-- İcra dosyası: faiz türü (null = dosyadaki sabit oran).
ALTER TABLE "EnforcementFile" ADD COLUMN "interestKind" "InterestRateKind";

-- 2) Tebligat varlığı — tür/kanal/tarih; tebliğ tarihi süre motorunu tetikler.
CREATE TYPE "TebligatKanali" AS ENUM ('UETS', 'KEP', 'PTT', 'ELDEN', 'EPOSTA', 'DIGER');
CREATE TYPE "TebligatYonu" AS ENUM ('GELEN', 'GIDEN');
CREATE TABLE "Tebligat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT,
    "channel" "TebligatKanali" NOT NULL,
    "direction" "TebligatYonu" NOT NULL DEFAULT 'GELEN',
    "subject" TEXT NOT NULL,
    "counterparty" TEXT,
    "sentAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "deadlineRuleKey" TEXT,
    "deadlineId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Tebligat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Tebligat_tenantId_caseId_idx" ON "Tebligat"("tenantId", "caseId");
CREATE INDEX "Tebligat_tenantId_servedAt_idx" ON "Tebligat"("tenantId", "servedAt");
ALTER TABLE "Tebligat" ADD CONSTRAINT "Tebligat_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Zaman kaydı onayı + kronometre.
CREATE TYPE "TimeEntryStatus" AS ENUM ('TASLAK', 'ONAY_BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI');
ALTER TABLE "TimeEntry"
  ADD COLUMN "status" "TimeEntryStatus" NOT NULL DEFAULT 'TASLAK',
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT;
-- Mevcut kayıtlar onaylı sayılır (geriye dönük iş akışı yoktu).
UPDATE "TimeEntry" SET "status" = 'ONAYLANDI';
CREATE INDEX "TimeEntry_tenantId_status_idx" ON "TimeEntry"("tenantId", "status");
CREATE TABLE "TimeTimer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caseId" TEXT,
    "clientId" TEXT,
    "description" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimeTimer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimeTimer_userId_key" ON "TimeTimer"("userId");

-- 4) Tahsilat stornosu (silme yerine ters kayıt; kanıt durur).
ALTER TABLE "Payment"
  ADD COLUMN "stornoAt" TIMESTAMP(3),
  ADD COLUMN "stornoBy" TEXT,
  ADD COLUMN "stornoReason" TEXT;

-- 5) Platform harç tarifesi (Harçlar Kanunu (1) sayılı tarife — yıl bazlı; platform girer).
CREATE TABLE "PlatformHarcTarifesi" (
    "id" TEXT NOT NULL,
    "yil" INTEGER NOT NULL,
    "pesinBinde" DECIMAL(6,2) NOT NULL,
    "istinafBinde" DECIMAL(6,2) NOT NULL,
    "temyizBinde" DECIMAL(6,2) NOT NULL,
    "maktuKalemlerJson" TEXT NOT NULL,
    "kaynak" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformHarcTarifesi_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformHarcTarifesi_yil_key" ON "PlatformHarcTarifesi"("yil");
