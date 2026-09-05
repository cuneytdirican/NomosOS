import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL || "http://localhost:3001";
const ADMIN = process.env.E2E_ADMIN_URL || "http://localhost:3002";
const MAILPIT = process.env.E2E_MAILPIT_URL || "http://localhost:8025";
const DEMO = { email: "partner@demo.nomosos.local", password: "Demo1234!" };

test.describe("NomosOS duman", () => {
  test("API hazır (readiness) ve metrikler yayında", async ({ request }) => {
    const ready = await request.get(`${API}/api/v1/health/ready`);
    expect(ready.status()).toBe(200);
    expect((await ready.json()).checks.postgres.status).toBe("up");
    const metrics = await request.get(`${API}/metrics`);
    expect(await metrics.text()).toContain("nomosos_db_up 1");
  });

  test("büro girişi → panel → Ayarlar/Abonelik → fatura listesi", async ({ page }) => {
    await page.goto("/giris");
    await page.getByPlaceholder("avukat@buronuz.com").fill(DEMO.email);
    await page.locator('input[type="password"]').first().fill(DEMO.password);
    await page.getByRole("button", { name: /^Giriş/ }).click();
    await page.waitForURL(/\/app/);
    await expect(page.getByText("Panel")).toBeVisible();
    await page.goto("/app/ayarlar/abonelik");
    await expect(page.getByTestId("abonelik-sayfasi")).toBeVisible();
    await expect(page.getByText("Sonraki dönem faturası")).toBeVisible();
  });

  test("parola sıfırlama e-postası Mailpit'e düşer ve bağlantı açılır", async ({ page, request }) => {
    await request.delete(`${MAILPIT}/api/v1/messages`);
    await page.goto("/sifre-unuttum");
    await page.getByPlaceholder("avukat@buro.av.tr").fill(DEMO.email);
    await page.getByRole("button", { name: /Sıfırlama bağlantısı gönder/ }).click();
    await expect(page.locator("p.rounded-lg").first()).toContainText("kayıtlıysa");
    let link = "";
    for (let i = 0; i < 10 && !link; i++) {
      const s = await (await request.get(`${MAILPIT}/api/v1/search?query=subject:parola`)).json();
      if (s.messages?.length) {
        const m = await (await request.get(`${MAILPIT}/api/v1/message/${s.messages[0].ID}`)).json();
        link = m.Text.match(/https?:\/\/\S+sifre-sifirla\?token=[0-9a-f]+/)?.[0] ?? "";
      }
      if (!link) await page.waitForTimeout(1000);
    }
    expect(link).toBeTruthy();
    await page.goto(link);
    await expect(page.getByRole("button", { name: "Parolayı güncelle" })).toBeVisible();
  });

  test("platform paneli girişi ve kupon listesi", async ({ page }) => {
    await page.goto(`${ADMIN}/giris`);
    await page.getByPlaceholder("ad.soyad@nomosos.local").fill("superadmin@nomosos.local");
    await page.getByPlaceholder("••••••••••••").fill("Demo1234!");
    await page.getByRole("button", { name: /giriş/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/giris"));
    await page.goto(`${ADMIN}/kuponlar`);
    await expect(page.getByRole("heading", { name: "Kuponlar" })).toBeVisible();
  });
});
