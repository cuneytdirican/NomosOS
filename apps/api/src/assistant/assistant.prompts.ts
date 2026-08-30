/**
 * Asistan modülünün YEREL prompt sözleşmeleri ve çıktı şemaları.
 *
 * NEDEN BURADA? Ortak AI katmanı `@nomosos/legal-ai`'dir ve CASE_CHAT ile
 * CITATION_VERIFY promptları oradan gelir. Ancak CASE_FULL_ANALYSIS, SMART_NOTE
 * ve büro geneli sorgu (OFFICE_QUERY) için `legal-ai` içinde henüz prompt yok ve
 * bu faz dosya sahipliğinde `packages/legal-ai` bu ajana kapalı. Bu yüzden
 * görev promptları burada tanımlanır; ancak HAM prompt YAZILMAZ:
 *
 *   - Sistem promptu daima `composeSystemPrompt()` ile NomosOS ÇEKİRDEK
 *     PROMPTU'nun (kaynak zorunluluğu, uydurma yasağı, süre hesabı yasağı,
 *     maske koruma, "çıktı öneridir") üzerine eklenir.
 *   - Çıktılar `guardOutput()` ile doğrulanır; kaynaksız bulgular `findingPaths`
 *     üzerinden ELENİR ve atıflar Teyit Ajanı'na gitmek üzere çıkarılır.
 *
 * `legal-ai`'ye bu promptlar taşındığında buradaki tanımlar silinip
 * `getPromptSpec(taskType)` ile değiştirilebilir; çağrı yerleri aynı kalır.
 */

import { z } from "zod";
import {
  ChatCitationSchema,
  composeSystemPrompt,
  NO_SOURCE_NOTICE,
  type LlmMessage,
} from "@nomosos/legal-ai";

/** Yerel prompt sözleşmesi — `legal-ai` PromptSpec'inin görev tipi kısıtı olmayan hâli. */
export interface LocalPromptSpec {
  readonly key: string;
  readonly name: string;
  readonly system: string;
  readonly fewShot: readonly LlmMessage[];
}

/** Sıra: çekirdek+görev sistemi → few-shot → gerçek kullanıcı içeriği. */
export function buildLocalMessages(spec: LocalPromptSpec, userContent: string): LlmMessage[] {
  return [
    { role: "system", content: composeSystemPrompt(spec.system) },
    ...spec.fewShot.map((m) => ({ ...m })),
    { role: "user", content: userContent },
  ];
}

/* ================================================================== *
 * 1) CASE_FULL_ANALYSIS — Tam dosya analizi raporu
 * ================================================================== */

const AnalysisItemSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  /** Kaynak künyeleri (bağlamda verilen parça etiketleri). Boşsa guard eler. */
  sourceRefs: z.array(z.string().min(1)).default([]),
});

export const CaseFullAnalysisOutputSchema = z.object({
  summary: z.string().min(1),
  parties: z.array(AnalysisItemSchema).default([]),
  claims: z.array(AnalysisItemSchema).default([]),
  strengths: z.array(AnalysisItemSchema).default([]),
  weaknesses: z.array(AnalysisItemSchema).default([]),
  gaps: z.array(AnalysisItemSchema).default([]),
  recommendations: z.array(AnalysisItemSchema).default([]),
  citations: z.array(ChatCitationSchema).default([]),
  noSource: z.boolean().default(false),
});
export type CaseFullAnalysisOutput = z.infer<typeof CaseFullAnalysisOutputSchema>;

/** output-guard'ın kaynaksız bulguyu eleyeceği diziler. */
export const CASE_FULL_ANALYSIS_FINDING_PATHS = [
  "parties",
  "claims",
  "strengths",
  "weaknesses",
  "gaps",
  "recommendations",
] as const;

