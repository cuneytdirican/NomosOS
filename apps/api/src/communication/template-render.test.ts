/**
 * ŞABLON ÇÖZÜCÜSÜ — birim testleri.
 *
 * Bu fonksiyonlar müvekkile GİDEN metni üretir ve hiçbiri LLM kullanmaz;
 * tamamı deterministik olarak sınanabilir. En kritik davranış "eksik değişkeni
 * boş bırakmama"dır: sessiz boşluk, yanlış bilgi göndermenin en kolay yoludur.
 */

import { describe, expect, it } from "vitest";
import {
  UnresolvedPlaceholderError,
  autoTemplateContext,
  extractPlaceholders,
  formatTrDateForClient,
  formatTrTimeForClient,
  formatTryFromDecimalString,
  mergeTemplateContext,
  missingPlaceholders,
  renderTemplate,
} from "./template-render";

describe("extractPlaceholders", () => {
  it("yer tutucuları tekrarsız ve sırayla çıkarır", () => {
    const body = "Sayın {{muvekkilAdi}}, {{dosyaNo}} sayılı dosyanız — {{muvekkilAdi}}";
    expect(extractPlaceholders(body)).toEqual(["muvekkilAdi", "dosyaNo"]);
  });

  it("boşluklu yazımı ve Türkçe harfleri kabul eder", () => {
    expect(extractPlaceholders("{{ dosyaNo }} {{belgeListesi}}")).toEqual([
      "dosyaNo",
      "belgeListesi",
    ]);
  });
});

describe("renderTemplate", () => {
  it("değerleri yerine koyar", () => {
    const out = renderTemplate("Sayın {{muvekkilAdi}}, {{dosyaNo}} dosyanız.", {
      muvekkilAdi: "ABC Holding A.Ş.",
      dosyaNo: "2026/145",
    });
    expect(out).toBe("Sayın ABC Holding A.Ş., 2026/145 dosyanız.");
  });

  it("ÇÖZÜLEMEYEN YER TUTUCUYU BOŞ BIRAKMAZ, hata fırlatır", () => {
    expect(() => renderTemplate("Sayın {{muvekkilAdi}}, {{durusmaTarihi}} tarihinde.", {
      muvekkilAdi: "Mehmet Demir",
    })).toThrow(UnresolvedPlaceholderError);
  });

  it("hata, eksik değişkenlerin TAMAMINI adıyla taşır", () => {
    try {
      renderTemplate("{{a}} {{b}} {{c}}", { b: "var" });
      throw new Error("hata bekleniyordu");
    } catch (err) {
      expect(err).toBeInstanceOf(UnresolvedPlaceholderError);
      expect((err as UnresolvedPlaceholderError).placeholders).toEqual(["a", "c"]);
    }
  });

  it("BOŞ DİZE 'çözüldü' saymaz — ' nezdinde görülen' gibi metin üretilmez", () => {
    expect(() => renderTemplate("{{mahkeme}} nezdinde", { mahkeme: "   " })).toThrow(
      UnresolvedPlaceholderError,
    );
  });

  it("eş adları birbirine bağlar: {{mahkeme}} ile {{mahkemeAdi}} aynı veriyi ister", () => {
    expect(renderTemplate("{{mahkeme}}", { mahkemeAdi: "İstanbul 12. İş Mahkemesi" })).toBe(
      "İstanbul 12. İş Mahkemesi",
    );
    expect(renderTemplate("{{mahkemeAdi}}", { mahkeme: "İstanbul 12. İş Mahkemesi" })).toBe(
      "İstanbul 12. İş Mahkemesi",
    );
  });

  it("PARA VE TARİH ALANLARINI EŞLEMEZ — fatura tutarı dava değeri değildir", () => {
    // {{faturaTutari}} istenmişken elde yalnızca {{tutar}} varsa hata alınır.
    // "Yakın anlamlı" eşleme, müvekkile yanlış tutar göndermenin sessiz yoludur.
    expect(() => renderTemplate("{{faturaTutari}}", { tutar: "150.000,00 TL" })).toThrow(
      UnresolvedPlaceholderError,
    );
    expect(() => renderTemplate("{{vadeTarihi}}", { sonTarih: "01.09.2026" })).toThrow(
      UnresolvedPlaceholderError,
    );
  });
});

