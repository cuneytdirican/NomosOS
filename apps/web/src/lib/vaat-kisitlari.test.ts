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
    expect(MARKETING_DOC).toContain("Modüller (14 kart)");
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
