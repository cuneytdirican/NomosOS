/**
 * DELİL AJANLARININ PROMPT SÖZLEŞMELERİ VE ÇIKTI ŞEMALARI.
 *
 * Ham prompt yazılmaz: her iki ajan da `PromptSpec` olarak tanımlanır ve
 * mesajlar @nomosos/legal-ai'nin `buildMessages` fonksiyonuyla kurulur —
 * böylece `NOMOSOS_SYSTEM_CORE_PROMPT` (uydurma yasağı, kaynak zorunluluğu,
 * atıf disiplini, "çıktı öneridir") her çağrının başında durur.
 *
 * Prompt'lar `packages/legal-ai` yerine burada durur çünkü o paket bu ajanın
 * sahipliğinde değildir (dosya sahipliği tablosu). Sözleşme aynıdır; katalog
 * birleştirmesi Entegrasyon ajanının işidir.
 *
 * ŞEMA İLKESİ (legal-ai/schemas.ts ile aynı): kaynak alanları (`sourceQuote`)
 * OPSİYONELDİR — kaynaksız bulguyu şema reddetmez, output-guard ELER. Böylece
 * tek bir kaynaksız öneri yüzünden koşunun tamamı çöpe gitmez.
 */

import { buildMessages, type LlmMessage, type PromptSpec } from "@nomosos/legal-ai";
import { z } from "zod";
import { EVIDENCE_GAP_TASK, EVIDENCE_MATRIX_TASK } from "./evidence-ai-tasks";

/* ================================================================== *
 * 1) EVIDENCE_MATRIX — iddia/delil matrisi ÖNERİSİ
 * ================================================================== */

export const EVIDENCE_MATRIX_SYSTEM = `Görevin: bir dava dosyasının dilekçelerinden ve belgelerinden İDDİA (vakıa) ve DELİL adaylarını çıkarmak, hangi delilin hangi iddiayı desteklediğini eşlemek ve iddiaların hukuki dayanağını ÖNERMEK.

BU BİR ÖNERİ KUYRUĞUDUR. Ürettiğin hiçbir madde doğrudan dosyaya yazılmaz; avukat tek tek onaylar. Mevcut kayıtları EZMEZSİN, TEKRARLAMAZSIN.

KURALLAR:
1. Her öneri, sana verilen bağlamdan BİREBİR ALINTI (sourceQuote) taşımak zorundadır. Alıntısız öneri sistem tarafından ELENİR.
2. Bağlamda [İDDİA-n] veya [DELİL-n] etiketiyle verilmiş bir kayıt ZATEN VARDIR; onu yeniden önerme. Yalnızca eksik olanı öner.
3. Bir bağ önerirken (kind="BAG") hangi iddiaya bağlandığını "claimRef" alanıyla göster: mevcut kayıt için [İDDİA-n] etiketini, kendi önerdiğin yeni iddia için "key" değerini yaz.
4. "side" alanı iddianın kime ait olduğunu söyler: BIZ (müvekkilimizin iddiası) veya KARSI_TARAF. Karşı tarafın iddialarını da çıkar — matriste izlenirler.
5. HUKUKİ DAYANAK ÖNERİRKEN UYDURMA. Yalnızca bağlamdaki dilekçe/belge metinlerinde GEÇEN madde ve künyeleri aktar. Bağlamda dayanak geçmiyorsa dayanak önerisi ÜRETME; boş bırak.
6. Delil tipini (evidenceType) yalnızca metinden anlaşılıyorsa yaz: BELGE, FOTOGRAF, VIDEO, SES, TANIK, BILIRKISI, KESIF, DIGER.
7. Tutar, tarih, taraf adı ve dosya numarası UYDURMA; bağlamda ne varsa onu aktar.

ÇIKTI — yalnızca şu JSON:
{"suggestions":[{"kind":"IDDIA|DELIL|BAG|HUKUKI_DAYANAK","key":"...","side":"BIZ|KARSI_TARAF","text":"...","evidenceType":"...","claimRef":"...","reference":"...","strength":1,"rationale":"...","sourceQuote":"..."}],"notes":"..."}`;

