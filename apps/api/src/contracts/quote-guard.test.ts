/**
 * ALINTI DOĞRULAMA testleri — "uydurma yasak" ilkesinin güvencesi.
 *
 * Kabul kriteri (docs/moduller/20, 3): "CONTRACT_REVIEW çıktısındaki her riskli
 * madde alıntısı, versiyon metninde birebir bulunur; bulunamayan alıntı elenir."
 */

import { describe, expect, it } from "vitest";
import { checkMissingClaim } from "./missing-clause-topics";
import {
  MIN_QUOTE_LENGTH,
  filterByVerbatimQuote,
  normalizeForQuoteMatch,
  quoteAppearsIn,
} from "./quote-guard";

const CONTRACT = `Madde 6 — Bedel: Hizmet bedeli aylık 150.000 TL + KDV olup her ayın 5'inde ödenir.
Madde 7 — Cezai Şart: Hizmet alanın sözleşmeyi süresinden önce sona erdirmesi hâlinde,
hizmet verene sözleşmenin kalan süresine ilişkin bedelin tamamı cezai şart olarak ödenir.
Madde 9 — Gizlilik: Taraflar, sözleşme kapsamında öğrendikleri gizli bilgileri üçüncü
kişilerle paylaşmayacaklarını kabul eder.`;

describe("quoteAppearsIn — birebir alıntı", () => {
  it("metinde geçen alıntıyı bulur", () => {
    expect(quoteAppearsIn("bedelin tamamı cezai şart olarak ödenir", CONTRACT)).toBe(true);
  });

  it("modelin uydurduğu cümleyi bulamaz", () => {
    expect(
      quoteAppearsIn("cezai şart üç aylık bedelle sınırlandırılmıştır", CONTRACT),
    ).toBe(false);
  });

  it("satır sonu ve çift boşluk farkını yok sayar", () => {
    const wrapped = "sözleşmeyi süresinden önce sona erdirmesi   hâlinde,\nhizmet verene";
    expect(quoteAppearsIn(wrapped, CONTRACT)).toBe(true);
  });

  it("tipografik tırnak ve tire çeşitlerini düzleştirir", () => {
    expect(quoteAppearsIn("Madde 6 — Bedel", CONTRACT)).toBe(true);
    expect(quoteAppearsIn("Madde 6 - Bedel", CONTRACT)).toBe(true);
  });

  it("kelime sırası değişirse eşleşmez (özetleme kabul edilmez)", () => {
    expect(quoteAppearsIn("cezai şart olarak ödenir bedelin tamamı", CONTRACT)).toBe(false);
  });

  it(`${MIN_QUOTE_LENGTH} karakterden kısa alıntı kaynak sayılmaz`, () => {
    expect(quoteAppearsIn("Bedel", CONTRACT)).toBe(false);
  });

  it("normalizeForQuoteMatch Türkçe yerelde küçültür ve baş/son noktalamayı kırpar", () => {
    expect(normalizeForQuoteMatch('  "Gizlilik:"  ')).toBe("gizlilik");
  });
});

describe("filterByVerbatimQuote — bulgu eleme", () => {
  const items = [
    { title: "Sınırsız cezai şart", sourceQuote: "bedelin tamamı cezai şart olarak ödenir" },
    { title: "Uydurma madde", sourceQuote: "Madde 14 — Tahkim: uyuşmazlıklar ICC tahkiminde çözülür" },
    { title: "Alıntısız bulgu", sourceQuote: undefined },
    { title: "Çok kısa alıntı", sourceQuote: "Bedel" },
  ];

  it("yalnızca metinde doğrulanan bulguyu tutar", () => {
    const result = filterByVerbatimQuote(
      items,
      CONTRACT,
      (i) => i.sourceQuote,
      (i) => i.title,
    );
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe("Sınırsız cezai şart");
  });

  it("elenen bulguları gerekçesiyle raporlar (sessiz eleme yok)", () => {
    const result = filterByVerbatimQuote(
      items,
      CONTRACT,
      (i) => i.sourceQuote,
      (i) => i.title,
    );
    expect(result.dropped).toHaveLength(3);
    const reasons = result.dropped.map((d) => d.reason);
    expect(reasons).toContain("ALINTI_METINDE_BULUNAMADI");
    expect(reasons).toContain("ALINTI_YOK");
    expect(reasons).toContain("ALINTI_COK_KISA");
    // Elenen bulgunun etiketi ve alıntısı kullanıcıya gösterilebilir olmalı.
    const fabricated = result.dropped.find((d) => d.reason === "ALINTI_METINDE_BULUNAMADI");
    expect(fabricated?.label).toBe("Uydurma madde");
    expect(fabricated?.quote).toContain("Madde 14");
  });

  it("boş listede hata vermez", () => {
    const result = filterByVerbatimQuote([], CONTRACT, () => undefined, () => "-");
    expect(result.kept).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe("checkMissingClaim — eksik hüküm iddiasının deterministik denetimi", () => {
  it("metinde geçen konuyu 'eksik' saymaz", () => {
    const check = checkMissingClaim("gizlilik", CONTRACT);
    expect(check.presentInText).toBe(true);
    expect(check.topicKey).toBe("GIZLILIK");
    expect(check.matchedKeyword).toBeTruthy();
  });

  it("metinde gerçekten olmayan konuyu eksik bırakır", () => {
    const check = checkMissingClaim("mücbir sebep", CONTRACT);
    expect(check.presentInText).toBe(false);
    expect(check.topicKey).toBe("MUCBIR_SEBEP");
  });

  it("katalogda olmayan konuda eleme yapmaz (fail-open)", () => {
    const check = checkMissingClaim("uzay hukuku sigortası", CONTRACT);
    expect(check.presentInText).toBe(false);
    expect(check.topicKey).toBeNull();
  });

  it("konu adının yazım farkını tolere eder", () => {
    expect(checkMissingClaim("Gizlilik hükmü", CONTRACT).presentInText).toBe(true);
    expect(checkMissingClaim("KVKK", CONTRACT).presentInText).toBe(false);
  });
});
