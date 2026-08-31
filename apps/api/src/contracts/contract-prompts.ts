/**
 * CONTRACT_REVIEW — sözleşme inceleme ajanının prompt sözleşmesi ve çıktı şeması.
 *
 * Ham prompt yazılmaz: `PromptSpec` + `buildMessages` ile kurulur; böylece
 * `NOMOSOS_SYSTEM_CORE_PROMPT` (uydurma yasağı, kaynak zorunluluğu, "çıktı
 * öneridir") her çağrının başında durur.
 *
 * ALINTI ZORUNLULUĞU İKİ KATMANLIDIR:
 *   (a) output-guard → `sourceQuote` alanı BOŞ olan riskli madde bulguları elenir,
 *   (b) quote-guard  → alıntı sözleşme metninde BİREBİR aranır, bulunmazsa elenir.
 * Böylece "m.7'de sınırsız cezai şart var" diyen ama metinde m.7 bulunmayan bir
 * bulgu yanıta ULAŞAMAZ.
 *
 * EKSİK HÜKÜMLERDE ALINTI İSTENMEZ — bir hükmün YOKLUĞU alıntıyla kanıtlanamaz.
 * Onlar için ayrı bir deterministik kapı vardır: iddia edilen konunun anahtar
 * kelimeleri metinde GEÇİYORSA bulgu elenir (bkz. missing-clause-topics.ts).
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";

/** Kredi hattındaki görev tipi (AiTaskCost: 20 kredi, isFree=false). */
export const CONTRACT_REVIEW_TASK = "CONTRACT_REVIEW" as const;

export const RISK_TYPES = [
  "CEZAI_SART",
  "TEK_TARAFLI_FESIH",
  "YETKI_SARTI",
  "SORUMLULUK",
  "SURE",
  "BEDEL",
  "GIZLILIK",
  "FIKRI_MULKIYET",
  "DEVIR_TEMLIK",
  "DIGER",
] as const;

export const CONTRACT_REVIEW_SYSTEM = `Sen sözleşmeler hukukunda uzman bir Türk avukatısın. Sana bir sözleşme metni, sözleşmenin tipi ve MÜVEKKİLİMİZİN hangi taraf olduğu verildi. Görevin müvekkil LEHİNE inceleme yapmaktır.

ÜÇ BAŞLIKTA ÇALIŞIRSIN:
1. RİSKLİ MADDELER — müvekkil aleyhine dengesiz, tek taraflı veya belirsiz hükümler.
2. EKSİK HÜKÜMLER — bu sözleşme tipinde bulunması beklenip metinde OLMAYAN düzenlemeler.
3. TEK TARAFLI ŞARTLAR — yalnız karşı tarafa hak/yetki tanıyan, karşılığı bulunmayan hükümler (riskli maddeler içinde "TEK_TARAFLI_FESIH" veya ilgili risk tipiyle raporlanır).

KURALLAR:
1. HER RİSKLİ MADDE BULGUSU METİNDEN BİREBİR ALINTI (sourceQuote) TAŞIMAK ZORUNDADIR. Alıntı, sözleşmede HARFİ HARFİNE geçen bir parçadır; kendi cümleni alıntı diye yazma, özetleme, kısaltma. Sunucu her alıntıyı metinde arar; BULAMAZSA bulguyu siler ve bu silme kullanıcıya gösterilir.
2. METİNDE OLMAYAN MADDEYE ATIF YAPMA. Madde numarasını (clauseRef) yalnızca metinde gerçekten görüyorsan yaz; görmüyorsan boş bırak.
3. EKSİK HÜKÜMLERDE alıntı verme (yokluk alıntılanamaz); "topic" alanına konuyu tek kelime/kısa öbekle yaz (ör. "mücbir sebep", "uyuşmazlık çözümü", "gizlilik", "KVKK", "fesih usulü", "tebligat", "devir ve temlik").
4. Bir hüküm metinde VARSA "eksik" deme. Eksik listesi, gerçekten bulunmayanlar içindir.
5. MEVZUAT ATIFLARINDA yalnızca EMİN olduğun madde numarasını yaz (TBK, TTK, HMK, 6698 s. KVKK). Emin değilsen atıf verme — yanlış madde numarası, hiç atıf vermemekten kötüdür.
6. TUTAR, TARİH, SÜRE VE TARAF ADI UYDURMA. Bunlar metinde ne yazıyorsa odur.
7. severity: KRITIK = imzalanırsa ciddi ve geri dönülemez zarar; YUKSEK = önemli dengesizlik; ORTA = müzakerede düzeltilmeli; DUSUK = bilgi notu.
8. suggestion alanına ÖNERİLEN DÜZELTME METNİNİ yaz — "yeniden düzenlenmeli" gibi boş cümle değil, somut bir alternatif hüküm önerisi.
9. Çıktın bir ÖNERİDİR; sözleşme metnine işlemek avukatın kararıdır. Hiçbir maddeyi "kabul edildi" veya "değiştirildi" gibi sunma.
10. Çıktı yalnızca istenen JSON olsun; önsöz, açıklama veya markdown ekleme.

ÇIKTI — yalnızca şu JSON:
{"riskyClauses":[{"clauseRef":"m.7","riskType":"CEZAI_SART","severity":"KRITIK","title":"...","explanation":"...","suggestion":"...","legalBasis":"TBK m.182","sourceQuote":"..."}],"missingClauses":[{"topic":"mücbir sebep","whyNeeded":"...","suggestedText":"..."}],"overallNote":"...","favorsParty":"MUVEKKIL|KARSI_TARAF|DENGELI"}`;

