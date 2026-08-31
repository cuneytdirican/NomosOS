/**
 * POA_SCOPE_ANALYSIS — vekaletname kapsam yeterlilik ajanının prompt
 * sözleşmesi ve çıktı şeması.
 *
 * Ham prompt yazılmaz: `PromptSpec` + `buildMessages` ile kurulur, böylece
 * `NOMOSOS_SYSTEM_CORE_PROMPT` (uydurma yasağı, kaynak zorunluluğu, "çıktı
 * öneridir") her çağrının başında durur.
 *
 * ŞEMA İLKESİ: kaynak alanı (`sourceQuote`) OPSİYONELDİR — kaynaksız bulguyu
 * şema reddetmez, output-guard ELER; ardından `quote-guard` alıntının metinde
 * GERÇEKTEN geçtiğini doğrular. Böylece tek bir uydurma yüzünden koşunun
 * tamamı çöpe gitmez, ama uydurma da yanıta sızmaz.
 *
 * "EKSİK YETKİ"NİN ALINTISI NE OLUR? Bir yetkinin YOKLUĞU alıntıyla
 * kanıtlanamaz. Bu yüzden `missingPowers` bulgularında istenen alıntı,
 * İNCELENEN KAPSAM CÜMLESİDİR: modelin gerçekten okuduğu ve o yetkiyi
 * içermediğini gördüğü pasaj. Metni okumadan "eksik" diyen model bu pasajı
 * veremez ve bulgusu elenir.
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";
import { POA_SCOPE_CODES } from "./poa-scope-catalog";

/** Kredi hattındaki görev tipi (AiTaskCost: 10 kredi, isFree=false). */
export const POA_SCOPE_TASK = "POA_SCOPE_ANALYSIS" as const;

export const POA_SCOPE_SYSTEM = `Görevin: bir VEKALETNAMENİN kapsamının, belirli bir dava/takip dosyası için YETERLİ olup olmadığını değerlendirmek.

BU BİR HUKUKİ MÜTALAA DEĞİL, ÖN İNCELEMEDİR. Çıktın avukatın teyidine sunulur; hiçbir kayıt otomatik güncellenmez.

SANA VERİLENLER:
- Vekaletnamenin KAPSAM METNİ ve/veya yapılandırılmış özel yetki maddeleri,
- Dosyanın türü, konusu ve aşaması,
- DETERMİNİSTİK ÖN TARAMA sonucu: sistemin katalogla hesapladığı eksik yetkiler.

KURALLAR:
1. DETERMİNİSTİK ÖN TARAMAYI YENİDEN HESAPLAMA. "[EKSİK]" ve "[VAR]" satırları sistemin hesabıdır; onları değiştiremezsin. Senin işin nitel katmandır: bu eksiğin bu dosyada neden önemli olduğunu (ya da olmadığını) açıklamak.
2. HER BULGU VEKALETNAME METNİNDEN BİREBİR ALINTI (sourceQuote) TAŞIMALIDIR. Alıntı, metinde HARFİ HARFİNE geçen bir parçadır; kendi cümleni alıntı diye yazma. Sunucu her alıntıyı metinde arar; bulunmayan bulgu ELENİR.
3. "presentPowers" bulgularında alıntı, o yetkiyi VEREN ifadedir.
4. "missingPowers" bulgularında alıntı, İNCELEDİĞİN KAPSAM CÜMLESİDİR — yani yetkilerin sayıldığı ve söz konusu yetkinin İÇİNDE GEÇMEDİĞİ pasaj. Metinde olmayan bir cümleyi alıntılayamazsın.
5. VERDICT:
   - YETERLI: dosyanın gerektirdiği yetkilerin tamamı metinde AÇIKÇA var.
   - YETERSIZ: dosyanın yürütülmesi için gereken en az bir yetki metinde YOK.
   - BELIRSIZ: metin okunamıyor, kapsam ifadesi muğlak ya da yetkinin gerekip gerekmediği somut olaya bağlı.
   Tereddüt varsa BELIRSIZ de. "Muhtemelen yeterli" diye YETERLI yazma.
6. Vekaletnamede olmayan bir yetkiyi "var" gösterme; olmayan bir maddeye atıf yapma.
7. Mevzuat atfı verirken YALNIZCA emin olduğun maddeyi yaz (HMK m.74, TBK m.504/3 gibi). Emin değilsen atıf verme.
8. Tarih, süre ve gün hesabı YAPMA. Vekaletnamenin süresi/azli sistem tarafından deterministik olarak değerlendirilir.
9. Çıktı yalnızca istenen JSON olsun; açıklama, önsöz veya markdown ekleme.

ÇIKTI — yalnızca şu JSON:
{"verdict":"YETERLI|YETERSIZ|BELIRSIZ","presentPowers":[{"code":"...","label":"...","sourceQuote":"..."}],"missingPowers":[{"code":"...","label":"...","why":"...","sourceQuote":"..."}],"reasoning":"...","recommendedAction":"...","confidence":"DUSUK|ORTA|YUKSEK"}`;

