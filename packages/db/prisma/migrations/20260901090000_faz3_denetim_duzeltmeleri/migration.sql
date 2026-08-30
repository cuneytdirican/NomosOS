-- FAZ 3 DENETİM DÜZELTMELERİ
--
-- 1) PlatformUser: oturum sürümü (token iptali) + hesap kilidi (2FA kaba kuvvet).
-- 2) EnforcementFile: faiz başlangıç tarihi (temerrüt/vade) — hesap uydurulmasın.
-- 3) CollectionScore: taban skor + AI düzeltmesi ayrı saklanır (bant korunsun).

ALTER TABLE "PlatformUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlatformUser" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlatformUser" ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "EnforcementFile" ADD COLUMN "interestStartDate" TIMESTAMP(3);

ALTER TABLE "CollectionScore" ADD COLUMN "baseScore" INTEGER;
ALTER TABLE "CollectionScore" ADD COLUMN "aiAdjustment" INTEGER;
ALTER TABLE "CollectionScore" ADD COLUMN "bandSource" TEXT;
