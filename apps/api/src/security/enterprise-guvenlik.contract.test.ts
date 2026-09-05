/**
 * ENTERPRISE++ GÜVENLİK & YÖNETİŞİM — sözleşme testleri.
 *
 * Şema, uçlar, ekranlar ve menü: kiracı 2FA, büro güvenlik politikası,
 * büro denetim izi, bildirim tercihleri. Metin tabanlı (dalga5 deseni).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf-8");
const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");

describe("şema + migration", () => {
  it("User.twoFactorSecret/lastTotpCounter, Tenant.require2fa/sessionMaxHours, NotificationPreference", () => {
    expect(schema).toContain("twoFactorSecret String?");
    expect(schema).toContain("require2fa      Boolean  @default(false)");
    expect(schema).toContain("sessionMaxHours Int?");
    expect(schema).toContain("model NotificationPreference {");
    expect(schema).toContain("@@unique([tenantId, userId, kind])");
    const sql = read("..", "..", "packages", "db", "prisma", "migrations", "20260924090000_enterprise_guvenlik_2fa_denetim_bildirim", "migration.sql");
    expect(sql).toContain('ADD COLUMN "twoFactorSecret" TEXT');
    expect(sql).toContain('CREATE TABLE "NotificationPreference"');
  });
});

describe("kiracı 2FA", () => {
  const svc = read("src", "auth", "two-factor.service.ts");
  const ctrl = read("src", "auth", "auth.controller.ts");

  it("gizli anahtar şifreli yazılır; düz metin saklanmaz", () => {
    expect(svc).toContain("twoFactorSecret: encryptSecret(secret)");
    expect(svc).not.toMatch(/twoFactorSecret:\s*secret[,\s]/);
  });

  it("tekrar oynatma + deneme sınırı + parola kapıları", () => {
    expect(svc).toContain("isFreshTotp(counter, user.lastTotpCounter)");
    expect(svc).toContain("TENANT_MAX_CHALLENGE_ATTEMPTS");
    expect(svc).toContain("bcrypt.compare(currentPassword, user.passwordHash)");
    expect(svc).toContain("require2fa");
  });

  it("uçlar: verify (public), setup (oturum+parola), setup-with-challenge, disable", () => {
    expect(ctrl).toContain('@Post("auth/2fa/verify")');
    expect(ctrl).toContain('@Post("auth/2fa/setup")');
    expect(ctrl).toContain('@Post("auth/2fa/setup-with-challenge")');
    expect(ctrl).toContain('@Post("auth/2fa/disable")');
    // Challenge yanıtında çerez YAZILMAZ.
    expect(ctrl).toContain('if ("accessToken" in result)');
  });

  it("giriş akışı: login challenge döner; oturum SessionService'ten (oturum ömrü politikası)", () => {
    const auth = read("src", "auth", "auth.service.ts");
    expect(auth).toContain("this.twoFactor.loginChallenge(user)");
    expect(auth).toContain('this.session.issue(');
    const session = read("src", "auth", "session.service.ts");
    expect(session).toContain("sessionMaxHours");
    expect(session).toContain("expiresIn: `${hours}h`");
  });

  it("kullanıcı yönetimi: yönetici 2FA sıfırlaması + twoFactorEnabled (anahtar dönmez)", () => {
    const users = read("src", "users", "users.service.ts");
    expect(users).toContain("twoFactorEnabled: twoFactorSecret !== null");
    expect(users).toContain("adminReset(");
    expect(read("src", "users", "users.controller.ts")).toContain('@Post(":id/reset-2fa")');
  });
});

describe("büro güvenlik politikası + denetim izi", () => {
  it("uçlar ve rol kapıları", () => {
    const c = read("src", "security", "security.controller.ts");
    expect(c).toContain('@Controller("security")');
    expect(c).toContain('@Get("audit/export.csv")');
    const s = read("src", "security", "security.service.ts");
    expect(s).toContain('assertRole(user, ["ADMIN"], "büro güvenlik politikasını değiştirme")');
    expect(s).toContain("const where: Prisma.AuditLogWhereInput = { tenantId: user.tenantId }");
    expect(s).toContain("AUDIT_EXPORT");
    expect(read("src", "app.module.ts")).toContain("SecurityModule");
  });
});

describe("bildirim tercihleri", () => {
  it("uçlar + giden kutusu kapısı", () => {
    expect(read("src", "scheduler", "notifications.controller.ts")).toContain('@Put("preferences")');
    expect(read("src", "scheduler", "notification-outbox.service.ts")).toContain("inAppDisabled(entry)");
  });
});

describe("gizli dosya (dosya bazlı erişim kısıtı)", () => {
  it("şema + global guard + liste süzgeçleri + uçlar", () => {
    expect(schema).toContain("isConfidential    Boolean    @default(false)");
    expect(schema).toContain("model CaseMember {");
    expect(read("src", "app.module.ts")).toContain("{ provide: APP_GUARD, useClass: CaseAccessGuard }");
    for (const f of [
      ["src", "cases", "cases.service.ts"],
      ["src", "hearings", "hearings.service.ts"],
      ["src", "deadlines", "deadlines.service.ts"],
      ["src", "tasks", "tasks.service.ts"],
      ["src", "documents", "documents.service.ts"],
      ["src", "agenda", "agenda.service.ts"],
    ]) {
      expect(read(...f)).toMatch(/caseVisibilityWhere|relatedCaseVisibilityWhere/);
    }
    const c = read("src", "cases", "cases.controller.ts");
    expect(c).toContain('@Put(":id/members")');
    expect(c).toContain("this.casesService.detail(user.tenantId, id, user)");
    const web = read("..", "web", "src", "app", "app", "dosyalar", "[id]", "page.tsx");
    expect(web).toContain("ConfidentialityCard");
    expect(web).toContain("/members");
  });
});

describe("KVKK saklama/imha + veri öznesi talepleri", () => {
  it("şema, uçlar, iş, politika alanı, ekran", () => {
    expect(schema).toContain("retentionYears  Int      @default(10)");
    expect(schema).toContain("anonymizedAt      DateTime?");
    expect(schema).toContain("model KvkkRequest {");
    expect(schema).toContain("KVKK_SAKLAMA");
    const c = read("src", "security", "kvkk.controller.ts");
    expect(c).toContain('@Controller("security/kvkk")');
    expect(c).toContain('@Post("retention/cases/:id/anonymize")');
    const s = read("src", "security", "kvkk.service.ts");
    // Otomatik silme YOK; imha yalnız ADMIN + gerekçe + süresi dolmuş KAPANDI.
    expect(s).toContain('assertRole(user, ["ADMIN"], "KVKK imhası uygulama")');
    expect(s).toContain("KVKK_RESPONSE_DAYS = 30");
    expect(read("src", "scheduler", "jobs", "kvkk-saklama.job.ts")).toContain("hiçbir veriyi SİLMEZ");
    expect(read("src", "security", "security.service.ts")).toContain("retentionYears");
    expect(read("..", "web", "src", "app", "app", "ayarlar", "kvkk", "page.tsx")).toContain("/security/kvkk/retention");
    expect(read("..", "web", "src", "app", "app", "layout.tsx")).toContain('"/app/ayarlar/kvkk"');
  });
});

describe("entegrasyonlar: API anahtarı + webhook", () => {
  it("şema, guard, olay kataloğu = denetim izi eylemleri, dağıtım işi, ekran", () => {
    expect(schema).toContain("model ApiKey {");
    expect(schema).toContain("model WebhookEndpoint {");
    expect(schema).toContain("model WebhookDelivery {");
    const guard = read("src", "common", "guards", "jwt-auth.guard.ts");
    expect(guard).toContain("resolveApiKey(");
    expect(guard).toContain('request.method !== "GET" && request.method !== "HEAD"');
    expect(guard).toContain("pathAllowedByScopes(");
    // Katalogdaki her olay gerçek bir denetim eylemidir.
    const catalog = read("src", "integrations", "webhook-events.ts");
    const actions = [...catalog.matchAll(/action: "([A-Z_]+)"/g)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThanOrEqual(15);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".service.ts") ? [p] : [];
      });
    const services = walk(join(process.cwd(), "src")).map((p) => readFileSync(p, "utf-8")).join("\n");
    for (const a of actions) {
      expect(services.includes(`action: "${a}"`), `denetim eylemi bulunamadı: ${a}`).toBe(true);
    }
    expect(read("src", "audit", "audit.service.ts")).toContain("subscribe(listener: AuditListener)");
    expect(read("src", "scheduler", "jobs", "webhook-dispatch.job.ts")).toContain("webhook-dispatch");
    expect(read("..", "web", "src", "app", "app", "ayarlar", "entegrasyonlar", "page.tsx")).toContain("/integrations/api-keys");
    expect(read("..", "web", "src", "app", "app", "layout.tsx")).toContain('"/app/ayarlar/entegrasyonlar"');
  });
});

describe("arayüz", () => {
  it("web: güvenlik / denetim / bildirimler sayfaları + menü; giriş 2FA adımı", () => {
    expect(read("..", "web", "src", "app", "app", "ayarlar", "guvenlik", "page.tsx")).toContain("/auth/2fa/setup");
    expect(read("..", "web", "src", "app", "app", "ayarlar", "denetim", "page.tsx")).toContain("/security/audit");
    expect(read("..", "web", "src", "app", "app", "ayarlar", "bildirimler", "page.tsx")).toContain("/notifications/preferences");
    const nav = read("..", "web", "src", "app", "app", "layout.tsx");
    for (const href of ["/app/ayarlar/guvenlik", "/app/ayarlar/bildirimler", "/app/ayarlar/denetim"]) {
      expect(nav).toContain(`"${href}"`);
    }
    const giris = read("..", "web", "src", "app", "giris", "page.tsx");
    expect(giris).toContain("/auth/2fa/verify");
    expect(giris).toContain("twoFactorSetupRequired");
    const users = read("..", "web", "src", "app", "app", "ayarlar", "kullanicilar", "page.tsx");
    expect(users).toContain("reset-2fa");
  });

  it("mobil: 2FA kod adımı", () => {
    expect(read("..", "mobile", "src", "auth", "session.tsx")).toContain("TwoFactorRequiredError");
    expect(read("..", "mobile", "app", "giris.tsx")).toContain("submitCode");
    expect(read("..", "mobile", "src", "api", "endpoints.ts")).toContain("/auth/2fa/verify");
  });
});