describe("formatTryFromDecimalString", () => {
  it("Decimal dizesini TR para biçimine çevirir (float aritmetiği yok)", () => {
    expect(formatTryFromDecimalString("1234567.89")).toBe("1.234.567,89 TL");
    expect(formatTryFromDecimalString("0.10")).toBe("0,10 TL");
    expect(formatTryFromDecimalString("1000.00")).toBe("1.000,00 TL");
  });

  it("negatif ve kuruşsuz değerleri doğru biçimler", () => {
    expect(formatTryFromDecimalString("-2500")).toBe("-2.500,00 TL");
    expect(formatTryFromDecimalString("42")).toBe("42,00 TL");
  });

  it("0,1'i 0,10 olarak yazar — kuruş hanesi kaybolmaz", () => {
    expect(formatTryFromDecimalString("0.1")).toBe("0,10 TL");
  });
});

describe("tarih/saat biçimlendirme (TR yerel, sabit +03:00)", () => {
  it("UTC'de bir önceki güne düşen anı TR gününe taşır", () => {
    // 2026-10-13T22:00Z = 14.10.2026 01:00 (İstanbul)
    const date = new Date("2026-10-13T22:00:00.000Z");
    expect(formatTrDateForClient(date)).toBe("14.10.2026");
    expect(formatTrTimeForClient(date)).toBe("01:00");
  });

  it("duruşma saatini TR yerel saatiyle verir", () => {
    expect(formatTrTimeForClient(new Date("2026-10-14T07:30:00.000Z"))).toBe("10:30");
  });
});

describe("autoTemplateContext", () => {
  const base = { clientName: "ABC Holding A.Ş.", tenantName: "Demo Hukuk Bürosu" };

  it("kayıttan gelen alanları doldurur", () => {
    const ctx = autoTemplateContext({
      ...base,
      lawyerName: "Av. Kaya",
      case: {
        fileNumber: "2026/145",
        courtName: "İstanbul 12. İş Mahkemesi",
        subject: "İşe iade istemi",
        amountDecimalString: "250000.00",
      },
      hearingAt: new Date("2026-10-14T07:30:00.000Z"),
    });

    expect(ctx.muvekkilAdi).toBe("ABC Holding A.Ş.");
    expect(ctx.dosyaNo).toBe("2026/145");
    expect(ctx.mahkeme).toBe("İstanbul 12. İş Mahkemesi");
    expect(ctx.tutar).toBe("250.000,00 TL");
    expect(ctx.durusmaTarihi).toBe("14.10.2026");
    expect(ctx.durusmaSaati).toBe("10:30");
    expect(ctx.avukatAdi).toBe("Av. Kaya");
  });

  it("VERİSİ OLMAYAN ALANI BOŞ DİZEYE DEĞİL undefined'a bırakır", () => {
    // Böylece şablon o yer tutucuyu kullanıyorsa render HATA verir, sessizce
    // boş metin üretmez.
    const ctx = autoTemplateContext({ ...base, case: null });
    expect(ctx.dosyaNo).toBeUndefined();
    expect(ctx.durusmaTarihi).toBeUndefined();
    expect(missingPlaceholders("{{dosyaNo}}", ctx)).toEqual(["dosyaNo"]);
  });
});

describe("mergeTemplateContext", () => {
  it("kullanıcı değeri kayıt değerinin üstündedir", () => {
    const merged = mergeTemplateContext({ mahkeme: "Eski Mahkeme" }, { mahkeme: "Yeni Mahkeme" });
    expect(merged.mahkeme).toBe("Yeni Mahkeme");
  });

  it("boş kullanıcı değeri kayıt değerini SİLMEZ", () => {
    const merged = mergeTemplateContext({ mahkeme: "İstanbul 12. İş Mahkemesi" }, { mahkeme: "  " });
    expect(merged.mahkeme).toBe("İstanbul 12. İş Mahkemesi");
  });

  it("kayıttan türetilemeyen serbest değişkenleri ekler", () => {
    const merged = mergeTemplateContext({ muvekkilAdi: "X" }, { belgeListesi: "1) Nüfus kaydı" });
    expect(renderTemplate("{{muvekkilAdi}}: {{belgeListesi}}", merged)).toBe("X: 1) Nüfus kaydı");
  });
});
