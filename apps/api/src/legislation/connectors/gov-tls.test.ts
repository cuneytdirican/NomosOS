/**
 * GOV-TLS YARDIMCISI TESTLERİ — sertifika süresi uyarısı ve hata sınıflandırması.
 * (Ağ yoktur; govFetch'in kendisi canlı duman testinin konusudur.)
 */

import { describe, expect, it } from "vitest";
import { GOV_CA_INTERMEDIATE_EXPIRES_AT, govCaExpiryWarning, isTlsChainError } from "./gov-tls";

describe("govCaExpiryWarning", () => {
  it("süre uzaksa uyarı yoktur", () => {
    expect(govCaExpiryWarning(new Date("2026-09-05T00:00:00Z"))).toBeNull();
  });

  it("son 90 gün içinde kalan gün sayısıyla uyarır", () => {
    const warn = govCaExpiryWarning(new Date(GOV_CA_INTERMEDIATE_EXPIRES_AT.getTime() - 30 * 86_400_000));
    expect(warn).toContain("gün içinde doluyor");
    expect(warn).toContain("2027-11-02");
  });

  it("süre dolduysa 'SONA ERDİ' ve yenileme talimatı verir", () => {
    const warn = govCaExpiryWarning(new Date(GOV_CA_INTERMEDIATE_EXPIRES_AT.getTime() + 86_400_000));
    expect(warn).toContain("SONA ERDİ");
    expect(warn).toContain("yenilenmeli");
  });
});

describe("isTlsChainError", () => {
  it("zincir/sertifika hata kodlarını tanır, diğerlerini tanımaz", () => {
    expect(isTlsChainError({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" })).toBe(true);
    expect(isTlsChainError({ code: "CERT_HAS_EXPIRED" })).toBe(true);
    expect(isTlsChainError({ code: "ECONNREFUSED" })).toBe(false);
    expect(isTlsChainError(new Error("zaman aşımı"))).toBe(false);
    expect(isTlsChainError(null)).toBe(false);
  });
});