export const caseFullAnalysisPrompt: LocalPromptSpec = {
  key: "CASE_FULL_ANALYSIS",
  name: "Tam Dosya Analizi",
  system: `Görevin: devralınan bir dosyaya bir saatte hâkim olmak isteyen avukat için, YALNIZCA sana verilen dosya bağlamına ve belge parçalarına dayanan yapılandırılmış bir ANALİZ RAPORU üretmek.

BÖLÜMLER (hepsi doldurulmalı; dayanak yoksa boş dizi bırak, uydurma):
- summary: dosyanın 3-6 cümlelik özeti.
- parties: taraflar ve rolleri.
- claims: ileri sürülen talepler/iddialar.
- strengths: lehimize olan noktalar.
- weaknesses: aleyhimize olan noktalar, riskler.
- gaps: eksik belge/delil/bilgi ve indekslenmemiş belgeler.
- recommendations: somut, yapılabilir öneriler.

KURALLAR:
1. HER MADDE KAYNAKLI. Her maddede sourceRefs dizisine, sana verilen parçanın künyesini (ör. "Cevap Dilekçesi — s.3 ¶2-4") birebir yaz. Kaynaksız madde sistem tarafından ELENİR; elenmiş madde avukata hiç ulaşmaz.
2. SÜRE HESABI YAPMA. Süre bilgilerini yalnızca bağlamdaki [AÇIK SÜRELER] kayıtlarından aktar; gün sayma, son gün belirleme.
3. UYDURMA YASAĞI. Madde numarası, esas/karar numarası, tarih, tutar veya taraf adını bağlamda yoksa yazma. Bağlam yetersizse gaps bölümüne "şu bilgi dosyada bulunamadı" maddesi ekle.
4. Bağlam tamamen boşsa summary alanına "${NO_SOURCE_NOTICE}" yaz ve noSource=true yap.
5. citations dizisine, raporun tamamında dayandığın kaynakları kind/label/refId ile ayrıca doldur.
6. recommendations maddeleri ÖNERİDİR; kayıt açmaz, süre kesinleştirmez — üslubun bunu yansıtsın.

ÇIKTI — yalnızca şu JSON:
{"summary":"...","parties":[{"title":"Davalı","detail":"...","sourceRefs":["..."]}],"claims":[],"strengths":[],"weaknesses":[],"gaps":[],"recommendations":[],"citations":[{"kind":"DOCUMENT","refId":"...","label":"...","quote":"..."}],"noSource":false}`,
  fewShot: [
    {
      role: "user",
      content: `DOSYA BAĞLAMI:
[DOSYA]
  2026/145 · İstanbul 12. İş Mahkemesi · ISCI_ISVEREN · ACIK · Kıdem ve ihbar tazminatı
[TARAFLAR]
  DAVACI: [MÜVEKKİL] (müvekkil)
  DAVALI: ABC Lojistik A.Ş.
[AÇIK SÜRELER — en yakından uzağa]
  Son gün: 2026-06-02 · Bilirkişi raporuna itiraz süresi · ONAYLANDI · HMK_BILIRKISI_ITIRAZ

BAĞLAM PARÇALARI:
[1] Bilirkişi Raporu — s.7 ¶3 (id: doc-12)
Hesaplamada davacının son brüt ücreti 42.000 TL kabul edilmiş, ancak yol ve yemek yardımı giydirilmiş ücrete dahil edilmemiştir.
[2] Cevap Dilekçesi — s.2 ¶1 (id: doc-9)
Davalı, iş akdinin davacının devamsızlığı nedeniyle haklı nedenle feshedildiğini savunmaktadır.`,
    },
    {
      role: "assistant",
      content: `{"summary":"Dosya, ABC Lojistik A.Ş. aleyhine açılmış kıdem ve ihbar tazminatı istemli bir iş davasıdır. Davalı feshi haklı nedene dayandırmakta, bilirkişi raporunda ise giydirilmiş ücret hesabı eksik yapılmış görünmektedir. Bilirkişi raporuna itiraz süresi 02.06.2026'da dolmaktadır. Aşağıdaki değerlendirme öneridir.","parties":[{"title":"Davalı — ABC Lojistik A.Ş.","detail":"Feshin haklı nedene dayandığını savunan işveren.","sourceRefs":["Cevap Dilekçesi — s.2 ¶1"]}],"claims":[{"title":"Kıdem ve ihbar tazminatı","detail":"Davalının haklı neden savunmasına karşı tazminat talebi.","sourceRefs":["Cevap Dilekçesi — s.2 ¶1"]}],"strengths":[{"title":"Giydirilmiş ücret hesabındaki eksiklik","detail":"Bilirkişi yol ve yemek yardımını giydirilmiş ücrete dahil etmemiştir; itirazla hesap yükseltilebilir.","sourceRefs":["Bilirkişi Raporu — s.7 ¶3"]}],"weaknesses":[{"title":"Devamsızlık savunması","detail":"Davalı feshi devamsızlığa dayandırmaktadır; devamsızlık tutanaklarının dosyada teyidi gerekir.","sourceRefs":["Cevap Dilekçesi — s.2 ¶1"]}],"gaps":[{"title":"Devamsızlık tutanakları bağlamda yok","detail":"Davalının dayandığı tutanaklar bağlam parçalarında görünmüyor; belge indekslenmemiş olabilir.","sourceRefs":["Cevap Dilekçesi — s.2 ¶1"]}],"recommendations":[{"title":"Bilirkişi raporuna itiraz dilekçesi hazırlanması","detail":"Giydirilmiş ücret hesabındaki eksikliğe odaklanan bir itiraz önerilir; süre kaydı 02.06.2026 olarak görünmektedir, süre kontrolü avukatça yapılmalıdır.","sourceRefs":["Bilirkişi Raporu — s.7 ¶3"]}],"citations":[{"kind":"DOCUMENT","refId":"doc-12","page":7,"label":"Bilirkişi Raporu — s.7 ¶3","quote":"yol ve yemek yardımı giydirilmiş ücrete dahil edilmemiştir"},{"kind":"DOCUMENT","refId":"doc-9","page":2,"label":"Cevap Dilekçesi — s.2 ¶1"}],"noSource":false}`,
    },
  ],
};

