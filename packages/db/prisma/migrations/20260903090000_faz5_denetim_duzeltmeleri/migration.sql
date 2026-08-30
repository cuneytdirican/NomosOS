-- FAZ 5 DENETİM DÜZELTMELERİ
--
-- 1) ConflictHit.escalated — "açık dosyada karşı taraf" yükseltmesi artık kararın
--    KENDİSİ olarak saklanır. Önceden yalnız `note` cümlesinin içinde geçiyordu;
--    kayıt geri okunduğunda çakışmanın hangi satırdan geldiği yapısal olarak
--    kaybolduğu için satır bandı benzerlikten yeniden türetiliyor ve genel sonuç
--    CAKISMA iken satır DIKKAT görünüyordu.
--
-- 2) CreditWallet.reservedSince — sahipsiz rezervasyon süpürücüsünün zaman
--    damgası. Süreç çağrı ortasında ölürse `settle`/`release` hiç çalışmaz ve
--    rezerve kredi kalıcı olarak kilitlenirdi; bu damga olmadan "eskileri düş"
--    demek de mümkün değildi.
--
-- 3) RiskScore.baseScore / RiskScoreHistory.baseScore — deterministik kural
--    tabanı artık SAKLANIYOR. `score - aiAdjustment` ile geri hesaplamak,
--    0-100 kırpması devreye girdiğinde (taban 85 + AI 25 → skor 100) tabanı
--    75 gösteriyordu; avukat override kararını bu yanlış sayıya bakarak
--    veriyordu. Sütun NULL kalabilir: mevcut satırlar için okuyucu eski geri
--    hesaba düşer, ilk yeniden hesapta gerçek taban yazılır.

-- AlterTable
ALTER TABLE "ConflictHit" ADD COLUMN     "escalated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CreditWallet" ADD COLUMN     "reservedSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RiskScore" ADD COLUMN     "baseScore" INTEGER;

-- AlterTable
ALTER TABLE "RiskScoreHistory" ADD COLUMN     "baseScore" INTEGER;
