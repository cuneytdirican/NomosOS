-- FAZ 7G — dosya detayı: kapanış kontrol listesi + arşiv kutusu; tanık ayrıntıları.

ALTER TABLE "Case" ADD COLUMN "closingChecklistJson" TEXT;
ALTER TABLE "Case" ADD COLUMN "archiveBoxNo" TEXT;

-- Tanık (Evidence.type = TANIK) ayrıntıları: iletişim, yakınlık, celp durumu, beyan özeti (JSON).
ALTER TABLE "Evidence" ADD COLUMN "witnessInfoJson" TEXT;
