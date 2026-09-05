-- Faz 5 — RAG ölçek: pgvector (HNSW) + pg_trgm + kiracı/dosya indeksi.
-- GEREKSİNİM: PostgreSQL'de pgvector uzantısı kurulu olmalı (docker imajı pgvector/pgvector:pg16
-- ya da yönetilen PG'de pgvector etkin). Uzantı yoksa bu göç DURUR — sessiz düşüş yok.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Vektör sütunu (boyutsuz: 768/1024/1536 modeller aynı tabloda) + boyut kaydı.
ALTER TABLE "DocumentChunk"
  ADD COLUMN "embeddingVec" vector,
  ADD COLUMN "embeddingDim" INTEGER;

-- Mevcut Float[] gömmelerini taşı (kaynak doğrusu embedding sütunu; JS yolu bayrakla korunur).
UPDATE "DocumentChunk"
SET "embeddingVec" = embedding::real[]::vector,
    "embeddingDim" = array_length(embedding, 1)
WHERE array_length(embedding, 1) > 0;

-- HNSW indeksler: pgvector sabit boyut ister → yaygın boyutlar için kısmi ifade indeksleri.
-- (Farklı boyutlu modeller indekssiz ama DOĞRU çalışır: sıralı tarama.)
CREATE INDEX "DocumentChunk_embeddingVec_768_hnsw" ON "DocumentChunk"
  USING hnsw ((("embeddingVec")::vector(768)) vector_cosine_ops)
  WHERE "embeddingDim" = 768;
CREATE INDEX "DocumentChunk_embeddingVec_1024_hnsw" ON "DocumentChunk"
  USING hnsw ((("embeddingVec")::vector(1024)) vector_cosine_ops)
  WHERE "embeddingDim" = 1024;
CREATE INDEX "DocumentChunk_embeddingVec_1536_hnsw" ON "DocumentChunk"
  USING hnsw ((("embeddingVec")::vector(1536)) vector_cosine_ops)
  WHERE "embeddingDim" = 1536;

-- Anahtar kelime yedeği (ILIKE) ve OCR metni için trigram GIN.
CREATE INDEX "DocumentChunk_content_trgm" ON "DocumentChunk" USING gin ("content" gin_trgm_ops);
CREATE INDEX "Document_ocrText_trgm" ON "Document" USING gin ("ocrText" gin_trgm_ops);

-- Kiracı + dosya süzgeci (her RAG sorgusunun ilk adımı).
CREATE INDEX "DocumentChunk_tenantId_caseId_idx" ON "DocumentChunk"("tenantId", "caseId");
