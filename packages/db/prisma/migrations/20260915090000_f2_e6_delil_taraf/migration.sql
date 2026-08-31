-- F2 · E6 kalanı — Modül 14 KK6: delilin KİM TARAFINDAN sunulduğu.
--
-- SORUN: "Delil matrisi" görünümü delilin tarafını bilmiyordu. KK6 kapısı
-- ("kendi sunduğumuz delil kendi iddiamızı CONTRADICTS ediyorsa 422")
-- offeredBy olmadan YAPISAL olarak kurulamıyordu: hangi delilin "bizim"
-- olduğunu bilmeden tutarsızlık tespiti yapılamaz.
--
-- ÇÖZÜM: `Evidence.offeredBy` (BIZ / KARSI_TARAF / ORTAK). null = göçten
-- önceki kayıtlar; kayıpsız göç politikası: eski deliller NULL kalır —
-- yanlış varsayım (herkese BIZ damgası basmak) yeni veri üretirdi. Avukat
-- gördüğü yerde tek tıkla taraf işaretler.

CREATE TYPE "EvidenceSide" AS ENUM ('BIZ', 'KARSI_TARAF', 'ORTAK');
ALTER TABLE "Evidence" ADD COLUMN "offeredBy" "EvidenceSide";
