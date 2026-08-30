-- Faz 2 denetim düzeltmeleri
--
-- 1) Tenant.aiPolicy   — "verilerim dışarı çıkmasın" garantisi tek ayarla verilebilsin.
-- 2) Tenant.autoMaskConsent — otomatik belge hattının dış sağlayıcıya (maskeli de olsa)
--    veri göndermesi için kayıtlı rıza; yoksa hattın AI adımları ATLANIR.
-- 3) CaseLawDocument.createdByTenantId — ortak içtihat havuzunda kiracılar arası
--    YAZMA izolasyonu (içerik zehirlenmesi ve serbest metin sızıntısı savunması).
-- 4) pg_trgm GIN indeksleri — ILIKE '%...%' aramaları indekssiz tam tablo taraması
--    yapıyordu (belge tam metni belge başına 200.000 karaktere kadar).

-- 1 & 2 --------------------------------------------------------------------
CREATE TYPE "AiPolicy" AS ENUM ('SERBEST', 'SADECE_YEREL');

ALTER TABLE "Tenant" ADD COLUMN "aiPolicy" "AiPolicy" NOT NULL DEFAULT 'SERBEST';
ALTER TABLE "Tenant" ADD COLUMN "autoMaskConsent" BOOLEAN NOT NULL DEFAULT false;

-- 3 ------------------------------------------------------------------------
ALTER TABLE "CaseLawDocument" ADD COLUMN "createdByTenantId" TEXT;
CREATE INDEX "CaseLawDocument_createdByTenantId_idx" ON "CaseLawDocument"("createdByTenantId");

-- 4 ------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Document_ocrText_trgm_idx"
  ON "Document" USING gin ("ocrText" gin_trgm_ops);
CREATE INDEX "Document_name_trgm_idx"
  ON "Document" USING gin ("name" gin_trgm_ops);
CREATE INDEX "CaseLawDocument_summary_trgm_idx"
  ON "CaseLawDocument" USING gin ("summary" gin_trgm_ops);
CREATE INDEX "CaseLawDocument_fullText_trgm_idx"
  ON "CaseLawDocument" USING gin ("fullText" gin_trgm_ops);
