import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Admin panelinin birim testleri (Faz 5): yetki matrisi (`rbac.ts`), uç adresleri ve
 * etiket/format yardımcıları — saf mantık, jsdom gerekmez. Bileşen ağacı Playwright dumanında.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
