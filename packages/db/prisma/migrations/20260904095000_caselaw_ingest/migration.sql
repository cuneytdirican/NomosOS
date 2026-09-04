-- İÇTİHAT TOPLAMA HATTI (caselaw-ingest): besleme kaynakları + onay kuyruğu.
--
-- Tasarım: zamanlanmış iş (caselaw-ingest-daily) yapılandırılmış kaynaklardan
-- yeni kararları ÇEKER ve CaseLawIngestItem'a yazar; kayıt onaylanmadan ortak
-- havuza (CaseLawDocument) GİRMEZ. Onay, CaselawPoolService'in künye
-- doğrulamasından birebir geçer. Kaynak adresi YAPILANDIRMADADIR (kod sabiti
-- değildir) — uydurma entegrasyon yasağı korunur: besleme sözleşmesi belgelenir,
-- adres platform görevlisi tarafından kaydedilir.

CREATE TABLE "CaselawSourceConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaselawSourceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaselawSourceConfig_key_key" ON "CaselawSourceConfig"("key");
CREATE INDEX "CaselawSourceConfig_isEnabled_idx" ON "CaselawSourceConfig"("isEnabled");

CREATE TABLE "CaseLawIngestItem" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "chamber" TEXT,
    "caseNumber" TEXT NOT NULL,
    "decisionNumber" TEXT NOT NULL,
    "decisionDate" DATE,
    "summary" TEXT,
    "fullText" TEXT,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BEKLIYOR',
    "batchId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "poolRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseLawIngestItem_pkey" PRIMARY KEY ("id")
);

-- Aynı kaynaktan aynı künye ikinci kez SIRAYA ALINAMAZ (createMany skipDuplicates
-- bu kısıta dayanır): reddedilen künye sonraki koşuda sessizce geri gelmez.
CREATE UNIQUE INDEX "CaseLawIngestItem_sourceKey_court_caseNumber_decisionNu_key"
    ON "CaseLawIngestItem"("sourceKey", "court", "caseNumber", "decisionNumber");
CREATE INDEX "CaseLawIngestItem_status_fetchedAt_idx" ON "CaseLawIngestItem"("status", "fetchedAt");
