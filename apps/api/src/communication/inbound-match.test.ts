/**
 * GELEN MESAJ EŞLEŞTİRMESİ — birim testleri.
 *
 * Bu testlerin asıl konusu tek bir cümledir: DETERMİNİSTİK KATMAN AI'DAN ÖNCE
 * GELİR VE ÇÖZDÜĞÜNDE AI'YA HİÇ GİDİLMEZ. `matched === true` dönen her senaryo,
 * `InboundService`'te AI çağrısının bulunduğu `if (!deterministic.matched)`
 * dalını kapatır.
 */

import { describe, expect, it } from "vitest";
import {
  AI_MATCH_PRESELECT_THRESHOLD,
  classifyContactRef,
  decideAiMatch,
  decideDeterministicMatch,
  extractFileNumbers,
  normalizeEmail,
  normalizeFileNumber,
  normalizePhone,
  quoteAppearsIn,
} from "./inbound-match";

describe("normalizePhone", () => {
  it("ülke kodu ve biçim farklarını tek anahtara indirger", () => {
    const expected = "5321112233";
    expect(normalizePhone("+90 532 111 22 33")).toBe(expected);
    expect(normalizePhone("0532 111 22 33")).toBe(expected);
    expect(normalizePhone("532-111-22-33")).toBe(expected);
    expect(normalizePhone("0090 532 111 22 33")).toBe(expected);
  });

  it("10 haneye inmeyen girdiyi reddeder — yanlış eşleşme yerine eşleşmeme", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("kırpar ve küçük harfe indirir", () => {
    expect(normalizeEmail("  Info@ABC.com.TR ")).toBe("info@abc.com.tr");
  });

  it("nokta/etiket sadeleştirmesi YAPMAZ — sağlayıcıya göre değişir", () => {
    expect(normalizeEmail("a.b@ornek.com")).not.toBe(normalizeEmail("ab@ornek.com"));
  });

  it("geçersiz adresi reddeder", () => {
    expect(normalizeEmail("düz metin")).toBeNull();
  });
});

describe("classifyContactRef", () => {
  it("e-posta ve telefonu ayırt eder", () => {
    expect(classifyContactRef("info@abc.com").kind).toBe("EPOSTA");
    expect(classifyContactRef("+905321112233").kind).toBe("TELEFON");
    expect(classifyContactRef("bilinmeyen").kind).toBe("BILINMIYOR");
  });
});

describe("extractFileNumbers / normalizeFileNumber", () => {
  it("esas numarasını metinden çıkarır", () => {
    expect(extractFileNumbers("2026/145 sayılı dosyada gelişme var mı?")).toEqual(["2026/145"]);
    expect(extractFileNumbers("E. 2025 / 341 ve 2026/88")).toEqual(["2025/341", "2026/88"]);
  });

  it("baştaki sıfırları normalize eder — 2026/0145 = 2026/145", () => {
    expect(extractFileNumbers("2026/0145")).toEqual(["2026/145"]);
    expect(normalizeFileNumber("2026 / 0145")).toBe("2026/145");
  });

  it("tarih parçalarını ve kesirleri esas numarası SANMAZ", () => {
    expect(extractFileNumbers("14/10 tarihinde ve 1/2 oranında")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * Deterministik karar
 * -------------------------------------------------------------------------- */

const CLIENTS = [
  { clientId: "c1", emails: ["info@abc.com"], phones: ["5321112233"] },
  { clientId: "c2", emails: ["mehmet@ornek.com"], phones: ["5335554433"] },
];

const CASES = [
  { caseId: "k1", clientId: "c1", fileNumber: "2026/145" },
  { caseId: "k2", clientId: "c1", fileNumber: "2026/88" },
  { caseId: "k3", clientId: "c2", fileNumber: "2025/341" },
];

describe("decideDeterministicMatch", () => {
  it("e-posta + esas no birlikte varsa DOSYA KESİNLEŞİR ve AI'ya gidilmez", () => {
    const result = decideDeterministicMatch({
      fromRef: "info@abc.com",
      text: "2026/145 sayılı dosyada duruşma ne zaman?",
      clients: CLIENTS,
      cases: CASES,
    });
    expect(result.matched).toBe(true);
    expect(result.clientId).toBe("c1");
    expect(result.caseId).toBe("k1");
    // Deterministik eşleşme bir tahmin değildir: güven tamdır.
    expect(result.confidence).toBe(1);
  });

  it("farklı biçimde yazılmış telefonla da eşleşir", () => {
    const result = decideDeterministicMatch({
      fromRef: "+90 532 111 22 33",
      text: "2026/88 dosyasıyla ilgili",
      clients: CLIENTS,
      cases: CASES,
    });
    expect(result.matched).toBe(true);
    expect(result.caseId).toBe("k2");
  });

  it("yalnız gönderen eşleşirse müvekkil bağlanır ama DOSYA BAĞLANMAZ", () => {
    const result = decideDeterministicMatch({
      fromRef: "info@abc.com",
      text: "Merhaba, bir gelişme var mı?",
      clients: CLIENTS,
      cases: CASES,
    });
    expect(result.clientId).toBe("c1");
    expect(result.caseId).toBeNull();
    // matched=false → AI önerisi istenebilir (müvekkilin iki dosyası var).
    expect(result.matched).toBe(false);
  });

  /**
   * ═══ KESİN EŞLEŞMENİN İKİ AYAĞI ═══
   *
   * Gönderen tanınmıyorken metindeki esas numarası bir İPUCUDUR, kayıt
   * eşleşmesi değildir. `fromRef` doğrulanmamış bir alandır (webhook gövdesi,
   * e-posta başlığı, elle giriş): karşı taraf vekilinin ya da spoof edilmiş bir
   * adresin "2026/145 dosyasında…" diyen mesajı, insan onayı görmeden
   * müvekkilin dosyasına düşemez.
   */
  it("gönderen tanınmıyorsa esas no TEK BAŞINA kesin eşleşme sayılmaz", () => {
    const result = decideDeterministicMatch({
      fromRef: "yeni-adres@baska.com",
      text: "2025/341 sayılı dosya hakkında",
      clients: CLIENTS,
      cases: CASES,
    });
    // Dosya ve müvekkil ÖNERİ olarak türetilir…
    expect(result.caseId).toBe("k3");
    expect(result.clientId).toBe("c2");
    // …ama kesin eşleşme DEĞİLDİR: insan onayı bekler.
    expect(result.senderResolved).toBe(false);
    expect(result.matched).toBe(false);
    expect(result.reason).toContain("gönderen kimliği");
  });

  it("gönderen kimliği DIŞARIDAN doğrulanmışsa (portal oturumu) eşleşme kesindir", () => {
    const result = decideDeterministicMatch({
      fromRef: "yeni-adres@baska.com",
      text: "2025/341 sayılı dosya hakkında",
      clients: CLIENTS,
      cases: CASES,
      senderVerified: true,
    });
    expect(result.senderResolved).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.caseId).toBe("k3");
  });

  it("gönderen kayıtla eşleşiyorsa esas no ile eşleşme kesindir", () => {
    const result = decideDeterministicMatch({
      fromRef: "info@abc.com",
      text: "2026/145 dosyası hakkında",
      clients: CLIENTS,
      cases: CASES,
    });
    expect(result.senderResolved).toBe(true);
    expect(result.matched).toBe(true);
  });

  it("BELİRSİZLİKTE EŞLEŞTİRMEZ: aynı numara iki müvekkilde kayıtlıysa", () => {
    const ambiguous = [
      { clientId: "c1", emails: [], phones: ["5321112233"] },
      { clientId: "c9", emails: [], phones: ["5321112233"] },
    ];
    const result = decideDeterministicMatch({
      fromRef: "0532 111 22 33",
      text: "merhaba",
      clients: ambiguous,
      cases: CASES,
    });
    expect(result.clientId).toBeNull();
    expect(result.reason).toContain("belirsizlik");
  });

  it("BELİRSİZLİKTE EŞLEŞTİRMEZ: aynı esas no iki dosyada geçiyorsa", () => {
    const duplicated = [
      { caseId: "k1", clientId: "cX", fileNumber: "2026/145" },
      { caseId: "k2", clientId: "cY", fileNumber: "2026/145" },
    ];
    const result = decideDeterministicMatch({
      fromRef: "bilinmeyen@x.com",
      text: "2026/145",
      clients: [],
      cases: duplicated,
    });
    expect(result.matched).toBe(false);
    expect(result.caseId).toBeNull();
  });

  it("müvekkil çözüldüyse dosya araması ONUN dosyalarıyla sınırlanır", () => {
    // c2'nin dosyası değil ama metinde c1'in esas numarası geçiyor:
    // kapsam c2 ile sınırlı olduğundan eşleşme OLMAZ.
    const result = decideDeterministicMatch({
      fromRef: "mehmet@ornek.com",
      text: "2026/145 dosyası hakkında",
      clients: CLIENTS,
      cases: CASES,
    });
    expect(result.clientId).toBe("c2");
    expect(result.caseId).toBeNull();
    expect(result.matched).toBe(false);
  });

  it("metinde esas no yoksa dosya bağlanmaz", () => {
    const result = decideDeterministicMatch({
      fromRef: "info@abc.com",
      text: "Teşekkürler",
      clients: CLIENTS,
      cases: CASES,
    });
    expect(result.matched).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * AI önerisinin kabul kapısı
 * -------------------------------------------------------------------------- */

describe("quoteAppearsIn", () => {
  it("boşluk ve büyük-küçük harf farkını yok sayar", () => {
    expect(quoteAppearsIn("Kiracının   tahliyesi konusunda", "kiracının tahliyesi")).toBe(true);
  });

  it("metinde olmayan alıntıyı reddeder", () => {
    expect(quoteAppearsIn("merhaba", "işe iade davası")).toBe(false);
  });

  it("boş/çok kısa alıntıyı kaynak saymaz", () => {
    expect(quoteAppearsIn("merhaba", "")).toBe(false);
    expect(quoteAppearsIn("merhaba", "ab")).toBe(false);
  });
});

describe("decideAiMatch", () => {
  const refIndex = new Map([
    ["dosya-1", "k1"],
    ["dosya-2", "k2"],
  ]);
  const messageText = "Kiracının tahliyesi konusunda icra dairesinden bir evrak geldi.";

  it("kaynaklı ve yüksek güvenli öneriyi kabul eder ve ÖN SEÇİLİ işaretler", () => {
    const decision = decideAiMatch({
      caseRef: "dosya-2",
      confidence: 0.92,
      reason: "İcra/tahliye dosyası",
      sourceQuote: "kiracının tahliyesi konusunda",
      refIndex,
      messageText,
    });
    expect(decision.caseId).toBe("k2");
    expect(decision.preselect).toBe(true);
    expect(decision.confidence).toBeGreaterThanOrEqual(AI_MATCH_PRESELECT_THRESHOLD);
  });

  it("UYDURMA REFERANSI REDDEDER — modele verilmeyen dosya kaydedilmez", () => {
    const decision = decideAiMatch({
      caseRef: "dosya-99",
      confidence: 0.99,
      reason: "eminim",
      sourceQuote: "kiracının tahliyesi",
      refIndex,
      messageText,
    });
    expect(decision.caseId).toBeNull();
    expect(decision.rejectedBecause).toContain("verilmeyen");
  });

  it("KAYNAKSIZ ÖNERİYİ REDDEDER — alıntı mesajda geçmiyorsa", () => {
    const decision = decideAiMatch({
      caseRef: "dosya-1",
      confidence: 0.95,
      reason: "bence bu",
      sourceQuote: "işe iade davanızla ilgili",
      refIndex,
      messageText,
    });
    expect(decision.caseId).toBeNull();
    expect(decision.rejectedBecause).toContain("kaynaksız");
  });

  it("0,50 altı güveni GÖSTERMEZ", () => {
    const decision = decideAiMatch({
      caseRef: "dosya-1",
      confidence: 0.3,
      reason: "belki",
      sourceQuote: "icra dairesinden bir evrak",
      refIndex,
      messageText,
    });
    expect(decision.caseId).toBeNull();
    expect(decision.rejectedBecause).toContain("eşiğin");
  });

  it("0,50–0,80 arası öneriyi kaydeder ama ÖN SEÇİLİ getirmez", () => {
    const decision = decideAiMatch({
      caseRef: "dosya-1",
      confidence: 0.65,
      reason: "olabilir",
      sourceQuote: "icra dairesinden bir evrak geldi",
      refIndex,
      messageText,
    });
    expect(decision.caseId).toBe("k1");
    expect(decision.preselect).toBe(false);
  });

  it("model 'eşleşme yok' derse öneri üretmez", () => {
    const decision = decideAiMatch({
      caseRef: null,
      confidence: 0,
      reason: "ipucu yok",
      refIndex,
      messageText,
    });
    expect(decision.caseId).toBeNull();
  });
});
