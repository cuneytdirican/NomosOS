/**
 * İ-01 REGRESYON TESTİ — TOTP tekrar oynatma koruması.
 *
 * `window: 1` saat kayması toleransı verir; adım saklanmadığında aynı kod
 * 90 saniyeye kadar tekrar kabul edilirdi. Bu test saf adım hesabını ve
 * servisin üç doğrulama noktasının tamamının korumalı yolu kullandığını
 * kanıtlar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFreshTotp, nextStoredCounter, totpCounterAt } from "./totp-replay";

/** Adım sınırına hizalı referans anı (30.000'in katı). */
const T = 30_000 * 596_063_34;

describe("totp-replay — adım hesabı (saf)", () => {
  it("delta 0/±1 adımı mutlak sayaca taşır", () => {
    const now = T;
    const base = Math.floor(now / 30_000);
    expect(totpCounterAt(0, now)).toBe(base);
    expect(totpCounterAt(-1, now)).toBe(base - 1);
    expect(totpCounterAt(1, now)).toBe(base + 1);
  });

  it("adım içinde zaman ilerledikçe sayaç değişmez, adım bitince artar", () => {
    expect(totpCounterAt(0, T)).toBe(totpCounterAt(0, T + 29_999));
    expect(totpCounterAt(0, T + 30_000)).toBe(totpCounterAt(0, T) + 1);
  });

  it("kullanılan adım ve GEÇMİŞ adımlar reddedilir; gelecek adım kabul edilir", () => {
    expect(isFreshTotp(100, null)).toBe(true);
    expect(isFreshTotp(99, 100)).toBe(false);
    expect(isFreshTotp(100, 100)).toBe(false); // eşit = aynı adım = tekrar
    expect(isFreshTotp(101, 100)).toBe(true);
  });

  it("saklanan sayaç asla geriye düşmez", () => {
    expect(nextStoredCounter(98, 100)).toBe(100);
    expect(nextStoredCounter(105, 100)).toBe(105);
    expect(nextStoredCounter(7, null)).toBe(7);
  });
});

describe("İ-01: üç doğrulama noktası korumalı yolu kullanıyor", () => {
  const service = readFileSync(
    join(process.cwd(), "src", "platform", "auth", "platform-auth.service.ts"),
    "utf-8",
  );
  const codeOnly = service
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  it("çıplak authenticator.verify KULLANILMIYOR — daima verifyTotpFresh", () => {
    expect(codeOnly).not.toMatch(/[^.]authenticator\.verify\(/);
    expect(codeOnly).toContain("this.verifyTotpFresh(");
  });

  it("üç doğrulama noktası (parola değiştirme, kurulum, giriş) korumalı", () => {
    const calls = codeOnly.match(/this\.verifyTotpFresh\(/g);
    expect(calls?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("başarıda adım kalıcı sayaca yazılıyor", () => {
    expect(codeOnly).toContain("lastTotpCounter:");
    expect(codeOnly).toMatch(/this\.markTotpUsed\(/);
  });

  it("tekrar oynatma için ayrı kullanıcı mesajı ve denetim izi var", () => {
    expect(service).toContain("zaten kullanılmış");
    expect(codeOnly).toContain("TEKRAR kullanıldı");
  });
});

describe("İ-01: şema ve sıfırlama yolu", () => {
  it("PlatformUser.lastTotpCounter kolonu tanımlı", () => {
    const schema = readFileSync(
      join(process.cwd(), "..", "..", "packages", "db", "prisma", "schema.prisma"),
      "utf-8",
    );
    const userBlock = schema.slice(schema.indexOf("model PlatformUser {"));
    expect(userBlock.slice(0, userBlock.indexOf("\nmodel "))).toMatch(
      /lastTotpCounter\s+Int\?/,
    );
  });

  it("2FA sıfırlaması sayacı da temizliyor", () => {
    const executor = readFileSync(
      join(process.cwd(), "src", "platform", "approvals", "platform-approval-executor.service.ts"),
      "utf-8",
    );
    expect(executor).toMatch(/twoFactorSecret = null;[\s\S]{0,200}lastTotpCounter = null;/);
  });
});
