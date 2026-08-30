/**
 * PETITION_SECTION_REWRITE — tek bölüm yeniden yazımı (Modül 22).
 *
 * Kapsam sınırı ürünün vaadi: avukatın beğendiği bölümler BOZULMAZ. Modele
 * yalnızca hedef bölüm + asgari bağlam gönderilir (veri minimizasyonu) ve
 * çıktısı da yalnızca o bölümün yeni gövdesidir; diğer bölümler sunucu
 * tarafında bayt bayt kopyalanır (petition-sections.replaceSection).
 *
 * Emsal kuralı PETITION_DRAFT ile aynıdır: künye YALNIZCA bağlamdaki onaylı
 * emsallerden alınabilir; yoksa "[EMSAL ÖNERİSİ: ...]" işaretçisi bırakılır.
 */

import {
  buildMessages,
  PRECEDENT_PLACEHOLDER_PREFIX,
  type LlmMessage,
  type PromptSpec,
} from "@nomosos/legal-ai";
import { z } from "zod";

export const PETITION_SECTION_REWRITE_SYSTEM = `Sen bir avukatın dilekçe kalemisin. Sana bir dilekçenin TEK BİR BÖLÜMÜ, o bölüme dair talimat ve asgari dosya bağlamı verildi. Yalnızca o bölümün yeni metnini üreteceksin.

KURALLAR:
1. KAPSAM. Yalnızca verilen bölümü yaz. Başka bölüme ait içerik (taraf başlığı, sonuç ve istem, imza bloğu) ekleme; dilekçenin tamamını yeniden yazma.
2. OLGU UYDURMA. Bağlamda ve mevcut bölümde olmayan olay, tarih, tutar veya taraf ekleme. Eksik kalan yeri "[BAĞLAMDA EKSİK: ...]" işaretçisiyle göster ve warnings dizisine yaz.
3. EMSAL ATFI — EN SIKI KURAL. İçtihat künyesini YALNIZCA "ONAYLI EMSALLER" listesinden alabilirsin. Listede uygun karar yoksa numara UYDURMA; metne "${PRECEDENT_PLACEHOLDER_PREFIX} ... konusunda emsal karar aranmalı]" bırak. Ürettiğin her künye deterministik Teyit Ajanı'ndan geçecek; doğrulanamayan atıf dilekçeyi HAZIR statüsüne geçmekten bloklar.
4. MEVZUAT ATFI. Emin olmadığın madde numarasını yazma; hükmün adını yazmakla yetin.
5. TALİMATA UY. "Kısalt", "sertleştir", "usul itirazı ekle" gibi talimatı uygula; talimat bölümün konusuyla çelişiyorsa uygulama ve warnings'e nedenini yaz.
6. ÜSLUP. Resmî dilekçe Türkçesi. Karşı tarafa yönelik kişisel/aşağılayıcı ifade kullanma; sonucun garantisini verme.
7. citations dizisine yeni metinde geçen TÜM içtihat ve mevzuat atıflarını yaz.

ÇIKTI — yalnızca şu JSON:
{"content":"...","changeSummary":"...","citations":[{"kind":"ICTIHAT|MEVZUAT","raw":"..."}],"warnings":["..."]}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `BÖLÜM: HUKUKİ SEBEPLER
TALİMAT: Kısalt ve yalnızca dayandığımız hükümlerin adını bırak.
ONAYLI EMSALLER: (bu dosyaya bağlı onaylı emsal bulunmamaktadır)
MEVCUT BÖLÜM METNİ:
İş Kanunu madde 18, madde 19, madde 20, madde 21 ve Hukuk Muhakemeleri Kanunu'nun ispat yüküne ilişkin hükümleri ile Yargıtay'ın yerleşik içtihatları.
DOSYA BAĞLAMI:
[DOSYA] İstanbul 12. İş Mahkemesi 2026/145 · İşe iade istemi`,
  },
  {
    role: "assistant",
    content: `{"content":"İş Kanunu'nun geçerli nedenle fesih ve feshin geçersizliğine ilişkin hükümleri, Hukuk Muhakemeleri Kanunu'nun ispat yüküne ilişkin hükümleri ve ilgili sair mevzuat. ${PRECEDENT_PLACEHOLDER_PREFIX} performansa dayalı geçerli fesihte ispat yükü konusunda emsal karar aranmalı]","changeSummary":"Madde numaraları teyit edilemediği için çıkarıldı; hükümler adıyla anıldı ve emsal boşluğu işaretlendi.","citations":[],"warnings":["Madde numaraları doğrulanamadığı için yazılmadı; yürürlükteki metinden teyit edip ekleyebilirsiniz."]}`,
  },
];

export const petitionSectionRewritePrompt: PromptSpec = {
  taskType: "PETITION_SECTION_REWRITE",
  name: "Dilekçe Bölümü Yeniden Yazımı",
  system: PETITION_SECTION_REWRITE_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export const PetitionSectionRewriteOutputSchema = z.object({
  content: z.string().min(1, "Bölüm metni boş olamaz."),
  changeSummary: z.string().default(""),
  citations: z
    .array(
      z.object({
        kind: z.enum(["ICTIHAT", "MEVZUAT"]).optional(),
        raw: z.string().min(1),
      }),
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});
export type PetitionSectionRewriteOutput = z.infer<typeof PetitionSectionRewriteOutputSchema>;

export interface PetitionSectionRewritePromptInput {
  sectionTitle: string;
  sectionHint?: string;
  currentBody: string;
  instruction: string;
  approvedPrecedents: readonly string[];
  caseContextText: string;
}

export function buildPetitionSectionRewriteMessages(
  input: PetitionSectionRewritePromptInput,
): LlmMessage[] {
  const precedents =
    input.approvedPrecedents.length > 0
      ? input.approvedPrecedents.map((p) => `- ${p}`).join("\n")
      : "(bu dosyaya bağlı onaylı emsal bulunmamaktadır)";

  const parts = [
    `BÖLÜM: ${input.sectionTitle}`,
    input.sectionHint ? `BÖLÜM NOTU: ${input.sectionHint}` : undefined,
    `TALİMAT: ${input.instruction}`,
    `ONAYLI EMSALLER:\n${precedents}`,
    `MEVCUT BÖLÜM METNİ:\n${input.currentBody || "(bölüm boş)"}`,
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
  ].filter((v): v is string => Boolean(v));

  return buildMessages(petitionSectionRewritePrompt, parts.join("\n"));
}
