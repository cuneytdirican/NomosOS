/**
 * RESMÎ GAZETE GÜN SAYFASI AYRIŞTIRICI TESTLERİ.
 *
 * HTML biçimi resmigazete.gov.tr gün sayfasından (tarayıcı üzerinden) birebir
 * doğrulanmıştır: "<b><u>BÖLÜM/TÜR BAŞLIĞI</u></b>" başlıkları ve
 * "<a href='YYYYMMDD-N.htm'>–– Başlık</a>" belge bağlantıları.
 *
 * Korunan taahhütler:
 *  1. Bölüm başlıkları ("… BÖLÜMÜ") madde türü sayılmaz; tür başlıkları sayılır.
 *  2. "KANUN" ve "KANUNLAR" ikisi de KANUN'dur (çoklu kanun günü DIGER'e düşmez).
 *  3. İlan bölümü bağlantıları (/ilanlar/…) HİÇ alınmaz.
 *  4. PDF belge isHtml=false; .htm belge isHtml=true; adres tam ve gün klasörlüdür.
 *  5. Başlıktaki "––" öneki ve etiketler temizlenir; sıra korunur.
 */

import { describe, expect, it } from "vitest";
import { parseRgDayHtml } from "./resmi-gazete.client";

const DAY_HTML = `
<html><body>
<b><u>YÜRÜTME VE İDARE BÖLÜMÜ</u></b>
<b><u>KANUNLAR</u></b>
<a href="20260904-1.htm">–– 7999 Sayılı İş Kanununda Değişiklik Yapılmasına Dair Kanun</a><br>
<a href="20260904-2.htm">–– 8000 Sayılı Bazı Kanunlarda Değişiklik Yapılması Hakkında Kanun</a><br>
<b><u>YÖNETMELİKLER</u></b>
<a href="20260904-3.htm">–– Adalet Bakanlığı <b>Personeli</b> Yönetmeliği</a><br>
<a href="20260904-4.pdf">–– Bir Üniversite Lisansüstü Eğitim Yönetmeliği</a><br>
<b><u>TEBLİĞLER</u></b>
<a href="20260904-5.htm">&nbsp;–– Vergi Usul Kanunu Genel Tebliği (Sıra No: 600)</a><br>
<b><u>İLAN BÖLÜMÜ</u></b>
<a href="/ilanlar/eskiler/2026/09/20260904-1.htm">a - Yargı İlânları</a>
</body></html>`;

describe("parseRgDayHtml", () => {
  it("belgeleri tür başlığına göre sınıflandırır; bölüm başlıkları tür sayılmaz", () => {
    const items = parseRgDayHtml(DAY_HTML, "2026-09-04");
    expect(items.map((i) => [i.order, i.docType])).toEqual([
      [1, "KANUN"],
      [2, "KANUN"],
      [3, "YONETMELIK"],
      [4, "YONETMELIK"],
      [5, "TEBLIG"],
    ]);
    expect(items[0].section).toBe("KANUNLAR");
    expect(items[2].section).toBe("YÖNETMELİKLER");
  });

  it("tekil 'KANUN' başlığı da KANUN'dur", () => {
    const html = `<b><u>KANUN</u></b><a href="20260904-1.htm">–– 7999 Sayılı Kanun</a>`;
    expect(parseRgDayHtml(html, "2026-09-04")[0].docType).toBe("KANUN");
  });

  it("ilan bölümü bağlantıları alınmaz", () => {
    const items = parseRgDayHtml(DAY_HTML, "2026-09-04");
    expect(items.some((i) => i.url.includes("/ilanlar/"))).toBe(false);
    expect(items).toHaveLength(5);
  });

  it("adres tam ve gün klasörlüdür; PDF/HTM ayrımı doğru", () => {
    const items = parseRgDayHtml(DAY_HTML, "2026-09-04");
    expect(items[0].url).toBe("https://www.resmigazete.gov.tr/eskiler/2026/09/20260904-1.htm");
    expect(items[0].isHtml).toBe(true);
    expect(items[3].url).toBe("https://www.resmigazete.gov.tr/eskiler/2026/09/20260904-4.pdf");
    expect(items[3].isHtml).toBe(false);
  });

  it("başlıklar temizlenir: '––' öneki, iç etiketler ve &nbsp; düşer", () => {
    const items = parseRgDayHtml(DAY_HTML, "2026-09-04");
    expect(items[0].title).toBe("7999 Sayılı İş Kanununda Değişiklik Yapılmasına Dair Kanun");
    expect(items[2].title).toBe("Adalet Bakanlığı Personeli Yönetmeliği");
    expect(items[4].title).toBe("Vergi Usul Kanunu Genel Tebliği (Sıra No: 600)");
  });

  it("tanınmayan tür başlığı DIGER olur; başlıksız sayfa boş döner", () => {
    const html = `<b><u>CUMHURBAŞKANI KARARLARI</u></b><a href="20260904-9.htm">–– Karar (Karar Sayısı: 1)</a>`;
    expect(parseRgDayHtml(html, "2026-09-04")[0].docType).toBe("DIGER");
    expect(parseRgDayHtml("<html>bozuk</html>", "2026-09-04")).toEqual([]);
  });
});
