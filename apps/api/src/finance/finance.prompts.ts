/**
 * CLIENT_FINANCIAL_SUMMARY — FİNANS ANLATIM PROMPTU.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  DİL MODELİ BU MODÜLDE HİÇBİR RAKAM GÖRMEZ VE HİÇBİR RAKAM ÜRETMEZ.    ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * VERİ MİNİMİZASYONU (KVKK md. 4/2-ç — "işlendikleri amaçla bağlantılı,
 * sınırlı ve ölçülü olma") ve ürün ilkesi ("para hesapları deterministiktir")
 * birlikte şu deseni dayatır:
 *
 *   1. API, tüm toplamları `FinanceSummaryService` içinde Prisma.Decimal ile
 *      KENDİSİ hesaplar.
 *   2. LLM'e gönderilen tek şey: kullanıcının SORUSU + rakamsız NİTEL SİNYALLER
 *      (risk bandı, "vadesi geçmiş fatura var mı", "avans bakiyesi pozitif mi").
 *      Ham finans satırı, tutar, müvekkil adı, TCKN, IBAN, dosya esas no —
 *      hiçbiri gönderilmez.
 *   3. LLM yalnızca YER TUTUCULU bir Türkçe metin şablonu üretir.
 *   4. Gerçek tutarları API şablona yerleştirir (`renderFinanceTemplate`).
 *   5. Şablonda yer tutucu dışında bir para/oran ifadesi bulunursa çıktı
 *      REDDEDİLİR (`assertNoFabricatedAmounts`) — model rakam uyduramaz.
 *
 * Böylece "AI çıktısı öneridir" ilkesi korunurken, ekrandaki her kuruş
 * veritabanından gelir.
 */

import { z } from "zod";
import type { LocalPromptSpec } from "../assistant/assistant.prompts";

/** Şablonda kullanılabilecek yer tutucular. Sırası ve adı sözleşmedir. */
export const FINANCE_PLACEHOLDERS = [
  "{muvekkil}",
  "{paraBirimi}",
  "{acikDosya}",
  "{tahakkuk}",
  "{tahsilat}",
  "{bekleyen}",
  "{bekleyenOran}",
  "{masraf}",
  "{harc}",
  "{avansBakiyesi}",
  "{risk}",
  "{vadesiGecenFatura}",
  "{ortalamaGecikmeGun}",
  "{acikFatura}",
  "{donem}",
] as const;
export type FinancePlaceholder = (typeof FINANCE_PLACEHOLDERS)[number];

export const FinanceNarrativeSchema = z.object({
  /** Yer tutuculu ana anlatım. API doldurur. */
  narrativeTemplate: z.string().min(10).max(2000),
  /** Kısa vurgu maddeleri; bunlar da yer tutuculu olabilir. */
  highlights: z.array(z.string().min(3).max(300)).max(5).default([]),
  /** Öneriler — ÖNERİDİR, otomatik işlem yapmaz. */
  recommendedActions: z.array(z.string().min(3).max(300)).max(5).default([]),
  /** Sorunun kapsam dışında kaldığı durumlarda kullanıcıya not. */
  scopeNote: z.string().max(400).default(""),
});
export type FinanceNarrative = z.infer<typeof FinanceNarrativeSchema>;

