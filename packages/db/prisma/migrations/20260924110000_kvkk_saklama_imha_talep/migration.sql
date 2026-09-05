-- KVKK SAKLAMA / İMHA POLİTİKASI + VERİ ÖZNESİ TALEPLERİ (Enterprise++)
--
--  * Tenant.retentionYears: dosya kapanışından itibaren saklama yılı (varsayılan 10,
--    politika matrisi K1 / Av. K. m.39). Süre dolan KAPANDI dosyalar imha ADAYIDIR;
--    imha yalnız ADMIN kararıyla ve gerekçeyle uygulanır (otomatik silme YOK).
--  * Case.anonymizedAt: imha uygulandı damgası (belgeler + RAG parçaları silindi).
--  * KvkkRequest: veri öznesi talebi kaydı + 30 günlük yasal yanıt süresi.
--  * NotificationKind.KVKK_SAKLAMA: aylık ADMIN uyarısı.

ALTER TABLE "Tenant" ADD COLUMN "retentionYears" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Case" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

ALTER TYPE "NotificationKind" ADD VALUE 'KVKK_SAKLAMA';

CREATE TABLE "KvkkRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACIK',
    "subject" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KvkkRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KvkkRequest_tenantId_status_dueAt_idx" ON "KvkkRequest"("tenantId", "status", "dueAt");
CREATE INDEX "KvkkRequest_clientId_idx" ON "KvkkRequest"("clientId");

ALTER TABLE "KvkkRequest" ADD CONSTRAINT "KvkkRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KvkkRequest" ADD CONSTRAINT "KvkkRequest_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
