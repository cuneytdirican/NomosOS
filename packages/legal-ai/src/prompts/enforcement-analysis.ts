/** ENFORCEMENT_ANALYSIS — İcra Copilot (Modül 05 / Modül 21 ajan 4). */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

export const ENFORCEMENT_ANALYSIS_SYSTEM = `Görevin: bir icra takip dosyasının işlem geçmişini okuyup (a) atılabilecek SONRAKİ ADIMLARI, (b) kaçırılmış olabilecek süreleri, (c) itiraz/şikâyet risklerini ve (d) tahsilat ihtimaline dair değerlendirmeyi çıkarmaktır.

KURALLAR:
1. Her bulgu dosyadaki bir işleme dayanmalıdır; sourceQuote veya sourceRefs zorunludur. Dayanaksız bulgu elenir.
2. SÜRE HESAPLAMA YAPMA. "Şu süre kaçırılmış olabilir, kontrol edilmeli" dersin; gün saymaz, son gün vermezsin. Hesap deterministik Süre Motoru'nun işidir; kaçırılmış süre şüphesini KACIRILAN_SURE tipiyle işaretle.
3. Önerdiğin her icra işlemi bir GÖREV ÖNERİSİDİR; avukat onayı olmadan hiçbir işlem başlatılmaz. "Haciz yapıldı" gibi olmuş bitmiş anlatım kurma.
4. collectionLikelihood (0-1) yalnızca dosyada dayanağı varsa (malvarlığı sorgu sonucu, önceki tahsilat, borçlunun beyanı) verilir; dayanak yoksa alanı hiç yazma. Rakamı gerekçesiz verme.
5. Mevzuat atfını (İİK m.…) yalnızca emin olduğun hükümler için yaz; emin değilsen hükmün adını yaz, numara uydurma.

ÇIKTI — yalnızca şu JSON:
{"findings":[{"title":"...","detail":"...","kind":"SONRAKI_ADIM|KACIRILAN_SURE|ITIRAZ|MALVARLIGI|DIGER","severity":"LOW|MEDIUM|HIGH|CRITICAL","sourceQuote":"...","sourceRefs":[{"documentTitle":"..."}]}],"collectionLikelihood":0.0,"collectionReasoning":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `İCRA DOSYASI BAĞLAMI:
[TAKİP] İstanbul 14. İcra Müdürlüğü 2026/8812 · İlamsız takip · Alacak: 250.000 TL
[İŞLEM] 2026-03-04 Ödeme emri tebliğ edildi.
[İŞLEM] 2026-03-11 Borçlu vekili itiraz dilekçesi sundu (borca itiraz).
[İŞLEM] 2026-05-02 Araç ve tapu sorgusu yapıldı: kayıt bulunamadı.
[İŞLEM] Banka hesap sorgusu yapılmamıştır.`,
  },
  {
    role: "assistant",
    content: `{"findings":[{"title":"Borca itiraz nedeniyle takip durmuş görünmektedir; itirazın iptali/kaldırılması yolu değerlendirilmelidir","detail":"Borçlu vekili 11.03.2026'da borca itiraz etmiştir. Takibin devamı için itirazın hükümden düşürülmesine yönelik dava/talep yolunun seçilmesi gerekir. Bu yola başvuru süresi bulunduğundan sürenin Süre Motoru üzerinden kontrol edilmesi gerekir; tarafımca hesaplanmamıştır.","kind":"KACIRILAN_SURE","severity":"CRITICAL","sourceQuote":"2026-03-11 Borçlu vekili itiraz dilekçesi sundu (borca itiraz)","sourceRefs":[{"documentTitle":"İcra işlem geçmişi"}]},{"title":"Banka hesap sorgusu yapılmamış","detail":"Araç ve tapu sorgusu sonuçsuz kalmıştır; bankalar nezdinde hesap sorgusu henüz yapılmamış görünmektedir. Sorgunun talep edilmesi önerilir.","kind":"MALVARLIGI","severity":"MEDIUM","sourceQuote":"Banka hesap sorgusu yapılmamıştır","sourceRefs":[{"documentTitle":"İcra işlem geçmişi"}]}],"collectionLikelihood":0.3,"collectionReasoning":"Araç ve tapu sorgusu kayıt döndürmemiş, ayrıca borca itirazla takip durmuştur; bu iki veri tahsilat ihtimalini düşürmektedir. Banka sorgusu yapılmadığından değerlendirme eksiktir."}`,
  },
];

export const enforcementAnalysisPrompt: PromptSpec = {
  taskType: "ENFORCEMENT_ANALYSIS",
  name: "İcra Analizi",
  system: ENFORCEMENT_ANALYSIS_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface EnforcementAnalysisPromptInput {
  caseContextText: string;
  /** Avukatın dosya içi komutu ("sonraki adım ne olmalı?"). */
  instruction?: string;
}

export function buildEnforcementAnalysisMessages(input: EnforcementAnalysisPromptInput): LlmMessage[] {
  const parts = [
    input.instruction ? `TALİMAT: ${input.instruction}` : undefined,
    `İCRA DOSYASI BAĞLAMI:\n${input.caseContextText}`,
  ].filter((v): v is string => Boolean(v));
  return buildMessages(enforcementAnalysisPrompt, parts.join("\n"));
}
