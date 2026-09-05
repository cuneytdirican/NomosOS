-- FAZ 1 — AVUKAT ÇEKİRDEĞİ
--  * Hearing.attendeeUserId: duruşmaya girecek sorumlu avukat ("benim duruşmalarım",
--    çakışma kontrolü). Hearing.prepJson: HEARING_PREP ajanının 9 bölümlü paketi.
--  * Deadline.rulesVersion: hesabın dayandığı kural seti sürümü (mevzuat değişince iz).

ALTER TABLE "Hearing" ADD COLUMN "attendeeUserId" TEXT;
ALTER TABLE "Hearing" ADD COLUMN "prepJson" TEXT;
CREATE INDEX "Hearing_tenantId_attendeeUserId_date_idx" ON "Hearing"("tenantId", "attendeeUserId", "date");
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_attendeeUserId_fkey"
  FOREIGN KEY ("attendeeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deadline" ADD COLUMN "rulesVersion" TEXT;

-- Süre önerisinin kaynak belgesi (onay ekranında belge yan yana okunur).
ALTER TABLE "Deadline" ADD COLUMN "sourceDocumentId" TEXT;
CREATE INDEX "Deadline_sourceDocumentId_idx" ON "Deadline"("sourceDocumentId");
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
