/**
 * CONTRACT_ANALYSIS — sözleşme analiz ajanının prompt sözleşmesi ve çıktı şeması.
 *
 * CONTRACT_REVIEW'den FARKI: tek taraflı "riskli madde" önerisi değil, İKİ
 * TARAF PERSPEKTİFİ tek koşuda iki ayrı dizide üretilir (ourSide / otherSide).
 * Tek promptta karışması sıralama/önyargı riski doğurur; şema ayrımı
 * test edilebilir kalır (plans/sozlesme-analiz-ve-simulasyon-modulu-plani.md).
 *
 * ALINTI ZORUNLULUĞU CONTRACT_REVIEW ile aynı iki katmandadır:
 *   (a) output-guard → `quote` alanı boş olan bulgular elenir,
 *   (b) quote-guard  → alıntı sözleşme metninde BİREBİR aranır, bulunmazsa
 *       bulgu ŞERHE DÖNÜŞMEZ ve elenme yanıtta görünür.
 *
 * ŞİDDET HARFLERİ FARKLI: şerh modeli KRITIK/ORTA/DUSUK'dir (YUKSEK yoktur) —
 * şerh, avukatın metin üzerinde taşıyacağı bir işarettir; "yüksek kritik"
 * ayrımı şerh bağlamında anlamsızdır.
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";

/** Kredi hattındaki görev tipi (seed: 25 kredi, isFree=false). */
export const CONTRACT_ANALYSIS_TASK = "CONTRACT_ANALYSIS" as const;

export const CONTRACT_ANALYSIS_SYSTEM = `Sen sözleşmeler hukukunda uzman bir Türk avukatısın. Sana bir sözleşme metni, sözleşmenin tipi ve MÜVEKKİLİMİZİN hangi taraf olduğu verildi. Görevin sözleşmeyi İKİ AYRI PERSPEKTİFDEN incelemektir:

1. ourSide — BİZİM TARAF (müvekkil) perspektifi: müvekkilimizi bağlayacak riskler, aleyhimize dengesiz hükümler, müzakere etmemiz gereken maddeler.
2. otherSide — KARŞI TARAF perspektifi: karşı tarafın avukatı olsan bu sözleşmeden hangi maddeleri kendi lehine kullanırdın; karşı tarafın güçlü noktaları ve saldıracağı kapılar.

KURALLAR:
1. HER BULGU METİNDEN BİREBİR ALINTI (quote) TAŞIMAK ZORUNDADIR. Alıntı, sözleşmede HARFİ HARFİNE geçen bir parçadır; kendi cümlenizi alıntı diye yazma, özetleme, kısaltma. Sunucu her alıntıyı metinde arar; BULAMAZSA bulgu şerhe DÖNÜŞMEZ ve bu elenme kullanıcıya gösterilir.
2. METİNDE OLMAYAN MADDEYE ATIF YAPMA. clauseRef alanına yalnızca metinde gerçekten gördüğün madde numarasını yaz ("m.7" biçiminde); görmüyorsan boş bırak.
3. severity: KRITIK = imzalanırsa ciddi ve geri dönülemez zarar; ORTA = müzakerede düzeltilmeli; DUSUK = bilgi notu. "YUKSEK" YOKTUR — kullanma.
4. proposedFix alanına SOMUT alternatif hüküm metni yaz — "yeniden düzenlenmeli" gibi boş cümle değil.
5. TUTAR, TARİH, SÜRE VE TARAF ADI UYDURMA. Bunlar metinde ne yazıyorsa odur.
6. MEVZUAT ATIFLARINDA (refs) yalnızca EMİN olduğun madde numarasını yaz (TBK, TTK, HMK, 6698 s. KVKK). Emin değilsen atıf verme.
7. ourSide ve otherSide aynı maddeyi farklı perspektiften ele alabilir; kopyala-yapıştır değil, perspektif farkı olmalı.
8. Çıktın ÖNERİDİR; sözleşme metnine işlemek avukatın kararıdır. Hiçbir maddeyi "kabul edildi" gibi sunma.
9. Çıktı yalnızca istenen JSON olsun; önsöz, açıklama veya markdown ekleme.

ÇIKTI — yalnızca şu JSON:
{"ourSide":[{"rank":1,"clauseRef":"m.7","severity":"KRITIK","title":"...","body":"...","proposedFix":"...","quote":"...","refs":["TBK m.182"]}],"otherSide":[{"rank":1,"clauseRef":"m.3","severity":"ORTA","title":"...","body":"...","quote":"...","refs":[]}],"overallNote":"..."}`;