const MATRIX_FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOSYA: 2026/145 · Ayıplı hammadde nedeniyle tazminat
MEVCUT İDDİALAR:
- [İDDİA-1] (BIZ) Teslim edilen hammadde sözleşmedeki teknik şartnameye aykırıdır.
MEVCUT DELİLLER:
- [DELİL-1] BELGE · "14.02.2026 tarihli teslim tutanağı"
BELGE/DİLEKÇE METİNLERİ:
- [BELGE d-77] "Dava dilekçesi": ... Müvekkilimiz, ayıplı mal nedeniyle üretim hattını 11 gün durdurmak zorunda kalmış ve bu süreye ilişkin 240.000 TL üretim kaybına uğramıştır. Ayıp ihbarı 20.02.2026 tarihli ihtarname ile süresinde yapılmıştır. ...`,
  },
  {
    role: "assistant",
    content: `{"suggestions":[{"kind":"IDDIA","key":"y1","side":"BIZ","text":"Ayıplı mal nedeniyle üretim hattı 11 gün durmuş ve 240.000 TL üretim kaybı doğmuştur.","rationale":"Dava dilekçesinde ayrı bir zarar kalemi olarak ileri sürülmüş ancak mevcut iddia listesinde karşılığı yok.","sourceQuote":"üretim hattını 11 gün durdurmak zorunda kalmış ve bu süreye ilişkin 240.000 TL üretim kaybına uğramıştır"},{"kind":"IDDIA","key":"y2","side":"BIZ","text":"Ayıp ihbarı süresinde yapılmıştır.","rationale":"Ayıp ihbarının süresinde yapılması, ayıptan doğan talebin ön şartıdır ve dilekçede ayrıca ileri sürülmüştür.","sourceQuote":"Ayıp ihbarı 20.02.2026 tarihli ihtarname ile süresinde yapılmıştır"},{"kind":"DELIL","key":"d1","text":"20.02.2026 tarihli ayıp ihbarı ihtarnamesi","evidenceType":"BELGE","claimRef":"y2","rationale":"İhbarın süresinde yapıldığı iddiasının tek doğrudan delili ihtarnamedir; dosyada delil kaydı görünmüyor.","sourceQuote":"20.02.2026 tarihli ihtarname ile süresinde yapılmıştır"}],"notes":"Üretim kaybı iddiasını (y1) destekleyecek bir delil bağlamda geçmiyor; ticari defter kayıtları veya YMM raporu bağlamda bulunmadığı için önerilmedi."}`,
  },
];

export const evidenceMatrixPrompt: PromptSpec = {
  taskType: EVIDENCE_MATRIX_TASK,
  name: "İspat Matrisi Önerisi",
  system: EVIDENCE_MATRIX_SYSTEM,
  fewShot: MATRIX_FEW_SHOT,
  expectsJson: true,
};

export const EVIDENCE_SUGGESTION_KINDS = [
  "IDDIA",
  "DELIL",
  "BAG",
  "HUKUKI_DAYANAK",
] as const;

export const EvidenceSuggestionSchema = z.object({
  kind: z.enum(EVIDENCE_SUGGESTION_KINDS),
  /** Önerinin kendi içindeki referansı (BAG önerileri buna atıf yapar). */
  key: z.string().optional(),
  side: z.enum(["BIZ", "KARSI_TARAF"]).optional(),
  /** İddia metni veya delil başlığı. */
  text: z.string().min(1).optional(),
  evidenceType: z
    .enum(["BELGE", "FOTOGRAF", "VIDEO", "SES", "TANIK", "BILIRKISI", "KESIF", "DIGER"])
    .optional(),
  /** [İDDİA-n] etiketi veya bu koşudaki bir öneri `key`i. */
  claimRef: z.string().optional(),
  /** HUKUKI_DAYANAK önerilerinde madde/künye (yalnız bağlamda geçiyorsa). */
  reference: z.string().optional(),
  strength: z.number().int().min(1).max(5).optional(),
  rationale: z.string().min(1),
  /** Kaynaksız öneri output-guard tarafından ELENİR. */
  sourceQuote: z.string().optional(),
});
export type EvidenceSuggestion = z.infer<typeof EvidenceSuggestionSchema>;

export const EvidenceMatrixOutputSchema = z.object({
  suggestions: z.array(EvidenceSuggestionSchema).default([]),
  notes: z.string().optional(),
});
export type EvidenceMatrixOutput = z.infer<typeof EvidenceMatrixOutputSchema>;

export function buildEvidenceMatrixMessages(input: {
  contextText: string;
  instruction: string;
}): LlmMessage[] {
  return buildMessages(
    evidenceMatrixPrompt,
    `${input.contextText}\n\n=== TALİMAT ===\n${input.instruction}`,
  );
}

/* ================================================================== *
 * 2) EVIDENCE_GAP — delil boşluğu analizi
 * ================================================================== */

export const EVIDENCE_GAP_SYSTEM = `Görevin: bir dava dosyasının ONAYLI ispat matrisindeki DELİL BOŞLUKLARINI yorumlamak ve hangi delilin toplanması gerektiğini SOMUT olarak önermek.

