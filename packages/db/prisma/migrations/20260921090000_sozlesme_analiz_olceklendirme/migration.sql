-- SÖZLEŞME ANALİZİ ÖLÇEKLENDİRMESİ — çok sayfalı sözleşmeler (map-reduce).
--
--  · ContractAnalysisRun.chunkStatsJson  — parça künyesi (parça sayısı, sayfa
--    aralıkları, parça başına durum). Ham metin YAZILMAZ: metin zaten
--    ContractVersion'dadır; koşu çıktısı yalnız bulgu/şerh taşır.
--  · ContractClauseAnnotation.pageFrom/pageTo — şerhin sanal sayfa konumu;
--    yüzlerce sayfalık sözleşmede şerhin metnin neresinde olduğu görünür olur.
--  · ContractVersionDiff.pagesJson — sayfa pencereli fark: yalnızca DEĞİŞEN
--    sayfalar kaydedilir; sonuç sayfalanmış döner. Eski kayıtlarda null kalır.

ALTER TABLE "ContractAnalysisRun" ADD COLUMN "chunkStatsJson" TEXT;

ALTER TABLE "ContractClauseAnnotation" ADD COLUMN "pageFrom" INTEGER,
    ADD COLUMN "pageTo" INTEGER;

ALTER TABLE "ContractVersionDiff" ADD COLUMN "pagesJson" TEXT;