const CONTRACT_ANALYSIS_FEW_SHOT: readonly LlmMessage[] = [
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
    content: `{"ourSide":[{"rank":1,"clauseRef":"m.7","severity":"KRITIK","title":"Cezai şart yalnızca müvekkil aleyhine ve tavansız düzenlenmiş","body":"Cezai şart tek yönlüdür: erken fesihte yalnızca müvekkilimiz (hizmet alan) kalan sürenin TAMAMINI ödemekle yükümlü tutulmuş, aynı fesih hakkını kullanan karşı taraf için hiçbir yaptırım öngörülmemiştir. Tavan da yoktur; sözleşmenin başında yapılacak bir fesih neredeyse tüm sözleşme bedeli kadar borç doğurur.","proposedFix":"Madde 7 karşılıklı hâle getirilmeli ve tavana bağlanmalıdır: 'Taraflardan birinin sözleşmeyi süresinden önce haklı bir sebep olmaksızın sona erdirmesi hâlinde karşı tarafa üç (3) aylık hizmet bedeli tutarında cezai şart ödenir; cezai şart bu tutarı aşamaz.'","quote":"Hizmet alanın sözleşmeyi süresinden önce sona erdirmesi hâlinde, hizmet verene sözleşmenin kalan süresine ilişkin bedelin tamamı cezai şart olarak ödenir.","refs":["TBK m.182"]},{"rank":2,"clauseRef":"m.12","severity":"ORTA","title":"Yetki şartı karşı tarafın merkezini işaret ediyor","body":"Yetkili mahkeme olarak yalnızca İzmir gösterilmiştir; müvekkilimizin merkezi bu yerde bulunmadığından olası her uyuşmazlıkta şehir dışında dava takibi külfeti doğar.","proposedFix":"Yetki şartı 'davalının yerleşim yeri mahkemeleri' olarak düzenlenmeli ya da müvekkil merkezini de kapsayacak biçimde genişletilmelidir.","quote":"İşbu sözleşmeden doğan uyuşmazlıklarda İzmir Mahkemeleri ve İcra Daireleri yetkilidir.","refs":["HMK m.17"]}],"otherSide":[{"rank":1,"clauseRef":"m.7","severity":"KRITIK","title":"Cezai şart m.7 karşı tarafın en güçlü kozudur","body":"Karşı taraf avukatı olsam erken fesih senaryosunda kalan bedelin tamamını talep eder ve TBK m.182 indirimi için önce bizim tazminat niteliğine ve fahişliğe ilişkin ispat yükünü taşımamızı gerektirirdim; müvekkil için en pahalı kapı burasıdır.","quote":"Hizmet alanın sözleşmeyi süresinden önce sona erdirmesi hâlinde, hizmet verene sözleşmenin kalan süresine ilişkin bedelin tamamı cezai şart olarak ödenir.","refs":["TBK m.182"]},{"rank":2,"clauseRef":"m.6","severity":"DUSUK","title":"Bedel zamanlaması karşı taraf lehine sabit","body":"Ayın 5'inde ödeme şartı düzenli nakit akışı olan karşı taraf için öngörülebilirdir; müzakere masasında ısrasız çekilmesi beklenmez.","quote":"Hizmet bedeli aylık 150.000 TL + KDV olup her ayın 5'inde ödenir.","refs":[]}],"overallNote":"Sözleşme cezai şart hükmünde belirgin biçimde müvekkil aleyhine dengesizdir; m.7 müzakere edilmeden imzalanmamalıdır."}`,
  },
];

