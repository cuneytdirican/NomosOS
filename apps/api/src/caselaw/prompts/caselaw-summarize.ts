/**
 * CASELAW_SUMMARIZE — karar özeti (Modül 23).
 *
 * Model YALNIZCA kendisine verilen karar metnini özetler. Metinde olmayan hiçbir
 * bilgi eklenemez; emin olunmayan alana "kararda açık değil" yazılır. Künye
 * (esas/karar no, daire, tarih) özet çıktısına YAZILMAZ — künye zaten sistemin
 * havuzdaki kaydından gelir, modele tekrar yazdırmak uydurma riski üretir.
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";

export const NOT_CLEAR_IN_DECISION = "kararda açık değil";

export const CASELAW_SUMMARIZE_SYSTEM = `Sen Türk içtihadı konusunda uzman bir hukukçusun. Sana bir mahkeme kararının metni verildi; onu sabit bir şemayla özetleyeceksin.

KURALLAR:
1. YALNIZCA verilen karar metnini kullan. Metinde olmayan hiçbir bilgiyi ekleme, tamamlama veya tahmin etme.
2. Bir alanı metinden çıkaramıyorsan o alana AYNEN "${NOT_CLEAR_IN_DECISION}" yaz. Boş bırakma, uydurma.
3. KÜNYE YAZMA: esas/karar numarası, daire adı, karar tarihi üretme — bunlar sistemin kaydından gelir.
4. Gerekçe bölümünde kararın dayandığı mevzuat maddelerini YALNIZCA metinde açıkça geçiyorsa aktar; geçmiyorsa madde numarası yazma.
5. Dosya bağlamı verildiyse "relevance" alanında kararın o dosyayla ilgisini yaz; verilmediyse "relevance" alanına "${NOT_CLEAR_IN_DECISION}" yaz. İlgi kurarken kararın sonucunu dosyaya taahhüt etme; bu bir değerlendirmedir.
6. Türkçe, yalın ve mesleki üslup. Alan başına en fazla 4 cümle.

ÇIKTI — yalnızca şu JSON:
{"dispute":"...","procedure":"...","reasoning":"...","outcome":"...","relevance":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `KARAR METNİ:
Davacı işçi, iş sözleşmesinin geçerli bir neden olmaksızın feshedildiğini ileri sürerek feshin geçersizliğine ve işe iadesine karar verilmesini talep etmiştir. Mahkemece davanın kabulüne karar verilmiş, hüküm davalı işveren tarafından temyiz edilmiştir. Dairemizce yapılan incelemede, feshin geçerli bir nedene dayandığını ispat yükünün işverene ait olduğu, dosyada bu yönde yeterli delil bulunmadığı anlaşılmakla hükmün ONANMASINA karar verilmiştir.

DOSYA BAĞLAMI: (verilmedi)`,
  },
  {
    role: "assistant",
    content: `{"dispute":"İş sözleşmesinin geçerli neden olmaksızın feshedildiği iddiasıyla açılan feshin geçersizliği ve işe iade istemi.","procedure":"İlk derece mahkemesi davanın kabulüne karar vermiş, hüküm davalı işveren tarafından temyiz edilmiştir.","reasoning":"Feshin geçerli bir nedene dayandığını ispat yükü işverendedir; dosyada bu yönde yeterli delil bulunmadığı tespit edilmiştir.","outcome":"ONAMA.","relevance":"kararda açık değil"}`,
  },
];

export const caseLawSummarizePrompt: PromptSpec = {
  taskType: "CASELAW_SUMMARIZE",
  name: "Karar Özeti",
  system: CASELAW_SUMMARIZE_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export const CaseLawSummarySchema = z.object({
  /** (1) Uyuşmazlık konusu. */
  dispute: z.string().min(1),
  /** (2) İlk derece / BAM süreci. */
  procedure: z.string().min(1),
  /** (3) Yüksek mahkemenin gerekçesi. */
  reasoning: z.string().min(1),
  /** (4) Sonuç (ONAMA / BOZMA / İPTAL / RET). */
  outcome: z.string().min(1),
  /** (5) Dosyayla ilgisi — bağlam verilmediyse "kararda açık değil". */
  relevance: z.string().min(1),
});
export type CaseLawSummary = z.infer<typeof CaseLawSummarySchema>;

export interface CaseLawSummarizePromptInput {
  /** Karar metni (tam metin yoksa özet). */
  decisionText: string;
  /** Dosya bağlamı — maskeleme hattından geçmiş olmalıdır. */
  caseContextText?: string;
}

export function buildCaseLawSummarizeMessages(input: CaseLawSummarizePromptInput): LlmMessage[] {
  const context = input.caseContextText?.trim()
    ? `DOSYA BAĞLAMI:\n${input.caseContextText}`
    : "DOSYA BAĞLAMI: (verilmedi)";
  return buildMessages(
    caseLawSummarizePrompt,
    `KARAR METNİ:\n${input.decisionText}\n\n${context}`,
  );
}