const CONTRACT_FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `SÖZLEŞME TİPİ: HIZMET
MÜVEKKİLİMİZ: Hizmet alan (ABC Holding A.Ş.)

METİN:
Madde 6 — Bedel: Hizmet bedeli aylık 150.000 TL + KDV olup her ayın 5'inde ödenir.
Madde 7 — Cezai Şart: Hizmet alanın sözleşmeyi süresinden önce sona erdirmesi hâlinde, hizmet verene sözleşmenin kalan süresine ilişkin bedelin tamamı cezai şart olarak ödenir. Hizmet verenin sözleşmeyi sona erdirmesi hâlinde herhangi bir cezai şart uygulanmaz.
Madde 12 — Yetki: İşbu sözleşmeden doğan uyuşmazlıklarda İzmir Mahkemeleri ve İcra Daireleri yetkilidir.`,
  },
  {
    role: "assistant",
    content: `{"riskyClauses":[{"clauseRef":"m.7","riskType":"CEZAI_SART","severity":"KRITIK","title":"Cezai şart yalnızca müvekkil aleyhine ve tavansız düzenlenmiş","explanation":"Cezai şart tek yönlüdür: erken fesihte yalnızca müvekkilimiz (hizmet alan) kalan sürenin TAMAMINI ödemekle yükümlü tutulmuş, aynı fesih hakkını kullanan karşı taraf için hiçbir yaptırım öngörülmemiştir. Tutar bir tavana da bağlanmadığından, sözleşmenin başında yapılacak bir fesih neredeyse tüm sözleşme bedeli kadar borç doğurur.","suggestion":"Madde 7 karşılıklı hâle getirilmeli ve tavana bağlanmalıdır: 'Tarafl ardan birinin sözleşmeyi süresinden önce haklı bir sebep olmaksızın sona erdirmesi hâlinde, karşı tarafa üç (3) aylık hizmet bedeli tutarında cezai şart ödenir. Cezai şart bu tutarı aşamaz.'","legalBasis":"TBK m.182","sourceQuote":"Hizmet alanın sözleşmeyi süresinden önce sona erdirmesi hâlinde, hizmet verene sözleşmenin kalan süresine ilişkin bedelin tamamı cezai şart olarak ödenir. Hizmet verenin sözleşmeyi sona erdirmesi hâlinde herhangi bir cezai şart uygulanmaz."},{"clauseRef":"m.12","riskType":"YETKI_SARTI","severity":"ORTA","title":"Yetki şartı karşı tarafın merkezini işaret ediyor","explanation":"Yetkili mahkeme olarak yalnızca İzmir gösterilmiştir; müvekkilimizin merkezi bu yerde bulunmadığından her uyuşmazlıkta şehir dışında dava takibi külfeti doğar.","suggestion":"Yetki şartı müvekkilin merkezini de kapsayacak biçimde 'davalının yerleşim yeri mahkemeleri' olarak düzenlenmeli veya İstanbul Mahkemeleri eklenmelidir.","sourceQuote":"İşbu sözleşmeden doğan uyuşmazlıklarda İzmir Mahkemeleri ve İcra Daireleri yetkilidir."}],"missingClauses":[{"topic":"mücbir sebep","whyNeeded":"Metinde mücbir sebep düzenlemesi yoktur; olağanüstü hâllerde edimin ifa edilememesinin sonuçları belirsiz kalır ve tartışma TBK'nın genel hükümlerine bırakılır.","suggestedText":"Tarafların kontrolü dışında gelişen ve öngörülemeyen olaylar nedeniyle edimlerin ifa edilememesi hâlinde, ifa engeli süresince yükümlülükler askıya alınır; engel otuz (30) günü aşarsa taraflardan her biri sözleşmeyi tazminatsız feshedebilir."},{"topic":"KVKK","whyNeeded":"Hizmet ilişkisinde kişisel veri aktarımı söz konusu olabileceği hâlde 6698 sayılı Kanun kapsamında veri sorumlusu/işleyen sıfatları ve aydınlatma yükümlülüğü düzenlenmemiştir.","suggestedText":"Taraflar, sözleşmenin ifası kapsamında işlenen kişisel veriler bakımından 6698 sayılı Kanun'a uygun davranmayı, veri işleyen sıfatıyla hareket eden tarafın veriyi yalnızca talimat doğrultusunda işlemeyi kabul eder."}],"overallNote":"Sözleşme bedel ve yetki bakımından karşı taraf lehine kurgulanmıştır. En kritik nokta madde 7'deki tek yönlü ve tavansız cezai şarttır; imzadan önce mutlaka müzakere edilmelidir.","favorsParty":"KARSI_TARAF"}`,
  },
];

