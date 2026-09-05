import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * ENTEGRASYON TESTLERİ (Faz 5) — gerçek Nest uygulaması + gerçek PostgreSQL (supertest).
 *
 * Birim paketinden AYRI koşar: `pnpm --filter @nomosos/api test:int`. Gereksinim:
 *   INTEGRATION_DATABASE_URL (göçler uygulanmış + seed) — CI'da pgvector servisi, yerelde
 *   docker-compose.test.yml Postgres'i (localhost:5433?). Tanımsızsa paket ATLANIR (skip), kırmaz.
 * Redis/MinIO isteğe bağlıdır: readiness testi bileşen durumunu yapısal olarak doğrular.
 */
export default defineConfig({
  // Nest DI `design:paramtypes` ister; esbuild dekoratör metadata üretmez → SWC dönüştürücü.
  plugins: [swc.vite({ jsc: { transform: { legacyDecorator: true, decoratorMetadata: true }, target: "es2022" } })],
  test: {
    include: ["test/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
