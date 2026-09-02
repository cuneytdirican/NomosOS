-- YARGI ORGANLARI + NOTERLER — referans katalog.
--
-- Kullanıcı talebi: icra dairesi/mahkeme/noter ELLE girilmesin, listeden
-- seçilsin; liste platform tarafından periyodik güncellensin.
-- Üç model: JudicialBody (mahkeme + icra dairesi), NotaryOffice,
-- JudicialSyncLog (senkron denemeleri).
-- Veriler seed'de gelir (kaynak=SEED); platform panelli senkron güncelleyebilir.

CREATE TABLE "JudicialBody" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "il" TEXT NOT NULL,
    "ilce" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudicialBody_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JudicialBody_type_name_key" ON "JudicialBody"("type", "name");
CREATE INDEX "JudicialBody_type_category_il_idx" ON "JudicialBody"("type", "category", "il");
CREATE INDEX "JudicialBody_il_ilce_idx" ON "JudicialBody"("il", "ilce");

CREATE TABLE "NotaryOffice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "il" TEXT NOT NULL,
    "ilce" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotaryOffice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotaryOffice_name_key" ON "NotaryOffice"("name");
CREATE INDEX "NotaryOffice_il_ilce_idx" ON "NotaryOffice"("il", "ilce");

CREATE TABLE "JudicialSyncLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudicialSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JudicialSyncLog_createdAt_idx" ON "JudicialSyncLog"("createdAt");
