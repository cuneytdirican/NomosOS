/**
 * DEMO GİRİŞ + ROL BAZLI DENEYİM REGRESYON TESTİ.
 *
 * Korunan taahhütler:
 *  1. /demo-giris ayrı sayfadır; gerçek login ucunu kullanır (sahte oturum yok),
 *     dört demo rolü (PARTNER/AVUKAT/SEKRETER/STAJYER) kartlarla sunulur.
 *  2. Menü rolle süzülür: Finans/Faturalar/Zaman STAJYER'e, AI Sağlayıcı
 *     AVUKAT/SEKRETER/STAJYER'e GÖRÜNMEZ. Kaynak: sunucu rol kümeleri
 *     (finance-access.ts, ROLE_SETS.ONAY) — yanlış gizlemek geçerli özelliği
 *     saklar; bu test hizayı korur.
 *  3. Demo gezinti şeridi hangi rolle gezildiğini her ekranda gösterir.
 *  4. Gerçek giriş ekranı (/giris) demo kimlik bilgisi TAŞIMAZ (İ-48) ve
 *     demo sayfasına bağlantı verir.
 *  5. NEXT_PUBLIC_DISABLE_DEMO=1 üretimde demo sayfasını kapatır.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf-8");

const LAYOUT = read("src", "app", "app", "layout.tsx");
const DEMO_PAGE = read("src", "app", "demo-giris", "page.tsx");
const GIRIS = read("src", "app", "giris", "page.tsx");
const API = read("src", "lib", "api.ts");

describe("Demo giriş sayfası ayrı ve gerçek", () => {
  it("dört demo rolü kart olarak sunulur", () => {
    for (const role of ["PARTNER", "AVUKAT", "SEKRETER", "STAJYER"]) {
      expect(DEMO_PAGE).toContain(`role: "${role}"`);
    }
    // Seed'deki gerçek demo hesapları.
    for (const email of [
      "partner@demo.nomosos.local",
      "avukat@demo.nomosos.local",
      "sekreter@demo.nomosos.local",
      "stajyer@demo.nomosos.local",
    ]) {
      expect(DEMO_PAGE).toContain(email);
    }
  });

  it("gerçek /auth/login ucunu kullanır — sahte oturum yok", () => {
    expect(DEMO_PAGE).toContain('"/auth/login"');
    expect(DEMO_PAGE).toContain("setToken(token)");
    expect(DEMO_PAGE).not.toContain("fake");
  });

  it("rolle girilen deneyimi işaretler (gösterim amaçlı)", () => {
    expect(DEMO_PAGE).toContain("setDemoRole(");
    expect(API).toContain("export function setDemoRole");
    expect(API).toContain("export function getDemoRole");
  });

  it("üretimde kapatılabilir (NEXT_PUBLIC_DISABLE_DEMO)", () => {
    expect(DEMO_PAGE).toContain("NEXT_PUBLIC_DISABLE_DEMO");
  });
});

describe("Rol bazlı menü süzmesi", () => {
  it("Finans, Faturalar ve Zaman Kaydı STAJYER'e görünmez", () => {
    // Üç öğe de roles: ["ADMIN","PARTNER","AVUKAT","SEKRETER"] taşır.
    const matches = LAYOUT.match(/roles: \["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    for (const href of ['"/app/finans"', '"/app/faturalar"', '"/app/zaman"']) {
      expect(LAYOUT).toContain(`href: ${href}`);
    }
    // SEKRETER görünürde KALIR (FINANCE_ACCESS.READ'a hizalı), STAJYER düşer.
    const finans = LAYOUT.slice(LAYOUT.indexOf('"/app/finans"'), LAYOUT.indexOf('"/app/faturalar"'));
    expect(finans).toContain('"SEKRETER"');
    expect(finans).not.toContain('"STAJYER"');
  });

  it("AI Sağlayıcı yalnız ADMIN/PARTNER'e görünür (K-9)", () => {
    const aiSaglayici = LAYOUT.slice(
      LAYOUT.indexOf('"/app/ayarlar/ai-saglayici"'),
      LAYOUT.indexOf('"/app/ayarlar/ai-saglayici"') + 600,
    );
    expect(aiSaglayici).toContain('roles: ["ADMIN", "PARTNER"]');
    expect(aiSaglayici).not.toContain('"AVUKAT", "PARTNER"');
  });

  it("süzme kodu render'da uygulanır (roles alanı ölü kod değil)", () => {
    expect(LAYOUT).toContain("visibleGroups");
    expect(LAYOUT).toContain('("roles" in item && item.roles)');
    expect(LAYOUT).toContain("NAV_GROUPS.map");
  });
});

describe("Demo gezinti şeridi", () => {
  it("şerit demo rolünü gösterir; rol değiştir ve çıkış düğmeleri var", () => {
    expect(LAYOUT).toContain("getDemoRole()");
    expect(LAYOUT).toContain("Demo gezinti");
    expect(LAYOUT).toContain("Rol değiştir");
    expect(LAYOUT).toContain("Demodan çık");
  });

  it("çıkış demo bayrağını da temizler", () => {
    expect(API).toContain('window.localStorage.removeItem(DEMO_ROLE_KEY)');
  });
});

describe("Gerçek giriş ekranı demo'dan ayrı (İ-48)", () => {
  it("demo kimlik bilgisi ve şifre YOK; demo sayfasına bağlantı VAR", () => {
    expect(GIRIS).toContain("/demo-giris");
    expect(GIRIS).not.toContain("partner@demo.nomosos.local");
    expect(GIRIS).not.toContain("Demo1234!");
  });
});
