-- Faz 5 denetim bulgularının uygulanması
--
-- 1) PortalUser: hesap kilidi ARTIK KALICI. Bellek içi sayaç süreç yeniden
--    başlayınca sıfırlanıyor, çok örnekli dağıtımda örnek başına tutuluyordu.
-- 2) PortalUser.sessionsValidFrom: sunucu tarafı çıkış (logout) ve parola
--    sıfırlamada mevcut token'ları geçersiz kılan damga.
-- 3) CommunicationLog: onaylanıp gönderilen mesaj ile elle düşülen not
--    ayırt edilebilsin diye kaynak ve giden mesaj bağı.

ALTER TABLE "PortalUser" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PortalUser" ADD COLUMN "failureWindowEndsAt" TIMESTAMP(3);
ALTER TABLE "PortalUser" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "PortalUser" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);

CREATE INDEX "PortalUser_email_idx" ON "PortalUser"("email");

ALTER TABLE "CommunicationLog" ADD COLUMN "source" TEXT DEFAULT 'ELLE';
ALTER TABLE "CommunicationLog" ADD COLUMN "outboundMessageId" TEXT;

CREATE INDEX "CommunicationLog_outboundMessageId_idx" ON "CommunicationLog"("outboundMessageId");
