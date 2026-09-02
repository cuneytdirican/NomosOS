-- D5 / M4 — fine-tuning iş yönetimi.
-- Sağlayıcıya otomatik gönderim YOKTUR: iş kaydı anlık görüntü + manifest
-- üretir; operatör durumu izler. TAMAMLANDI'da resultModelName zorunludur
-- (uygulama katmanında denetlenir).

CREATE TABLE "FineTuneJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'HAZIRLANDI',
    "sampleCount" INTEGER NOT NULL,
    "taskTypesJson" TEXT NOT NULL,
    "resultModelName" TEXT,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FineTuneJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FineTuneJob_status_createdAt_idx" ON "FineTuneJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FineTuneJob" ADD CONSTRAINT "FineTuneJob_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
