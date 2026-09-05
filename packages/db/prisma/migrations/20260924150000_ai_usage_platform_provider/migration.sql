-- AI KULLANIM KAYDI — PLATFORM SAĞLAYICI REFERANSI
--
-- Platform sağlayıcısıyla (D1.3) koşan görevlerde yürütücüler sentetik
-- `platform:<id>` kimliğini `providerConfigId` (AiProviderConfig FK) sütununa
-- yazıyor, FK ihlaliyle koşu 500 düşüyordu. Platform kimliği kendi sütununa alınır.

ALTER TABLE "AiUsageLog" ADD COLUMN "platformAiProviderId" TEXT;
CREATE INDEX "AiUsageLog_platformAiProviderId_idx" ON "AiUsageLog"("platformAiProviderId");
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_platformAiProviderId_fkey"
  FOREIGN KEY ("platformAiProviderId") REFERENCES "PlatformAiProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
