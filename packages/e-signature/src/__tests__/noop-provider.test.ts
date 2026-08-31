/**
 * NoopSignatureProvider — "SAHTE İMZA ÜRETİLMEZ" güvencesinin testi.
 *
 * Buradaki her test bir ürün ilkesini korur: yapılandırılmamış kurulumda
 * hiçbir çağrı BAŞARILI görünmemelidir.
 */

import { describe, expect, it } from "vitest";
import {
  NoopSignatureProvider,
  NOT_CONFIGURED_MESSAGE,
  SignatureProviderNotConfiguredError,
  isNotConfiguredError,
  type CreateRequestOptions,
  type SignatureDocument,
  type Signer,
} from "../index";

const doc: SignatureDocument = {
  fileName: "vekalet-ucret-sozlesmesi.pdf",
  mimeType: "application/pdf",
  content: new Uint8Array([1, 2, 3]),
  title: "Vekalet Ücret Sözleşmesi",
};

const signers: Signer[] = [
  { fullName: "Ayşe Yılmaz", email: "ayse@ornek.com.tr", role: "MUVEKKIL" },
  { fullName: "Av. Cem Demir", email: "cem@buro.com.tr", role: "AVUKAT" },
];

const options: CreateRequestOptions = { method: "NES" };

describe("NoopSignatureProvider — arayüz sözleşmesi", () => {
  it("ISignatureProvider'ın beş metodunu ve üç meta alanını sağlar", () => {
    const p = new NoopSignatureProvider();
    expect(typeof p.createRequest).toBe("function");
    expect(typeof p.getStatus).toBe("function");
    expect(typeof p.cancel).toBe("function");
    expect(typeof p.downloadSignedDocument).toBe("function");
    expect(typeof p.healthCheck).toBe("function");
    expect(p.key).toBe("noop");
    expect(typeof p.displayName).toBe("string");
    // Yapılandırılmamış sağlayıcı HİÇBİR yöntemi desteklemez — dürüst cevap.
    expect(p.supportedMethods).toEqual([]);
  });
});

describe("NoopSignatureProvider — her işlem çağrısı Türkçe hata döner", () => {
  it("createRequest: yapılandırılmamış hatası fırlatır, providerRef ÜRETMEZ", async () => {
    const p = new NoopSignatureProvider();
    await expect(p.createRequest(doc, signers, options)).rejects.toBeInstanceOf(
      SignatureProviderNotConfiguredError,
    );
    await expect(p.createRequest(doc, signers, options)).rejects.toThrowError(
      /Ayarlar → E-imza/,
    );
  });

  it("getStatus: yapılandırılmamış hatası fırlatır", async () => {
    const p = new NoopSignatureProvider();
    await expect(p.getStatus("ref-1")).rejects.toBeInstanceOf(
      SignatureProviderNotConfiguredError,
    );
  });

  it("cancel: yapılandırılmamış hatası fırlatır", async () => {
    const p = new NoopSignatureProvider();
    await expect(p.cancel("ref-1", "müzakere yeniden açıldı")).rejects.toBeInstanceOf(
      SignatureProviderNotConfiguredError,
    );
  });

  it("downloadSignedDocument: imzalı nüsha UYDURMAZ, hata fırlatır", async () => {
    const p = new NoopSignatureProvider();
    await expect(p.downloadSignedDocument("ref-1")).rejects.toBeInstanceOf(
      SignatureProviderNotConfiguredError,
    );
  });

  it("hata kodu SAGLAYICI_YAPILANDIRILMAMIS'tır ve isNotConfiguredError ile tanınır", async () => {
    const p = new NoopSignatureProvider();
    const err = await p.getStatus("ref-1").catch((e: unknown) => e);
    expect(isNotConfiguredError(err)).toBe(true);
    expect((err as SignatureProviderNotConfiguredError).code).toBe(
      "SAGLAYICI_YAPILANDIRILMAMIS",
    );
    expect((err as Error).message).toContain(NOT_CONFIGURED_MESSAGE.slice(0, 30));
  });
});

describe("NoopSignatureProvider — healthCheck rapor döndürür, hata fırlatmaz", () => {
  it("configured=false, reachable tanımsız (hiçbir uca gidilmedi)", async () => {
    const health = await new NoopSignatureProvider().healthCheck();
    expect(health.configured).toBe(false);
    expect(health.providerKey).toBe("noop");
    expect(health.supportedMethods).toEqual([]);
    expect(health.message).toContain("Ayarlar → E-imza");
    expect(health.reachable).toBeUndefined();
  });

  it("kayıtlı olmayan bir anahtar istendiğinde mesaj o anahtarı anar", async () => {
    const health = await new NoopSignatureProvider({ provider: "nes-x" }).healthCheck();
    expect(health.configured).toBe(false);
    expect(health.message).toContain("nes-x");
    expect(health.message).toContain("kayıtlı değil");
  });
});

describe("NoopSignatureProvider — doğrulama sağlayıcı hatasından ÖNCE çalışır", () => {
  it("imzacı listesi boşsa doğrulama hatası verir (yapılandırma hatası değil)", async () => {
    const p = new NoopSignatureProvider();
    const err = await p.createRequest(doc, [], options).catch((e: unknown) => e);
    expect((err as { code: string }).code).toBe("IMZACI_DOGRULAMA");
  });

  it("belge içeriği yoksa doğrulama hatası verir", async () => {
    const p = new NoopSignatureProvider();
    const empty: SignatureDocument = { fileName: "a.pdf", mimeType: "application/pdf" };
    const err = await p.createRequest(empty, signers, options).catch((e: unknown) => e);
    expect((err as { code: string }).code).toBe("IMZACI_DOGRULAMA");
    expect((err as Error).message).toContain("içeriği bulunamadı");
  });
});
