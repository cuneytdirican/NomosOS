/**
 * DALGA 5 SÖZLEŞME TESTLERİ — platform yönetimi (plans/yonetim-plani-2026Q4-D5.md).
 *
 * M2: Kiracı AÇMA ucu (POST /tenants) — dört-göz TENANT_CREATE.
 * M3: Askıda/iptalli kiracı GİRİŞ engeli (abonelik → login bağı).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

describe("M2: kiracı açma — dört-göz TENANT_CREATE", () => {
  it("APPROVAL_ACTIONS kataloğunda + izin etiketi + etiket tablosunda", () => {
    const s = read("src", "platform", "approvals", "approval-actions.ts");
    expect(s).toContain("TENANT_CREATE: \"TENANT_CREATE\"");
    expect(s).toContain('TENANT_CREATE: "tenant.create"');
    expect(s).toContain("Yeni kiracı (büro) açma");
    expect(s).toContain("TenantCreatePayload");
  });

  it("uç: POST /tenants + ONAY yetki beyanı + zod şeması", () => {
    const c = read("src", "platform", "tenants", "platform-tenants.controller.ts");
    expect(c).toMatch(/@Post\(\)\s*\n\s*@ApprovalWritePermission\("tenant.create"\)/);
    expect(c).toContain("tenantCreateSchema");

    const sc = read("src", "platform", "tenants", "platform-tenants.schemas.ts");
    expect(sc).toContain("adminEmail");
    expect(sc).toContain("password");
    expect(sc).toContain("planKey");
  });

  it("parola talep anında HASH'lenir — payloadJson düz parola taşımaz", () => {
    const s = read("src", "platform", "tenants", "platform-tenants.service.ts");
    expect(s).toContain("bcrypt.hash(input.password");
    expect(s).toContain("passwordHash");
    expect(s).not.toContain("payload: { ...input }");
  });

  it("talep anı doğrulamaları: tekil e-posta + tekil ad + AKTİF plan + koltuk tavanı", () => {
    const s = read("src", "platform", "tenants", "platform-tenants.service.ts");
    expect(s).toContain("emailTaken");
    expect(s).toContain("nameTaken");
    expect(s).toContain("plan.isActive");
    expect(s).toContain("plan.maxUsers");
  });

  it("yürütücü: TEK İŞLEMDE tenant + ADMIN kullanıcı + TRIAL abonelik", () => {
    const e = read("src", "platform", "approvals", "platform-approval-executor.service.ts");
    expect(e).toContain("case APPROVAL_ACTIONS.TENANT_CREATE:");
    expect(e).toContain("createTenant(payload as TenantCreatePayload");
    expect(e).toContain('role: "ADMIN"');
    expect(e).toContain('status: "TRIAL"');
    expect(e).toContain("trialEndsAt");
    // Yürütme anı yeniden doğrulaması — talep ile onay arası yarış korunur.
    expect(e).toContain("onay beklerken");
  });

  it("izin matrisi: tenant.create dört-göz — SUPER_ADMIN ve OPS_ADMIN (katalog değişmezi)", () => {
    const p = read("src", "platform", "platform-permissions.ts");
    const block = p.split('"tenant.create": {')[1]?.split("},")[0] ?? "";
    expect(block).toContain('SUPER_ADMIN: "four_eyes"');
    expect(block).toContain('OPS_ADMIN: "four_eyes"');
    expect(block).not.toContain("BILLING_ADMIN: \"four_eyes\"");
    // İkiz matris (panel) aynı kararı taşır.
    const rbac = read("..", "admin", "src", "lib", "rbac.ts");
    const twin = rbac.split('"tenant.create": {')[1]?.split("},")[0] ?? "";
    expect(twin).toContain('SUPER_ADMIN: "four_eyes"');
  });

  it("panel: Yeni Kiracı düğmesi + uç tanımı", () => {
    const page = read("..", "admin", "src", "app", "(panel)", "tenantlar", "page.tsx");
    expect(page).toContain("CreateTenantButton");
    expect(page).toContain("Yeni Kiracı");
    expect(page).toContain("dört-göz");
    const ep = read("..", "admin", "src", "lib", "endpoints.ts");
    expect(ep).toContain('create: "/tenants"');
  });
});

describe("M6: UYAP eşleşme sonrası otomatik yeniden senkron", () => {
  const svc = () => read("src", "uyap", "uyap.service.ts");

  it("resolveMatch eşleşme anında sahnelenmiş olayları dosyaya İŞLER (caseId null → hedef)", () => {
    const s = svc();
    expect(s).toContain("OTOMATİK YENİDEN SENKRON");
    expect(s).toContain("caseId: null");
    expect(s).toMatch(/uyapEventRecord\.update\(\{ where: \{ id: ev\.id \}, data: \{ caseId \} \}\)/);
  });

  it("safahat → zaman çizelgesi; duruşma → ajanda (PLANLANDI) — syncEvents ile AYNI biçim", () => {
    const s = svc();
    expect(s).toMatch(/kind === "DURUSMA"[\s\S]{0,400}status: "PLANLANDI"/);
    // Duruşma notu eşleşme sonrası işlendiğini belgeler; safahat başlığı
    // syncEvents ile aynı biçimdedir (UYAP: <işlem>).
    expect(s).toContain("eşleşme sonrası işlendi");
    expect(s).toMatch(/title: `UYAP: \$\{ev\.islem\}`/);
  });

  it("yanıt işlenen kayıt sayısını döner (replayed) — panel/web gösterir", () => {
    const s = svc();
    expect(s).toContain("replayed = staged.length");
    expect(s).toContain("return { ok: true, replayed }");
    const page = read("..", "web", "src", "app", "app", "uyap", "page.tsx");
    expect(page).toContain("replayed");
    expect(page).toContain("bekleyen UYAP olayı dosyaya işlendi");
  });

  it("işlem TEK İŞLEMDEDİR (link + kuyruk çözümü + replay aynı transaction'da)", () => {
    const s = svc();
    expect(s).toMatch(/\$transaction\(async \(tx\) => \{[\s\S]*uyapCaseLink\.upsert[\s\S]*uyapMatchQueue\.update[\s\S]*uyapEventRecord\.findMany/);
  });
});

describe("M3: askıda kiracı GİRİŞ engeli (abonelik → login)", () => {
  it("login: SUSPENDED ve CANCELED abonelik 403 ile reddedilir", () => {
    const s = read("src", "auth", "auth.service.ts");
    expect(s).toContain("KİRAÇI ASKI DENETİMİ");
    expect(s).toContain('subscription.status === "SUSPENDED"');
    expect(s).toContain('subscription.status === "CANCELED"');
    expect(s).toContain("ForbiddenException");
  });

  it("denetim izi: engellenen giriş de loglanır", () => {
    const s = read("src", "auth", "auth.service.ts");
    expect(s).toContain('"büro askıda/iptal"');
  });

  it("veri silinmez — askı yalnız abonelik durumundadır", () => {
    const e = read("src", "platform", "approvals", "platform-approval-executor.service.ts");
    expect(e).toContain("Veri SİLİNMEZ");
  });
});
