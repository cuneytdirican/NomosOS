import { describe, expect, it } from "vitest";
import {
  isGrantLive,
  scopeCovers,
  supportGrantDenial,
  SUPPORT_SCOPE_ORDER,
  type SupportGrantSnapshot,
} from "./support-grant";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ DESTEK ERİŞİM PENCERESİ — denetim bulgusu Ö-06 regresyonu                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `SupportAccessGrant` yazılıyor ama HİÇBİR KAPIDA okunmuyordu: dört-göz
 * onayı, 24 saatlik tavan ve kapsam beyaz listesi hiçbir davranışı
 * değiştirmiyordu; süresi dolan pencere de bir şeyi kapatmıyordu.
 */
const now = new Date("2026-08-31T12:00:00.000Z");
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

const grant = (over: Partial<SupportGrantSnapshot> = {}): SupportGrantSnapshot => ({
  scope: "SADECE_USTVERI",
  expiresAt: hours(2),
  revokedAt: null,
  ...over,
});

describe("kapsam hiyerarşisi", () => {
  it("dardan geniş sırası spec'e uyar", () => {
    expect(SUPPORT_SCOPE_ORDER).toEqual([
      "SADECE_USTVERI",
      "YAPILANDIRMA",
      "ICERIK_MASKELI",
    ]);
  });

  it("geniş kapsam darı kapsar; tersi geçmez", () => {
    expect(scopeCovers("ICERIK_MASKELI", "SADECE_USTVERI")).toBe(true);
    expect(scopeCovers("YAPILANDIRMA", "SADECE_USTVERI")).toBe(true);
    expect(scopeCovers("SADECE_USTVERI", "YAPILANDIRMA")).toBe(false);
    expect(scopeCovers("SADECE_USTVERI", "SADECE_USTVERI")).toBe(true);
  });
});

describe("pencere canlılığı", () => {
  it("süresi dolmamış ve iptal edilmemiş pencere canlıdır", () => {
    expect(isGrantLive(grant(), now)).toBe(true);
  });

  it("SÜRESİ DOLMUŞ pencere canlı DEĞİLDİR", () => {
    expect(isGrantLive(grant({ expiresAt: hours(-1) }), now)).toBe(false);
  });

  it("erken iptal edilmiş pencere canlı değildir", () => {
    expect(isGrantLive(grant({ revokedAt: hours(-0.5) }), now)).toBe(false);
  });
});

describe("supportGrantDenial (denetim bulgusu Ö-06)", () => {
  it("hiç pencere yoksa erişim REDDEDİLİR", () => {
    const denial = supportGrantDenial([], "SADECE_USTVERI", now);
    expect(denial).not.toBeNull();
    expect(denial).toContain("destek erişim penceresi açılmalıdır");
  });

  it("AKTİF ve yeterli kapsamlı pencere varsa geçer", () => {
    expect(supportGrantDenial([grant()], "SADECE_USTVERI", now)).toBeNull();
  });

  it("SÜRESİ DOLMUŞSA 403 — bu, bulgunun tam çekirdeğidir", () => {
    const denial = supportGrantDenial([grant({ expiresAt: hours(-1) })], "SADECE_USTVERI", now);
    expect(denial).not.toBeNull();
    expect(denial).toContain("sona ermiş");
  });

  it("iptal edilmiş pencere de geçmez", () => {
    const denial = supportGrantDenial([grant({ revokedAt: hours(-1) })], "SADECE_USTVERI", now);
    expect(denial).not.toBeNull();
  });

  it("kapsam yetersizse ayrı ve açıklayıcı mesaj döner", () => {
    const denial = supportGrantDenial([grant()], "YAPILANDIRMA", now);
    expect(denial).not.toBeNull();
    expect(denial).toContain("kapsamı yetersiz");
  });

  it("birden çok pencereden EN GENİŞİ yeterse geçer", () => {
    const grants = [
      grant({ expiresAt: hours(-3) }),
      grant({ scope: "ICERIK_MASKELI" }),
      grant({ scope: "YAPILANDIRMA", revokedAt: hours(-1) }),
    ];
    expect(supportGrantDenial(grants, "YAPILANDIRMA", now)).toBeNull();
  });

  it("pencerenin bittiği AN kapanır (sınır davranışı)", () => {
    const expiring = grant({ expiresAt: now });
    expect(supportGrantDenial([expiring], "SADECE_USTVERI", now)).not.toBeNull();
    expect(
      supportGrantDenial([expiring], "SADECE_USTVERI", new Date(now.getTime() - 1))
    ).toBeNull();
  });
});
