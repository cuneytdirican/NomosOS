-- Faz 2 — bildirim gerçek kanallar + büro parola sıfırlama.

-- Dış kanal dağıtımı (e-posta/push) damgası: bir bildirim bir kez dağıtılır.
ALTER TABLE "NotificationOutbox" ADD COLUMN "dispatchedAt" TIMESTAMP(3);
CREATE INDEX "NotificationOutbox_dispatchedAt_status_idx" ON "NotificationOutbox"("dispatchedAt", "status");

-- Büro kullanıcısı parola sıfırlama jetonu (SHA-256 özeti; ham jeton yalnız e-postada).
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON "PasswordResetToken"("userId", "usedAt");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
