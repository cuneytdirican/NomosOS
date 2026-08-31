-- ===========================================================================
-- DENETİM DÜZELTME TURU — K-14
-- Kural motorundan üretilen sürenin GİRDİSİ düzeltilebilir hâle geliyor.
-- ===========================================================================
--
-- SORUN. `updateDeadlineSchema` yalnız title/dueDate/ownerId/legalBasis
-- alıyordu; `triggerDate` ve `serviceMethod` yoktu. Servis, kural kaynaklı
-- sürede `dueDate` değişikliğini reddedip "tetikleyici tarihi düzeltip yeniden
-- hesaplayın" diyordu — ama o işlemi yapacak uç üründe YOKTU. İki günlük bir
-- tebliğ tarihi hatasının tek çaresi kaydı silmekti; bu da hesap izini ve
-- denetim bağını koparıyordu.
--
-- ÇÖZÜM. `PATCH /deadlines/:id/inputs` ucu girdiyi düzeltir, motor yeniden
-- koşar, yeni `computeNote` yazılır. İLK TESPİT aşağıdaki alanlarda dondurulur
-- (Modül 04 KK8: "ne sanıyorduk / ne çıktı" farkı kayıtta kalmalıdır).
--
-- GEÇİŞ NOTU: mevcut satırlar için hepsi NULL / 0'dır. Bu doğru varsayımdır —
-- göç öncesinde hiçbir kayıt düzeltilmiş OLAMAZDI, uç yoktu.
-- ---------------------------------------------------------------------------

ALTER TABLE "Deadline" ADD COLUMN "originalTriggerDate" TIMESTAMP(3);
ALTER TABLE "Deadline" ADD COLUMN "originalServiceMethod" "ServiceMethod";
ALTER TABLE "Deadline" ADD COLUMN "originalDueDate" DATE;
ALTER TABLE "Deadline" ADD COLUMN "correctedById" TEXT;
ALTER TABLE "Deadline" ADD COLUMN "correctedAt" TIMESTAMP(3);
ALTER TABLE "Deadline" ADD COLUMN "correctionCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Deadline_correctedById_idx" ON "Deadline"("correctedById");

ALTER TABLE "Deadline"
  ADD CONSTRAINT "Deadline_correctedById_fkey"
  FOREIGN KEY ("correctedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
