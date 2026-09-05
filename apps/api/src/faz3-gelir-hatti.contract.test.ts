/**
 * FAZ 3 — GELİR HATTI sözleşme testleri: dönem faturası + dunning işi, checkout/kesinleştirme,
 * iyzico adaptörü, kupon, yıllık fiyat/pro-rata, modül kapısı, fatura PDF, e-Fatura ayarı,
 * web/admin ekranları, env/compose.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_ROUTES, BILLING_ROUTES } from "@nomosos/shared";

const root = join(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");
const schema = read("packages", "db", "prisma", "schema.prisma");
const migration = read("packages", "db", "prisma", "migrations", "20260926100000_faz3_gelir_hatti", "migration.sql");

describe("Faz 3 — şema + migration", () => {
  it("InvoiceRecord tür/dönem/indirim + tekil (tenant,type,periodStart); PaymentRecord checkoutToken; Coupon; EInvoiceSettings; yıllık fiyat; bildirim türleri", () => {
    expect(schema).toContain("enum InvoiceRecordType");
    expect(schema).toContain("@@unique([tenantId, type, periodStart])");
    expect(schema).toContain("checkoutToken   String?        @unique");
    expect(schema).toContain("model Coupon {");
    expect(schema).toContain("model EInvoiceSettings {");
    expect(schema).toContain("annualPricePerUser  Decimal? @db.Decimal(18, 2)");
    expect(schema).toContain("billingInterval    BillingInterval    @default(AYLIK)");
    for (const k of ["ODEME_GECIKTI", "DENEME_BITIYOR", "FATURA_KESILDI"]) expect(schema).toContain(k);
    expect(migration).toContain('CREATE UNIQUE INDEX "InvoiceRecord_tenantId_type_periodStart_key"');
    expect(migration).toContain('CREATE TABLE "Coupon"');
  });
});

describe("Faz 3 — gelir kaçağı kapandı", () => {
  it("kredi satın alma checkout akışına taşındı; krediler ödeme kesinleşince yüklenir; eski anında yükleme yok", () => {
    const cc = read("apps", "api", "src", "credits", "credits.controller.ts");
    expect(cc).not.toContain('@Post("purchase")');
    const cs = read("apps", "api", "src", "credits", "credit.service.ts");
    expect(cs).toContain("async loadPaidPackage(");
    expect(cs).not.toContain("async purchase(user: AuthUser, packageKey: string)");
    const sc = read("apps", "api", "src", "platform-billing", "subscription.controller.ts");
    expect(sc).toContain('@Post("credits/purchase")');
    const co = read("apps", "api", "src", "platform-billing", "platform-checkout.service.ts");
    expect(co).toContain("this.credits.loadPaidPackage(tx,");
    expect(co).toContain('status: "ODENDI", paidAt: now');
    expect(co).toContain("ödeme kesinleştirilmedi"); // tutar uyuşmazlığı reddi
  });

  it("dönem faturası işte kesilir (7 gün önce), dunning 1/3/7, deneme uyarısı; guard /subscription'ı 402'den muaf tutar", () => {
    const job = read("apps", "api", "src", "scheduler", "jobs", "subscription-renewal.job.ts");
    expect(job).toContain("issueForPeriod({ subscription: sub, periodStart: sub.currentPeriodEnd, now })");
    expect(job).toContain("[1, 3, 7].includes(gun)");
    expect(job).toContain('kind: "DENEME_BITIYOR"');
    expect(read("apps", "api", "src", "common", "guards", "tenant-status.guard.ts")).toContain('"/api/v1/subscription"');
  });

  it("modül kapısı: guard kayıtlı; icra/finans/faturalama/sso uçları @RequiresModule taşır", () => {
    const app = read("apps", "api", "src", "app.module.ts");
    expect(app).toContain("{ provide: APP_GUARD, useClass: ModuleAccessGuard }");
    expect(app).toContain("PlatformBillingModule");
    // DI: checkout servisi OdemeSaglayici'yi BillingModule'den alır (canlıda açılış hatası yaşandı).
    expect(read("apps", "api", "src", "billing", "billing.module.ts")).toMatch(/exports: \[[^\]]*OdemeSaglayici[^\]]*\]/);
    expect(read("apps", "api", "src", "enforcement", "enforcement.controller.ts")).toContain('@RequiresModule("icra")');
    expect(read("apps", "api", "src", "finance", "finance.controller.ts")).toContain('@RequiresModule("finans")');
    expect(read("apps", "api", "src", "billing", "billing.controller.ts")).toContain('@RequiresModule("faturalama")');
    expect(read("apps", "api", "src", "auth", "sso.controller.ts")).toContain('@RequiresModule("sso")');
  });

  it("iyzico adaptörü + webhook/callback uçları; pro-rata executor'da; kupon + yıllık fiyat", () => {
    expect(read("apps", "api", "src", "billing", "iyzico.adapter.ts")).toContain("/payment/iyzipos/checkoutform/initialize/auth/ecom");
    expect(SUBSCRIPTION_ROUTES.paymentCallback).toBe("/billing/odeme/callback");
    expect(SUBSCRIPTION_ROUTES.paymentWebhook).toBe("/billing/odeme/webhook");
    expect(read("apps", "api", "src", "platform", "approvals", "platform-approval-executor.service.ts")).toContain("issueProRataInvoice(");
    expect(read("apps", "api", "src", "platform-billing", "platform-billing.controller.ts")).toContain("/coupons");
    expect(read("apps", "api", "src", "platform", "subscriptions", "platform-subscriptions.schemas.ts")).toContain("annualPricePerUser");
    expect(read("apps", "api", "src", "billing", "subscription-pricing.ts")).toContain("BYO_LLM_DISCOUNT_PERCENT = 30");
  });

  it("fatura PDF (pdfkit + DejaVu) ve tenant başına e-Fatura ayarı; resolve async", () => {
    const pkg = JSON.parse(read("apps", "api", "package.json"));
    expect(pkg.dependencies.pdfkit).toBeTruthy();
    expect(pkg.dependencies["dejavu-fonts-ttf"]).toBeTruthy();
    expect(BILLING_ROUTES.invoicePdf("x")).toBe("/billing/invoices/x/pdf");
    expect(BILLING_ROUTES.eInvoiceSettings).toBe("/billing/e-invoice/settings");
    expect(SUBSCRIPTION_ROUTES.pdf("y")).toBe("/subscription/invoices/y/pdf");
    const svc = read("apps", "api", "src", "billing", "e-invoice", "e-invoice.service.ts");
    expect(svc).toContain("async resolve(tenantId: string)");
    expect(svc).toContain("decryptSecret(settings.credentialsEncrypted)");
    expect(read("apps", "api", "src", "billing", "invoices.service.ts")).not.toMatch(/const adapter = this\.eInvoice\.resolve\(/);
  });

  it("web: Abonelik ekranı + menü; kredi satın alma ödeme sayfasına yönlenir; admin: kuponlar + faturalar", () => {
    expect(read("apps", "web", "src", "app", "app", "ayarlar", "abonelik", "page.tsx")).toContain("/subscription/invoices/${id}/pay");
    expect(read("apps", "web", "src", "app", "app", "layout.tsx")).toContain('href: "/app/ayarlar/abonelik"');
    expect(read("apps", "web", "src", "app", "app", "ayarlar", "ai-kullanim", "page.tsx")).toContain("window.location.href = res.odemeSayfasi");
    expect(read("apps", "admin", "src", "app", "(panel)", "kuponlar", "page.tsx")).toContain("EP.coupons.create");
    expect(read("apps", "admin", "src", "app", "(panel)", "faturalar", "page.tsx")).toContain("EP.invoices.markPaid");
    expect(read("apps", "admin", "src", "lib", "nav.ts")).toContain('href: "/kuponlar"');
  });

  it("env/compose: ODEME_SAGLAYICI, IYZICO_*, PLATFORM_LEGAL_*", () => {
    const env = read(".env.example");
    for (const k of ["ODEME_SAGLAYICI", "IYZICO_API_KEY", "IYZICO_SECRET_KEY", "PLATFORM_LEGAL_NAME"]) expect(env).toContain(k);
    expect(read("docker-compose.prod.yml")).toContain("IYZICO_SECRET_KEY: ${IYZICO_SECRET_KEY:-}");
  });
});
