import { describe, expect, it } from "vitest";
import { hashPortalToken, newPortalToken, portalTokenHashEquals } from "./portal-token";
import { portalAcceptInviteSchema, portalLoginSchema, portalMessageSchema } from "./portal.schemas";

describe("portal token'ları", () => {
  it("64 hane hex üretir ve her çağrıda farklıdır", () => {
    const a = newPortalToken();
    const b = newPortalToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("özet deterministiktir ve ham token'ı içermez", () => {
    const raw = newPortalToken();
    const hash = hashPortalToken(raw);
    expect(hash).toBe(hashPortalToken(raw));
    expect(hash).not.toBe(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("farklı token'lar farklı özet üretir", () => {
    expect(hashPortalToken(newPortalToken())).not.toBe(hashPortalToken(newPortalToken()));
  });

  it("sabit zamanlı karşılaştırma doğru çalışır", () => {
    const hash = hashPortalToken("abc");
    expect(portalTokenHashEquals(hash, hash)).toBe(true);
    expect(portalTokenHashEquals(hash, hashPortalToken("abd"))).toBe(false);
    expect(portalTokenHashEquals(hash, "kisa")).toBe(false);
  });
});

describe("portal şemaları", () => {
  it("giriş şeması e-postayı normalleştirir", () => {
    const parsed = portalLoginSchema.parse({ email: "  Muvekkil@ABC.COM ", password: "x" });
    expect(parsed.email).toBe("muvekkil@abc.com");
  });

  it("davet kabulü zayıf parolayı reddeder", () => {
    const base = { token: "a".repeat(64), fullName: "Ayşe Yılmaz" };
    // Çok kısa
    expect(portalAcceptInviteSchema.safeParse({ ...base, password: "kisa1" }).success).toBe(false);
    // Rakamsız
    expect(
      portalAcceptInviteSchema.safeParse({ ...base, password: "sadeceharfler" }).success
    ).toBe(false);
    // Harfsiz
    expect(portalAcceptInviteSchema.safeParse({ ...base, password: "12345678901" }).success).toBe(
      false
    );
    // Uygun
    expect(
      portalAcceptInviteSchema.safeParse({ ...base, password: "GucluParola1" }).success
    ).toBe(true);
  });

  it("davet kabulü biçimsiz token'ı reddeder", () => {
    const result = portalAcceptInviteSchema.safeParse({
      token: "kisa-token",
      fullName: "Ayşe Yılmaz",
      password: "GucluParola1",
    });
    expect(result.success).toBe(false);
  });

  it("mesaj şeması boş ve aşırı uzun metni reddeder", () => {
    expect(portalMessageSchema.safeParse({ body: " " }).success).toBe(false);
    expect(portalMessageSchema.safeParse({ body: "a".repeat(5_001) }).success).toBe(false);
    expect(portalMessageSchema.safeParse({ body: "Merhaba avukat bey." }).success).toBe(true);
  });

  it("mesaj şeması clientId gibi kapsam genişleten bir alanı taşımaz", () => {
    const parsed = portalMessageSchema.parse({
      body: "Merhaba",
      clientId: "00000000-0000-0000-0000-000000000000",
    } as never);
    // Zod bilinmeyen anahtarı düşürür: istemci kendi kapsamını genişletemez.
    expect(parsed).not.toHaveProperty("clientId");
  });
});
