/** OPPONENT_SIMULATION — Karşı taraf avukatı simülasyonu (Modül 16). */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

export const OPPONENT_SIMULATION_SYSTEM = `Görevin: dosyayı KARŞI TARAF VEKİLİNİN gözünden okumak ve bize karşı ileri sürebileceği en güçlü argümanları, güç sırasına göre listelemektir. Amaç bizi hazırlıksız yakalanmaktan korumaktır; bu yüzden acımasız ama dürüst ol.

KURALLAR:
1. Her argüman DOSYADAKİ bir veriye dayanmalıdır: belge alıntısı, safahat kaydı, delil eksikliği veya karşı tarafın kendi beyanı. sourceRefs ve/veya alıntı zorunludur; dayanaksız argüman elenir ve avukata gösterilmez.
2. strength 1-10 arası tam sayı: 10 = dosyayı tek başına kaybettirebilir. Puanı gerekçelendir; şişirme.
3. ourGap alanında bizim SOMUT açığımızı yaz ("ıslah tarihi tartışmalı", "tanık listesi süresinde sunulmadı"). "Dikkatli olunmalı" gibi içi boş cümle yazma.
4. suggestedReply alanında bu argümana karşı verilebilecek somut cevabı yaz; cevabın dayanağı da dosyada olmalı, yoksa "bu argümana karşı dosyada dayanak yok, delil toplanmalı" de.
5. İçtihat künyesi yalnızca bağlamda verilmişse kullanılabilir; UYDURMA. Ürettiğin künyeler Teyit Ajanı'ndan geçecektir.
6. Talep edilen sayıdan fazla argüman üretme; dosya o kadar argüman desteklemiyorsa daha az üret ve nedenini overallAssessment'ta yaz.
7. Bu bir simülasyondur; karşı tarafın gerçekte ne yapacağının garantisi değildir. Sonuç tahmini ("davayı kaybederiz") verme, risk tarifi yap.

ÇIKTI — yalnızca şu JSON:
{"arguments":[{"rank":1,"title":"...","basis":"...","strength":9,"ourGap":"...","suggestedReply":"...","severity":"CRITICAL","citations":[],"sourceRefs":[{"documentTitle":"...","page":3,"quote":"..."}]}],"overallAssessment":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `ARGÜMAN SAYISI: 2
DOSYA BAĞLAMI:
[DOSYA] 2026/145 · Alacak davası · Müvekkil: davacı
[BELGE] Cevap Dilekçesi s.3 ¶2 — "alacak TBK m.146 uyarınca on yıllık zamanaşımına uğramıştır"
[SAFAHAT] 2026-06-02 Islah dilekçesi sunuldu (talep artırımı).
[DELİL] İddia edilen teslimatlara ilişkin irsaliyeler dosyaya sunulmamıştır.`,
  },
  {
    role: "assistant",
    content: `{"arguments":[{"rank":1,"title":"Zamanaşımı def'i — özellikle ıslahla artırılan kısım yönünden","basis":"Davalı cevap dilekçesinde on yıllık zamanaşımını ileri sürmüştür; ıslah 02.06.2026 tarihlidir ve artırılan kısım yönünden def'in ayrıca değerlendirilmesi gündeme gelecektir.","strength":8,"ourGap":"Islahla artırılan kısmın zamanaşımına uğrayıp uğramadığı dosyada tartışılmamış; alacağın muaccel olduğu tarihe ilişkin belge bağlamda yok.","suggestedReply":"Alacağın muacceliyet tarihini gösteren belgelerin dosyaya sunulması ve ıslaha karşı zamanaşımı def'inin süresinde ileri sürülüp sürülmediğinin tutanağa geçirilmesi.","severity":"HIGH","citations":[],"sourceRefs":[{"documentTitle":"Cevap Dilekçesi","page":3,"quote":"alacak TBK m.146 uyarınca on yıllık zamanaşımına uğramıştır"}]},{"rank":2,"title":"Teslimatların ispatlanamadığı savunması","basis":"İddia edilen teslimatlara ilişkin irsaliyeler dosyaya sunulmamıştır; karşı taraf ispat yükünün davacıda olduğunu ileri sürecektir.","strength":6,"ourGap":"İrsaliyeler dosyada yok; yalnızca faturaya dayanılıyor.","suggestedReply":"İrsaliyelerin ve teslim tutanaklarının müvekkilden temin edilerek delil listesine eklenmesi; mümkün değilse ticari defterler üzerinde inceleme talebi.","severity":"MEDIUM","citations":[],"sourceRefs":[{"documentTitle":"Delil listesi"}]}],"overallAssessment":"Bağlamda yalnızca iki argümanı destekleyecek somut veri bulunmaktadır. Bu çıktı simülasyondur; karşı tarafın gerçek stratejisini bağlamaz."}`,
  },
];

export const opponentSimulationPrompt: PromptSpec = {
  taskType: "OPPONENT_SIMULATION",
  name: "Karşı Taraf Simülasyonu",
  system: OPPONENT_SIMULATION_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface OpponentSimulationPromptInput {
  caseContextText: string;
  /** Üretilecek argüman sayısı (varsayılan 7 — Modül 16). */
  argumentCount?: number;
  strategySummary?: string;
}

export function buildOpponentSimulationMessages(input: OpponentSimulationPromptInput): LlmMessage[] {
  const parts = [
    `ARGÜMAN SAYISI: ${input.argumentCount ?? 7}`,
    input.strategySummary ? `MEVCUT STRATEJİMİZ:\n${input.strategySummary}` : undefined,
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
  ].filter((v): v is string => Boolean(v));
  return buildMessages(opponentSimulationPrompt, parts.join("\n"));
}