/* ================================================================== *
 * 2) SMART_NOTE — Akıllı not önerisi
 * ================================================================== */

export const SmartNoteOutputSchema = z.object({
  notes: z
    .array(
      z.object({
        content: z.string().min(1),
        kind: z.enum(["GENEL", "DURUSMA_HAZIRLIK", "STRATEJI", "HATIRLATMA"]).default("GENEL"),
        rationale: z.string().default(""),
        sourceRefs: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
  noSource: z.boolean().default(false),
});
export type SmartNoteOutput = z.infer<typeof SmartNoteOutputSchema>;

export const SMART_NOTE_FINDING_PATHS = ["notes"] as const;

export const smartNotePrompt: LocalPromptSpec = {
  key: "SMART_NOTE",
  name: "Akıllı Not Önerisi",
  system: `Görevin: dosyanın son gelişmelerinden hareketle avukatın dosya defterine düşmek isteyeceği KISA NOT ÖNERİLERİ üretmek.

KURALLAR:
1. En fazla 3 not öner. Her not tek başına anlaşılır, 1-4 cümle olsun.
2. HER NOTUN sourceRefs alanı dolu olmalı: notun dayandığı parça künyesi / safahat tarihi / süre kaydı. Kaynaksız not sistemce ELENİR.
3. Not ÖNERİDİR; dosyaya avukat onayı olmadan kaydedilmez. Emir kipiyle talimat verme, tespit ve hatırlatma yaz.
4. Süre hesabı yapma; yalnızca mevcut süre kayıtlarını hatırlat ("kayıtta son gün X görünüyor, kontrol edilmeli").
5. kind alanını içeriğe göre seç: DURUSMA_HAZIRLIK (yaklaşan duruşma), STRATEJI (dava yönü), HATIRLATMA (yapılacak iş), GENEL.
6. Dayanak yoksa notes boş dizi, noSource=true.

ÇIKTI — yalnızca şu JSON:
{"notes":[{"content":"...","kind":"DURUSMA_HAZIRLIK","rationale":"...","sourceRefs":["..."]}],"noSource":false}`,
  fewShot: [
    {
      role: "user",
      content: `NOT TÜRÜ: DURUSMA_HAZIRLIK
YÖNERGE: Yarınki duruşmaya hazırlık notu.
DOSYA BAĞLAMI:
[DURUŞMA]
  2026-06-10 · İstanbul 12. İş Mahkemesi · DURUSMA
[SAFAHAT — en yeniden eskiye]
  2026-05-28 · Bilirkişi raporu tebliğ edildi

BAĞLAM PARÇALARI:
[1] Bilirkişi Raporu — s.7 ¶3 (id: doc-12)
Yol ve yemek yardımı giydirilmiş ücrete dahil edilmemiştir.`,
    },
    {
      role: "assistant",
      content: `{"notes":[{"content":"10.06.2026 duruşmasında bilirkişi raporundaki giydirilmiş ücret eksikliğinin (yol ve yemek yardımı) zapta geçirilmesi değerlendirilmelidir. Rapor 28.05.2026'da tebliğ edilmiş görünüyor; itiraz süresi kaydının kontrolü gerekir.","kind":"DURUSMA_HAZIRLIK","rationale":"Duruşma öncesi rapordaki en somut itiraz noktası.","sourceRefs":["Bilirkişi Raporu — s.7 ¶3","Safahat 2026-05-28"]}],"noSource":false}`,
    },
  ],
};

/* ================================================================== *
 * 3) OFFICE_QUERY — Büro geneli sorgu PLANI (veri minimizasyonu)
 * ================================================================== */

export const OFFICE_QUERY_ENTITIES = [
  "DEADLINE",
  "TASK",
  "HEARING",
  "CASE",
  "CLIENT",
  "FINANCIAL",
] as const;
export type OfficeQueryEntity = (typeof OFFICE_QUERY_ENTITIES)[number];

export const OFFICE_QUERY_PRESETS = [
  "BUGUN",
  "YARIN",
  "BU_HAFTA",
  "GELECEK_HAFTA",
  "BU_AY",
  "GELECEK_30_GUN",
  "GECMIS_30_GUN",
  "GECIKMIS",
  "TUMU",
] as const;
export type OfficeQueryPreset = (typeof OFFICE_QUERY_PRESETS)[number];

/**
 * LLM'in üretmesine izin verilen TEK ŞEY budur: bir sorgu planı.
 * Satır verisi (müvekkil adı, dosya başlığı, tutar) modele HİÇ gönderilmez;
 * sorguyu API kendisi çalıştırır ve sonucu şablonla Türkçeye çevirir.
 */
export const OfficeQueryPlanSchema = z.object({
  entity: z.enum(OFFICE_QUERY_ENTITIES),
  datePreset: z.enum(OFFICE_QUERY_PRESETS).default("TUMU"),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Varlığın kendi durum enum değerleri (ör. Deadline: BEKLIYOR/ONAYLANDI). */
  statuses: z.array(z.string().min(1)).max(10).default([]),
  /** true → yalnızca soruyu soran kullanıcıya ait kayıtlar. */
  onlyMine: z.boolean().default(false),
  /** Başlık/ad içinde geçmesi istenen serbest metin (kullanıcının kendi sorusundan). */
  textContains: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(["ASC", "DESC"]).default("ASC"),
  /**
   * Sonuç metninin Türkçe şablonu. {sayi} ve {liste} yer tutucularını API doldurur.
   * Şablonda gerçek kayıt verisi BULUNAMAZ (model o veriyi hiç görmedi).
   */
  answerTemplate: z.string().min(3).max(400),
  /** Planın gerekçesi — kullanıcıya şeffaflık için gösterilir. */
  reasoning: z.string().max(600).default(""),
});
export type OfficeQueryPlan = z.infer<typeof OfficeQueryPlanSchema>;

export const officeQueryPrompt: LocalPromptSpec = {
  key: "OFFICE_QUERY",
  name: "Büro Geneli Sorgu Planlayıcı",
  system: `Görevin: avukatın büro geneli doğal dil sorusunu, sistemin kendisinin çalıştıracağı YAPILANDIRILMIŞ BİR SORGU PLANINA çevirmek.

ÇOK ÖNEMLİ — VERİ MİNİMİZASYONU (KVKK): Sana hiçbir müvekkil, dosya, süre veya tutar SATIR VERİSİ verilmedi ve verilmeyecek. Sen yalnızca PLAN üretirsin; sorguyu sistem çalıştırır, sonucu sistem yazar. Bu yüzden cevabın içinde gerçek kayıt sayısı, dosya adı, müvekkil adı veya tutar UYDURAMAZSIN — bunları yer tutucularla göstereceksin.

ALANLAR:
- entity: DEADLINE (süreler) | TASK (görevler) | HEARING (duruşmalar) | CASE (dosyalar) | CLIENT (müvekkiller) | FINANCIAL (finans kayıtları)
- datePreset: BUGUN | YARIN | BU_HAFTA | GELECEK_HAFTA | BU_AY | GELECEK_30_GUN | GECMIS_30_GUN | GECIKMIS | TUMU
- dateFrom / dateTo: kullanıcı açık tarih verdiyse YYYY-MM-DD (aksi hâlde yazma)
- statuses: varlığın durum değerleri. DEADLINE: BEKLIYOR, ONAYLANDI, TAMAMLANDI, KACIRILDI, IPTAL. TASK: ACIK, DEVAM_EDIYOR, KONTROLDE, ONAY_BEKLIYOR, TAMAMLANDI, IPTAL. HEARING: PLANLANDI, YAPILDI, ERTELENDI, IPTAL. CASE: ACIK, DERDEST, KARAR, ISTINAF, TEMYIZ, KESINLESTI, ICRADA, KAPANDI, ARSIV. Listede olmayan bir değer sistemce elenir; emin değilsen boş bırak.
- onlyMine: "benim", "bana atanan", "sorumlusu ben olan" gibi ifadelerde true
- textContains: kullanıcının sorusundaki ayırt edici serbest metin (ör. bir unvan); yoksa yazma
- limit, sort
- answerTemplate: Türkçe tek cümle; {sayi} ve {liste} yer tutucularını KULLAN. Örnek: "Bu hafta son günü dolan {sayi} süre kaydı var:\\n{liste}"
- reasoning: planı tek cümleyle açıkla

KURALLAR:
1. Yalnızca yukarıdaki alanlarla plan üret; serbest SQL, tablo adı veya kod yazma.
2. Sonuç metnini uydurma; answerTemplate dışında cevap yazma.
3. Soru yukarıdaki varlıklardan hiçbiriyle karşılanamıyorsa entity için en yakın olanı seç ve reasoning'te sınırı belirt.
4. Kullanıcının rol yetkisi FINANCIAL sorgusuna izin vermeyebilir; bu kontrolü sistem yapar, sen sadece planı üret.

ÇIKTI — yalnızca şu JSON:
{"entity":"DEADLINE","datePreset":"BU_HAFTA","statuses":["BEKLIYOR","ONAYLANDI"],"onlyMine":false,"limit":25,"sort":"ASC","answerTemplate":"...","reasoning":"..."}`,
  fewShot: [
    {
      role: "user",
      content: "SORU: Bu hafta hangi dosyalarda süre var?",
    },
    {
      role: "assistant",
      content: `{"entity":"DEADLINE","datePreset":"BU_HAFTA","statuses":["BEKLIYOR","ONAYLANDI"],"onlyMine":false,"limit":50,"sort":"ASC","answerTemplate":"Bu hafta son günü dolan {sayi} süre kaydı bulunuyor:\\n{liste}","reasoning":"Süre kayıtları, bu haftanın tarih aralığında, henüz tamamlanmamış durumlarla listelendi."}`,
    },
  ],
};
