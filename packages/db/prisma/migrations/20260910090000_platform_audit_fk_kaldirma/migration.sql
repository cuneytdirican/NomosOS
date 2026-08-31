-- denetim bulgusu Ö-27 kalıntısı (kapatıcı 2): PlatformUser hard delete'i
-- yapısal olarak imkânsızlaştırma.
--
-- SORUN: PlatformAuditLog.platformUserId üzerindeki FK (onDelete: SetNull),
-- PlatformUser hard delete'ini veritabanı düzeyinde olanaklı kılıyordu.
-- Ama hard delete, PlatformAuditLog satırlarında UPDATE (platformUserId -> NULL)
-- koşar; Ö-27'nin append-only trigger'ı UPDATE'i her durumda reddeder. Yani
-- bir gün hard delete çağrısı eklenirse platform kullanıcı yönetimi KİLİTLENİR:
-- silme yarım kalır ve hata üretir. Mevcut güvence yalnızca "repoda böyle bir
-- çağrı yok" gözlemiydi — yapısal bir garanti değildi.
--
-- ÇÖZÜM: FK'yi tamamen kaldır. platformUserId artık tenantId ile AYNI desen:
-- FK'sız nullable skaler kolon. Kiracı silinse de iz ayakta kaldığı gibi,
-- platform kullanıcısı hard delete edilse de iz ayakta kalır; ad-soyad
-- çözümlemesi sorgu tarafında "(silinmiş kullanıcı)" şeridiyle yapılır.
-- Böylece hard delete işlemi artık append-only trigger'ıyla ÇAKIŞMAZ ve
-- denetim izi her koşulda korunur.

ALTER TABLE "PlatformAuditLog" DROP CONSTRAINT "PlatformAuditLog_platformUserId_fkey";
