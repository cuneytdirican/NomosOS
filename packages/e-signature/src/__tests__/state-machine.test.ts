/**
 * İMZA DURUM MAKİNESİ testleri + kayıt defteri davranışı.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  NoopSignatureProvider,
  SIGNATURE_REQUEST_STATUSES,
  SignatureStateError,
  assertSignatureTransition,
  canTransitionSignature,
  clearSignatureProviders,
  createSignatureProvider,
  isProviderRegistered,
  isTerminalSignatureStatus,
  listRegisteredProviders,
  registerSignatureProvider,
  type ISignatureProvider,
  type SignatureRequestStatus,
} from "../index";

describe("durum makinesi — izin verilen geçişler", () => {
  it("OLUSTURULDU → GONDERILDI ve OLUSTURULDU → IPTAL serbesttir", () => {
    expect(canTransitionSignature("OLUSTURULDU", "GONDERILDI")).toBe(true);
    expect(canTransitionSignature("OLUSTURULDU", "IPTAL")).toBe(true);
    expect(() => assertSignatureTransition("OLUSTURULDU", "GONDERILDI")).not.toThrow();
  });

  it("GONDERILDI dört sonuca da gidebilir", () => {
    for (const to of ["IMZALANDI", "REDDEDILDI", "SURESI_DOLDU", "IPTAL"] as const) {
      expect(canTransitionSignature("GONDERILDI", to)).toBe(true);
    }
  });

  it("gönderilmeden imzalanamaz (OLUSTURULDU → IMZALANDI reddedilir)", () => {
    expect(canTransitionSignature("OLUSTURULDU", "IMZALANDI")).toBe(false);
    const err = catchError(() => assertSignatureTransition("OLUSTURULDU", "IMZALANDI"));
    expect(err).toBeInstanceOf(SignatureStateError);
    expect((err as Error).message).toContain("İzin verilen geçişler");
  });

  it("nihai durumlardan çıkış yoktur ve mesaj yeni süreç açmayı önerir", () => {
    for (const s of ["IMZALANDI", "REDDEDILDI", "SURESI_DOLDU", "IPTAL"] as const) {
      expect(isTerminalSignatureStatus(s)).toBe(true);
      expect(canTransitionSignature(s, "GONDERILDI")).toBe(false);
    }
    const err = catchError(() => assertSignatureTransition("IMZALANDI", "GONDERILDI"));
    expect((err as Error).message).toContain("Yeni bir imza süreci başlatın");
  });

  it("aynı duruma geçiş (yinelenen bildirim) hata değildir — idempotens", () => {
    for (const s of SIGNATURE_REQUEST_STATUSES) {
      expect(canTransitionSignature(s, s)).toBe(true);
    }
  });

  it("her durum tablosunda tanımlıdır (eksik değer yok)", () => {
    for (const s of SIGNATURE_REQUEST_STATUSES) {
      expect(() => canTransitionSignature(s, "IPTAL")).not.toThrow();
    }
    // Prisma `SignatureStatus` enum'uyla birebir aynı küme olmalıdır.
    expect([...SIGNATURE_REQUEST_STATUSES].sort()).toEqual(
      ["GONDERILDI", "IMZALANDI", "IPTAL", "OLUSTURULDU", "REDDEDILDI", "SURESI_DOLDU"].sort(),
    );
  });
});

describe("kayıt defteri", () => {
  afterEach(() => clearSignatureProviders());

  it("varsayılan kurulumda kayıtlı gerçek sağlayıcı YOKTUR", () => {
    expect(listRegisteredProviders()).toEqual([]);
    expect(isProviderRegistered("nes-x")).toBe(false);
  });

  it("anahtar verilmezse Noop döner", () => {
    expect(createSignatureProvider()).toBeInstanceOf(NoopSignatureProvider);
    expect(createSignatureProvider({ provider: null })).toBeInstanceOf(NoopSignatureProvider);
  });

  it("kayıtlı olmayan anahtar Noop'a düşer ve anahtarı hata mesajında anar", async () => {
    const p = createSignatureProvider({ provider: "nes-x" });
    expect(p).toBeInstanceOf(NoopSignatureProvider);
    const err = await p.getStatus("ref").catch((e: unknown) => e);
    expect((err as Error).message).toContain("nes-x");
  });

  it("kayıtlı adaptör anahtarıyla çözülür (büyük/küçük harf duyarsız)", () => {
    const fake: ISignatureProvider = {
      key: "nes-x",
      displayName: "NES-X",
      supportedMethods: ["NES"],
      createRequest: async () => {
        throw new Error("kullanılmıyor");
      },
      getStatus: async () => {
        throw new Error("kullanılmıyor");
      },
      cancel: async () => {
        throw new Error("kullanılmıyor");
      },
      downloadSignedDocument: async () => {
        throw new Error("kullanılmıyor");
      },
      healthCheck: async () => ({
        providerKey: "nes-x",
        displayName: "NES-X",
        configured: true,
        supportedMethods: ["NES"] as const,
        message: "hazır",
      }),
    };
    registerSignatureProvider("nes-x", () => fake);
    expect(isProviderRegistered("NES-X")).toBe(true);
    expect(createSignatureProvider({ provider: "NES-X" })).toBe(fake);
    expect(listRegisteredProviders()).toEqual(["nes-x"]);
  });

  it('"noop" anahtarı ayrılmıştır, kaydedilemez', () => {
    expect(() => registerSignatureProvider("noop", () => new NoopSignatureProvider())).toThrow();
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

// Tip düzeyinde sözleşme kontrolü: durum birleşimi genişlerse derleme kırılır.
const _exhaustive: SignatureRequestStatus = "OLUSTURULDU";
void _exhaustive;
