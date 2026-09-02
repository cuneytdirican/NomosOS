-- İ-01: PlatformUser'a hata penceresi kolonu.
--
-- SORUN: başarısız deneme sayacı hiç sıfırlanmıyordu — bir yıl önce 4 hata
-- yapan kullanıcı, bugün 1 hata daha yaptığında kilitleniyordu (5. hata).
-- Tenant tarafındaki account-lockout.ts'ta pencere VAR; panel tarafında YOKTU.
--
-- ÇÖZÜM: failureWindowEndsAt — ilk hatadan 15 dk sonra sayaç yeniden başlar.

ALTER TABLE "PlatformUser" ADD COLUMN "failureWindowEndsAt" TIMESTAMP(3);