export const contractAnalysisPrompt: PromptSpec = {
  taskType: CONTRACT_ANALYSIS_TASK,
  name: "Sözleşme Analizi (İki Taraf)",
  system: CONTRACT_ANALYSIS_SYSTEM,
  fewShot: CONTRACT_ANALYSIS_FEW_SHOT,
  expectsJson: true,
};

/** Tek taraf perspektifi bulgusu — planın ourSideJson/otherSideJson satır şeması. */
export const ContractAnalysisFindingSchema = z.object({
  /** Sunum sırası (1'den başlar). */
  rank: z.number().int().min(1).max(50).default(1),
  /** Madde referansı — YALNIZCA metinde geçiyorsa ("m.7"). */
  clauseRef: z.string().max(60).optional(),
  severity: z.enum(["KRITIK", "ORTA", "DUSUK"]).default("ORTA"),
  title: z.string().trim().min(3).max(300),
  /** Bulgunun gövdesi — gerekçe açıklaması. */
  body: z.string().trim().min(10).max(4000),
  /** Önerilen düzeltme metni (şerh proposedFix alanına düşer). */
  proposedFix: z.string().max(4000).optional(),
  /** Alıntı — quote-guard'da metinde birebir aranır; bulunamayan bulgu şerhe DÖNÜŞMEZ. */
  quote: z.string().max(4000).optional(),
  /** Mevzuat referansları (yalnızca emin olunanlar). */
  refs: z.array(z.string().max(200)).max(10).default([]),
});
export type ContractAnalysisFinding = z.infer<typeof ContractAnalysisFindingSchema>;

export const ContractAnalysisOutputSchema = z.object({
  ourSide: z.array(ContractAnalysisFindingSchema).default([]),
  otherSide: z.array(ContractAnalysisFindingSchema).default([]),
  overallNote: z.string().max(6000).optional(),
});
export type ContractAnalysisOutput = z.infer<typeof ContractAnalysisOutputSchema>;

export function buildContractAnalysisMessages(input: {
  contextText: string;
  instruction: string;
}): LlmMessage[] {
  return buildMessages(
    contractAnalysisPrompt,
    `${input.contextText}\n\n=== TALİMAT ===\n${input.instruction}`,
  );
}

/**
 * PARÇA (map-reduce) mesajı — koşu sözleşmeyi parça parça incelerken her
 * parça için AYRI çağrıda kullanılır. Sistem promptu ortaktır; fark, metnin
 * BİR BÖLÜM olduğunun ve sayfa künyesinin kullanıcı iletisinde açık yazılmasıdır:
 * şerhin `pageFrom/pageTo` konumu bu künyeden gelir ve kullanıcı "s.42"ye
 * bakarak metni bulur.
 */
export function buildContractChunkAnalysisMessages(input: {
  contextText: string;
  instruction: string;
  /** "s.3-4" — parçanın kapsadığı sanal sayfa aralığı. */
  pageLabel: string;
  /** "5/38" — parçanın koşudaki sırası. */
  chunkLabel: string;
}): LlmMessage[] {
  const partNote =
    `İNCelenen metin sözleşmenin TAMAMI DEĞİL, bir BÖLÜMÜDÜR (sayfa ${input.pageLabel}, ` +
    `parça ${input.chunkLabel}). Yalnızca bu bölümde gördüğün maddeler için bulgu üret; ` +
    "bölüm dışına atıf yapma.\n\n";
  return buildMessages(
    contractAnalysisPrompt,
    `${partNote}${input.contextText}\n\n=== TALİMAT ===\n${input.instruction}`,
  );
}
