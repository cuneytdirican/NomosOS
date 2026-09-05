-- ENTERPRISE++ GÜVENLİK & YÖNETİŞİM PAKETİ
--
--  * User.twoFactorSecret / lastTotpCounter — kiracı (avukat) hesabında TOTP
--    iki adımlı doğrulama (platform paneliyle aynı desen; anahtar şifreli).
--  * Tenant.require2fa / sessionMaxHours — büro güvenlik politikası
--    (2FA zorunluluğu, oturum ömrü 1-24 sa).
--  * NotificationPreference — kullanıcı bildirim tercihleri (tür × kanal).

-- AlterTable: User
ALTER TABLE "User"
  ADD COLUMN "twoFactorSecret" TEXT,
  ADD COLUMN "lastTotpCounter" INTEGER;

-- AlterTable: Tenant
ALTER TABLE "Tenant"
  ADD COLUMN "require2fa" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sessionMaxHours" INTEGER;

-- CreateTable: NotificationPreference
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_tenantId_userId_kind_key" ON "NotificationPreference"("tenantId", "userId", "kind");
CREATE INDEX "NotificationPreference_tenantId_userId_idx" ON "NotificationPreference"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
