/**
 * İMZACI DOĞRULAMA testleri.
 *
 * Hedef: hatalı imzacı listesi HİÇBİR sağlayıcıya ulaşmadan, Türkçe ve
 * TOPLU olarak reddedilsin.
 */

import { describe, expect, it } from "vitest";
import {
  SignatureValidationError,
  normalizeGsm,
  validateDocument,
  validateOptions,
  validateSigners,
  type Signer,
} from "../index";

const ok: Signer[] = [
  { fullName: "Ayşe Yılmaz", email: "Ayse@Ornek.com.tr", role: "MUVEKKIL" },
];

describe("validateSigners — temel kurallar", () => {
  it("en az bir imzacı zorunludur", () => {
    expect(() => validateSigners([], { method: "NES" })).toThrowError(
      SignatureValidationError,
    );
    try {
      validateSigners([], { method: "NES" });
    } catch (e) {
      expect((e as SignatureValidationError).issues[0]).toContain("en az bir imzacı");
    }
  });

  it("geçersiz e-posta reddedilir ve kaçıncı imzacı olduğu söylenir", () => {
    const bad: Signer[] = [{ fullName: "Ayşe Yılmaz", email: "ayse[at]ornek", role: "MUVEKKIL" }];
    const err = catchError(() => validateSigners(bad, { method: "NES" }));
    expect(err).toBeInstanceOf(SignatureValidationError);
    expect((err as SignatureValidationError).issues.join(" ")).toContain("1. imzacı");
    expect((err as SignatureValidationError).issues.join(" ")).toContain("e-posta");
  });

  it("üç karakterden kısa ad reddedilir", () => {
    const bad: Signer[] = [{ fullName: "AY", email: "ay@ornek.com", role: "AVUKAT" }];
    const err = catchError(() => validateSigners(bad, { method: "NES" }));
    expect((err as SignatureValidationError).issues.join(" ")).toContain("en az 3 karakter");
  });

  it("geçerli listede e-posta küçük harfe indirilir", () => {
    const out = validateSigners(ok, { method: "NES" });
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("ayse@ornek.com.tr");
  });

  it("aynı e-posta iki kez verilemez", () => {
    const dup: Signer[] = [
      { fullName: "Ayşe Yılmaz", email: "a@ornek.com", role: "MUVEKKIL" },
      { fullName: "Ayşe Y.", email: "A@ORNEK.COM", role: "TANIK" },
    ];
    const err = catchError(() => validateSigners(dup, { method: "NES" }));
    expect((err as SignatureValidationError).issues.join(" ")).toContain(
      "birden fazla kez geçiyor",
    );
  });
});

describe("validateSigners — Türkiye bağlamı: mobil imza GSM zorunluluğu", () => {
  it("MOBIL_IMZA yönteminde GSM yoksa reddedilir", () => {
    const err = catchError(() => validateSigners(ok, { method: "MOBIL_IMZA" }));
    expect((err as SignatureValidationError).issues.join(" ")).toContain("GSM numarası zorunludur");
  });

  it("MOBIL_IMZA yönteminde geçerli GSM kabul edilir ve +90 biçimine getirilir", () => {
    const withGsm: Signer[] = [{ ...ok[0], phone: "0532 123 45 67" }];
    const out = validateSigners(withGsm, { method: "MOBIL_IMZA" });
    expect(out[0].phone).toBe("+905321234567");
  });

  it("imzacı bazında yöntem ezilebilir: süreç NES olsa da mobil imzacı GSM ister", () => {
    const mixed: Signer[] = [
      { fullName: "Ayşe Yılmaz", email: "a@ornek.com", role: "MUVEKKIL", method: "MOBIL_IMZA" },
      { fullName: "Av. Cem Demir", email: "c@buro.com", role: "AVUKAT" },
    ];
    const err = catchError(() => validateSigners(mixed, { method: "NES" }));
    expect((err as SignatureValidationError).issues.join(" ")).toContain("1. imzacı");
    expect((err as SignatureValidationError).issues.join(" ")).toContain("mobil imza");
  });

  it("normalizeGsm sabit hat ve bozuk numaraları reddeder", () => {
    expect(normalizeGsm("+905321234567")).toBe("+905321234567");
    expect(normalizeGsm("05321234567")).toBe("+905321234567");
    expect(normalizeGsm("02123334455")).toBeNull();
    expect(normalizeGsm("532123")).toBeNull();
    expect(normalizeGsm(undefined)).toBeNull();
  });
});

describe("validateSigners — sıra ve sağlayıcı yeteneği", () => {
  it("aynı sıra numarası iki imzacıya verilemez", () => {
    const dup: Signer[] = [
      { fullName: "Ayşe Yılmaz", email: "a@ornek.com", role: "MUVEKKIL", order: 1 },
      { fullName: "Av. Cem Demir", email: "c@buro.com", role: "AVUKAT", order: 1 },
    ];
    const err = catchError(() => validateSigners(dup, { method: "NES" }));
    expect((err as SignatureValidationError).issues.join(" ")).toContain("birden fazla imzacıya");
  });

  it("sıralı akışta sırasız imzacı bırakılamaz", () => {
    const partial: Signer[] = [
      { fullName: "Ayşe Yılmaz", email: "a@ornek.com", role: "MUVEKKIL", order: 1 },
      { fullName: "Av. Cem Demir", email: "c@buro.com", role: "AVUKAT" },
    ];
    const err = catchError(() =>
      validateSigners(partial, { method: "NES", sequential: true }),
    );
    expect((err as SignatureValidationError).issues.join(" ")).toContain("imza sırası");
  });

  it("sağlayıcının desteklemediği yöntem reddedilir", () => {
    const err = catchError(() =>
      validateSigners(ok, { method: "E_DEVLET", supportedMethods: ["NES"] }),
    );
    expect((err as SignatureValidationError).issues.join(" ")).toContain("desteklemiyor");
  });

  it("birden çok sorun TEK hatada toplanır", () => {
    const bad: Signer[] = [
      { fullName: "Ayşe Yılmaz", email: "a@ornek.com", role: "MUVEKKIL" },
      { fullName: "Av. Cem", email: "A@ORNEK.COM", role: "AVUKAT" },
    ];
    const err = catchError(() => validateSigners(bad, { method: "MOBIL_IMZA" }));
    // 2 × GSM eksikliği + 1 × yinelenen e-posta
    expect((err as SignatureValidationError).issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateDocument / validateOptions", () => {
  it("içeriksiz ve anahtarsız belge reddedilir", () => {
    const err = catchError(() =>
      validateDocument({ fileName: "a.pdf", mimeType: "application/pdf" }),
    );
    expect((err as SignatureValidationError).issues.join(" ")).toContain("içeriği bulunamadı");
  });

  it("depo anahtarı verilen belge kabul edilir", () => {
    expect(() =>
      validateDocument({
        fileName: "a.pdf",
        mimeType: "application/pdf",
        storageKey: "tenant/abc/sozlesme-v3.pdf",
      }),
    ).not.toThrow();
  });

  it("geçerlilik süresi 1-365 gün aralığında olmalıdır", () => {
    expect(() => validateOptions({ method: "NES", expiresInDays: 0 })).toThrowError(
      SignatureValidationError,
    );
    expect(() => validateOptions({ method: "NES", expiresInDays: 30 })).not.toThrow();
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("Hata bekleniyordu ama fırlatılmadı.");
}
