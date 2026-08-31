import { describe, expect, it } from "vitest";
import { superAdminFloorViolation } from "./super-admin-floor";
import { MIN_ACTIVE_SUPER_ADMINS } from "../platform.constants";

/**
 * SUPER_ADMIN TABANI — denetim bulgusu Ö-02 regresyonu.
 *
 * Eski kapı `remaining === 0` idi ve `MIN_ACTIVE_SUPER_ADMINS` (2) hiçbir
 * yerde EŞİK değildi; sistem tek SUPER_ADMIN'e düşürülebiliyor, o noktada
 * "talep eden ≠ onaylayan" kuralı tüm dört-göz işlemlerini kalıcı olarak
 * kilitliyordu.
 */
describe("superAdminFloorViolation (denetim bulgusu Ö-02)", () => {
  it("taban sabiti gerçekten 2'dir", () => {
    expect(MIN_ACTIVE_SUPER_ADMINS).toBe(2);
  });

  it("geriye taban kadar kalıyorsa işlem serbesttir", () => {
    expect(superAdminFloorViolation(MIN_ACTIVE_SUPER_ADMINS)).toBeNull();
    expect(superAdminFloorViolation(MIN_ACTIVE_SUPER_ADMINS + 5)).toBeNull();
  });

  it("TEK SUPER_ADMIN kalacaksa REDDEDİLİR (eski kod buna izin veriyordu)", () => {
    const violation = superAdminFloorViolation(1);
    expect(violation).not.toBeNull();
    expect(violation).toContain("en az 2 aktif SUPER_ADMIN");
    expect(violation).toContain("kilitlenir");
  });

  it("hiç SUPER_ADMIN kalmayacaksa da reddedilir", () => {
    expect(superAdminFloorViolation(0)).not.toBeNull();
  });

  it("eşik parametreliyse ona uyar (test/kurulum senaryoları)", () => {
    expect(superAdminFloorViolation(1, 1)).toBeNull();
    expect(superAdminFloorViolation(2, 3)).not.toBeNull();
  });
});
