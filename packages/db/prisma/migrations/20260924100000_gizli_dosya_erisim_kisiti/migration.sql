-- GİZLİ DOSYA — DOSYA BAZLI ERİŞİM KISITI (Enterprise++)
--
--  * Case.isConfidential: açıkken dosyayı yalnız ADMIN/PARTNER, sorumlu avukat
--    ve CaseMember üyeleri görür (guard + liste süzgeçleri; görünmeyen dosya 404).
--  * CaseMember: gizli dosyaya erişim listesi (kiracı + dosya + kullanıcı).

-- AlterTable
ALTER TABLE "Case" ADD COLUMN "isConfidential" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Case_tenantId_isConfidential_idx" ON "Case"("tenantId", "isConfidential");

-- CreateTable
CREATE TABLE "CaseMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaseMember_caseId_userId_key" ON "CaseMember"("caseId", "userId");
CREATE INDEX "CaseMember_tenantId_userId_idx" ON "CaseMember"("tenantId", "userId");

ALTER TABLE "CaseMember" ADD CONSTRAINT "CaseMember_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseMember" ADD CONSTRAINT "CaseMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