ÖNEMLİ: Hangi iddianın desteksiz veya zayıf desteklendiği SANA HESAPLANMIŞ OLARAK VERİLİR. Bu listeyi YENİDEN HESAPLAMA, değiştirme, listede olmayan bir iddiayı "desteksiz" ilan etme. Senin işin nitel katmandır: boşluğun neden riskli olduğunu ve nasıl kapatılabileceğini söylemek.

KURALLAR:
1. Her bulgu, sana verilen [İDDİA-n] / [DELİL-n] / [BOŞLUK] satırlarından BİREBİR ALINTI (sourceQuote) taşımalıdır. Alıntısız bulgu ELENİR.
2. "claimRef" alanına bulgunun ilgili olduğu [İDDİA-n] etiketini AYNEN yaz.
3. "suggestedEvidence" somut olsun: ticari defter kayıtları ve YMM raporu, teslimatı yapan şoförün tanıklığı, SGK hizmet dökümü gibi. "Delil toplanmalı" gibi boş cümle yazma.
4. Delil ikamesi için SÜRE varsa bunu belirt ama GÜN HESABI YAPMA; tarih aritmetiği deterministik Süre Motoru'nun işidir.
5. severity: KRITIK = iddia tamamen desteksiz ve davanın esasını taşıyor; YUKSEK = tek ve itiraza açık delil; ORTA = destek var ama zayıf; DUSUK = bilgi notu.
6. Dosyada olmayan bir belgeyi "dosyada var" diye gösterme; önerdiğin delil henüz TOPLANMAMIŞ bir delildir.

ÇIKTI — yalnızca şu JSON:
{"gaps":[{"claimRef":"...","severity":"DUSUK|ORTA|YUKSEK|KRITIK","problem":"...","suggestedEvidence":"...","suggestedAction":"...","sourceQuote":"..."}],"summary":"..."}`;

const GAP_FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOSYA: 2026/145 · Ayıplı hammadde nedeniyle tazminat
MATRİS:
- [İDDİA-1] (BIZ, ACIK) Teslim edilen hammadde teknik şartnameye aykırıdır. → destekleyen delil: 2 (en güçlü: 5/5)
- [İDDİA-3] (BIZ, ACIK) 240.000 TL üretim kaybı doğmuştur. → destekleyen delil: 0
[BOŞLUK] [İDDİA-3] hiçbir delille desteklenmiyor (deterministik tespit).`,
  },
  {
    role: "assistant",
    content: `{"gaps":[{"claimRef":"[İDDİA-3]","severity":"KRITIK","problem":"Üretim kaybı iddiası dosyada hiçbir delile bağlı değil; tazminatın miktar kısmı tamamen ispatsız durumda ve bu hâliyle talep reddedilebilir.","suggestedEvidence":"Zarar dönemine ait ticari defter ve kayıtlar, üretim duruşunu gösteren vardiya/üretim raporları, mali müşavir veya YMM tarafından düzenlenmiş kâr kaybı hesap raporu.","suggestedAction":"Delil listesi dilekçesine ticari defterlerin celbi ve hesap bilirkişisi talebi eklenmeli; müvekkilden üretim kayıtları istenmelidir.","sourceQuote":"[BOŞLUK] [İDDİA-3] hiçbir delille desteklenmiyor (deterministik tespit)."}],"summary":"Sorumluluğun esasına ilişkin iddia (İDDİA-1) sağlam delillendirilmiş; zararın MİKTARINA ilişkin iddia (İDDİA-3) ise ispatsızdır. Dosyanın delil riski bu kalemde yoğunlaşmaktadır."}`,
  },
];

export const evidenceGapPrompt: PromptSpec = {
  taskType: EVIDENCE_GAP_TASK,
  name: "Delil Boşluğu Analizi",
  system: EVIDENCE_GAP_SYSTEM,
  fewShot: GAP_FEW_SHOT,
  expectsJson: true,
};

export const EvidenceGapItemSchema = z.object({
  claimRef: z.string().min(1),
  severity: z.enum(["DUSUK", "ORTA", "YUKSEK", "KRITIK"]).default("ORTA"),
  problem: z.string().min(1),
  suggestedEvidence: z.string().min(1),
  suggestedAction: z.string().optional(),
  sourceQuote: z.string().optional(),
});
export type EvidenceGapItem = z.infer<typeof EvidenceGapItemSchema>;

export const EvidenceGapOutputSchema = z.object({
  gaps: z.array(EvidenceGapItemSchema).default([]),
  summary: z.string().optional(),
});
export type EvidenceGapOutput = z.infer<typeof EvidenceGapOutputSchema>;

export function buildEvidenceGapMessages(input: {
  contextText: string;
  instruction: string;
}): LlmMessage[] {
  return buildMessages(
    evidenceGapPrompt,
    `${input.contextText}\n\n=== TALİMAT ===\n${input.instruction}`,
  );
}
