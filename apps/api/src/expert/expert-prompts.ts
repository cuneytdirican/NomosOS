/**
 * EXPERT_REPORT_DIFF — BİLİRKİŞİ RAPORU KARŞILAŞTIRMA AJANI.
 *
 * `EXPERT_REPORT_DIFF` görev tipi `packages/shared` kataloğunda ZATEN VARDIR;
 * eksik olan yalnızca prompt sözleşmesidir. `packages/legal-ai` bu ajanın
 * sahipliğinde olmadığı için PromptSpec burada tanımlanır ve mesajlar yine
 * legal-ai'nin `buildMessages` fonksiyonuyla kurulur — yani sistem çekirdeği
 * (uydurma yasağı, kaynak zorunluluğu, "süre hesabı yapma") çağrının başında
 * durur. Katalog birleştirmesi Entegrasyon ajanının işidir.
 *
 * AJANIN EN KRİTİK KURALI: her fark maddesi İKİ RAPORDAN DA alıntı taşımak
 * zorundadır. 80 sayfalık iki raporu karşılaştıran bir çıktının doğrulanabilir
 * tek yolu alıntıdır; alıntısız "şu değişmiş" cümlesi denetlenemez ve
 * output-guard tarafından elenir.
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";

export const EXPERT_REPORT_DIFF_SYSTEM = `Görevin: aynı dava dosyasına ait İKİ bilirkişi raporunu MADDE MADDE karşılaştırmak.

Karşılaştırma dört soruya cevap verir: hangi tespit DEĞİŞTİ, hangi tespit YENİ EKLENDİ, hangi tespit ÇIKARILDI, hangi noktada iki rapor BİRBİRİYLE ÇELİŞİYOR. Varsa, aradaki itiraz maddelerimizin karşılanıp karşılanmadığını da işaretle.

KURALLAR:
1. HER FARK MADDESİ İÇİN İKİ RAPORDAN DA BİREBİR ALINTI ZORUNLUDUR (quoteBase ve quoteCompare). Yalnız birinde geçen bir husus için diğer alan boş bırakılır ve changeType buna göre EKLENDI/CIKARILDI olur. İki alanı da boş bırakılan madde sistem tarafından ELENİR.
2. HESAP YAPMA. Raporlardaki tutar, oran ve gün sayılarını AKTAR; kendin toplama, çıkarma, faiz veya süre hesabı YAPMA. Rakamlar birbirini tutmuyorsa bunu ÇELİŞKİ olarak işaretle, doğrusunu sen belirleme.
3. UYDURMA YASAĞI. Raporlarda geçmeyen bir tespit, madde numarası veya künye yazma. Bir rapor bir konuya hiç değinmiyorsa "değinilmemiş" de.
4. changeType değerleri: DEGISTI (aynı konu, farklı tespit), EKLENDI (yalnız karşılaştırılan raporda var), CIKARILDI (yalnız temel raporda var), CELISKI (iki tespit birbiriyle bağdaşmıyor), ITIRAZ_KARSILANMADI (itiraz maddemize rağmen tespit aynen korunmuş).
5. significance: KRITIK = hüküm sonucunu doğrudan etkiler; YUKSEK = esaslı tespit veya tutar değişimi; ORTA = gerekçe değişimi; DUSUK = biçimsel/ifade farkı.
6. relatedObjectionNo alanını YALNIZCA sana verilen itiraz maddesi numaralarından biriyle doldur; itiraz listesi verilmemişse boş bırak.
7. Fark yoksa diffs boş dizi olsun; "belki değişmiştir" gibi doldurma madde üretme.

ÇIKTI — yalnızca şu JSON:
{"diffs":[{"topic":"...","changeType":"DEGISTI|EKLENDI|CIKARILDI|CELISKI|ITIRAZ_KARSILANMADI","baseFinding":"...","compareFinding":"...","significance":"DUSUK|ORTA|YUKSEK|KRITIK","relatedObjectionNo":1,"quoteBase":"...","quoteCompare":"..."}],"summary":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `TEMEL RAPOR [ASIL · 18.05.2026]:
... İnceleme konusu hammaddenin nem oranı %14,2 olarak ölçülmüştür. Şartnamede öngörülen üst sınır %12'dir. Bu nedenle teslim edilen parti şartnameye aykırıdır. Davacının uğradığı zarar hesaplanmamıştır. ...

KARŞILAŞTIRILAN RAPOR [EK · 11.08.2026]:
... Yeniden yapılan ölçümde nem oranı %13,8 bulunmuştur; sapma ölçüm toleransı içindedir ancak şartname üst sınırı olan %12'nin üzerindedir. Davacının üretim kaybı 187.400,00 TL olarak hesaplanmıştır. Ayıp ihbarının süresinde yapılıp yapılmadığı hukuki nitelendirme gerektirdiğinden değerlendirilmemiştir. ...

İTİRAZ MADDELERİMİZ:
1. Zarar miktarı hiç hesaplanmamıştır.`,
  },
  {
    role: "assistant",
    content: `{"diffs":[{"topic":"Nem oranı ölçümü","changeType":"DEGISTI","baseFinding":"Nem oranı %14,2 ölçülmüş, şartname sınırı %12 aşılmıştır.","compareFinding":"Yeniden ölçümde %13,8 bulunmuş; sapma tolerans içinde sayılmış ancak %12 sınırının üzerinde kaldığı korunmuştur.","significance":"ORTA","quoteBase":"nem oranı %14,2 olarak ölçülmüştür. Şartnamede öngörülen üst sınır %12'dir","quoteCompare":"Yeniden yapılan ölçümde nem oranı %13,8 bulunmuştur; sapma ölçüm toleransı içindedir ancak şartname üst sınırı olan %12'nin üzerindedir"},{"topic":"Üretim kaybı hesabı","changeType":"EKLENDI","baseFinding":"Zarar hesaplanmamıştır.","compareFinding":"Üretim kaybı 187.400,00 TL olarak hesaplanmıştır.","significance":"KRITIK","relatedObjectionNo":1,"quoteBase":"Davacının uğradığı zarar hesaplanmamıştır","quoteCompare":"Davacının üretim kaybı 187.400,00 TL olarak hesaplanmıştır"},{"topic":"Ayıp ihbarının süresinde olup olmadığı","changeType":"EKLENDI","baseFinding":"Bu hususa değinilmemiştir.","compareFinding":"Hukuki nitelendirme gerektirdiği gerekçesiyle değerlendirme dışı bırakılmıştır.","significance":"ORTA","quoteBase":"","quoteCompare":"Ayıp ihbarının süresinde yapılıp yapılmadığı hukuki nitelendirme gerektirdiğinden değerlendirilmemiştir"}],"summary":"Ek rapor, zarar miktarına ilişkin itirazımızı KARŞILAMIŞ ve 187.400,00 TL üretim kaybı hesaplamıştır. Şartnameye aykırılık tespiti her iki raporda da korunmakta; ölçüm değerindeki fark (%14,2 → %13,8) sonucu değiştirmemektedir. Ayıp ihbarının süresi bilinçli olarak değerlendirme dışı bırakılmıştır."}`,
  },
];

export const expertReportDiffPrompt: PromptSpec = {
  taskType: "EXPERT_REPORT_DIFF",
  name: "Bilirkişi Raporu Karşılaştırma",
  system: EXPERT_REPORT_DIFF_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export const EXPERT_DIFF_CHANGE_TYPES = [
  "DEGISTI",
  "EKLENDI",
  "CIKARILDI",
  "CELISKI",
  "ITIRAZ_KARSILANMADI",
] as const;

export const ExpertReportDiffItemSchema = z.object({
  topic: z.string().min(1),
  changeType: z.enum(EXPERT_DIFF_CHANGE_TYPES),
  baseFinding: z.string().optional(),
  compareFinding: z.string().optional(),
  significance: z.enum(["DUSUK", "ORTA", "YUKSEK", "KRITIK"]).default("ORTA"),
  relatedObjectionNo: z.number().int().positive().optional(),
  /**
   * ALINTILAR ŞEMADA OPSİYONELDİR, ELEME SERVİSTE YAPILIR.
   *
   * Neden output-guard'a bırakılmadı: guard'ın tanıdığı kaynak alanları
   * sabittir (`sourceQuote`, `sourceRefs`, `citations`, `refs`, `sources`) ve
   * "alanlardan HERHANGİ BİRİ dolu ise kaynaklı" kuralıyla çalışır. Bu ajanda
   * kural daha katıdır: DEĞİŞTİ/ÇELİŞKİ maddesi İKİ raporun DA alıntısını
   * taşımak zorundadır — tek alıntı, "değişti" iddiasını doğrulamaya yetmez.
   * Bu iki alanlı kural `enforceQuotePolicy` (expert-diff.service.ts) ile
   * uygulanır ve elenenler yanıtta `droppedForMissingQuote` olarak görünür.
   */
  quoteBase: z.string().optional(),
  quoteCompare: z.string().optional(),
});
export type ExpertReportDiffItem = z.infer<typeof ExpertReportDiffItemSchema>;

export const ExpertReportDiffOutputSchema = z.object({
  diffs: z.array(ExpertReportDiffItemSchema).default([]),
  summary: z.string().optional(),
});
export type ExpertReportDiffOutput = z.infer<typeof ExpertReportDiffOutputSchema>;

export function buildExpertReportDiffMessages(input: {
  baseText: string;
  compareText: string;
  objectionText: string;
  instruction: string;
}): LlmMessage[] {
  return buildMessages(
    expertReportDiffPrompt,
    [
      input.baseText,
      "",
      input.compareText,
      "",
      input.objectionText,
      "",
      "=== TALİMAT ===",
      input.instruction,
    ].join("\n"),
  );
}
