-- İ-16: Document'a yumuşak silme kolonu.
--
-- SORUN: DELETE /documents/:id FİZİKSEL delete yapıyordu. S3'ten de siliniyordu.
-- Hukuk bürosunda yanlışlıkla silinen bir dilekçe/duruşma tutanağı geri
-- getirilemez; denetim izi kopar.
--
-- ÇÖZÜM: deletedAt — silme artık bu alanı yazıp S3 nesnesini korur.
-- Listeler `deletedAt: null` ile süzer.

ALTER TABLE "Document" ADD COLUMN "deletedAt" TIMESTAMP(3);
