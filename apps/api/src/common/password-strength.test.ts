import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertPasswordStrength, evaluatePassword } from "./password-strength";

describe("password-strength (zxcvbn)", () => {
  it("sözlük/klavye parolaları reddedilir, uzun ve rastgele kabul edilir", () => {
    expect(evaluatePassword("Password123!").ok).toBe(false);
    expect(evaluatePassword("Parola123!").ok).toBe(false); // Türkçe sözlük
    expect(evaluatePassword("qwertyuiop12").ok).toBe(false);
    expect(evaluatePassword("Demo1234!").ok).toBe(false);
    expect(evaluatePassword("Avukat2026!").ok).toBe(false);
    const good = evaluatePassword("mavi-kedi-tramvay-1907-Uskudar");
    expect(good.ok).toBe(true);
    expect(good.score).toBeGreaterThanOrEqual(3);
    expect(evaluatePassword("x7#Lq9!vT2pZ&mR4").ok).toBe(true);
  });

  it("hesap bilgisi parçası (e-posta yerel kısmı, ad soyad) parolada olamaz", () => {
    const r = evaluatePassword("ayse.yilmaz-2026-guclu!!", ["ayse.yilmaz@buro.av.tr", "Ayşe Yılmaz"]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("hesap bilgilerinizden");
    expect(evaluatePassword("mavi-kedi-tramvay-1907-Uskudar", ["ayse.yilmaz@buro.av.tr"]).ok).toBe(true);
  });

  it("Türkçe geri bildirim ve 400", () => {
    const r = evaluatePassword("password12345");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/tahmin direnci|yaygın|kolay/);
    expect(() => assertPasswordStrength("password12345")).toThrow(BadRequestException);
    expect(() => assertPasswordStrength("mavi-kedi-tramvay-1907-Uskudar")).not.toThrow();
  });
});
