-- E8 (rakip analizi) — PaymentMethod enum'una ONLINE değeri.
--
-- Şema güncellemesinde (20260916090000) enum DEĞERİ migration SQL'ine
-- yazılmayı atlanmıştı; kod ONLINE ile tahsilat yazdığında Postgres
-- "invalid input value for enum" hatası veriyordu. Bu migration yalnızca
-- eksik enum değerini ekler.

ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE';
