-- FAZ 7F — müvekkil portalı: yapılacaklar (PortalTodo), KVKK/İYS rıza kayıtları (PortalConsent).

CREATE TYPE "PortalTodoStatus" AS ENUM ('ACIK', 'TAMAMLANDI', 'IPTAL');
CREATE TYPE "PortalConsentKind" AS ENUM ('KVKK_AYDINLATMA', 'ACIK_RIZA', 'ILETISIM_EPOSTA', 'ILETISIM_SMS');

CREATE TABLE "PortalTodo" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "caseId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueDate" DATE,
  "status" "PortalTodoStatus" NOT NULL DEFAULT 'ACIK',
  "createdBy" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "completedNote" TEXT,
  "completedByPortalUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalTodo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PortalTodo_tenantId_clientId_status_idx" ON "PortalTodo"("tenantId", "clientId", "status");
CREATE INDEX "PortalTodo_caseId_idx" ON "PortalTodo"("caseId");
ALTER TABLE "PortalTodo" ADD CONSTRAINT "PortalTodo_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalTodo" ADD CONSTRAINT "PortalTodo_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rıza kaydı EKLEME-YALNIZ (append-only): her değişiklik yeni satır; güncel durum = tür başına son satır.
-- İYS/KVKK denetiminde "kim, ne zaman, hangi metne, hangi cihazdan" izi tam kalır.
CREATE TABLE "PortalConsent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "portalUserId" TEXT NOT NULL,
  "kind" "PortalConsentKind" NOT NULL,
  "version" TEXT NOT NULL,
  "accepted" BOOLEAN NOT NULL,
  "textHash" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PortalConsent_tenantId_clientId_kind_createdAt_idx" ON "PortalConsent"("tenantId", "clientId", "kind", "createdAt");
ALTER TABLE "PortalConsent" ADD CONSTRAINT "PortalConsent_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
