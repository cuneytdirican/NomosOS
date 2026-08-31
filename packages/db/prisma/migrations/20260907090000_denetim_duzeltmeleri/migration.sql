-- ===========================================================================
-- DENETİM DÜZELTME TURU — K-03, Ö-14, Ö-30
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- K-03 · Kiracı (avukat) hesabında oturum iptali, hesap kilidi ve parola
--        değiştirme yolu yoktu.
--
-- `PlatformUser` ve `PortalUser` bu alanları taşıyordu; büronun TÜM verisine
-- bakan `User` taşımıyordu. Sızmış bir avukat parolası ürün üzerinden
-- kapatılamıyor, dağıtık kaba kuvvet hiç kilitlenmiyordu.
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "failureWindowEndsAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- Ö-14 · `Payment` modelinde para birimi yoktu; faturasız tahsilat koşulsuz
--        TRY sayılıyordu.
--
-- GEÇİŞ NOTU: mevcut satırlara DEFAULT 'TRY' uygulanır. Bu, geçmiş kayıtların
-- gerçeğini değiştirmez — servis zaten hepsini TRY sayıyordu; kolon yalnızca o
-- örtük varsayımı AÇIK hâle getirir. Faturaya bağlı tahsilatlar bir sonraki
-- adımda faturanın para birimine hizalanır (aşağıdaki UPDATE).
-- ---------------------------------------------------------------------------
ALTER TABLE "Payment" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'TRY';

-- Faturaya bağlı tahsilatların para birimini faturadan al: bu satırlarda doğru
-- değer ZATEN biliniyordu (`payments.service.ts` yanıtta faturanınkini
-- kullanıyordu) ama kalıcı değildi.
UPDATE "Payment" p
SET "currency" = i."currency"
FROM "Invoice" i
WHERE p."invoiceId" = i."id" AND i."currency" IS NOT NULL AND i."currency" <> '';

-- ---------------------------------------------------------------------------
-- Ö-30 · Delil matrisi "çürüten delil" kavramını taşıyamıyordu.
--
-- GEÇİŞ NOTU: mevcut satırlar SUPPORTS olur. Bu, veriyi bozan bir varsayım
-- DEĞİLDİR: göç öncesinde başka bir seçenek yoktu ve her bağ "bu delil bu
-- iddiayı ne kadar destekliyor" anlamında kurulmuştu (`strength` alanının
-- açıklaması da bunu söylüyor).
-- ---------------------------------------------------------------------------
CREATE TYPE "EvidenceLinkType" AS ENUM ('SUPPORTS', 'CONTRADICTS', 'BELIRSIZ');

ALTER TABLE "ClaimEvidenceLink"
  ADD COLUMN "linkType" "EvidenceLinkType" NOT NULL DEFAULT 'SUPPORTS';
