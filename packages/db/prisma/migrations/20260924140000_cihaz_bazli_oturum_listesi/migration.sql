-- CİHAZ BAZLI OTURUM LİSTESİ (Enterprise++)
--
-- Her giriş (parola / parola+2fa / sso) bir UserSession satırı üretir; JWT
-- `jti` ile eşleşir. Kullanıcı kendi açık oturumlarını görür ve TEK TEK
-- kapatabilir (bugüne kadar yalnız "tümünü düşür" vardı — sessionsValidFrom).
-- Yönetici, büro kullanıcısının oturumlarını görür/kapatır.

CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "userAgent" TEXT,
    "deviceLabel" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserSession_jti_key" ON "UserSession"("jti");
CREATE INDEX "UserSession_userId_revokedAt_expiresAt_idx" ON "UserSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "UserSession_tenantId_createdAt_idx" ON "UserSession"("tenantId", "createdAt");
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
