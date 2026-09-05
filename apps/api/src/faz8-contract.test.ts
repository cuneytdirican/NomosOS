/**
 * FAZ 8 SÖZLEŞME TESTLERİ — büyüme (self-signup HARİÇ).
 *
 * 8A: kamusal plan/durum uçları kişisel veri taşımaz; vitrin fiyatı DB'den; SEO altyapısı; blog
 *     içeriği ürünün gerçek kapsamıyla birebir (UYAP'a gönderim vaadi yok).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

/** Yorum satırları ayıklanır — kural gerekçeleri metni kirletmesin. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

describe("Faz 8A: kamusal uçlar + SEO + içerik", () => {
  it("GET /public/plans ve /public/status @Public, önbellekli, kiracı verisi taşımaz", () => {
    const c = read("src", "public", "public.controller.ts");
    expect(c).toContain("@Public()");
    expect(c).toContain('@Controller("public")');
    expect(c).toContain('@Get("plans")');
    expect(c).toContain('@Get("status")');
    expect(c).toContain("Cache-Control");
    expect(c).not.toMatch(/tenantId|userId|email/);
    expect(c).toContain('audience: "TUM"');
    expect(read("src", "app.module.ts")).toContain("PublicModule");
    expect(read("src", "health", "health.module.ts")).toContain("exports: [ReadinessService]");
  });

  it("plan tohumu yıllık fiyat taşır (aylık × 10); vitrin PlanTier'dan okur", () => {
    const seed = read("..", "..", "packages", "db", "src", "seed.ts");
    expect(seed).toContain('annualPricePerUser: "15000.00"');
    expect(seed).toContain("annualPricePerUser: p.annualPricePerUser");
    const plans = read("..", "web", "src", "components", "marketing", "PublicPlans.tsx");
    expect(plans).toContain("/api/v1/public/plans");
    expect(plans).toContain("revalidate: 300");
    expect(read("..", "web", "src", "app", "fiyatlandirma", "page.tsx")).toContain("<PublicPlans />");
  });

  it("SEO: sitemap, robots (uygulama yolları kapalı), OG görseli (tokmak yok), metadataBase", () => {
    const sitemap = read("..", "web", "src", "app", "sitemap.ts");
    expect(sitemap).toContain("/fiyatlandirma");
    expect(sitemap).toContain("blogPosts.map");
    const robots = read("..", "web", "src", "app", "robots.ts");
    expect(robots).toContain('"/app"');
    expect(robots).toContain("sitemap.xml");
    const og = read("..", "web", "src", "app", "opengraph-image.tsx");
    expect(og).toContain("ImageResponse");
    expect(codeOnly(og).toLowerCase()).not.toMatch(/gavel|tokmak/);
    expect(read("..", "web", "src", "app", "layout.tsx")).toContain("metadataBase");
  });

  it("blog/hakkımızda/iletişim/eklenti/durum sayfaları; içerik vaat kısıtlarına uyar", () => {
    for (const p of [["blog", "page.tsx"], ["blog", "[slug]", "page.tsx"], ["hakkimizda", "page.tsx"], ["iletisim", "page.tsx"], ["eklenti", "page.tsx"], ["durum", "page.tsx"]]) {
      expect(() => read("..", "web", "src", "app", ...p)).not.toThrow();
    }
    const blog = read("..", "web", "src", "components", "marketing", "blog-content.ts");
    expect(codeOnly(blog)).not.toMatch(/UYAP'a (otomatik )?gönder/i);
    expect(blog).toContain("Sistem sizin adınıza hiçbir evrak göndermez");
    expect(codeOnly(blog)).not.toMatch(/garanti ederiz|kesinlikle kazan/i);
    const content = read("..", "web", "src", "components", "marketing", "content.ts");
    expect(content).toContain("export const extension");
    expect(content).toContain(".zip.sha256");
    expect(() => read("..", "web", "public", "downloads", "nomosos-uyap-koprusu-v0.1.0.zip.sha256")).not.toThrow();
  });
});

describe("Faz 8B: sözleşme seti + TermsAcceptance", () => {
  it("dört metin tek kaynakta; zorunlu üçlü; taslak uyarısı; kabul ekleme-yalnız + ONAY rolü", () => {
    const docs = read("..", "..", "packages", "shared", "src", "legal-docs.ts");
    for (const k of ["HIZMET_SOZLESMESI", "DPA", "SLA", "MESAFELI_SATIS"]) expect(docs).toContain(`key: "${k}"`);
    expect(docs).toContain("draftNotice");
    const svc = codeOnly(read("src", "terms", "terms.service.ts"));
    expect(svc).toContain("ROLE_SETS.ONAY");
    expect(svc).toContain("termsAcceptance.create");
    expect(svc).not.toMatch(/termsAcceptance\.(update|delete|deleteMany|updateMany)/);
    expect(svc).toContain("sha256");
    expect(read("..", "..", "packages", "db", "prisma", "schema.prisma")).toContain("model TermsAcceptance");
    expect(read("src", "app.module.ts")).toContain("TermsModule");
    const platform = read("src", "platform", "tenants", "platform-tenants.controller.ts");
    expect(platform).toContain('@Get(":id/terms")');
    expect(platform).toContain('@ReadPermission("tenant.view")');
    expect(read("..", "web", "src", "components", "marketing", "content.ts")).toContain("/sozlesmeler/veri-isleme-protokolu");
  });
});

describe("Faz 8C: destek talepleri + SLA", () => {
  it("SLA saatleri tek kaynakta; iç not kiracıya dönmez; platform yetkileri iki matriste aynı", () => {
    const shared = read("..", "..", "packages", "shared", "src", "support.ts");
    expect(shared).toMatch(/KRITIK: 2,[\s\S]*YUKSEK: 8,[\s\S]*NORMAL: 24,[\s\S]*DUSUK: 72,/);
    const tenant = codeOnly(read("src", "support-tickets", "support-tickets.service.ts"));
    expect(tenant).toContain("internal: false");
    expect(tenant).toContain("tenantId: user.tenantId");
    const platform = codeOnly(read("src", "platform", "support-tickets", "platform-support-tickets.service.ts"));
    expect(platform).toContain("firstResponseAt: t.firstResponseAt ?? now");
    expect(platform).toContain("if (!input.internal)");
    const api = read("src", "platform", "platform-permissions.ts");
    const admin = read("..", "admin", "src", "lib", "rbac.ts");
    const block = (s: string) => s.match(/"support\.tickets\.view": \{[\s\S]*?\},\s*"support\.tickets\.update": \{[\s\S]*?\},/)?.[0];
    expect(block(api)).toBeTruthy();
    expect(block(api)).toBe(block(admin));
    expect(read("..", "admin", "src", "lib", "nav.ts")).toContain('href: "/destek"');
  });
});

describe("Faz 8D: Danıştay + gelir metrikleri", () => {
  it("üç canlı kaynak paralel; Danıştay gövdesi andKelimeler; MRR yıllığı aya böler; gelir churn", () => {
    const adapter = read("src", "caselaw", "adapters", "yargitay-live.adapter.ts");
    expect(adapter).toContain('adapterKey: "DANISTAY_CANLI"');
    expect(adapter).toContain("andKelimeler: [q]");
    const svc = codeOnly(read("src", "caselaw", "caselaw.service.ts"));
    expect(svc).toContain("[this.liveAdapter, this.emsalAdapter, this.danistayAdapter]");
    const metrics = codeOnly(read("src", "platform", "metrics", "platform-metrics.service.ts"));
    expect(metrics).toContain("annualPricePerUser).div(12)");
    expect(metrics).toContain("revenueChurnRate30d");
    expect(read("src", "scheduler", "job-registry.service.ts")).toContain("UsageSnapshotJob");
  });
});

describe("Faz 8E: veri göçü", () => {
  it("önizleme yazmaz; çalıştırma ONAY rolü; belgeler DocumentsService.upload hattından; satır tavanı", () => {
    const svc = codeOnly(read("src", "import", "import.service.ts"));
    expect(svc).toContain('assertRole(user, ROLE_SETS.ONAY, "veri göçü")');
    expect(svc).toContain("this.documents.upload(");
    expect(svc).toContain("IMPORT_MAX_ROWS");
    // preview yolu prisma create çağırmaz: planCases/planHearings yalnız findMany kullanır.
    const planCases = svc.slice(svc.indexOf("private async planCases"), svc.indexOf("private async runCases"));
    expect(planCases).not.toContain(".create(");
    const planHearings = svc.slice(svc.indexOf("private async planHearings"), svc.indexOf("private async runHearings"));
    expect(planHearings).not.toContain(".create(");
    const ctrl = read("src", "import", "import.controller.ts");
    expect(ctrl).toContain("limits: { fileSize: MAX_ZIP_BYTES }");
    expect(read("src", "app.module.ts")).toContain("ImportModule");
    expect(read("..", "web", "src", "app", "app", "layout.tsx")).toContain("/app/ayarlar/veri-gocu");
  });
});
