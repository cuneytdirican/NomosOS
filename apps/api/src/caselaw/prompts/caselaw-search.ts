/**
 * CASELAW_SEARCH — sorgu genişletme (Modül 23).
 *
 * KRİTİK SINIR: Bu görevde model KARAR ÜRETMEZ, KARAR BULMAZ, KÜNYE YAZMAZ.
 * Yalnızca avukatın doğal dil sorusunu, yerel havuzda ILIKE ile aranabilecek
 * ANAHTAR KELİMELERE ve İLGİLİ HUKUKİ KAVRAMLARA çevirir. Bulunan her sonuç,
 * bu genişletilmiş sorguyla veritabanında GERÇEKTEN eşleşen bir satırdır.
 *
 * Bu ayrım halüsinasyon savunmasının temelidir: LLM "arama motoru" değil "sorgu
 * yazarı"dır; künye üretmesine izin verilmediği için uydurma karar döndüremez.
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";

export const CASELAW_SEARCH_SYSTEM = `Görevin, bir avukatın doğal dille sorduğu içtihat araştırma sorusunu ARAMA TERİMLERİNE çevirmektir.

MUTLAK SINIRLAR:
1. KARAR ÜRETME. Esas numarası, karar numarası, daire adı veya tarih YAZMA. Hafızandaki hiçbir kararı sonuç olarak sunma. Senin çıktın bir arama sorgusudur, bir cevap değildir.
2. Yalnızca kullanıcının sorusundan ve (verildiyse) dosya bağlamından türeyen terimler üret; konuyu genişletirken Türk hukukunun yerleşik terimlerini kullan (ör. "işe iade" → "feshin geçersizliği", "geçerli neden", "ispat yükü").
3. Terimler TEK BAŞINA aranabilir olmalı: 1-3 kelimelik, kısaltmasız, ek almamış hâlleriyle yaz.
4. Kullanıcı belirli bir mahkeme/daire ya da tarih aralığı söylediyse courtHints ve dateFrom/dateTo alanlarını doldur; söylemediyse BOŞ bırak, tahmin etme.
5. En fazla 12 keyword, en fazla 8 concept üret. Fazlası aramayı bulanıklaştırır.

ÇIKTI — yalnızca şu JSON:
{"keywords":["..."],"concepts":["..."],"courtHints":["..."],"dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD","note":"..."}
dateFrom/dateTo ve courtHints zorunlu değildir; emin değilsen yazma.`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `SORU: işe iade davasında ispat yükü kimde, son 3 yıl Yargıtay kararları
BUGÜN: 2026-03-01`,
  },
  {
    role: "assistant",
    content: `{"keywords":["işe iade","ispat yükü","geçerli neden","fesih","feshin geçersizliği","işveren","performans","savunma alınması"],"concepts":["geçerli nedenle fesih","feshin son çare olması ilkesi","işverenin ispat külfeti"],"courtHints":["Yargıtay"],"dateFrom":"2023-03-01","note":"Kullanıcı son 3 yıl dediği için tarih alt sınırı bugünden geriye 3 yıl olarak yazıldı; üst sınır belirtilmedi."}`,
  },
];

export const caseLawSearchPrompt: PromptSpec = {
  taskType: "CASELAW_SEARCH",
  name: "İçtihat Arama Sorgusu Genişletme",
  system: CASELAW_SEARCH_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export const CaseLawSearchPlanSchema = z.object({
  keywords: z.array(z.string().min(1)).max(24).default([]),
  concepts: z.array(z.string().min(1)).max(16).default([]),
  courtHints: z.array(z.string().min(1)).max(8).default([]),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır.")
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır.")
    .optional(),
  note: z.string().default(""),
});
export type CaseLawSearchPlan = z.infer<typeof CaseLawSearchPlanSchema>;

export interface CaseLawSearchPromptInput {
  question: string;
  /** Dosya bağlamı özeti (maskeleme hattından geçmiş). Zorunlu değildir. */
  caseContextText?: string;
  /** Bugünün tarihi (YYYY-AA-GG) — "son 3 yıl" gibi göreli ifadeler için. */
  today: string;
}

export function buildCaseLawSearchMessages(input: CaseLawSearchPromptInput): LlmMessage[] {
  const parts = [
    `SORU: ${input.question}`,
    `BUGÜN: ${input.today}`,
    input.caseContextText ? `DOSYA BAĞLAMI (yalnız terim çıkarmak için):\n${input.caseContextText}` : undefined,
  ].filter((v): v is string => Boolean(v));

  return buildMessages(caseLawSearchPrompt, parts.join("\n"));
}
