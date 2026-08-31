import { describe, expect, it } from "vitest";
import { resolveTrustedProxy } from "./trusted-proxy";

/**
 * REGRESYON — denetim bulgusu Ö-08.
 *
 * Testin koruduğu davranış tek cümleyle: "yanlış ya da eksik vekil ayarı
 * SESSİZCE 0'a düşmez". Eski kod `Number(undefined ?? 0)` ve `Number("1a")`
 * için aynı sonucu (0) veriyordu; üretimde bu, hesap kilidini, oran sınırını
 * ve denetim izindeki IP alanını birlikte çürüten sessiz bir yanlış
 * yapılandırmaydı.
 */
describe("resolveTrustedProxy (Ö-08)", () => {
  it("geliştirmede tanımsız değer 0'a düşer ama AÇIKÇA işaretlenir", () => {
    const d = resolveTrustedProxy({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(d.hops).toBe(0);
    expect(d.explicit).toBe(false);
    expect(d.summary).toContain("tanımsız");
  });

  it("ÜRETİMDE tanımsız değer AÇILIŞI DURDURUR", () => {
    expect(() => resolveTrustedProxy({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /TRUSTED_PROXY_HOPS tanımlı değil/,
    );
  });

  it("üretimde AÇIKÇA 0 yazmak geçerli bir cevaptır (vekil yok)", () => {
    const d = resolveTrustedProxy({
      NODE_ENV: "production",
      TRUSTED_PROXY_HOPS: "0",
    } as NodeJS.ProcessEnv);
    expect(d.hops).toBe(0);
    expect(d.explicit).toBe(true);
  });

  it("vekil arkasında hop sayısı olduğu gibi kullanılır", () => {
    const d = resolveTrustedProxy({
      NODE_ENV: "production",
      TRUSTED_PROXY_HOPS: "2",
    } as NodeJS.ProcessEnv);
    expect(d.hops).toBe(2);
    expect(d.summary).toContain("sondan 2");
  });

  it("bozuk değer 0'a DÜŞMEZ, fırlatır (yazım hatası güvenlik ayarını kapatamaz)", () => {
    for (const raw of ["1a", "-1", "11", "1.5", "çok", "true"]) {
      expect(() =>
        resolveTrustedProxy({ TRUSTED_PROXY_HOPS: raw } as NodeJS.ProcessEnv),
      ).toThrow(/geçersiz/i);
    }
  });

  it("boş dizge tanımsız sayılır — üretimde yine durur", () => {
    expect(() =>
      resolveTrustedProxy({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "   " } as NodeJS.ProcessEnv),
    ).toThrow(/tanımlı değil/);
  });
});
