-- KULLANICI TANIMLI MODEL EĞİTİMİ + PLATFORM AAÜT TARİFESİ
--
--  * FineTuneJob: kiracı işleri (tenantId + providerConfigId) ve platform
--    işleri (platformAiProviderId) tek tabloda; provider/baseModel artık
--    KATALOGDAN çözülen anlık görüntüdür (serbest metin girişi yok).
--    requestedById nullable (kiracı işinde PlatformUser yoktur; requestedByUserId).
--  * AiProviderConfig.origin / PlatformAiProvider.origin: TANIMLI | IMPORTED —
--    dışarıda eğitilmiş model KAYDI içe aktarma (ağırlık dosyası girmez).
--  * PlatformVekaletTarife: büro kendi AAÜT tarifesini girmediyse kullanılan
--    resmî (Resmî Gazete) platform tarifesi; künye zorunlu, rakam uydurulmaz.

-- AlterTable: FineTuneJob
ALTER TABLE "FineTuneJob"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "providerConfigId" TEXT,
  ADD COLUMN "platformAiProviderId" TEXT,
  ADD COLUMN "requestedByUserId" TEXT,
  ALTER COLUMN "requestedById" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "FineTuneJob_tenantId_createdAt_idx" ON "FineTuneJob"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "FineTuneJob" ADD CONSTRAINT "FineTuneJob_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FineTuneJob" ADD CONSTRAINT "FineTuneJob_providerConfigId_fkey"
  FOREIGN KEY ("providerConfigId") REFERENCES "AiProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FineTuneJob" ADD CONSTRAINT "FineTuneJob_platformAiProviderId_fkey"
  FOREIGN KEY ("platformAiProviderId") REFERENCES "PlatformAiProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: origin (TANIMLI | IMPORTED)
ALTER TABLE "AiProviderConfig" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'TANIMLI';
CREATE INDEX "AiProviderConfig_origin_idx" ON "AiProviderConfig"("origin");

ALTER TABLE "PlatformAiProvider" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'TANIMLI';
CREATE INDEX "PlatformAiProvider_origin_idx" ON "PlatformAiProvider"("origin");

-- CreateTable: PlatformVekaletTarife
CREATE TABLE "PlatformVekaletTarife" (
    "id" TEXT NOT NULL,
    "yil" INTEGER NOT NULL,
    "maktuKademelerJson" TEXT NOT NULL,
    "maktuTekrarJson" TEXT,
    "nispiOranYuzde" DECIMAL(5,2) NOT NULL,
    "kdvOrani" DECIMAL(4,2) NOT NULL DEFAULT 20,
    "rgKunye" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformVekaletTarife_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformVekaletTarife_yil_key" ON "PlatformVekaletTarife"("yil");
