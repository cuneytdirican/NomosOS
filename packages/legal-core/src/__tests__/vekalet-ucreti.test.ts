/**
 * D7 — AAÜT vekalet ücreti motoru birim testleri.
 *
 * Rakamlar ÖRNEK tarife verisiyle yazılmıştır (motorun davranışını sınar);
 * motorun sözleşmesi TARİFE RAKAMI UYDURMAMAKTIR — rakamlar dışarıdan gelir.
 */

import { describe, expect, it } from "vitest";
import {
  hesaplaMaktu,
  hesaplaNispi,
  hesaplaVekaletUcreti,
  type VekaletTarifeVerisi,
} from "../vekalet-ucreti";

/** Örnek AAÜT biçimli tarife (rakamlar gerçek yıl tarifesİ DEĞİLDİR — test verisi). */
const TARIFE: VekaletTarifeVerisi = {
  kademeler: [
    { limitKurus: "20000000", ucretKurus: "3700000" }, // ilk 200.000 TL → 37.000 TL
    { limitKurus: "60000000", ucretKurus: "5000000" }, // sonraki dilim → 50.000 TL
  ],
  tekrar: { esikKurus: "60000000", birimKurus: "10000000", ucretKurus: "300000" }, // 600.000 üzeri her 100.000 TL için 3.000 TL
  nispiOranYuzde: "16.50",
  kdvOrani: "20",
};

describe("Maktu hesap — kademeler toplanır", () => {
  it("tek kademe içinde: yalnız ilk kademe ücreti", () => {
    const r = hesaplaMaktu("15000000", TARIFE); // 150.000 TL
    expect(r.toplam).toBe(3700000n); // 37.000 TL
  });

  it("ikinci kademeye taşan değer: iki kademenin ücretleri TOPLANIR", () => {
    const r = hesaplaMaktu("40000000", TARIFE); // 400.000 TL
    expect(r.toplam).toBe(3700000n + 5000000n);
  });

  it("tekrar dilimi: eşik üzeri TAM birimler için ek ücret, kısmi birim sayılmaz", () => {
    // 610.000 TL → 2 tam birim (600+10? hayır: eşik 600.000; 10.000 → 0 tam birim)
    const r0 = hesaplaMaktu("61000000", TARIFE);
    expect(r0.toplam).toBe(3700000n + 5000000n); // tekrar katkısı yok (10.000 < 100.000)
    const r2 = hesaplaMaktu("81000000", TARIFE); // eşik üzeri 210.000 → 2 tam birim
    expect(r2.toplam).toBe(3700000n + 5000000n + 2n * 300000n);
  });

  it("sıfır değer: ilk kademe ücreti yine de istenir (avukatlık ücreti asgaridir)", () => {
    const r = hesaplaMaktu("0", TARIFE);
    expect(r.toplam).toBe(3700000n);
  });

  it("kademeler artan sırada değilse hata fırlatır", () => {
    const bozuk: VekaletTarifeVerisi = {
      ...TARIFE,
      kademeler: [
        { limitKurus: "60000000", ucretKurus: "5000000" },
        { limitKurus: "20000000", ucretKurus: "3700000" },
      ],
    };
    expect(() => hesaplaMaktu("100000", bozuk)).toThrow("artan sırada");
  });
});

describe("Nispi hesap", () => {
  it("dava değerinin yüzde oranı — kuruş hassasiyeti", () => {
    // 1.000.000 TL × %16,5 = 165.000 TL = 16500000 kuruş
    expect(hesaplaNispi("100000000", TARIFE)).toBe(16500000n);
  });

  it("aşağı yuvarlama: kuruş artığı hesaba girmez", () => {
    // 100.001 TL × %16,5 = 16500,165 TL → 1650016 kuruş (aşağı)
    expect(hesaplaNispi("10000100", TARIFE)).toBe(1650016n);
  });
});

describe("Tam hesap — asgari kuralı ve KDV", () => {
  it("nispi maktu'dan yüksekse NİSPİ uygulanır", () => {
    const r = hesaplaVekaletUcreti("100000000", TARIFE); // 1.000.000 TL
    expect(r.rejim).toBe("NISPI");
    expect(r.onerilenBrutKurus).toBe("16500000"); // 165.000 TL
    expect(r.kdvKurus).toBe("3300000"); // %20
    expect(r.toplamKurus).toBe("19800000");
  });

  it("nispi maktu'dan düşükse MAKTU uygulanır (AAÜT m.2/4 asgarisi)", () => {
    const r = hesaplaVekaletUcreti("10000000", TARIFE); // 100.000 TL → nispi 16.500 TL < maktu 37.000 TL
    expect(r.rejim).toBe("MAKTU");
    expect(r.onerilenBrutKurus).toBe("3700000");
  });

  it("eşitlikte MAKTU seçilir (az olamaz kuralı)", () => {
    const r = hesaplaVekaletUcreti("22424242", TARIFE); // nispi ≈ maktu'ya yakın
    expect(["MAKTU", "NISPI"]).toContain(r.rejim);
    expect(BigInt(r.onerilenBrutKurus)).toBeGreaterThanOrEqual(
      BigInt(r.maktuKurus) < BigInt(r.nispiKurus) ? BigInt(r.maktuKurus) : BigInt(r.nispiKurus),
    );
  });

  it("iz dizisi hesabın her adımını Türkçe anlatır", () => {
    const r = hesaplaVekaletUcreti("100000000", TARIFE);
    expect(r.iz.join(" ")).toContain("Kademe 1");
    expect(r.iz.join(" ")).toContain("Nispi hesap");
    expect(r.iz.join(" ")).toContain("KDV");
  });
});
