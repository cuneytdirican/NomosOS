import { defineConfig } from "@playwright/test";

/**
 * NomosOS e2e dumanı (Faz 5). Hedef: docker-compose.test.yml yığını (web :3000, api :3001,
 * admin :3002, Mailpit :8025). CI'da gecelik/elle; yerelde `npm run test:headed`.
 * Ayrı bir npm paketi: kök pnpm çalışma alanına DAHİL DEĞİLDİR (tarayıcı indirmesi CI'ı şişirmesin).
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_WEB_URL || "http://localhost:3000",
    locale: "tr-TR",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
