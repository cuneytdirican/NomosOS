import { JwtService } from "@nestjs/jwt";
import { beforeAll, describe, expect, it } from "vitest";
import { TENANT_JWT_AUDIENCE } from "../common/jwt-audience";
import { PLATFORM_JWT_AUDIENCE, platformJwtSecret } from "../platform/platform.constants";
import { PORTAL_JWT_AUDIENCE, portalJwtSecret } from "../portal/portal.constants";

/**
 * ÜÇ KİMLİK EVRENİNİN SINIRI — spec §Kabul Kriterleri 1.
 *
 * "PortalUser token'ı ile /api/v1/* uçlarına yapılan her istek 401 döndürüyor
 * (ve tersi)." Guard'ın tamamını (Prisma, Reflector) kurmadan, o 401'i üreten
 * ASIL mekanizma burada sınanır: AYRI İMZA ANAHTARI + AYRI AUDIENCE.
 *
 * Bu test, bir gün `portalJwtSecret()` yanlışlıkla `JWT_SECRET`'i döndürecek
 * biçimde değiştirilirse ya da audience sabitleri eşitlenirse kırılır.
 */
describe("portal / tenant / platform token ayrımı", () => {
  const jwt = new JwtService({});
  const tenantSecret = "gelistirme-ortami-icin-yeterince-uzun-jwt-anahtari-2026";

  beforeAll(() => {
    process.env.JWT_SECRET = tenantSecret;
    delete process.env.PORTAL_JWT_SECRET;
    delete process.env.PLATFORM_JWT_SECRET;
  });

  const portalToken = () =>
    jwt.sign(
      { sub: "portal-user", tenantId: "t1", clientId: "c1" },
      { secret: portalJwtSecret(), audience: PORTAL_JWT_AUDIENCE, expiresIn: "8h" }
    );

  const tenantToken = () =>
    jwt.sign(
      { sub: "office-user", tenantId: "t1", role: "AVUKAT" },
      { secret: tenantSecret, audience: TENANT_JWT_AUDIENCE, expiresIn: "12h" }
    );

  it("üç audience sabiti birbirinden farklıdır", () => {
    const all = new Set([TENANT_JWT_AUDIENCE, PLATFORM_JWT_AUDIENCE, PORTAL_JWT_AUDIENCE]);
    expect(all.size).toBe(3);
  });

  it("portal imza anahtarı büro anahtarından türetilir ama ona EŞİT DEĞİLDİR", () => {
    expect(portalJwtSecret()).not.toBe(tenantSecret);
    expect(portalJwtSecret()).toMatch(/^[0-9a-f]{64}$/);
    // Türetme deterministiktir: aynı JWT_SECRET her zaman aynı portal anahtarı.
    expect(portalJwtSecret()).toBe(portalJwtSecret());
  });

  it("portal ve platform türetilmiş anahtarları birbirinden farklıdır", () => {
    expect(portalJwtSecret()).not.toBe(platformJwtSecret());
  });

  it("portal token'ı büro anahtarıyla doğrulanamaz (imza kapısı)", () => {
    expect(() => jwt.verify(portalToken(), { secret: tenantSecret })).toThrow();
  });

  it("büro token'ı portal anahtarıyla doğrulanamaz (ters yön)", () => {
    expect(() => jwt.verify(tenantToken(), { secret: portalJwtSecret() })).toThrow();
  });

  it("portal token'ı doğru anahtarla bile 'tenant' audience'ıyla reddedilir", () => {
    // İkinci kapı: anahtarlar bir gün yanlışlıkla eşitlense de audience tutar.
    expect(() =>
      jwt.verify(portalToken(), {
        secret: portalJwtSecret(),
        audience: TENANT_JWT_AUDIENCE,
      })
    ).toThrow();
  });

  it("portal token'ı kendi anahtarı ve audience'ıyla geçerlidir", () => {
    const payload = jwt.verify<{ sub: string; clientId: string; aud: string }>(portalToken(), {
      secret: portalJwtSecret(),
      audience: PORTAL_JWT_AUDIENCE,
    });
    expect(payload.aud).toBe(PORTAL_JWT_AUDIENCE);
    expect(payload.clientId).toBe("c1");
  });

  it("kısa PORTAL_JWT_SECRET reddedilir (kaba kuvvete açık anahtar)", () => {
    process.env.PORTAL_JWT_SECRET = "kisa";
    expect(() => portalJwtSecret()).toThrow(/en az 32 karakter/);
    delete process.env.PORTAL_JWT_SECRET;
  });
});
