-- FAZ 7B — Global arama (pg_trgm) + Türkçe sıralama (ICU collation).
--
-- Türkçe collation: "tr-TR-x-icu" PostgreSQL ICU desteğiyle gelir (pgvector/pgvector:pg16 imajı
-- ICU'ludur). Yönetilen PG'de ICU yoksa göç DURUR — sessizce yanlış sıralamaya düşülmez.
-- Sıralama etkisi: ORDER BY title artık İ/ı/ş/ğ/ü/ö/ç'yi Türk alfabesine göre dizer
-- (ör. "Çelik" "Demir"den önce, "İnal" "Ilgaz"dan sonra). Eşitlik karşılaştırması deterministik kalır.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'tr-TR-x-icu') THEN
    RAISE EXCEPTION 'ICU collation "tr-TR-x-icu" bulunamadı; PostgreSQL ICU desteğiyle derlenmiş olmalı.';
  END IF;
END $$;

ALTER TABLE "Case"     ALTER COLUMN "title" TYPE TEXT COLLATE "tr-TR-x-icu";
ALTER TABLE "Client"   ALTER COLUMN "name"  TYPE TEXT COLLATE "tr-TR-x-icu";
ALTER TABLE "Task"     ALTER COLUMN "title" TYPE TEXT COLLATE "tr-TR-x-icu";
ALTER TABLE "Document" ALTER COLUMN "name"  TYPE TEXT COLLATE "tr-TR-x-icu";
ALTER TABLE "Deadline" ALTER COLUMN "title" TYPE TEXT COLLATE "tr-TR-x-icu";

-- Trigram dizinleri: ILIKE '%…%' aramaları tam tarama yerine GIN kullanır.
CREATE INDEX IF NOT EXISTS "Case_title_trgm"       ON "Case"     USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Case_fileNumber_trgm"  ON "Case"     USING gin ("fileNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Case_courtName_trgm"   ON "Case"     USING gin ("courtName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Client_name_trgm"      ON "Client"   USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_title_trgm"       ON "Task"     USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Deadline_title_trgm"   ON "Deadline" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Petition_title_trgm"   ON "Petition" USING gin ("title" gin_trgm_ops);
