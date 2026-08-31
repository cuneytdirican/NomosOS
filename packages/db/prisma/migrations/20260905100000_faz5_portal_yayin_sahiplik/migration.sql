-- Portal yayın kaydına "sahiplik doğrulandı mı?" bayrağı.
--
-- Denetim bulgusu 4: `resolveOwner` bir kaynağın sahibini çözemediğinde
-- (dosyasız belge) sahiplik kapısı KAPANMIYOR, ATLANIYORDU. "İki bağımsız
-- koşulun aynı anda yanlış olması gerekir" güvencesi bu kayıtlar için
-- geçerli değildi ve bu, yayın listesinde hiçbir yerde görünmüyordu.
ALTER TABLE "PortalPublication" ADD COLUMN "ownershipVerified" BOOLEAN NOT NULL DEFAULT true;
