/**
 * B7 (rakip analizi) — BANKA HACİZ CEVABI AJANI.
 *
 * İİK m.89/2 üçüncü kişi cevabı (banka haciz cevabı) belge hattının
 * BANKA_HACIZ_CEVABI sınıfına düşer. Bu ajan:
 *   1. Belge metnini DETERMİNİSTİK olarak tarar (banka adı, borçlu, IBAN,
 *      hesap no, bakiye, tarih).
 *   2. Bulgu yoksa "bulgu yok" döner — UYDURMAZ.
 *   3. Bulgu VARSA, bağlı icra dosyasına malvarlığı KAYDI ÖNERİSİ üretir.
 *      Öneri — kayıt DEĞİL; avukat onayı ister (ürün ilkesi: AI önerir,
 *      avukat onaylar).
 *
 * NEDEN DETERMİNİSTİK: Banka cevapları YAPISALDIR (form metni, tablo,
 * "borçlu", "bakiye", "kapatılmıştır" gibi anahtar sözcükler). Regex
 * çıkarımı bu biçimde daha GÜVENİLİRDİR: LLM'e vermek hem masraf hem
 * halüsinasyon riski ekler. Belge OCR'lı taramaysa metin zaten yoktur
 * (pipeline BASARISIZ notu düşmüştür); ajan yalnız metin katmanı olan
 * belgelerde çalışır.
 */

export interface BankaCevabiBulgu {
  bankaAdi: string | null;
  borcluAdi: string | null;
  iban: string | null;
  hesapNo: string | null;
  bakiye: string | null; // TL metin (örn. "12.500,00")
  tarih: string | null; // yyyy-mm-dd
}

export interface BankaCevabiAnalizi {
  bulundu: boolean;
  bulgu: BankaCevabiBulgu;
  /** Önerinin gerekçesi — avukata gösterilir. */
  gerekce: string[];
}

const BANKALAR = [
  "Ziraat Bankası", "İş Bankası", "Garanti BBVA", "Akbank", "Yapı Kredi",
  "Denizbank", "QNB Finansbank", "TEB", "Vakıfbank", "Halkbank",
  "Albaraka", "Kuveyt Türk", "Türkçe", "Şekerbank", "ING",
] as const;

const IBAN_RE = /TR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}/i;
const BAKIYE_RE = /(?:bakiye|tutar|meblağ|malvarlığı)\s*[:;]?\s*([\d.,]+)\s*(?:TL|TRY)?/i;
const TARIH_RE = /(\d{2})[./](\d{2})[./](\d{4})/g;

export function analizBankaCevabi(metin: string): BankaCevabiAnalizi {
  const gerekce: string[] = [];
  const bulgu: BankaCevabiBulgu = {
    bankaAdi: null,
    borcluAdi: null,
    iban: null,
    hesapNo: null,
    bakiye: null,
    tarih: null,
  };

  // Banka adı
  for (const b of BANKALAR) {
    if (metin.toLowerCase().includes(b.toLowerCase())) {
      bulgu.bankaAdi = b;
      gerekce.push(`Banka adı tespit edildi: ${b}.`);
      break;
    }
  }

  // IBAN
  const iban = IBAN_RE.exec(metin);
  if (iban) {
    bulgu.iban = iban[0].replace(/\s+/g, "");
    gerekce.push(`IBAN tespit edildi: ${bulgu.iban.slice(0, 8)}…${bulgu.iban.slice(-4)}.`);
  }

  // Bakiye
  const bakiye = BAKIYE_RE.exec(metin);
  if (bakiye) {
    bulgu.bakiye = bakiye[1];
    gerekce.push(`Bakiye ibaresi tespit edildi: ${bulgu.bakiye} TL.`);
  }

  // Tarih (ilk geçerli gg.aa.yyyy)
  const tarihler = [...metin.matchAll(TARIH_RE)];
  if (tarihler.length > 0) {
    const [, g, a, y] = tarihler[0];
    bulgu.tarih = `${y}-${a.padStart(2, "0")}-${g.padStart(2, "0")}`;
    gerekce.push(`Belge tarihi: ${bulgu.tarih}.`);
  }

  // "kapatılmıştır" / "bloke edilmiştir" → işlem yapılmış ibaresi
  const kapatilmis = /kapat[ıi]lm[ıi][sş]t[ıi]r/i.test(metin);
  if (kapatilmis) {
    gerekce.push('Belgede "kapatılmıştır" ibaresi var — hesap kapatılmış olabilir.');
  }

  return {
    bulundu: gerekce.length > 0,
    bulgu,
    gerekce,
  };
}
