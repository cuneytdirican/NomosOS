-- SSO / OIDC KURUMSAL GİRİŞ (Enterprise++)
--
--  * Tenant: OIDC sağlayıcı tanımı (issuer, client, şifreli sır, e-posta alanı),
--    zorlama (parola girişi kapalı — ADMIN hariç), otomatik kullanıcı açma.
--  * User.ssoSubject: sağlayıcının `sub` kimliği — ilk SSO girişinde bağlanır.

ALTER TABLE "Tenant"
  ADD COLUMN "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ssoIssuer" TEXT,
  ADD COLUMN "ssoClientId" TEXT,
  ADD COLUMN "ssoClientSecret" TEXT,
  ADD COLUMN "ssoEmailDomain" TEXT,
  ADD COLUMN "ssoEnforced" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ssoAutoProvision" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ssoDefaultRole" "UserRole" NOT NULL DEFAULT 'STAJYER';

CREATE INDEX "Tenant_ssoEmailDomain_idx" ON "Tenant"("ssoEmailDomain");

ALTER TABLE "User" ADD COLUMN "ssoSubject" TEXT;
CREATE INDEX "User_tenantId_ssoSubject_idx" ON "User"("tenantId", "ssoSubject");
