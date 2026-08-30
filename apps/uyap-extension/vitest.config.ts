import { defineConfig } from "vitest/config";

// Parser testleri gerçek DOM üzerinde çalışır: sahte UYAP HTML fixture'ları jsdom'a yüklenir.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["e2e/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
    reporters: ["default"],
  },
});
