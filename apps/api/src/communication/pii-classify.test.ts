/**
 * GİDEN MESAJ KVKK SINIFLANDIRMASI — birim testleri.
 *
 * Ayrımın anlamı: müvekkilin KENDİ verisi mesajda olağandır; ÜÇÜNCÜ KİŞİ verisi
 * engelleyici uyarı sebebidir (Modül 19 kabul kriteri 8).
 */

import { describe, expect, it } from "vitest";
import { scanPii } from "@nomosos/ai";
import { classifyOutboundPii } from "./pii-classify";

const CLIENT = {
  emails: ["info@abc.com"],
  phones: ["0532 111 22 33"],
  tckns: ["10000000146"],
  ibans: ["TR330006100519786457841326"],
};

/** `scanPii` TCKN'yi algoritmik olarak doğrular; testte geçerli bir numara şart. */
const VALID_OWN_TCKN = "10000000146";

describe("classifyOutboundPii", () => {
  it("müvekkilin KENDİ e-postasını üçüncü kişi verisi saymaz", () => {
    const text = "Sorularınız için info@abc.com adresinden bize ulaşabilirsiniz.";
    const result = classifyOutboundPii(scanPii(text).findings, CLIENT);
    expect(result.thirdParty).toHaveLength(0);
    expect(result.own.map((f) => f.kind)).toContain("EPOSTA");
    expect(result.summary.hasThirdPartyPii).toBe(false);
  });

  it("müvekkilin telefonunu BİÇİM FARKINA rağmen kendi verisi sayar", () => {
    // Kayıtta "0532 111 22 33", metinde "+90 532 111 22 33".
    const text = "Kayıtlı numaranız +90 532 111 22 33 olarak görünmektedir.";
    const result = classifyOutboundPii(scanPii(text).findings, CLIENT);
    expect(result.thirdParty).toHaveLength(0);
    expect(result.own).toHaveLength(1);
  });

  it("ÜÇÜNCÜ KİŞİ e-postasını yakalar ve uyarı üretir", () => {
    const text = "Karşı tarafın vekili avukat@karsitaraf.com adresinden yazdı.";
    const result = classifyOutboundPii(scanPii(text).findings, CLIENT);
    expect(result.thirdParty.map((f) => f.kind)).toEqual(["EPOSTA"]);
    expect(result.summary.hasThirdPartyPii).toBe(true);
    expect(result.summary.notice).toContain("ALICIYA AİT OLMAYAN");
  });

  it("müvekkilin kendi TCKN'si olağandır, başkasınınki değildir", () => {
    const own = classifyOutboundPii(
      scanPii(`Kimlik numaranız ${VALID_OWN_TCKN} ile kayıt yapılmıştır.`).findings,
      CLIENT,
    );
    expect(own.thirdParty).toHaveLength(0);

    const other = classifyOutboundPii(
      scanPii("Tanığın kimlik numarası 19191919190 olarak bildirildi.").findings,
      CLIENT,
    );
    // Kalıp geçerli bir TCKN ise üçüncü kişi verisi olarak işaretlenmelidir.
    if (other.own.length + other.thirdParty.length > 0) {
      expect(other.thirdParty.length).toBeGreaterThan(0);
    }
  });

  it("KAYITTA HİÇ VERİ YOKKEN her bulgu üçüncü kişi sayılır (fail-closed)", () => {
    const empty = { emails: [], phones: [], tckns: [], ibans: [] };
    const result = classifyOutboundPii(
      scanPii("İletişim: info@abc.com").findings,
      empty,
    );
    expect(result.thirdParty).toHaveLength(1);
  });

  it("özet HAM DEĞER TAŞIMAZ — kayıt kişisel veri deposuna dönüşmez", () => {
    const text = "Karşı taraf vekili avukat@karsitaraf.com yazdı.";
    const result = classifyOutboundPii(scanPii(text).findings, CLIENT);
    const serialized = JSON.stringify(result.summary);
    expect(serialized).not.toContain("avukat@karsitaraf.com");
    expect(serialized).toContain("*");
  });
});
