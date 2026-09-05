-- Faz 3 — gelir hattı: abonelik faturası, ödeme sağlayıcısı (checkout), kupon,
-- yıllık fiyat, plan farkı (pro-rata), e-Fatura ayarı (tenant başına), dunning bildirimleri.

-- Platform faturası türü ve dönem alanları.
CREATE TYPE "InvoiceRecordType" AS ENUM ('ABONELIK', 'KREDI_PAKETI', 'PLAN_FARKI');
ALTER TABLE "InvoiceRecord"
  ADD COLUMN "type" "InvoiceRecordType" NOT NULL DEFAULT 'KREDI_PAKETI',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd" TIMESTAMP(3),
  ADD COLUMN "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "couponCode" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "metaJson" TEXT;
-- Aynı büro + tür + dönem için tek fatura (çift üretim yarışında P2002).
CREATE UNIQUE INDEX "InvoiceRecord_tenantId_type_periodStart_key" ON "InvoiceRecord"("tenantId", "type", "periodStart");
CREATE INDEX "InvoiceRecord_type_status_idx" ON "InvoiceRecord"("type", "status");

-- Ödeme kaydı ↔ fatura bağı + checkout jetonu (sağlayıcı geri dönüşü bununla eşlenir).
ALTER TABLE "PaymentRecord"
  ADD COLUMN "invoiceRecordId" TEXT,
  ADD COLUMN "checkoutToken" TEXT,
  ADD COLUMN "providerPayload" TEXT;
CREATE UNIQUE INDEX "PaymentRecord_checkoutToken_key" ON "PaymentRecord"("checkoutToken");
CREATE INDEX "PaymentRecord_invoiceRecordId_idx" ON "PaymentRecord"("invoiceRecordId");
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_invoiceRecordId_fkey" FOREIGN KEY ("invoiceRecordId") REFERENCES "InvoiceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Abonelik: faturalama aralığı + kupon.
CREATE TYPE "BillingInterval" AS ENUM ('AYLIK', 'YILLIK');
ALTER TABLE "Subscription"
  ADD COLUMN "billingInterval" "BillingInterval" NOT NULL DEFAULT 'AYLIK',
  ADD COLUMN "couponCode" TEXT;

-- Plan: yıllık fiyat (kullanıcı başına, yıllık toplam).
ALTER TABLE "PlanTier" ADD COLUMN "annualPricePerUser" DECIMAL(18,2);

-- Kupon.
CREATE TYPE "CouponKind" AS ENUM ('YUZDE', 'SABIT');
CREATE TYPE "CouponScope" AS ENUM ('TUM', 'ABONELIK', 'KREDI');
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CouponKind" NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "appliesTo" "CouponScope" NOT NULL DEFAULT 'TUM',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_isActive_idx" ON "Coupon"("isActive");

-- e-Fatura entegratör ayarı (tenant başına; kimlik bilgisi AES-256-GCM şifreli).
CREATE TABLE "EInvoiceSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "baseUrl" TEXT,
    "credentialsEncrypted" TEXT,
    "senderAlias" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EInvoiceSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EInvoiceSettings_tenantId_key" ON "EInvoiceSettings"("tenantId");
ALTER TABLE "EInvoiceSettings" ADD CONSTRAINT "EInvoiceSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bildirim türleri: gecikmiş ödeme (dunning), deneme bitiyor, fatura kesildi.
ALTER TYPE "NotificationKind" ADD VALUE 'ODEME_GECIKTI';
ALTER TYPE "NotificationKind" ADD VALUE 'DENEME_BITIYOR';
ALTER TYPE "NotificationKind" ADD VALUE 'FATURA_KESILDI';
