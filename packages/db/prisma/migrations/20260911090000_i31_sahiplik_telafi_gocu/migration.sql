-- denetim bulgusu İ-31 (üretim öncesi kapatıcı 5): PortalPublication
-- sahiplik bayrağının telafi göçü.
--
-- SORUN: `20260905100000_faz5_portal_yayin_sahiplik`, kolonu
-- `DEFAULT true` ile ekledi. Göçten önce var olan tüm yayınlar bu yüzden
-- "sahipliği DOĞRULANMIŞ" damgası taşıyor; oysa bu yayınların bir kısmı
-- sahipliği çözülemeyen kaynaklardı (ör. hiçbir dosyaya bağlanmamış belge).
-- Bayrak erişim kapısı değildir — erişim her istekte yeniden çözülür — ama
-- gözlemlenebilirlik kördür: hangi yayınların ikinci kapıyı ATLADIĞI
-- hiçbir yerden okunamıyordu. Yanlış damga üretim verisine taşınırsa
-- sonradan ayırmak imkânsıza yakındır.
--
-- ÇÖZÜM: telafi göçü. Her yayın için sahiplik bugünkü veriyle YENİDEN
-- çözülür; kaynak artık yoksa ya da müvekkil bağlantısı çözülemiyorsa
-- bayrak `false` olur. Bu bir GÖZLEMLEME düzeltmesidir: görünürlük
-- değişmez (erişim `assertVisible`'da her istekte yeniden hesaplanır),
-- yalnızca damga doğru olur.
--
-- Kaynak türüne göre sahiplik çözümlemesi portal-publication.service.ts
-- `resolveOwner` ile BİREBİR aynıdır:
--   DOSYA  → Case mevcut (clientId zorunlu)          → çözüldü
--   BELGE  → Document mevcut VE caseId dolu          → çözüldü
--   DURUSMA/SAFAHAT_KAYDI → kayıt mevcut (Case FK'sı zorunlu) → çözüldü
--   FATURA/ODEME → clientId şemada ZORUNLU           → çözüldü
--   MESAJ → OutboundMessage.clientId ZORUNLU        → çözüldü

-- DOSYA: dosya silinmişse sahiplik çözülemez.
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "Case" c
  WHERE c.id = pp."resourceId" AND c."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'DOSYA';

-- BELGE: belge yok VEYA hiçbir dosyaya bağlı DEĞİLSE sahiplik çözülemez
-- (`resolveOwner`: clientId = row.case?.clientId ?? null).
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "Document" d
  JOIN "Case" c ON c.id = d."caseId"
  WHERE d.id = pp."resourceId" AND d."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'BELGE';

-- DURUSMA: duruşma mevcut mu (caseId şemada zorunlu, FK ile garanti).
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "Hearing" h
  JOIN "Case" c ON c.id = h."caseId"
  WHERE h.id = pp."resourceId" AND h."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'DURUSMA';

-- SAFAHAT_KAYDI: safahat kaydı mevcut mu (caseId zorunlu).
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "TimelineEvent" t
  JOIN "Case" c ON c.id = t."caseId"
  WHERE t.id = pp."resourceId" AND t."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'SAFAHAT_KAYDI';

-- FATURA: fatura mevcut mu (clientId şemada zorunlu).
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "Invoice" i
  WHERE i.id = pp."resourceId" AND i."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'FATURA';

-- ODEME: ödeme mevcut mu (clientId şemada zorunlu).
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "Payment" p
  WHERE p.id = pp."resourceId" AND p."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'ODEME';

-- MESAJ: giden mesaj mevcut mu (clientId şemada zorunlu; servis katmanı
-- bu tür için her zaman `ownershipVerified: true` yazar).
UPDATE "PortalPublication" pp
SET "ownershipVerified" = EXISTS (
  SELECT 1 FROM "OutboundMessage" m
  WHERE m.id = pp."resourceId" AND m."tenantId" = pp."tenantId"
)
WHERE pp."resourceType" = 'MESAJ';
