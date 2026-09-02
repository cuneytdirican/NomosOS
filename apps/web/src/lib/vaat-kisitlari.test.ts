/**
 * Ö-24/Ö-25/Ö-26 REGRESYON TESTİ — backlog vaatlerinin pazarlama ve arayüz
 * metninden çıkarılması (üretim öncesi kapatıcı 6, otonom ürün kararı).
 *
 * KARAR: OCR yok, mevzuat atıf doğrulaması yok, UYAP arka ucu yok — bu üçü
 * "yazılmamış özellik"tir ve pazarlama/arayüz metni onları VARMIŞ gibi
 * gösteremez. Bu test yasak ifadeleri tarar; biri geri gelirse kırmızıya döner.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf-8");

const CONTENT = read("src", "components", "marketing", "content.ts");
const DOCUMENTS_TAB = read("src", "components", "documents-tab.tsx");
/** vitest apps/web içinde çalışır — iki üst dizin depo köküdür. */
const MARKETING_DOC = read("..", "..", "docs", "08-tanitim-sitesi-icerik.md");

/** Yorum satırları ayıklanır (kural gerekçeleri metriği paralamamalı). */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

describe("Ö-26: UYAP çalışan özellik gibi sunulamaz", () => {
  it("güven şeridinde 'UYAP entegrasyonu' çipi yok (içtihat teyidi çipi var)", () => {
    expect(codeOnly(CONTENT)).not.toMatch(/"UYAP entegrasyonu"/);
  });

  it("UYAP bölümü geliştirme aşaması olarak işaretli", () => {
    expect(codeOnly(CONTENT)).toContain("GELİŞTİRME AŞAMASINDA");
    expect(codeOnly(CONTENT)).toContain("geliştirme aşamasındadır");
  });

  it("'şu an aktarılır' şimdiki zaman vaadi kalktı; mockup 'Aktarıldı' demiyor", () => {
    expect(codeOnly(CONTENT)).not.toContain("Aktarıldı");
    expect(codeOnly(CONTENT)).not.toContain("UYAP ekranını sizin için");
    expect(codeOnly(CONTENT)).toContain("Hedef akış");
  });

  it("modül listesinde UYAP geliştirme aşaması etiketi taşıyor", () => {
    expect(codeOnly(CONTENT)).toContain("UYAP Köprüsü (geliştirme aşamasında)");
  });

  it("kaynak doküman da aynı kısıtı taşıyor (birebir kuralı)", () => {
    expect(MARKETING_DOC).toContain("GELİŞTİRME AŞAMASINDA");
    expect(MARKETING_DOC).not.toContain("ekranını sizin için");
  });

  it("yol haritası Faz 2'yi UYAP arka ucu olmadan işaretliyor", () => {
    const roadmap = read("..", "..", "docs", "06-yol-haritasi.md");
    expect(roadmap).toContain("ARKA UCU yazılmadı");
  });
});

