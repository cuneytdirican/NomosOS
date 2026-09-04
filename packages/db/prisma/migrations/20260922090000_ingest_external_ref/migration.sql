-- İÇTİHAT ONAY MASASI — okuyarak onay (plans/ictihat-havuzu-yol-haritasi.md madde 4).
--
--   · CaseLawIngestItem.externalRef — besleme kaydının dış kaynak karar kimliği.
--     Onay öncesi karar metnini KAYNAKTAN okumak için gerekir: kuyruk kaydında
--     fullText yoksa önizleme bu kimlikle resmî belge ucundan (getDokuman?id=)
--     TEMİZ METİN çeker. Besleme kaydı externalId/id alanı taşıyorsa çekim
--     sırasında yazılır; taşımıyorsa null kalır ve önizleme dürüst hata verir.

ALTER TABLE "CaseLawIngestItem" ADD COLUMN "externalRef" TEXT;
