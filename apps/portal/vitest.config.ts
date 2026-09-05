import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Müvekkil portalı birim testleri (Faz 5): API yardımcıları ve etiketler — saf mantık. */
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
