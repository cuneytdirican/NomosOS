/**
 * DEADLINE_DETECT — Süre Tespit Ajanı.
 *
 * HİBRİT İLKE (Modül 21 / Gereksinim 4): AI yalnız TESPİT eder,
 * son gün HESABINI deterministik kural motoru (@nomosos/legal-core) yapar.
 * Bu ayrım promptta açıkça ve tekrar tekrar yazılıdır; modelin tarih aritmetiği
 * yapması ürünün en tehlikeli hata sınıfıdır.
 */

import { SYSTEM_DEADLINE_RULES } from "@nomosos/legal-core";

import type { LlmMessage, PromptSpec } from "../types";
import { UNKNOWN_DEADLINE_RULE_KEY } from "../schemas";
import { buildMessages } from "./system-core";

/**
 * Kural anahtarı kataloğu prompt'a MOTORDAN türetilerek enjekte edilir
 * (hukuki denetim, bulgu 2). Elle yazılmış örnek anahtarlar (HMK_281_BILIRKISI_ITIRAZ,
 * HMK_120_HARC_TAMAMLAMA …) motorda yoktu; model tanınmayan anahtar üretiyordu.
 */
const RULE_CATALOG = SYSTEM_DEADLINE_RULES.map(
  (rule) => `- ${rule.key} — ${rule.name} (${rule.legalBasis})`,
).join("\n");

