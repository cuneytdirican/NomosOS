-- FAZ 8B — sözleşme kabul kaydı (Hizmet/EULA, DPA, SLA, Mesafeli satış). Ekleme-yalnız; metin sürümü + SHA-256 özeti.

CREATE TABLE "TermsAcceptance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "docKey" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "textHash" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TermsAcceptance_tenantId_docKey_acceptedAt_idx" ON "TermsAcceptance"("tenantId", "docKey", "acceptedAt");
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