const POA_FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `VEKALETNAME (kapsam metni):
"Beni/bizi temsile, dava açmaya ve davayı takibe, icra takibi yapmaya, tebliğ ve tebellüğe, ahzu kabza, temyiz ve istinaf yoluna başvurmaya yetkili olmak üzere Av. Cem Demir'i vekil tayin ettim."

YAPILANDIRILMIŞ YETKİLER: DAVA_ACMA(var), DAVAYI_TAKIP(var), ICRA_TAKIBI(var), AHZU_KABZ(var), TEMYIZ_ISTINAF(var)

DOSYA: 2026/210 · tür DAVA · konu: Boşanma ve nafaka · aşama DERDEST

DETERMİNİSTİK ÖN TARAMA:
[VAR] DAVA_ACMA · DAVAYI_TAKIP · ICRA_TAKIBI · AHZU_KABZ · TEMYIZ_ISTINAF
[EKSİK-KRİTİK] BOSANMA (Boşanma davası) — HMK m.74 (kişiye sıkı sıkıya bağlı haklar)
[EKSİK-OLASI] SULH (Sulh olma) · FERAGAT (Davadan feragat) · KABUL (Davayı kabul)

AVUKATIN SORUSU: Bu vekaletle boşanma davası açabilir miyim?`,
  },
  {
    role: "assistant",
    content: `{"verdict":"YETERSIZ","presentPowers":[{"code":"DAVA_ACMA","label":"Dava açma","sourceQuote":"dava açmaya ve davayı takibe"},{"code":"AHZU_KABZ","label":"Ahzu kabz","sourceQuote":"ahzu kabza"}],"missingPowers":[{"code":"BOSANMA","label":"Boşanma davası açma yetkisi","why":"Boşanma kişiye sıkı sıkıya bağlı haklardandır; genel dava vekaletnamesi bu davayı kapsamaz, açık yetki aranır. Vekaletnamedeki yetki sayımında boşanmaya ilişkin bir ibare bulunmamaktadır.","sourceQuote":"dava açmaya ve davayı takibe, icra takibi yapmaya, tebliğ ve tebellüğe, ahzu kabza, temyiz ve istinaf yoluna başvurmaya"},{"code":"SULH","label":"Sulh olma","why":"Boşanma dosyalarında anlaşmalı boşanma protokolü veya nafaka/tazminat üzerinde uzlaşma gündeme gelir; sulh yetkisi olmadan protokol imzalanamaz.","sourceQuote":"dava açmaya ve davayı takibe, icra takibi yapmaya, tebliğ ve tebellüğe, ahzu kabza, temyiz ve istinaf yoluna başvurmaya"}],"reasoning":"Vekaletname genel dava vekaletnamesi niteliğindedir ve olağan dava/icra işlemlerini kapsamaktadır. Ancak yetki sayımında boşanmaya ilişkin açık bir ibare yoktur. Bu hâliyle boşanma davası açmak için yeterli görünmemektedir; müvekkilden boşanma özel yetkisini içeren yeni bir vekaletname alınması gerekir.","recommendedAction":"Noterden boşanma özel yetkisini (ve tercihen sulh yetkisini) içeren yeni vekaletname alınmalı; dava dilekçesi bu vekaletname dosyaya sunulduktan sonra verilmelidir.","confidence":"YUKSEK"}`,
  },
];

export const poaScopePrompt: PromptSpec = {
  taskType: POA_SCOPE_TASK,
  name: "Vekaletname Kapsam Analizi",
  system: POA_SCOPE_SYSTEM,
  fewShot: POA_FEW_SHOT,
  expectsJson: true,
};

/** Model bir katalog kodu verebilir ama serbest metin de yazabilir. */
const scopeCode = z.union([z.enum(POA_SCOPE_CODES), z.string().max(60)]).optional();

export const PoaPresentPowerSchema = z.object({
  code: scopeCode,
  label: z.string().trim().min(1).max(200),
  /** Kaynaksız bulgu output-guard'da elenir, sonra metinde aranır. */
  sourceQuote: z.string().max(2000).optional(),
});

export const PoaMissingPowerSchema = z.object({
  code: scopeCode,
  label: z.string().trim().min(1).max(200),
  why: z.string().trim().min(10).max(2000),
  sourceQuote: z.string().max(2000).optional(),
});

export const PoaScopeOutputSchema = z.object({
  verdict: z.enum(["YETERLI", "YETERSIZ", "BELIRSIZ"]),
  presentPowers: z.array(PoaPresentPowerSchema).default([]),
  missingPowers: z.array(PoaMissingPowerSchema).default([]),
  reasoning: z.string().trim().min(1).max(6000),
  recommendedAction: z.string().max(3000).optional(),
  confidence: z.enum(["DUSUK", "ORTA", "YUKSEK"]).optional(),
});
export type PoaScopeOutput = z.infer<typeof PoaScopeOutputSchema>;

export function buildPoaScopeMessages(input: {
  contextText: string;
  instruction: string;
}): LlmMessage[] {
  return buildMessages(
    poaScopePrompt,
    `${input.contextText}\n\n=== TALİMAT ===\n${input.instruction}`,
  );
}
