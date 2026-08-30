/**
 * Güvenlik/KVKK sınır testleri.
 *
 * Bu testler docs/05 § 7'deki iki taahhüdün KODLA güvence altına alındığını doğrular:
 *  1. Eklenti üçüncü tarafa hiçbir veri göndermez (çerezli indirme yalnız UYAP'a).
 *  2. Evrak baytları yalnız büronun kendi deposuna yüklenir (ön-imzalı adres doğrulanır).
 */

import { describe, expect, it } from "vitest";

import { assertAllowedUploadUrl } from "../src/lib/http";
import { isAllowedUyapDownloadUrl } from "../src/lib/udf";
import { ApiError } from "../src/lib/errors";
import { DEFAULT_SETTINGS, MAX_DOCUMENT_BYTES_LIMIT, normalizeSettings } from "../src/lib/settings";

describe("UYAP indirme adresi beyaz listesi", () => {
  it("UYAP alan adını kabul eder", () => {
    expect(
      isAllowedUyapDownloadUrl("https://avukat.uyap.gov.tr/evrak/indir.jsf?evrakId=1"),
    ).toBe(true);
    expect(isAllowedUyapDownloadUrl("https://avukatbeta.uyap.gov.tr/x")).toBe(true);
  });

  it("üçüncü taraf adrese çerezli istek atmaz", () => {
    expect(isAllowedUyapDownloadUrl("https://kotu.example.com/evrak-indir")).toBe(false);
    // Sayfa kaynağı verilse bile farklı host reddedilir.
    expect(
      isAllowedUyapDownloadUrl("https://kotu.example.com/indir", "https://avukat.uyap.gov.tr"),
    ).toBe(false);
  });

  it("https olmayan adresi reddeder", () => {
    expect(isAllowedUyapDownloadUrl("http://avukat.uyap.gov.tr/evrak")).toBe(false);
    expect(isAllowedUyapDownloadUrl("javascript:alert(1)")).toBe(false);
  });

  it("alan adı taklidini reddeder", () => {
    expect(isAllowedUyapDownloadUrl("https://uyap.gov.tr.kotu.example.com/x")).toBe(false);
    expect(isAllowedUyapDownloadUrl("https://sahteuyap.gov.tr/x")).toBe(false);
  });
});

describe("ön-imzalı yükleme adresi doğrulama", () => {
  const api = "https://app.nomosos.com";

  it("API ana bilgisayarına yüklemeye izin verir", () => {
    expect(assertAllowedUploadUrl(`${api}/upload/abc`, api).hostname).toBe("app.nomosos.com");
  });

  it("eşleştirmede bildirilen depo hostuna izin verir", () => {
    const url = assertAllowedUploadUrl("https://depo.nomosos.com/put/abc", api, ["depo.nomosos.com"]);
    expect(url.hostname).toBe("depo.nomosos.com");
  });

  it("bildirilmemiş hosta bayt göndermez", () => {
    expect(() => assertAllowedUploadUrl("https://baska.example.com/put", api, ["depo.nomosos.com"]))
      .toThrowError(ApiError);
  });

  it("https olmayan adrese bayt göndermez", () => {
    expect(() => assertAllowedUploadUrl("http://app.nomosos.com/upload", api)).toThrowError(ApiError);
  });

  it("yerel geliştirmede http localhost'a izin verir", () => {
    const url = assertAllowedUploadUrl("http://localhost:3001/upload", "http://localhost:3001");
    expect(url.hostname).toBe("localhost");
  });
});

describe("evrak boyut sınırı", () => {
  it("ayarlanabilir sınır 50 MB'ı aşamaz", () => {
    const settings = normalizeSettings({ maxDocumentBytes: 500 * 1024 * 1024 }, DEFAULT_SETTINGS);
    expect(settings.maxDocumentBytes).toBe(MAX_DOCUMENT_BYTES_LIMIT);
  });
});
