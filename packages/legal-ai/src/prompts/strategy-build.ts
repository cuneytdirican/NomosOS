/** STRATEGY_BUILD — Strateji Ajanı (Modül 15 / Modül 21 ajan 5). */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

export const STRATEGY_BUILD_SYSTEM = `Görevin: dosyanın verisinden bir DAVA STRATEJİSİ AĞACI taslağı üretmek. Ağaç düğümleri: HEDEF (ulaşmak istediğimiz sonuç), ARGUMAN (hedefi taşıyan hukuki iddia), DAYANAK (argümanın delili/mevzuatı/emsali), RISK (argümanı zayıflatan unsur), AKSIYON (yapılması gereken somut iş).

KURALLAR:
1. Her düğüm dosyadaki bir veriye bağlanır: sourceRefs veya citations zorunludur. Dayanaksız düğüm elenir; strateji ağacında "güzel duran ama dosyada karşılığı olmayan" argümana yer yoktur.
2. TARAFSIZ AĞAÇ. Her ARGUMAN düğümü için en az bir DAYANAK ve mümkünse bir RISK düğümü üret; tek taraflı iyimser ağaç kurma. RISK düğümü DAYANAK düğümü kadar ciddiye alınır: karşı tarafın argümanını en güçlü hâliyle karşılayan riskleri yaz. Ağaç bir zafer planı değil, dosyanın stratejik gerçeğidir.
3. Emsal künyesi yalnızca bağlamda verilen onaylı emsallerden alınır; künye UYDURMA. Emsal boşluğu varsa bunu bir AKSIYON düğümü olarak yaz ("… konusunda emsal taraması yapılmalı").
4. Mevzuat atfında emin değilsen madde numarası verme, hükmün adını yaz.
5. Sonuç tahmini/garanti verme; RISK düğümlerinde olasılık yerine somut zayıflığı tarif et.
6. key alanı kısa, kararlı ve benzersiz bir slug olsun (ör. "arg_zamanasimi_def"); versiyon diff'i bu anahtara dayanır.
7. Bu bir taslaktır; strateji versiyonunun yayını avukat onayına tabidir.

ÇIKTI — yalnızca şu JSON:
{"nodes":[{"key":"...","title":"...","kind":"HEDEF|ARGUMAN|DAYANAK|RISK|AKSIYON","detail":"...","citations":[],"sourceRefs":[{"documentTitle":"...","page":1,"quote":"..."}]}],"summary":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOSYA BAĞLAMI:
[DOSYA] 2026/145 · İşe iade · Müvekkil: davacı işçi
[BELGE] Fesih Bildirimi (12.01.2026) — gerekçe: "performans yetersizliği"
[BELGE] Bilirkişi Raporu s.7 — "feshin geçerli nedene dayandığı ispatlanamamıştır"
[DELİL] İşverence savunma alındığına dair belge dosyada yok.
ONAYLI EMSALLER: (yok)`,
  },
  {
    role: "assistant",
    content: `{"nodes":[{"key":"hedef_ise_iade","title":"Feshin geçersizliğine ve işe iadeye karar verilmesi","kind":"HEDEF","detail":"Davacının iş sözleşmesinin geçerli neden olmaksızın feshedildiğinin tespiti ve işe iadesine karar verilmesi hedeflenmektedir.","citations":[],"sourceRefs":[{"documentTitle":"Fesih Bildirimi","quote":"performans yetersizliği"}]},{"key":"arg_ispat_yuku","title":"Geçerli nedenin ispatı işverendedir ve ispatlanamamıştır","kind":"ARGUMAN","detail":"Bilirkişi raporu, feshin geçerli nedene dayandığının ispatlanamadığını tespit etmiştir; ispat yükü işverendedir.","citations":[],"sourceRefs":[{"documentTitle":"Bilirkişi Raporu","page":7,"quote":"feshin geçerli nedene dayandığı ispatlanamamıştır"}]},{"key":"day_bilirkisi_raporu","title":"Bilirkişi raporunun 7. sayfasındaki tespit","kind":"DAYANAK","detail":"Rapor, işverenin performans iddiasını objektif ölçütlerle temellendiremediğini ortaya koymaktadır.","citations":[],"sourceRefs":[{"documentTitle":"Bilirkişi Raporu","page":7}]},{"key":"arg_savunma_alinmamasi","title":"Fesih öncesi savunma alınmamıştır","kind":"ARGUMAN","detail":"Dosyada işverence davacının savunmasının alındığına dair belge bulunmamaktadır; usule aykırılık iddiası kurulabilir.","citations":[],"sourceRefs":[{"documentTitle":"Delil listesi","quote":"İşverence savunma alındığına dair belge dosyada yok"}]},{"key":"risk_performans_kayitlari","title":"İşveren performans kayıtlarını sonradan sunabilir","kind":"RISK","detail":"İşveren, performans değerlendirme kayıtlarını delil listesine ekleyerek raporun dayanağını tartışmaya açabilir; bu durumda ek bilirkişi incelemesi gündeme gelir.","citations":[],"sourceRefs":[{"documentTitle":"Fesih Bildirimi"}]},{"key":"aks_emsal_taramasi","title":"Emsal taraması yapılmalı","kind":"AKSIYON","detail":"Performansa dayalı fesihte savunma alınması ve objektif ölçüt zorunluluğu konusunda emsal karar taraması yapılıp dosyaya onaylı emsal bağlanmalıdır; bağlamda onaylı emsal bulunmadığından künye verilmemiştir.","citations":[],"sourceRefs":[]}],"summary":"Strateji, ispat yükü ve fesih usulü olmak üzere iki argüman ekseninde kurulmuştur. Emsal desteği henüz yoktur ve taranmalıdır. Taslaktır; yayını avukat onayına tabidir."}`,
  },
];

export const strategyBuildPrompt: PromptSpec = {
  taskType: "STRATEGY_BUILD",
  name: "Strateji Oluşturma",
  system: STRATEGY_BUILD_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface StrategyBuildPromptInput {
  caseContextText: string;
  approvedPrecedents?: readonly string[];
  /** Mevcut strateji ağacının özeti (güncelleme koşusunda). */
  existingStrategySummary?: string;
}

export function buildStrategyBuildMessages(input: StrategyBuildPromptInput): LlmMessage[] {
  const precedents =
    input.approvedPrecedents && input.approvedPrecedents.length > 0
      ? input.approvedPrecedents.map((p) => `- ${p}`).join("\n")
      : "(yok)";
  const parts = [
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
    `ONAYLI EMSALLER:\n${precedents}`,
    input.existingStrategySummary
      ? `MEVCUT STRATEJİ (güncellenecek):\n${input.existingStrategySummary}`
      : undefined,
  ].filter((v): v is string => Boolean(v));
  return buildMessages(strategyBuildPrompt, parts.join("\n\n"));
}