export const DEADLINE_DETECT_SYSTEM = `Görevin: sana verilen belge metninde SÜRE BAŞLATAN OLAYLARI tespit etmek ve her biri için hangi süre kuralının uygulanabilir OLABİLECEĞİNİ önermektir.

EN ÖNEMLİ KURAL — HESAPLAMA YAPMA:
Sen süre HESAPLAMAZSIN. Son gün belirlemezsin, gün saymazsın, hafta/ay çevirmezsin, adli tatil veya resmî tatil düzeltmesi yapmazsın, "son gün ...'dır" cümlesi kurmazsın. Yaptığın tek şey şudur: "şu tarihte şu olay oldu, buna şu süre kuralı uygulanabilir." Tarih aritmetiğinin tamamını, tebligat yöntemini ve tatil düzeltmelerini NomosOS'un deterministik Süre Motoru yapar. Çıktında hesaplanmış hiçbir tarih bulunmamalıdır; eventDate alanı YALNIZCA belgede yazan, süreyi BAŞLATAN olayın tarihidir.

Neden: Süre kaçırmak bir hukuk bürosunda geri dönüşü olmayan zarardır. Model tarafından hesaplanan bir son gün doğru görünse bile denetlenebilir değildir; kural motoru hesabı ise mevzuat dayanağı ve tatil takvimiyle izlenebilir.

TESPİT KURALLARI:
1. Her tespit için sourceQuote ZORUNLUDUR: süreyi doğuran cümleyi belgeden BİREBİR alıntıla. Alıntısız tespit sistem tarafından elenir ve avukata hiç gösterilmez.
2. eventDate: olayın belgede AÇIKÇA yazan tarihi (tebliğ tarihi, tefhim tarihi, karar tarihi, rapor havale tarihi). Belgede tarih yoksa o tespiti verme; yerine notes alanında "tebliğ tarihi belgede yok, tebligat parçası eklenmeli" yaz.
3. suggestedRuleKey: AŞAĞIDAKİ KATALOGDAN BİR ANAHTAR yaz. Katalog dışında anahtar UYDURMA; kısaltma, madde numarası ekleme veya biçim değiştirme. Olay kataloğdaki hiçbir kurala oturmuyorsa (ör. İİK m.89 haciz ihbarnamesi, ihtiyati tedbire itiraz, mahkemece takdiren verilen süre) anahtarı "${UNKNOWN_DEADLINE_RULE_KEY}" yaz, confidence'ı düşür ve notes'a hangi sürenin söz konusu olduğunu açıkla — avukat kuralı kendisi seçecektir. "En yakın kural"a bağlamak YANLIŞ SÜRE hesabına yol açar; asla yapma.

4. statuteBasis: yalnızca belgede geçiyorsa veya kuralın yerleşik dayanağıysa yaz ("HMK m.281"). Madde numarası UYDURMA; emin değilsen alanı hiç yazma.
5. confidence: metin "kesin süre", "iki haftalık süre", "tebliğden itibaren" gibi açık ifade taşıyorsa yüksek; süre üstü kapalı çıkarılıyorsa düşük olsun.
6. Bir belge birden çok süre doğurabilir (hem itiraz hem beyan süresi); her birini ayrı detection olarak ver.
7. Belge hiç süre doğurmuyorsa detections boş dizi olsun ve notes'a nedenini yaz. Süre üretmek için zorlama.

SÜRE MOTORU KURAL KATALOĞU (suggestedRuleKey için TEK geçerli anahtar listesi):
${RULE_CATALOG}
- ${UNKNOWN_DEADLINE_RULE_KEY} — Katalogda karşılığı olmayan süre (kuralı avukat seçecek)

ÇIKTI — yalnızca şu JSON:
{"detections":[{"eventDescription":"...","eventDate":"YYYY-AA-GG","suggestedRuleKey":"...","statuteBasis":"...","confidence":0.0,"sourceQuote":"..."}],"notes":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `BELGE TÜRÜ: ARA_KARAR
BELGE METNİ:
T.C. İSTANBUL 12. İŞ MAHKEMESİ — ESAS NO: 2026/145
Bilirkişi raporu taraf vekillerine 12.08.2026 tarihinde tebliğ edilmiş olmakla;
1- Rapora karşı beyanda bulunmak üzere taraflara iki haftalık kesin süre verilmesine,
2- Davacı vekiline eksik harcı tamamlaması için bir haftalık süre verilmesine karar verildi.`,
  },
  {
    role: "assistant",
    // DÜZELTİLDİ (hukuki denetim, bulgu 3): önceki few-shot, harç tamamlama süresi için
    // BAŞKA BİR OLAYIN tarihini (bilirkişi raporunun tebliğ tarihi) eventDate olarak
    // kopyalıyordu — kendi 2. kuralını çiğneyerek. Few-shot örnekleri kuraldan daha güçlü
    // davranış öğretir; model süre başlangıcını ödünç almayı öğrenirse deterministik motor
    // doğru çalışsa bile SON GÜN yanlış çıkar. Örnek artık tarihi olmayan tespiti hiç
    // vermiyor, eksikliği notes'a taşıyor.
    content: `{"detections":[{"eventDescription":"Bilirkişi raporunun taraf vekillerine tebliği; rapora karşı beyan (itiraz) süresini başlatan olay.","eventDate":"2026-08-12","suggestedRuleKey":"HMK_BILIRKISI_ITIRAZ","statuteBasis":"HMK m.281","confidence":0.93,"sourceQuote":"Bilirkişi raporu taraf vekillerine 12.08.2026 tarihinde tebliğ edilmiş olmakla"}],"notes":"Ara kararın 2. bendinde eksik harcın tamamlanması için bir haftalık kesin süre verilmiştir; ancak bu sürenin başladığı ara kararın tefhim/tebliğ tarihi belgede yazmadığı için TESPİT ÜRETİLMEMİŞTİR (tebligat parçası veya duruşma tutanağı eklenmelidir). Ayrıca harç tamamlama süresinin katalogda karşılığı yoktur; eklenecekse anahtar avukatça seçilmelidir. Son gün hesabı yapılmamıştır; tespit Süre Motoru'nun kural doğrulamasına ve avukat onayına tabidir."}`,
  },
];

export const deadlineDetectPrompt: PromptSpec = {
  taskType: "DEADLINE_DETECT",
  name: "Süre Tespiti",
  system: DEADLINE_DETECT_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface DeadlineDetectPromptInput {
  documentText: string;
  /** Belge Sınıflandırma Ajanı'nın verdiği sınıf (zincirin ikinci halkası). */
  documentClass?: string;
  /** Tebligat parçasından okunan tebliğ tarihi (biliniyorsa). */
  notifiedAt?: string;
  /** Dosya tipi süre kuralı setini daraltır (DAVA/ICRA/CEZA...). */
  caseType?: string;
}

export function buildDeadlineDetectMessages(input: DeadlineDetectPromptInput): LlmMessage[] {
  const parts: string[] = [];
  if (input.documentClass) parts.push(`BELGE TÜRÜ: ${input.documentClass}`);
  if (input.caseType) parts.push(`DOSYA TİPİ: ${input.caseType}`);
  if (input.notifiedAt) parts.push(`SİSTEMDE KAYITLI TEBLİĞ TARİHİ: ${input.notifiedAt}`);
  parts.push(`BELGE METNİ:\n${input.documentText}`);
  return buildMessages(deadlineDetectPrompt, parts.join("\n"));
}
