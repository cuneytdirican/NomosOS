import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Web katmanının birim testleri. Bileşen ağacı DEĞİL, ekranların dayandığı
 * SAF mantık test edilir: sayfalama zarfının okunması (K-15) ve klavye
 * gezinme kuralları (Ö-35, Ö-36). Bunlar jsdom gerektirmez ve regresyonu
 * ucuz biçimde yakalar.
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
