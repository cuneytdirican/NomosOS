-- denetim bulgusu İ-01 (üretim öncesi kimlik sertleştirme): TOTP tekrar
-- oynatma koruması.
--
-- SORUN: `window: 1` saat kayması toleransı verir; kullanılan adım hiçbir
-- yerde saklanmadığı için AYNI 6 haneli kod, geçerlilik penceresi boyunca
-- (±1 adım toleransla 90 saniyeye kadar) TEKRAR TEKRAR kabul edilirdi.
-- Kodu bir kez gören biri (ekran fotoğrafı, MITM kalıntısı) aynı kodu ikinci
-- bir oturum için kullanabilirdi.
--
-- ÇÖZÜM: son KULLANILAN adım sayacı. Doğrulama başarılıysa kodun adım sayacı
-- bu sütuna yazılır; kendisinden KÜÇÜK/EŞİT hiçbir adım artık kabul edilmez.
-- 2FA sıfırlandığında (dört-gözlü onaylı kullanıcı güncellemesi) null'lanır.

ALTER TABLE "PlatformUser" ADD COLUMN "lastTotpCounter" INTEGER;
