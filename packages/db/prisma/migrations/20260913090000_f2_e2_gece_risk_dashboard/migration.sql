-- F2 · E2 — gece risk skoru işi ve ortak panel günlük fotoğrafı.
--
-- SORUN: RiskScore yalnız bir avukat dosyayı AÇTIĞINDA hesaplanıyordu.
-- Günlük değişen sinyaller (yaklaşan süre, delil durumu, tahsilat) skoru
-- yenilemiyordu; panelde görünen skor günlerce bayat kalabiliyordu.
-- Panel ayrıca her açılışta yüzlerce RiskScore satırını canlı topluyordu.
--
-- ÇÖZÜM: (1) Gece işi aktif dosyaların DETERMİNİSTİK tabanını tazeler
-- (AI çağrılmaz — AI önerir, gece işi yalnız kural sinyallerini yeniden sayar;
-- RiskScore.computedBy bu hesapta null'dır, şema bunu baştan öngörüyordu).
-- (2) Kiracı başına günlük DashboardSnapshot satırı yazılır; panel tek satırdan
-- okur.

CREATE TABLE "DashboardSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "caseCount" INTEGER NOT NULL,
    "highRiskCount" INTEGER NOT NULL,
    "avgGenelScore" INTEGER,
    "bandDistributionJson" TEXT NOT NULL,
    "topCasesJson" TEXT NOT NULL,
    "recomputedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardSnapshot_tenantId_date_key" ON "DashboardSnapshot"("tenantId", "date");
