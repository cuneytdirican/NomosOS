/**
 * Parser dayanıklılık testleri (vitest + jsdom).
 *
 * Odak noktası yalnızca "mutlu yol" değildir; asıl sınanan davranış şudur:
 * UYAP DOM'u değiştiğinde parser SESSİZCE YANLIŞ VERİ ÜRETMEZ, açık hata döner ve
 * kırılan selector'ı raporlar.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { dosyaDetayParser } from "../src/content/parsers/dosya-detay";
import { dosyaListesiParser } from "../src/content/parsers/dosya-listesi";
import { durusmaParser } from "../src/content/parsers/durusma";
import { evrakListesiParser } from "../src/content/parsers/evrak-listesi";
import { icraDosyaParser, parseTrMoney } from "../src/content/parsers/icra-dosya";
import { safahatParser } from "../src/content/parsers/safahat";
import { detectPageKinds } from "../src/content/parsers";
import type { PageContext } from "../src/types/parser";

const BASE_URL = "https://avukat.uyap.gov.tr/";

function loadFixture(name: string, path = "dosya/sorgula.jsf"): PageContext {
  // vitest paket kökünden çalışır; import.meta.url CommonJS derlemesinde Windows'ta
  // yanlış çözüldüğü için cwd tabanlı çözüm kullanılır.
  const file = resolve(process.cwd(), "e2e/fixtures", name);
  const html = readFileSync(file, "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, url: `${BASE_URL}${path}` };
}

describe("dosya listesi parser", () => {
  it("sütunları başlık metninden çözer ve tipli DTO döner", () => {
    const result = dosyaListesiParser.parse(loadFixture("dosya-listesi.html"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.selectorVersion).toBe("v1");
    expect(result.data.dosyalar).toHaveLength(3);
    expect(result.data.toplamKayit).toBe(12);

    const ilk = result.data.dosyalar[0];
    expect(ilk.dosyaNo).toBe("2026/145");
    expect(ilk.yil).toBe(2026);
    expect(ilk.sira).toBe(145);
    expect(ilk.birim).toBe("İstanbul 12. İş Mahkemesi");
    expect(ilk.dosyaTuru).toBe("Hukuk");
    expect(ilk.durum).toBe("Derdest");
    expect(ilk.acilisTarihi).toBe("2026-02-14");
    expect(ilk.uyapDosyaId).toBe("1234567");
    expect(ilk.detayUrl).toBe("https://avukat.uyap.gov.tr/dosya/detay.jsf?dosyaId=1234567");

    // Bağlantısı olmayan satırda uydurma değer üretilmez.
    const ucuncu = result.data.dosyalar[2];
    expect(ucuncu.dosyaNo).toBe("2024/512");
    expect(ucuncu.uyapDosyaId).toBeNull();
    expect(ucuncu.detayUrl).toBeNull();
  });

  it("sütun başlığı eşanlamlısı değişse de okur (Birim → Yargı Birimi)", () => {
    const ctx = loadFixture("dosya-listesi.html");
    const basliklar = ctx.doc.querySelectorAll("thead th");
    basliklar[1].textContent = "Yargı Birimi";

    const result = dosyaListesiParser.parse(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dosyalar[0].birim).toBe("İstanbul 12. İş Mahkemesi");
  });

  it("SAYFA İMZASI tutmazsa hiç veri okumaz", () => {
    const ctx = loadFixture("bozuk-dosya-listesi.html");

    // Ön eleme de DOM tabanlıdır: parser bu sayfayı kendi sayfası saymaz.
    expect(dosyaListesiParser.matches(ctx)).toBe(false);

    const result = dosyaListesiParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("PAGE_SIGNATURE_MISMATCH");
    expect(result.failure.issues[0].field).toBe("dosyaListesiTablosu");
    expect(result.failure.issues[0].selector).toContain("dosyaListesiTable");
    expect(result.failure.message).toContain("beklenen yapıda değil");
  });

  it("zorunlu sütun kaybolursa kırılan alanı raporlar", () => {
    const ctx = loadFixture("dosya-listesi.html");
    const basliklar = ctx.doc.querySelectorAll("thead th");
    basliklar[2].textContent = "Referans Kodu"; // "Dosya No" sütunu kayboldu

    const result = dosyaListesiParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("REQUIRED_FIELD_MISSING");
    expect(result.failure.issues.map((issue) => issue.field)).toContain("dosyaNo");
  });

  it("dosya numarası beklenen biçimde değilse tahmin etmez, durur", () => {
    const ctx = loadFixture("dosya-listesi.html");
    const hucre = ctx.doc.querySelectorAll("tbody tr")[1].querySelectorAll("td")[2];
    hucre.textContent = "E. 8821"; // yıl/sıra biçimi bozuldu

    const result = dosyaListesiParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNEXPECTED_STRUCTURE");
    expect(result.failure.issues[0].scope).toBe("satır 2");
  });

  it("kayıt yoksa EMPTY_RESULT döner (parser kırılması değildir)", () => {
    const ctx = loadFixture("dosya-listesi.html");
    const tbody = ctx.doc.querySelector("tbody");
    if (tbody) tbody.innerHTML = "";

    const result = dosyaListesiParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("EMPTY_RESULT");
  });
});

describe("dosya detay parser", () => {
  it("künye ve tarafları okur", () => {
    const ctx = loadFixture("dosya-detay.html", "dosya/detay.jsf?dosyaId=1234567");
    const result = dosyaDetayParser.parse(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dosyaNo).toBe("2026/145");
    expect(result.data.birim).toBe("İstanbul 12. İş Mahkemesi");
    expect(result.data.dosyaTuru).toBe("Hukuk Dava Dosyası");
    expect(result.data.durum).toBe("Derdest");
    expect(result.data.acilisTarihi).toBe("2026-02-14");
    expect(result.data.konu).toContain("İşçilik Alacağı");
    expect(result.data.uyapDosyaId).toBe("1234567");

    expect(result.data.taraflar).toHaveLength(2);
    expect(result.data.taraflar[0]).toMatchObject({
      rol: "Davacı",
      ad: "Ayşe Yılmaz",
      vekil: "Av. Mehmet Demir",
      sira: 1,
    });
    expect(result.data.taraflar[1].ad).toBe("ABC Lojistik Anonim Şirketi");
  });

  it("taraflar tablosu yoksa sayfa imzası tutmaz", () => {
    const ctx = loadFixture("dosya-detay.html", "dosya/detay.jsf?dosyaId=1234567");
    ctx.doc.querySelector('table[id$="taraflarTable"]')?.remove();

    expect(dosyaDetayParser.matches(ctx)).toBe(false);
    const result = dosyaDetayParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("PAGE_SIGNATURE_MISMATCH");
    expect(result.failure.issues.map((issue) => issue.field)).toContain("taraflarTablosu");
  });
});

describe("safahat parser", () => {
  it("tarihleri ISO 8601'e (+03:00) çevirir", () => {
    const result = safahatParser.parse(loadFixture("safahat.html", "dosya/safahat.jsf"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dosyaNo).toBe("2026/145");
    expect(result.data.kayitlar).toHaveLength(3);
    expect(result.data.kayitlar[1]).toMatchObject({
      sira: 2,
      tarih: "2026-02-18T09:41:00+03:00",
      islem: "Tensip Zaptı Düzenlendi",
    });
    // Saat verilmeyen kayıt yalnız tarih olarak kalır; saat UYDURULMAZ.
    expect(result.data.kayitlar[2].tarih).toBe("2026-03-02");
  });

  it("sütun adı değişince (İşlem Tarihi → Zaman Damgası) açık hata döner", () => {
    const result = safahatParser.parse(loadFixture("bozuk-safahat.html", "dosya/safahat.jsf"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("REQUIRED_FIELD_MISSING");
    const tarihSorunu = result.failure.issues.find((issue) => issue.field === "tarih");
    expect(tarihSorunu).toBeDefined();
    expect(tarihSorunu?.selector).toContain("İşlem Tarihi");
  });

  it("iki alan aynı sütuna düşerse (birleşik başlık) sessizce yanlış okumaz", () => {
    // "İşlem Türü" sütunu yok; yalnız "İşlem Açıklaması" var. Eski çözümlemede
    // `islem` bu başlığa tolerans yoluyla eşleşip `aciklama` ile AYNI hücreden okunuyordu.
    const result = safahatParser.parse(
      loadFixture("birlesik-sutun-safahat.html", "dosya/safahat.jsf"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("REQUIRED_FIELD_MISSING");
    expect(result.failure.issues.some((issue) => issue.field === "islem")).toBe(true);
  });

  it("ayrıştırılamayan tarihte satırı atlamaz, aktarımı durdurur", () => {
    const ctx = loadFixture("safahat.html", "dosya/safahat.jsf");
    const hucre = ctx.doc.querySelectorAll("tbody tr")[0].querySelectorAll("td")[1];
    hucre.textContent = "yakında";

    const result = safahatParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNEXPECTED_STRUCTURE");
    expect(result.failure.issues[0].field).toBe("tarih");
  });
});

describe("evrak listesi parser", () => {
  it("evrak künyesini ve indirme bağlantılarını okur", () => {
    const result = evrakListesiParser.parse(loadFixture("evrak-listesi.html", "dosya/evraklar.jsf"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dosyaNo).toBe("2026/145");
    expect(result.data.evraklar).toHaveLength(3);

    const ilk = result.data.evraklar[0];
    expect(ilk.evrakId).toBe("99001");
    expect(ilk.ad).toBe("tensip_zapti.udf");
    expect(ilk.tur).toBe("Tensip Zaptı");
    expect(ilk.uzanti).toBe("udf");
    expect(ilk.boyutBytes).toBe(126976);
    expect(ilk.indirmeUrl).toBe(
      "https://avukat.uyap.gov.tr/evrak/indir.jsf?dosyaId=1234567&evrakId=99001",
    );

    expect(result.data.evraklar[1].tarih).toBe("2026-03-02T14:20:00+03:00");

    // İndirilemeyen evrak için uydurma bağlantı üretilmez; uyarı listelenir.
    expect(result.data.evraklar[2].indirmeUrl).toBeNull();
    expect(result.warnings.some((issue) => issue.field === "indirmeUrl")).toBe(true);
  });

  it("boş tarih hücresini sessizce geçmez, uyarı bırakır", () => {
    const ctx = loadFixture("evrak-listesi.html", "dosya/evraklar.jsf");
    const hucre = ctx.doc.querySelectorAll("tbody tr")[0].querySelectorAll("td")[4];
    hucre.textContent = "";

    const result = evrakListesiParser.parse(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.evraklar[0].tarih).toBeNull();
    expect(result.warnings.some((issue) => issue.field === "tarih")).toBe(true);
  });

  it("evrak adı ve türü sütunlarının ikisi de yoksa okumaz", () => {
    const ctx = loadFixture("evrak-listesi.html", "dosya/evraklar.jsf");
    const basliklar = ctx.doc.querySelectorAll("thead th");
    basliklar[1].textContent = "Kod";
    basliklar[2].textContent = "Referans";

    const result = evrakListesiParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("REQUIRED_FIELD_MISSING");
    expect(result.failure.issues[0].field).toBe("ad|tur");
  });
});

describe("duruşma parser", () => {
  it("ayrı tarih ve saat sütunlarını birleştirir", () => {
    const result = durusmaParser.parse(loadFixture("durusma.html", "durusma/listem.jsf"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.durusmalar).toHaveLength(2);
    expect(result.data.durusmalar[0]).toMatchObject({
      dosyaNo: "2026/145",
      tarih: "2026-05-12T09:30:00+03:00",
      salon: "Salon 3",
      tur: "Ön İnceleme",
    });
    expect(result.data.durusmalar[1].dosyaNo).toBe("2025/8821");
    expect(result.data.durusmalar[1].tarih).toBe("2026-06-03T14:00:00+03:00");
  });

  it("duruşma tarihi okunamazsa ajandaya yanlış kayıt yazmaz", () => {
    const ctx = loadFixture("durusma.html", "durusma/listem.jsf");
    const hucre = ctx.doc.querySelectorAll("tbody tr")[0].querySelectorAll("td")[2];
    hucre.textContent = "belirsiz";

    const result = durusmaParser.parse(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("UNEXPECTED_STRUCTURE");
  });
});

describe("sayfa tespiti", () => {
  it("dosya listesi sayfasını tanır", () => {
    expect(detectPageKinds(loadFixture("dosya-listesi.html"))).toEqual(["DOSYA_LISTESI"]);
  });

  it("tanınmayan sayfada hiçbir parser tetiklenmez", () => {
    expect(detectPageKinds(loadFixture("bozuk-dosya-listesi.html"))).toEqual([]);
  });

  it("dosya detay sayfasında yalnızca detay parser'ı eşleşir", () => {
    const ctx = loadFixture("dosya-detay.html", "dosya/detay.jsf?dosyaId=1234567");
    expect(detectPageKinds(ctx)).toEqual(["DOSYA_DETAY"]);
  });
});

describe("icra dosyası parser (Faz 6)", () => {
  it("takip alanlarını künyeden, borçlu/alacaklıyı taraflardan okur", () => {
    const ctx = loadFixture("icra-dosya.html", "icra/dosyaDetay.jsf?dosyaId=9988776");
    expect(icraDosyaParser.matches(ctx)).toBe(true);
    expect(detectPageKinds(ctx)).toEqual(["ICRA_DOSYA", "DOSYA_DETAY"]);

    const result = icraDosyaParser.parse(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dosyaNo).toBe("2026/8841");
    expect(result.data.birim).toBe("Ankara 7. İcra Dairesi");
    expect(result.data.uyapDosyaId).toBe("9988776");
    expect(result.data.icra).toEqual({
      takipTuru: "İlamsız Takip (Genel Haciz Yolu)",
      takipTarihi: "2026-03-05",
      alacakTutari: "125750.40",
      asama: "Haciz",
      borclu: "Hasan Kara",
      alacakli: "Kuzey Yapı Malzemeleri Ltd. Şti.",
    });
  });

  it("hukuk dosyası detayında icra parser'ı EŞLEŞMEZ (yanlış pozitif yok)", () => {
    const ctx = loadFixture("dosya-detay.html", "dosya/detay.jsf?dosyaId=1234567");
    expect(icraDosyaParser.matches(ctx)).toBe(false);
    expect(detectPageKinds(ctx)).not.toContain("ICRA_DOSYA");
  });

  it("tutar okuma: TR biçimi → ondalık metin; bozuk metin → null", () => {
    expect(parseTrMoney("125.750,40 TL")).toBe("125750.40");
    expect(parseTrMoney("1.000 TL")).toBe("1000.00");
    expect(parseTrMoney("")).toBeNull();
    expect(parseTrMoney("bilinmiyor")).toBeNull();
  });
});