export const financeSummaryPrompt: LocalPromptSpec = {
  key: "CLIENT_FINANCIAL_SUMMARY",
  name: "Finans Özeti Anlatımı",
  system: `Görevin: bir Türk hukuk bürosunun finans özetini, avukatın okuyup toplantıya girebileceği KISA ve NET Türkçe bir metne çevirmek.

ÇOK ÖNEMLİ — SANA HİÇBİR TUTAR VERİLMEDİ VE VERİLMEYECEK:
Sana yalnızca kullanıcının sorusu ve rakamsız nitel sinyaller (risk bandı, "vadesi geçmiş fatura var mı" gibi) verilir. Müvekkil adı, tutar, tarih, dosya numarası GÖRMEZSİN. Bu yüzden metnine ASLA rakam yazamazsın; rakamların yerine YER TUTUCU koyarsın ve gerçek değerleri sistem yerleştirir.

KULLANABİLECEĞİN YER TUTUCULAR (aynen, süslü parantezle yaz):
{muvekkil} {paraBirimi} {acikDosya} {tahakkuk} {tahsilat} {bekleyen} {bekleyenOran} {masraf} {harc} {avansBakiyesi} {risk} {vadesiGecenFatura} {ortalamaGecikmeGun} {acikFatura} {donem}

KURALLAR:
1. RAKAM YASAĞI. Metninde hiçbir para tutarı, yüzde veya gün sayısı YAZMA. "350.000 TL", "%40", "62 gün" gibi ifadeler yasaktır; bunların yerine {bekleyen}, {bekleyenOran}, {ortalamaGecikmeGun} yaz. Rakam içeren bir çıktı sistem tarafından REDDEDİLİR ve kullanıcıya hiç ulaşmaz.
2. UYDURMA YOK. Sana verilmeyen bir olguyu (ödeme sözü, görüşme, sözleşme hükmü) anlatma. Yalnızca sinyallerde geçen durumları yorumla.
3. KAPSAM. KAPSAM=MUVEKKIL ise tek bir müvekkilin durumunu anlat ve {muvekkil} yer tutucusunu kullan. KAPSAM=BURO ise büro geneli anlat, {muvekkil} KULLANMA.
4. RİSK BANDI SENİN KARARIN DEĞİL. Risk seviyesi kural motorundan gelir; sen yalnızca {risk} yer tutucusuyla aktarır ve neden öyle olabileceğini nitel olarak açıklarsın. Bandı değiştirme, "aslında düşük" deme.
5. PARASAL KARAR VERME. "Şu kadar iskonto yapın", "şu tutarı silin" gibi tutar içeren talimat verme. Önerilerin süreçsel olsun (ödeme planı görüşmesi, avans talebi, ihtarname değerlendirmesi, icra takibi seçeneğinin avukatça değerlendirilmesi).
6. ÜSLUP. En fazla bir kısa paragraf (3-6 cümle) + en fazla 3 vurgu + en fazla 3 öneri. Abartısız, sakin, meslek dili.
7. Bu bir ÖNERİDİR; kararı avukat verir. Metnin içine "bu bir öneridir" yazma, sistem gösterir.

ÇIKTI — yalnızca şu JSON:
{"narrativeTemplate":"...","highlights":["..."],"recommendedActions":["..."],"scopeNote":"..."}`,
  fewShot: [
    {
      role: "user",
      content: `SORU: ABC Holding'in bize toplam borcu ne durumda?
KAPSAM: MUVEKKIL
SİNYALLER (rakam içermez):
- riskBandi: ORTA
- bekleyenBakiyeVarMi: EVET
- vadesiGecenFaturaVarMi: EVET
- avansBakiyesiDurumu: POZITIF
- paraBirimiCesitliligi: TEK
- acikDosyaVarMi: EVET`,
    },
    {
      role: "assistant",
      content: `{"narrativeTemplate":"{muvekkil} için açık dosya sayısı {acikDosya}. Bugüne kadar {tahakkuk} tahakkuk edilmiş, {tahsilat} tahsil edilmiş; bekleyen bakiye {bekleyen} ({bekleyenOran} oranında). Vadesi geçmiş {vadesiGecenFatura} fatura bulunuyor ve ortalama gecikme {ortalamaGecikmeGun} gün. Müvekkilin {avansBakiyesi} tutarında kullanılabilir avans bakiyesi var. Kural motoru tahsilat riskini {risk} olarak değerlendiriyor.","highlights":["Vadesi geçmiş fatura bulunması, bakiyenin kendiliğinden kapanmayacağını gösteriyor.","Avans bakiyesinin pozitif olması, yeni masrafların mahsubu için alan bırakıyor."],"recommendedActions":["Muhasebeyle bir ödeme planı görüşmesi planlanması değerlendirilebilir.","Yeni iş kabulünde avans oranının gözden geçirilmesi düşünülebilir.","Gecikme sürmesi hâlinde ihtarname seçeneğinin avukatça değerlendirilmesi önerilir."],"scopeNote":""}`,
    },
  ],
};

/**
 * UYDURMA RAKAM KAPISI — YER TUTUCU DIŞINDA HİÇBİR BASAMAK KABUL EDİLMEZ.
 *
 * ÖNCEKİ SÜRÜM beş ayrı desen kullanıyordu ve hepsi bir İŞARET arıyordu:
 * binlik ayracı, ondalık virgül, para birimi eki, `%`, ya da `gün|ay|hafta`.
 * AYRAÇSIZ, BİRİMSİZ TAMSAYI hiçbirine takılmıyordu (denetim bulgusu 10):
 * modelin ürettiği "Toplam bekleyen bakiye 350000 civarındadır" ya da
 * "Vadesi geçmiş 7 fatura var" cümleleri kapıdan TEMİZ geçiyor,
 * `renderFinanceTemplate` ile şablona giriyor ve kullanıcıya NomosOS'un
 * deterministik hesabıymış gibi sunuluyordu.
 *
 * Prompt kuralı 1 zaten "hiçbir para tutarı, yüzde veya gün sayısı YAZMA"
 * diyor; kontrol bundan daha gevşek olamaz. Kural tek cümleye indirildi:
 * yer tutucular çıkarıldıktan sonra kalan metinde BASAMAK BULUNMAMALIDIR.
 *
 * DAR BEYAZ LİSTE: madde/sıra numaraları ("1.", "2)") meşrudur ve elenir.
 * Liste bilinçli olarak dardır — genişledikçe kapı gevşer.
 */
const ORDINAL_MARKER = /(?:^|[\s(])\d{1,2}[.)](?=\s)/gm;

export function findFabricatedNumbers(text: string): string[] {
  const stripped = text
    // Yer tutucular (gerçek değerleri API yerleştirir).
    .replace(/\{[a-zA-ZçğıöşüÇĞİÖŞÜ]+\}/g, " ")
    // Madde/sıra numaraları.
    .replace(ORDINAL_MARKER, " ");

  const hits = new Set<string>();
  // Kalan her basamak dizisi bir ihlaldir; bağlamıyla birlikte raporlanır ki
  // kullanıcı/geliştirici hangi ifadenin reddedildiğini görebilsin.
  for (const match of stripped.matchAll(/\S*\d+\S*/g)) {
    hits.add(match[0].trim());
  }
  return [...hits];
}

/** Bilinmeyen yer tutucu kullanımını yakalar (şablon boş kalmasın). */
export function findUnknownPlaceholders(text: string): string[] {
  const known = new Set<string>(FINANCE_PLACEHOLDERS);
  const hits = new Set<string>();
  for (const match of text.matchAll(/\{[^}\n]{1,40}\}/g)) {
    if (!known.has(match[0] as FinancePlaceholder)) hits.add(match[0]);
  }
  return [...hits];
}

/** Yer tutucuları gerçek (deterministik) değerlerle doldurur. */
export function renderFinanceTemplate(
  template: string,
  values: Partial<Record<string, string>>,
): string {
  return template.replace(/\{([a-zA-ZçğıöşüÇĞİÖŞÜ]+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : value;
  });
}
