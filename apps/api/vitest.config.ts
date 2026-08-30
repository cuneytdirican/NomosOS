import { defineConfig } from "vitest/config";

/**
 * `apps/api` BİRİM TESTLERİ.
 *
 * Denetimin en büyük açığı: 233 testin tamamı `packages/*` ve
 * `apps/uyap-extension` içindeydi; `apps/api`'de test koşucusu bile tanımlı
 * değildi. Oysa kredi matematiği, risk kuralları, delil matrisi ve ad
 * normalizasyonu SAF FONKSİYONLARDIR — birim testi için ideal ve tamamen
 * kapsam dışıydılar.
 *
 * KAPSAM: yalnız DB/DI gerektirmeyen saf mantık. Nest bağlamı, Prisma ve HTTP
 * uçları burada test edilmez; onlar uçtan uca duman testinin işidir.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