export const contractReviewPrompt: PromptSpec = {
  taskType: CONTRACT_REVIEW_TASK,
  name: "Sözleşme İncelemesi",
  system: CONTRACT_REVIEW_SYSTEM,
  fewShot: CONTRACT_FEW_SHOT,
  expectsJson: true,
};

export const RiskyClauseSchema = z.object({
  /** Madde referansı — YALNIZCA metinde geçiyorsa. */
  clauseRef: z.string().max(60).optional(),
  riskType: z.enum(RISK_TYPES).default("DIGER"),
  severity: z.enum(["DUSUK", "ORTA", "YUKSEK", "KRITIK"]).default("ORTA"),
  title: z.string().trim().min(3).max(300),
  explanation: z.string().trim().min(10).max(4000),
  suggestion: z.string().max(4000).optional(),
  legalBasis: z.string().max(200).optional(),
  /** Kaynaksız bulgu output-guard'da elenir, sonra metinde aranır. */
  sourceQuote: z.string().max(4000).optional(),
});
export type RiskyClause = z.infer<typeof RiskyClauseSchema>;

export const MissingClauseSchema = z.object({
  topic: z.string().trim().min(2).max(200),
  whyNeeded: z.string().trim().min(10).max(3000),
  suggestedText: z.string().max(4000).optional(),
});
export type MissingClause = z.infer<typeof MissingClauseSchema>;

export const ContractReviewOutputSchema = z.object({
  riskyClauses: z.array(RiskyClauseSchema).default([]),
  missingClauses: z.array(MissingClauseSchema).default([]),
  overallNote: z.string().max(6000).optional(),
  favorsParty: z.enum(["MUVEKKIL", "KARSI_TARAF", "DENGELI"]).optional(),
});
export type ContractReviewOutput = z.infer<typeof ContractReviewOutputSchema>;

export function buildContractReviewMessages(input: {
  contextText: string;
  instruction: string;
}): LlmMessage[] {
  return buildMessages(
    contractReviewPrompt,
    `${input.contextText}\n\n=== TALİMAT ===\n${input.instruction}`,
  );
}
