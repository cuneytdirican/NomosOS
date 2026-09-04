-- HEPO (Modül 28, docs/moduller/28-hepo-modulu.md): İSG/Çevre/Sağlık uyum hukuku.
--
-- İki katman:
--  1. HepoObligation — ORTAK katalog (tenantId YOK); tohum verisi
--     @nomosos/shared HEPO_OBLIGATIONS'dan slug ile idempotent upsert edilir.
--  2. HepoClientObligation — kiracıya ait atama/durum takibi (ACIK/UYGUN/
--     UYGUN_DEGIL/IHLAL); tüm sorgular tenantId ile süzülür.

CREATE TABLE "HepoObligation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "periodicity" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "penaltyNote" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HepoObligation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HepoObligation_slug_key" ON "HepoObligation"("slug");
CREATE INDEX "HepoObligation_topic_idx" ON "HepoObligation"("topic");
CREATE INDEX "HepoObligation_isActive_idx" ON "HepoObligation"("isActive");

CREATE TABLE "HepoClientObligation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACIK',
    "dueDate" TIMESTAMP(3),
    "lastDoneAt" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HepoClientObligation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HepoClientObligation_clientId_obligationId_key" ON "HepoClientObligation"("clientId", "obligationId");
CREATE INDEX "HepoClientObligation_tenantId_status_idx" ON "HepoClientObligation"("tenantId", "status");
CREATE INDEX "HepoClientObligation_tenantId_dueDate_idx" ON "HepoClientObligation"("tenantId", "dueDate");
CREATE INDEX "HepoClientObligation_clientId_idx" ON "HepoClientObligation"("clientId");

ALTER TABLE "HepoClientObligation" ADD CONSTRAINT "HepoClientObligation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HepoClientObligation" ADD CONSTRAINT "HepoClientObligation_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "HepoObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
