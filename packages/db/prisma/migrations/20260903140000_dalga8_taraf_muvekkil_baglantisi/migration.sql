-- D8 — dosya tarafı ↔ müvekkil kartı bağlantısı (taraflar elle yazılmaz,
-- müvekkil katalogdan seçilir; ad sunucuda karttan doldurulur).

ALTER TABLE "CaseParty" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE INDEX "CaseParty_clientId_idx" ON "CaseParty"("clientId");

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
