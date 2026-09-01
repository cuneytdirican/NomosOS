-- F2-Ö-16: Tenant'a vergi kimlik bilgileri.
--
-- SORUN: e-Fatura/e-Arşiv gönderiminde SATICI VKN'si GİB'e gönderilmiyordu —
-- `tenant.findUnique` yalnız `name` seçiyor, şemada alan bile yoktu. UBL
-- eşlemesi (`ubl-tr-mapping.ts`) `tenant.taxNumber`'ı bekliyor ve null'la
-- eşleşiyordu; GİB VKN'siz belgeyi reddeder.
--
-- ÇÖZÜM: taxNumber/taxOffice/address kolonları. null = girilmemiş; e-belge
-- gönderimi (F2-Ö-16 düzeltmesi) eksik VKN'yi 400 ile reddeder.

ALTER TABLE "Tenant" ADD COLUMN "taxNumber" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "taxOffice" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "address" TEXT;