describe("Ö-25: atıf doğrulama vaadi yalnız İÇTİHAT için", () => {
  it("nirselsiz 'her atıf ... doğrulanır' ifadesi yok — daima içtihat nitelemesiyle", () => {
    expect(codeOnly(CONTENT)).not.toMatch(/"[^"]*her atıf[^"]*doğrulanır/);
    expect(codeOnly(CONTENT)).not.toContain("atıf doğrulama ve dosya");
  });

  it("halüsinasyon şeridi mevzuat ayrımını açıkça yazıyor", () => {
    expect(codeOnly(CONTENT)).toContain("Mevzuat atıfları tanınır ancak doğrulanmaz");
  });

  it("kredi SSS'i 'içtihat atıf teyidi' diyor", () => {
    expect(codeOnly(CONTENT)).toContain("içtihat atıf teyidi");
  });

  it("uygulama içi kullanım sayfası da niteliyor", () => {
    const page = read(
      "src", "app", "app", "ayarlar", "ai-kullanim", "page.tsx",
    );
    expect(codeOnly(page)).toContain("içtihat atıf teyidi");
    expect(codeOnly(page)).not.toContain("atıf doğrulama ve RAG");
  });
});

describe("Ö-24: OCR yok — metin katmanı kısıtı görünür", () => {
  it("yükleme ekranı 'metin katmanı olan' kısıtını yazıyor", () => {
    expect(codeOnly(DOCUMENTS_TAB)).toContain("metin katmanı olan");
    expect(codeOnly(DOCUMENTS_TAB)).toContain("OCR henüz yok");
  });

  it("yükleme ipucu taranmayan biçimi vaat etmiyor ('e-posta dosyaları' yok)", () => {
    expect(codeOnly(DOCUMENTS_TAB)).not.toContain("e-posta dosyaları");
  });

  it("pazarlama hattı 'metin katmanı olan belgelerde' nitelemesi taşıyor", () => {
    expect(codeOnly(CONTENT)).toContain("metin katmanı olan belgelerde");
  });
});

/* ------------------------------------------------------------------ *
 * F2 YENİ ÖZELLİKLERİN PAZARLAMA KARŞILIĞI — eklenen her özellik
 * tanıtım sitesinde anlatılmalı (E1/E2/E6/A1/B2 karşılıkları).
 * ------------------------------------------------------------------ */

describe("F2 özellikleri tanıtım sitesinde anlatılıyor", () => {
  it("Delil Matrisi kartı: bağ yönü + KK6 tutarlılık kuralı", () => {
    expect(codeOnly(CONTENT)).toContain('"Delil Matrisi"');
    expect(codeOnly(CONTENT)).toContain("destekler mi, çürütür mü");
    expect(codeOnly(CONTENT)).toContain("tutarlılık kuralı");
    // Birebir: docs/08 tablosunda da var.
    expect(MARKETING_DOC).toContain("**Delil Matrisi**");
  });

  it("Risk Değerlendirmesi kartı: deterministik taban + gece tazeleme", () => {
    expect(codeOnly(CONTENT)).toContain('"Risk Değerlendirmesi"');
    expect(codeOnly(CONTENT)).toContain("deterministik risk skoru");
    expect(codeOnly(CONTENT)).toContain("her gece otomatik tazelenir");
    expect(MARKETING_DOC).toContain("**Risk Değerlendirmesi**");
  });

  it("modül kart sayısı 14 — yeni kartlar eklendi", () => {
    const titles = (CONTENT.match(/title: "([^"]+)",\n {6}text:/g) ?? []).length;
    expect(titles).toBeGreaterThanOrEqual(14);
    expect(MARKETING_DOC).toContain("Modüller (17 kart)");
  });

  it("DOCX/UDF desteği belge hattı adımında sayılıyor (B2)", () => {
    expect(codeOnly(CONTENT)).toContain("PDF, Word (DOCX), UDF ve düz metin");
  });

  it("güvenlik sayfasında ajan izleri anlatılıyor — yalnız maskeli özet (E1)", () => {
    expect(codeOnly(CONTENT)).toContain('"ai-cagri-izleri"');
    expect(codeOnly(CONTENT)).toContain("maskelenmiş kısa özet");
    // KVKK sözleşmesi: izlerde TAM METİN yok iddiası metinle eşleşiyor.
    expect(codeOnly(CONTENT)).toContain("belge veya yazışma metni saklanmaz");
  });

  it("güvenlik sayfasında KVKK m.11 dışa aktarma anlatılıyor (A1)", () => {
    expect(codeOnly(CONTENT)).toContain('"veri-ozne-haklari"');
    expect(codeOnly(CONTENT)).toContain("KVKK m.11");
    expect(codeOnly(CONTENT)).toContain("Her dışa aktarma denetim izine yazılır");
  });

  it("SSS'de ajan izleri ve müvekkil veri dışa aktarma soruları var", () => {
    expect(codeOnly(CONTENT)).toContain("Yapay zekânın ne yaptığını görebilir miyiz?");
    expect(codeOnly(CONTENT)).toContain("Müvekkil verilerini talep üzerine alabilir miyiz?");
  });
});

/* ------------------------------------------------------------------ *
 * YENİ RAKİP FARKLARI ÖZELLİKLERİ — E7/E8/E9/D7/A6/A1/B7
 * ------------------------------------------------------------------ */

describe("Rakip farkları tanıtım sitesinde anlatılıyor", () => {
  it("Randevu Yönetimi kartı var (E9)", () => {
    expect(codeOnly(CONTENT)).toContain('"Randevu Yönetimi"');
    expect(codeOnly(CONTENT)).toContain("self-servis randevu");
    expect(MARKETING_DOC).toContain("**Randevu Yönetimi**");
  });

  it("Vekalet Ücreti Hesabı kartı var (D7)", () => {
    expect(codeOnly(CONTENT)).toContain('"Vekalet Ücreti Hesabı"');
    expect(codeOnly(CONTENT)).toContain("motor uydurmaz");
    expect(MARKETING_DOC).toContain("**Vekalet Ücreti Hesabı**");
  });

  it("Banka Haciz Cevabı Ajanı kartı var (B7)", () => {
    expect(codeOnly(CONTENT)).toContain('"Banka Haciz Cevabı Ajanı"');
    expect(codeOnly(CONTENT)).toContain("siz onaylarsınız");
    expect(MARKETING_DOC).toContain("**Banka Haciz Cevabı Ajanı**");
  });

  it("modül kart sayısı 17 — yeni kartlar eklendi", () => {
    const titles = (CONTENT.match(/title: "([^"]+)",\n {6}text:/g) ?? []).length;
    expect(titles).toBeGreaterThanOrEqual(17);
    expect(MARKETING_DOC).toContain("Modüller (17 kart)");
  });

  it("SSS'de randevu, vekalet ücreti, e-SMM, online ödeme, CSV, banka soruları var", () => {
    expect(codeOnly(CONTENT)).toContain("portaldan randevu alabilir");
    expect(codeOnly(CONTENT)).toContain("Vekalet ücreti hesabı");
    expect(codeOnly(CONTENT)).toContain("e-SMM");
    expect(codeOnly(CONTENT)).toContain("online ödeme");
    expect(codeOnly(CONTENT)).toContain("CSV formatındaki müşteri");
    expect(codeOnly(CONTENT)).toContain("Banka haciz cevapları");
  });

  it("e-SMM dürüst: bağlanana kadar 'yapılandırılmadı' der", () => {
    // Vaat kısıtı: sahte entegrasyon yok.
    expect(codeOnly(CONTENT)).toContain("yapılandırılmadı");
  });

  it("online ödeme dürüst: sanal POS sözleşmesi gerektiğini söyler", () => {
    expect(codeOnly(CONTENT)).toContain("sanal POS");
    expect(codeOnly(CONTENT)).toContain("ödeme kuruluşu sözleşmesi");
  });

  it("banka cevabı dürüst: OCR gerektiren belgelerde çalışmaz der", () => {
    expect(codeOnly(CONTENT)).toContain("OCR gerektiren");
    expect(codeOnly(CONTENT)).toContain("henüz çalışmaz");
  });
});

describe("F2-Ö-28: 429 mesajı ölü adres göstermez", () => {
  it("demo-talebi 429 metni gerçek demo hattını verir", () => {
    const route = read("src", "app", "api", "demo-talebi", "route.ts");
    expect(route).toContain("demo@nomosos.com");
    expect(route).not.toContain("nomosos.example");
  });

  it("demo gündemi UYAP'ı kurulmuş özellik gibi anlatmıyor (İ-54)", () => {
    expect(codeOnly(CONTENT)).toContain("UYAP eklentisi ve veri aktarım yol haritası");
    expect(codeOnly(CONTENT)).not.toContain("aktarımının nasıl kurulduğu");
  });
});

describe("TARAFSIZLIK vaadi (avukat geri bildirimi) — AI objektiftir", () => {
  it("AI bölümü tarafsızlığı açıkça söylüyor", () => {
    expect(codeOnly(CONTENT)).toContain("TARAFSIZ yürütür");
    expect(codeOnly(CONTENT)).toContain("aleyhte bulguları gizlemez");
  });

  it("kaynak doküman da aynı vaadi taşıyor (birebir kuralı)", () => {
    expect(MARKETING_DOC).toContain("TARAFSIZ yürütür");
    expect(MARKETING_DOC).toContain("aleyhte bulguları gizlemez");
  });

  it("AI 'sizin adınıza savunur' gibi avukatlık vaadi yok", () => {
    // AI analizcidir, avukat değildir — savunma vaadi verilemez.
    expect(codeOnly(CONTENT)).not.toMatch(/adınıza savunur|yerine savunur|sizin avukatınız/);
  });

  it("çekirdek prompt sözleşmesi tarafsızlık kuralını taşıyor (kaynak taahhüdü)", () => {
    // Arayüz vaadi prompt sözleşmesiyle destekleniyor olmalı — vaat yalnız
    // pazarlama metninde kalırsa boş bir sözdür.
    const core = read(
      "..", "..", "packages", "legal-ai", "src", "prompts", "system-core.ts",
    );
    expect(core).toContain("TARAFSIZLIK — OBJEKTİF DEĞERLENDİRME");
    expect(core).toContain("EN GÜÇLÜ hâliyle ele alırsın");

    // Sözleşme testleri de duruyor olmalı:
    const promptsTest = read(
      "..", "..", "packages", "legal-ai", "src", "__tests__", "prompts.test.ts",
    );
    expect(promptsTest).toContain("tarafsızlık sözleşmesi");
  });
});
