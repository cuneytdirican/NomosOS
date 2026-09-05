-- FAZ 7C — iş akışı şablonları + rol matrisi (ek yetkiler) + görev şablon izi.

-- 1) Rol matrisi: role EK olarak verilen yetenekler (HUKUKI | ONAY | OPERASYON | FINANS).
ALTER TABLE "User" ADD COLUMN "extraPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2) Görev: hangi iş akışı şablonundan doğdu (iş yükü / zincir görünümü).
ALTER TABLE "Task" ADD COLUMN "workflowKey" TEXT;
CREATE INDEX "Task_tenantId_workflowKey_idx" ON "Task"("tenantId", "workflowKey");

-- 3) Büro tanımlı iş akışı şablonu (sistem şablonları kodda; büro kendi zincirini yazar).
CREATE TABLE "WorkflowTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "caseType" "CaseType",
  "description" TEXT,
  "itemsJson" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkflowTemplate_tenantId_key_key" ON "WorkflowTemplate"("tenantId", "key");
CREATE INDEX "WorkflowTemplate_tenantId_caseType_idx" ON "WorkflowTemplate"("tenantId", "caseType");

-- 4) ICU collation sürüm uyarısı (Faz 7B göçü sonrası görüldü): katalog collation'ı imaj ICU sürümüne
--    tazelenir. Yetki yoksa (yönetilen PG'de superuser değil) yalnız NOTICE — göç DURMAZ.
DO $$
BEGIN
  BEGIN
    ALTER COLLATION pg_catalog."tr-TR-x-icu" REFRESH VERSION;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'tr-TR-x-icu collation sürümü tazelenemedi: %', SQLERRM;
  END;
END $$;
