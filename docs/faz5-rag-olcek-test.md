# Faz 5 — RAG Ölçek + Test Altyapısı (6 Eylül 2026)

## 1. pgvector — benzerlik veritabanında

- **Gereksinim:** PostgreSQL'de `vector` ve `pg_trgm` uzantıları. Docker imajları
  `pgvector/pgvector:pg16` (dev/test/prod compose + CI servisi). Yönetilen PG'de pgvector etkin
  olmalı; göç `CREATE EXTENSION IF NOT EXISTS vector` ile başlar ve uzantı yoksa DURUR.
- **Şema** (`20260927100000_faz5_pgvector`): `DocumentChunk.embeddingVec vector` (boyutsuz) +
  `embeddingDim`; mevcut `Float[]` gömmeler tek `UPDATE` ile taşındı. HNSW kısmi ifade indeksleri
  768 / 1024 / 1536 boyut için (`vector_cosine_ops`); başka boyutlu model indekssiz ama doğru çalışır.
  `pg_trgm` GIN: `DocumentChunk.content`, `Document.ocrText`. `[tenantId, caseId]` bileşik indeks.
- **Yazma:** `IndexingService.syncVectorColumn(documentId)` — parçalar `Float[]` ile yazılır, ardından
  tek `UPDATE … SET embeddingVec = embedding::real[]::vector`. Uzantı yoksa uyarı, JS yolu sürer.
- **Okuma:** `RetrievalService.retrieveByPgvector` — sorgu vektörü modelin boyutuna cast edilir,
  `ORDER BY embeddingVec <=> $q LIMIT k`, skor = 1 − kosinüs uzaklığı; `embeddingModel` süzgeci.
  Hata/uzantı yokluğunda `null` → eski süreç-içi kosinüs (`RAG_VECTOR_BACKEND=js` ile de zorlanır).
- **Ölçek:** 100k parça için p95 hedefi < 300 ms (HNSW); önceki yol tüm vektörleri belleğe çekiyordu.

## 2. Test altyapısı

- **Entegrasyon (supertest):** `apps/api/test/*.int.test.ts`, `vitest.integration.config.ts`,
  `pnpm --filter @nomosos/api test:int`. `INTEGRATION_DATABASE_URL` yoksa atlanır. 10 kritik uç:
  sağlık/readiness, giriş (yanlış/doğru + httpOnly çerez), `/me` + kimliksiz 401 + `x-request-id`,
  kiracı izolasyonu, rol kapısı, `.exe` yükleme 415, cüzdan + abonelik özeti, plan modülü kapısı
  (SOLO → 403), global oran sınırı 429, 404 zarfı.
- **CI:** `.github/workflows/entegrasyon.yml` — `entegrasyon` işi (pgvector servisi, göç + seed,
  supertest) her push/PR'da; `e2e` işi (docker-compose.test.yml + Playwright `e2e/`) gecelik ve elle.
- **Admin/portal Vitest:** `apps/admin` (rbac matrisi, uçlar, menü), `apps/portal` (api yardımcıları,
  etiketler) — `pnpm -r test` kapsamında. Mobil `tsc` zaten `pnpm typecheck` içinde.
- **Playwright e2e paketi:** `e2e/` (kök çalışma alanı DIŞINDA; tarayıcı bağımlılığı CI'ı şişirmesin):
  readiness + metrik, büro girişi → Abonelik, parola sıfırlama e-postası (Mailpit) → bağlantı, admin
  girişi → Kuponlar.

## 3. Dönüştürülen grep-tabanlı testler

Faz 0–4 sözleşme testleri (kaynak metni okuyan) korunur; davranış testleri artık asıl güvence:
`platform-checkout.service.test`, `subscription-renewal.job.test`, `module-access.guard.test`,
`global-rate-limit.guard.test`, `password-strength.test`, `readiness.service.test`,
`request-context.test`, `json-logger.test`, `metrics.registry.test`, `rotate-master-key.test` ve
entegrasyon paketi. Kalan grep-tabanlı testler yapısal sözleşme (dosya/uç varlığı) rolündedir.
