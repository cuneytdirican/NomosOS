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

describe("K-02: eklenti arka ucu eşleştirme akışı dürüstçe çalışır", () => {
  it("popup eşleştirme talimatı günceldir — arka uç artık yayında", () => {
    const html = read(EXT_ROOT, "popup", "popup.html");
    expect(html).toContain("eşleştirme kodu üretin");
    expect(html).not.toContain("geliştirme aşamasında");
  });

  it("eşleştirme 404'si gerçek nedeni söyler: adres yanlış veya sürüm eski", () => {
    const popup = read(EXT_ROOT, "popup", "popup.ts");
    expect(popup).toContain("sunmuyor");
    expect(popup).not.toContain("henüz dağıtılmamış");
  });

  it("auth.ts sözleşme yorumu arka ucun YAYINDA olduğunu yazar", () => {
    const auth = read(EXT_ROOT, "lib", "auth.ts");
    expect(auth).toContain("Arka uç YAYINDA");
    expect(auth).not.toContain("YOKTUR — bu uçlar henüz hiçbir yerde yayınlanmaz");
  });

  it("şemada UYAP controller'ı VAR — iddia gerçekle eşleşiyor", async () => {
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
    const uyapFiles = files.filter((f) => rf(f, "utf-8").includes('@Controller("uyap")'));
    // İki ayrı controller (eklenti uçları + web uçları) TEK dosyada yaşar —
    // dosya sayısı 1'dir; sözleşme iki SINIF bildirimini arar.
    expect(uyapFiles.length).toBeGreaterThanOrEqual(1);
    const content = uyapFiles.map((f) => rf(f, "utf-8")).join("\n");
    expect(content).toContain("UyapExtensionController");
    expect(content).toContain("UyapWebController");
  });

  it("eklentinin çağırdığı uçlar denetleyicide birebir var (sözleşme taahhüdü)", async () => {
    const { readFileSync: rf } = await import("node:fs");
    const controller = rf(join(process.cwd(), "src", "uyap", "uyap.controller.ts"), "utf-8");
    const authPaths = read(EXT_ROOT, "lib", "auth.ts");
    // Eklentinin sabitleri ile sunucu yolları eşleşmeli.
    for (const path of ["/uyap/pair", "/uyap/pair/refresh", "/uyap/sync/files", "/uyap/sync/events", "/uyap/documents/presign", "/uyap/documents/commit", "/uyap/status"]) {
      expect(authPaths).toContain(`"/api/v1${path}"`);
      // Denetleyicideki alt yol: "/uyap/pair" → '"pair"'.
      const sub = path.replace(/^\/uyap\/?/, "");
      expect(controller).toContain(`"${sub}"`);
    }
  });
});
