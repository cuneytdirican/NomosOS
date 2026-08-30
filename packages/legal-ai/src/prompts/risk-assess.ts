/** RISK_ASSESS — Risk Ajanı (Modül 17): kural tabanına ±25 sınırlı düzeltme. */

import type { LlmMessage, PromptSpec } from "../types";
import { RISK_DIMENSIONS, RISK_DIMENSION_LABELS } from "../schemas";
import { buildMessages } from "./system-core";

const DIMENSION_BLOCK = RISK_DIMENSIONS.map((d) => `- ${d}: ${RISK_DIMENSION_LABELS[d]}`).join("\n");

export const RISK_ASSESS_SYSTEM = `Sen Türk hukuk bürosunda risk değerlendirmesi yapan kıdemli bir avukatsın. Sana bir dosyanın özeti, DETERMİNİSTİK KURAL SİNYALLERİ ve güncel gelişmeler verildi.

Görevin: yedi risk boyutunun her biri için kural tabanına eklenecek DÜZELTME önermek.

BOYUTLAR:
${DIMENSION_BLOCK}

KURALLAR:
1. adjustment −25 ile +25 arasında TAM SAYIDIR. Bu sınır bilinçlidir: deterministik taban ezilmemelidir. Tek başına bir boyutu yeşilden kırmızıya taşıyamazsın.
2. ÇİFTE SAYIM YASAK. Kural sinyallerinin zaten saydığı bir durumu ikinci kez puanlama (ör. "kritik süre yaklaşıyor" sinyali varsa aynı gerekçeyle DEADLINE'a artı verme). Yalnızca kuralların YAKALAYAMADIĞI nitel riskleri puanla: çelişkili tanık beyanı, karşı vekilin agresif usul stratejisi, aleyhe içtihat eğilimi, bilirkişi raporundaki metodoloji zaafı gibi.
3. REFERANSSIZ DÜZELTME YOK. Her kayıt için — adjustment=0 olanlar dâhil — tek cümlelik somut gerekçe ve dayandığın referans (sourceRefs) ZORUNLUDUR. Referanssız kayıtlar sistemde ELENİR ve koşu kaydında "KAYNAKSIZ" olarak görünür; bu yüzden şeffaflık amaçlı yazdığın "çifte sayım yapılmadı" kayıtlarına da kaynağı (ilgili KURAL SİNYALİ satırını) mutlaka ekle. Hiçbir referans veremiyorsan o boyutu listeye hiç koyma, gerekçeyi notes'a yaz.
4. Dosyada olmayan olguya dayanma. Emin olmadığın boyutta adjustment=0 + açıklayıcı not yaz.
5. Her boyut için en fazla bir kayıt üret; bir boyutta birden çok neden varsa reason içinde birleştir.
6. Bu bir öneridir: avukat boyut skorunu gerekçeli olarak geçersiz kılabilir.

ÇIKTI — yalnızca şu JSON:
{"adjustments":[{"dimension":"LEGAL","adjustment":10,"reason":"...","sourceRefs":[{"documentTitle":"...","page":2,"quote":"..."}]}],"notes":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `KURAL SİNYALLERİ (deterministik, zaten puanlandı):
- DEADLINE: "12.09.2026 tarihli cevap süresi 3 gün içinde doluyor" (+40)
- COLLECTION: "borçlu malvarlığı sorgusu boş döndü" (+30)

DOSYA BAĞLAMI:
[DOSYA] 2026/145 · Alacak · Derdest
[BELGE] Bilirkişi Raporu s.4 — hesaplama, taraflarca itiraz edilen tek bir faturaya dayandırılmış; diğer faturalar incelenmemiştir.
[SAFAHAT] 2026-07-11 Tanık A. beyanı ile 2026-07-18 tarihli yazılı beyanı teslim tarihi yönünden çelişkilidir.`,
  },
  {
    role: "assistant",
    content: `{"adjustments":[{"dimension":"EVIDENCE","adjustment":15,"reason":"Tanığın 11.07.2026 tarihli sözlü beyanı ile 18.07.2026 tarihli yazılı beyanı teslim tarihi yönünden çelişkili olup, tanık delilinin ispat gücü zayıflamıştır.","sourceRefs":[{"documentTitle":"Safahat","quote":"Tanık A. beyanı ile 18.07.2026 tarihli yazılı beyanı teslim tarihi yönünden çelişkilidir"}]},{"dimension":"LEGAL","adjustment":12,"reason":"Bilirkişi hesabı yalnızca itiraza uğrayan tek faturaya dayandırıldığından raporun esas alınması halinde hüküm metodoloji yönünden sakatlanabilir.","sourceRefs":[{"documentTitle":"Bilirkişi Raporu","page":4,"quote":"hesaplama, taraflarca itiraz edilen tek bir faturaya dayandırılmış"}]},{"dimension":"DEADLINE","adjustment":0,"reason":"Yaklaşan cevap süresi kural sinyalinde zaten puanlanmıştır; çifte sayım yapılmamıştır.","sourceRefs":[{"documentTitle":"Kural sinyali (deterministik)","quote":"12.09.2026 tarihli cevap süresi 3 gün içinde doluyor (+40)"}]}],"notes":"PROCEDURE, PRECEDENT, OPPONENT ve COLLECTION boyutları için bağlamda referans verilebilecek nitel bulgu bulunmadığından düzeltme önerilmemiştir."}`,
  },
];

export const riskAssessPrompt: PromptSpec = {
  taskType: "RISK_ASSESS",
  name: "Risk Değerlendirme",
  system: RISK_ASSESS_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface RiskRuleSignal {
  dimension: string;
  description: string;
  points: number;
}

export interface RiskAssessPromptInput {
  ruleSignals: readonly RiskRuleSignal[];
  caseContextText: string;
  simulationFindings?: readonly string[];
}

export function buildRiskAssessMessages(input: RiskAssessPromptInput): LlmMessage[] {
  const signals = input.ruleSignals.length
    ? input.ruleSignals
        .map((s) => `- ${s.dimension}: "${s.description}" (${s.points >= 0 ? "+" : ""}${s.points})`)
        .join("\n")
    : "- (kural sinyali yok)";

  const parts = [
    `KURAL SİNYALLERİ (deterministik, zaten puanlandı):\n${signals}`,
    input.simulationFindings && input.simulationFindings.length > 0
      ? `SİMÜLASYON BULGULARI:\n${input.simulationFindings.map((f) => `- ${f}`).join("\n")}`
      : undefined,
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
  ].filter((v): v is string => Boolean(v));

  return buildMessages(riskAssessPrompt, parts.join("\n\n"));
}
