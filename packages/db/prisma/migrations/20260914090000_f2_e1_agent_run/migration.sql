-- F2 · E1 — AI ajan gözlemlenebilirliği.
--
-- SORUN: LLM çağrıları AiUsageLog'a yazılıyordu ama o İÇ MUHASEBE kaydıdır
-- (token/kredi/maliyet). "Hangi ajan, hangi girdiyle ne döndü, neden başarısız
-- oldu" sorusunun cevabı yoktu; çıktı guard'ının elediği çağrılar günlükte
-- yalnız bir istisna olarak görünüyordu. Sonraki her AI epic'ini
-- enstrümante edecek temel iz tablosu bu yüzdendir.
--
-- KVKK: AgentRun'a TAM METİN ASLA yazılmaz — yalnız özet (alan adları,
-- uzunluklar, maskelenmiş kısa alıntı). Maskeleme ÖNCESİ metin kayda girmez.

-- ALTER TABLE "Tenant" ADD COLUMN "xxx" gerekmez; yeni tablolar:

CREATE TABLE "AgentDefinition" (
    "id" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentDefinition_agentKey_key" ON "AgentDefinition"("agentKey");

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "userId" TEXT,
    "entity" TEXT,
    "entityId" TEXT,
    "model" TEXT,
    "providerType" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER,
    "piiMasked" BOOLEAN NOT NULL DEFAULT false,
    "inputSummaryJson" TEXT,
    "outputSummaryJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRun_tenantId_agentKey_createdAt_idx" ON "AgentRun"("tenantId", "agentKey", "createdAt");
CREATE INDEX "AgentRun_tenantId_taskType_createdAt_idx" ON "AgentRun"("tenantId", "taskType", "createdAt");
CREATE INDEX "AgentRun_tenantId_status_createdAt_idx" ON "AgentRun"("tenantId", "status", "createdAt");
