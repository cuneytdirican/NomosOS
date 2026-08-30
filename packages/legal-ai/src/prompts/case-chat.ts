/** CASE_CHAT — Dosya Sohbeti (RAG): kaynak gösterimi ZORUNLU. */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages, NO_SOURCE_NOTICE } from "./system-core";

export const CASE_CHAT_SYSTEM = `Görevin: avukatın dosya hakkındaki sorusunu, YALNIZCA sana verilen dosya bağlam parçalarına (belge alıntıları, safahat, süreler, taraflar, bağlı emsaller) dayanarak cevaplamak.

KURALLAR:
1. KAYNAK ZORUNLU. Her maddi iddian için citations dizisine en az bir kayıt koy. Kayıt, sana verilen parçanın künyesine (belge adı + sayfa/paragraf, safahat tarihi, süre kaydı) atıf yapmalıdır. Kaynağı olmayan cümle kurma; kaynaksız cevap sistemde işaretlenir ve avukata "teyitsiz" gösterilir.
2. BAĞLAM DIŞINA ÇIKMA. Bağlamda cevap yoksa açıkça "${NO_SOURCE_NOTICE}" de, noSource=true yap ve neyin eksik olduğunu söyle ("cevap dilekçesi henüz indekslenmemiş olabilir"). Genel hukuk bilginle dosya olgusu üretme, tahmin yürütme, "muhtemelen dosyada şu vardır" deme.
3. SÜRE SORULARI. Süre ve tarih sorularında yalnızca deterministik Süre Motoru kayıtlarını aktar. Kendin gün sayma, son gün hesaplama; kayıt yoksa "dosyada onaylanmış süre kaydı yok, süre kontrolü yapılmalı" de.
4. ATIF. İçtihat/mevzuat künyesini yalnızca bağlamda geçiyorsa aktar; künye UYDURMA. Aktardığın künye Teyit Ajanı'ndan geçmeden "doğrulanmış" sayılmaz, cevabında da böyle sunma.
5. MASKELER. [TCKN-MASKELİ] gibi maske etiketlerini olduğu gibi bırak.
6. YETKİ. Bağlamda olmayan bir veri sınıfını (ör. finans) kullanıcının yetkisi nedeniyle görmüyor olabilirsin; "bu bilgiye erişimim yok" de, tahmin etme.
7. ÜSLUP. Kısa, doğrudan, meslektaşa konuşur gibi. Hukuki değerlendirme sunduğunda bunun öneri olduğunu ve nihai kararın avukatta olduğunu belirt.
8. followUpSuggestions: en fazla 3 adet, dosyada gerçekten cevaplanabilir devam sorusu.

ÇIKTI — yalnızca şu JSON:
{"answer":"...","citations":[{"kind":"DOCUMENT|TIMELINE|DEADLINE|CASELAW|STATUTE","refId":"...","page":3,"quote":"...","label":"Cevap Dilekçesi s.3"}],"noSource":false,"followUpSuggestions":["..."]}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `SORU: Karşı taraf zamanaşımı def'ini nerede ileri sürdü?
BAĞLAM PARÇALARI:
[1] Belge: "Cevap Dilekçesi" (id: doc-88) s.3 ¶2 — "Usule İlişkin İtirazlar" başlığı altında: "Müvekkil aleyhine ileri sürülen alacak TBK m.146 uyarınca on yıllık genel zamanaşımına tabi olup, alacak zamanaşımına uğramıştır."
[2] Belge: "Islah Dilekçesi" (id: doc-91) s.1 — talep artırımı.
[3] Safahat 2026-05-14: Davalı cevap dilekçesi sunuldu.`,
  },
  {
    role: "assistant",
    content: `{"answer":"Davalı, zamanaşımı def'ini 14.05.2026 tarihinde sunduğu cevap dilekçesinin \\"Usule İlişkin İtirazlar\\" bölümünde ileri sürmüştür; TBK m.146 uyarınca on yıllık genel zamanaşımının dolduğunu savunmaktadır. Bağlamdaki ıslah dilekçesi yalnızca talep artırımına ilişkin olup, ıslahla artırılan kısım yönünden ayrıca ileri sürülmüş bir zamanaşımı def'i bağlamda görünmemektedir. Bu değerlendirme öneridir; ıslaha karşı def'in süresinde ileri sürülüp sürülmediğinin dosyanın tamamı üzerinden teyidi gerekir.","citations":[{"kind":"DOCUMENT","refId":"doc-88","page":3,"quote":"alacak TBK m.146 uyarınca on yıllık genel zamanaşımına tabi olup, alacak zamanaşımına uğramıştır","label":"Cevap Dilekçesi s.3"},{"kind":"TIMELINE","refId":"2026-05-14","label":"Safahat 14.05.2026 — cevap dilekçesi sunuldu"},{"kind":"DOCUMENT","refId":"doc-91","page":1,"label":"Islah Dilekçesi s.1"}],"noSource":false,"followUpSuggestions":["Islah dilekçesine karşı davalının beyanı dosyada var mı?","Zamanaşımı def'ine karşı verdiğimiz cevap hangi dilekçede?"]}`,
  },
];

export const caseChatPrompt: PromptSpec = {
  taskType: "CASE_CHAT",
  name: "Dosya Sohbeti",
  system: CASE_CHAT_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface CaseChatRetrievedChunk {
  /** Kaynak künyesi — chunker'ın ürettiği citationLabel. */
  citationLabel: string;
  content: string;
  refId?: string;
  page?: number;
}

export interface CaseChatPromptInput {
  question: string;
  /** Retrieval sonucu parçalar (alaka sırasına göre). */
  chunks: readonly CaseChatRetrievedChunk[];
  /** Dosya meta özeti (case-context.ts çıktısı). */
  caseContextText?: string;
  /** Önceki sohbet turları (rol + içerik). */
  history?: readonly LlmMessage[];
}

export function buildCaseChatMessages(input: CaseChatPromptInput): LlmMessage[] {
  const chunkBlock = input.chunks.length
    ? input.chunks
        .map((c, i) => {
          const head = `[${i + 1}] ${c.citationLabel}${c.refId ? ` (id: ${c.refId})` : ""}`;
          return `${head}\n${c.content}`;
        })
        .join("\n\n")
    : "(Retrieval boş döndü — dosyada eşleşen parça bulunamadı.)";

  const parts = [`SORU: ${input.question}`];
  if (input.caseContextText) parts.push(`DOSYA BAĞLAMI:\n${input.caseContextText}`);
  parts.push(`BAĞLAM PARÇALARI:\n${chunkBlock}`);

  const messages = buildMessages(caseChatPrompt, parts.join("\n\n"));
  if (input.history && input.history.length > 0) {
    // Geçmiş turlar few-shot ile gerçek soru arasına girer.
    messages.splice(messages.length - 1, 0, ...input.history.map((m) => ({ ...m })));
  }
  return messages;
}
