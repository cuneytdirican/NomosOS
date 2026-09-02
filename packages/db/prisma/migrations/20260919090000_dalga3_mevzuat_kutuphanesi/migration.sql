-- DALGA 3 (geliştirme planı D3 / A4): mevzuat kütüphanesi.
--
-- DÜRÜSTLÜK (vaat kısıtı): Resmî Gazete'den otomatik senkron YOKTUR — kaynak
-- entegrasyonu sözleşmeye bağlıdır ve bu vaat edilemez. Büro, kullandığı
-- mevzuat metnini KENDİSİ yükler ve güncel tutar; tam metin arama yereldir
-- (tüm satırlar taranır, tavan 500 sonuç).

CREATE TABLE "Legislation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "number" TEXT,
    "year" INTEGER,
    "enactedAt" DATE,
    "fullText" TEXT NOT NULL,
    "preview" TEXT NOT NULL DEFAULT '',
    "tags" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "versionNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Legislation_pkey" PRIMARY KEY ("id")
);

-- Tam metin değişince preview'yu senkron tutan tetikleyici (satır bazlı).
CREATE OR REPLACE FUNCTION legislation_sync_preview() RETURNS trigger AS $$
BEGIN
  NEW."preview" := left(NEW."fullText", 2000);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legislation_preview_trigger
BEFORE INSERT OR UPDATE OF "fullText" ON "Legislation"
FOR EACH ROW EXECUTE FUNCTION legislation_sync_preview();

CREATE INDEX "Legislation_tenantId_docType_idx" ON "Legislation"("tenantId", "docType");
CREATE INDEX "Legislation_tenantId_title_idx" ON "Legislation"("tenantId", "title");
