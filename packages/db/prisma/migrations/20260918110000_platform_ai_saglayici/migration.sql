-- PLATFORM AI SAĞLAYICISI (plan: D1.3).
--
-- NomosOS'un işlettiği AI sağlayıcıları. Kiracı planında BYO-LLM yetkisi
-- yoksa veya kiracı sağlayıcı tanımlamamışsa AI görevleri bu tablodan çözülür.
-- API anahtarı AES-256-GCM ile şifreli saklanır (crypto.ts deseninin aynısı).

CREATE TABLE "PlatformAiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "baseUrl" TEXT,
    "defaultModel" TEXT NOT NULL,
    "headersJson" TEXT,
    "mappingJson" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAiProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAiProvider_name_key" ON "PlatformAiProvider"("name");
CREATE INDEX "PlatformAiProvider_isActive_isDefault_idx" ON "PlatformAiProvider"("isActive", "isDefault");
