-- Rakip analizi özellikleri (docs/faz2/rakip-analizi.md):
--   D7 AAÜT vekalet ücreti tarifesi + motor
--   A6 e-SMM belge türü
--   E8 portal ödeme bağlantısı
--   E9 randevu (büro + portal self-servis)
--   A1'e destek: Client özel alanları (customFieldsJson)
--   B7: banka haciz cevabı belge sınıfı
--
-- KVKK NOTU: özel alanlar (customFieldsJson) kişisel veri taşır — politika
-- matrisi K1 kategorisi; KVKK m.11 dışa aktarmaya DAHİL edilir.

-- A6: belge türü
CREATE TYPE "InvoiceDocType" AS ENUM ('FATURA', 'E_SMM');
ALTER TABLE "Invoice" ADD COLUMN "documentType" "InvoiceDocType" NOT NULL DEFAULT 'FATURA';

-- D7: AAÜT tarife tablosu (rakamlar büro tarafından girilir, motor hesaplar)
CREATE TABLE "VekaletTarife" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "yil" INTEGER NOT NULL,
    "maktuKademelerJson" TEXT NOT NULL,
    "maktuTekrarJson" TEXT,
    "nispiOranYuzde" DECIMAL(5,2) NOT NULL,
    "kdvOrani" DECIMAL(4,2) NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VekaletTarife_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VekaletTarife_tenantId_yil_key" ON "VekaletTarife"("tenantId", "yil");

-- E8: portal ödeme bağlantısı
CREATE TABLE "OdemeLinki" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "status" TEXT NOT NULL DEFAULT 'AKTIF',
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OdemeLinki_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OdemeLinki_token_key" ON "OdemeLinki"("token");
CREATE INDEX "OdemeLinki_tenantId_invoiceId_idx" ON "OdemeLinki"("tenantId", "invoiceId");
ALTER TABLE "OdemeLinki" ADD CONSTRAINT "OdemeLinki_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- E9: randevu
CREATE TABLE "Randevu" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "portalUserId" TEXT,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANLANDI',
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Randevu_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Randevu_tenantId_startAt_idx" ON "Randevu"("tenantId", "startAt");
CREATE INDEX "Randevu_tenantId_status_idx" ON "Randevu"("tenantId", "status");
ALTER TABLE "Randevu" ADD CONSTRAINT "Randevu_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- B7: banka haciz cevabı belge sınıfı
ALTER TYPE "DocumentClass" ADD VALUE 'BANKA_HACIZ_CEVABI';

-- A1-e: müvekkil özel alanları
ALTER TABLE "Client" ADD COLUMN "customFieldsJson" TEXT;

-- Demo talebi: tanıtım sitesi talepleri platform panelinde kayıt olarak izlenir
-- (e-posta/webhook gönderilmez — kullanıcı kararı).
CREATE TABLE "DemoRequest" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "barAssociation" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "lawyerCount" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'YENI',
    "statusChangedBy" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DemoRequest_status_createdAt_idx" ON "DemoRequest"("status", "createdAt");
