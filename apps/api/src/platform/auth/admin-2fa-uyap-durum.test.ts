/**
 * F2-K-01 / K-02 REGRESYON TESTİ — admin 2FA girişi + UYAP eklentisi dürüst durumu.
 *
 * K-01: admin giriş sayfası TOTP'yi login gövdesine `totp` alanıyla GÖNDERMEZ;
 * sunucu sözleşmesini uygular: login → { twoFactorRequired, challengeToken } →
 * POST /auth/2fa/verify { challengeToken, code } → { accessToken, user }.
 *
 * K-02: eklenti popup'ı arka uç olmadan SAHTE BAŞARI göstermez; arka ucun
 * geliştirme aşamasında olduğunu eşleştirme DENENMEDEN önce yazar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** apps/api vitest'i apps/api içinde koşar; admin/uyap iki-üst seviyededir. */
const ADMIN_ROOT = join(process.cwd(), "..", "..", "apps", "admin", "src");
const EXT_ROOT = join(process.cwd(), "..", "..", "apps", "uyap-extension", "src");
const read = (...parts: string[]) => readFileSync(join(...parts), "utf-8");

describe("K-01: admin girişi sunucu sözleşmesini uygular", () => {
  const page = read(ADMIN_ROOT, "app", "giris", "page.tsx");

  it("login gövdesi YALNIZCA email + password taşır — totp YOK", () => {
    expect(page).toContain('body: { email, password }');
    // Eski hata: body.totp = totp — şemada böyle alan yok, kod YUTULUYORDU.
    expect(page).not.toContain("body.totp");
  });

  it("challengeToken login yanıtından saklanır", () => {
    expect(page).toContain("data.challengeToken");
    expect(page).toContain("setChallengeToken(data.challengeToken)");
  });

  it("ikinci adım /auth/2fa/verify ucunu challengeToken + code ile çağırır", () => {
    expect(page).toContain("EP.auth.verify2fa");
    expect(page).toContain("body: { challengeToken, code: totp }");
  });

  it("kurulum zorunluysa setup akışı vardır", () => {
    expect(page).toContain("twoFactorSetupRequired");
    expect(page).toContain("EP.auth.setup2fa");
  });

  it("endpoints tanımları ve tipler sözleşmeyi taşır", () => {
    const endpoints = read(ADMIN_ROOT, "lib", "endpoints.ts");
    expect(endpoints).toContain('verify2fa: "/auth/2fa/verify"');
    expect(endpoints).toContain('setup2fa: "/auth/2fa/setup"');
    // Başlıktaki eski yanlış sözleşme kaldırıldı.
    expect(endpoints).not.toContain("totp?");
    const types = read(ADMIN_ROOT, "lib", "types.ts");
    expect(types).toContain("challengeToken?: string");
    expect(types).toContain("twoFactorSetupRequired?: boolean");
  });

  it("sunucu sözleşmesi değişmedi (şema + uç kontrolü)", () => {
    const schemas = read(
      join(process.cwd(), "src", "platform", "auth", "platform-auth.schemas.ts"),
    );
    expect(schemas).not.toMatch(/totp/);
    const controller = read(
      join(process.cwd(), "src", "platform", "auth", "platform-auth.controller.ts"),
    );
    expect(controller).toContain('@Post("2fa/verify")');
    expect(controller).toContain('@Post("2fa/setup")');
  });
});

describe("K-02: eklenti arka uç yokluğunu dürüstçe söyler", () => {
  it("popup eşleştirme DENEMESİNDEN ÖNCE arka uç durumunu gösterir", () => {
    const html = read(EXT_ROOT, "popup", "popup.html");
    expect(html).toContain("geliştirme aşamasında");
    expect(html).toContain("eşleştirme yapılamaz");
  });

  it("eşleştirme 404'si gerçeği söyler: arka uç dağıtılmamış", () => {
    const popup = read(EXT_ROOT, "popup", "popup.ts");
    expect(popup).toContain("arka ucu henüz dağıtılmamış");
  });

  it("auth.ts yorumu arka ucun YOK olduğunu yazar (F2-K-02 düzeltmesi)", () => {
    const auth = read(EXT_ROOT, "lib", "auth.ts");
    expect(auth).toContain("YOKTUR");
    expect(auth).toContain("geliştirme aşamasında");
    // Eski yanıltıcı iddia kaldırıldı.
    expect(auth).not.toContain("gerçekte `/api/v1/uyap/*` altında yayınlanır");
  });

  it("şemada UYAP controller'ı hâlâ yok — iddia gerçekle eşleşiyor", async () => {
    const { readdirSync, readFileSync: rf } = await import("node:fs");
    const dir = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith(".controller.ts")) files.push(p);
      }
    };
    walk(dir);
    const uyap = files.filter((f) => rf(f, "utf-8").includes('@Controller("uyap")'));
    // Arka uç yazıldığında bu test kırmızıya döner — o zaman popup'taki uyarı
    // metni de güncellenmelidir (test bilinçli kanıt taşır).
    expect(uyap).toEqual([]);
  });
});
