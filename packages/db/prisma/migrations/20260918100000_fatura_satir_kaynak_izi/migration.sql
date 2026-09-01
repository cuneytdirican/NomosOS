-- F2-Ö-18: grup satırlarının temsil ettiği zaman kayıtlarının izi.
--
-- SORUN: `createFromTimeEntries` grup satırlarını sourceId=null ile üretiyor.
-- Taslak faturadan bir grup satırı çıkarıldığında, o grubun temsil ettiği
-- zaman kayıtları faturaya BAĞLI kalıyor ama faturada artık görünmüyor:
-- "kilitli-yetim" — ne faturalanabilir ne görünür.
--
-- ÇÖZÜM: `sourceIdsJson` (JSON dizi) her grup satırına hangi TimeEntry id'lerini
-- temsil ettiğini yazar. Satır çıkarılınca bu listedeki kayıtlar serbest bırakılır.

ALTER TABLE "InvoiceLine" ADD COLUMN "sourceIdsJson" TEXT;
