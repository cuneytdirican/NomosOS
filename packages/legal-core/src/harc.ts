/**
 * DAVA HARÇ VE GİDER AVANSI HESAPLAYICI (geliştirme planı A3).
 *
 * Dayanaklar:
 *   - 492 sayılı Harçlar Kanunu ek-4: maktu ve nispi harçlar; peşin harç
 *     (ilk derece: dava değerinin BİNDE 68,31'i — 2026 tarife), istinaf/temyiz
 *     peşin harcı (binde 34,16 / kararın). Oranlar YILlık CM ile değişir →
 *     PARAMETRE; varsayılanlar açıkça "teyit edin" uyarısıyla döner.
 *   - İİK m.202: gider avansı — icra takibinde masraflar için ileride harcanmak
 *     üzere alınan meblağ; kullanılmayanı istendiği anda iade edilir.
 *
 * Kuruş hassasiyeti Decimal yerine tamsapenny (int) aritmetiğiyle — kayan
 * nokta hatası olmadığı için Motor avukata GÖSTERİR.
 */

export interface DavaHarciInput {
  /** Dava değeri (TL). */
  caseValue: number;
  /** Peşin harç oranı — binde (varsayılan 68.31; dönem oranını teyit edin). */
  pesinRatePerMille?: number;
  /** İstinaf peşin harç oranı — binde (varsayılan 34.16). */
  istinafRatePerMille?: number;
  /** Temyiz peşin harç oranı — binde (varsayılan 68.31 — kararın %'si). */
  temyizRatePerMille?: number;
}

export interface DavaHarciResult {
  pesinHarc: number;
  istinafHarc: number | null;
  temyizHarc: number | null;
  steps: Array<{ label: string; detail?: string; value?: string }>;
  warnings: string[];
}

const pence = (tl: number): number => Math.round(tl * 100);

export function calculateDavaHarci(input: DavaHarciInput): DavaHarciResult {
  if (!(input.caseValue > 0)) throw new Error("Dava değeri sıfırdan büyük olmalıdır.");
  const pesinRate = input.pesinRatePerMille ?? 68.31;
  const istinafRate = input.istinafRatePerMille ?? 34.16;
  const temyizRate = input.temyizRatePerMille ?? 68.31;

  const valueP = pence(input.caseValue);
  const pesinHarcP = Math.round((valueP * pesinRate) / 1000);
  const istinafHarcP = Math.round((valueP * istinafRate) / 1000);
  const temyizHarcP = Math.round((valueP * temyizRate) / 1000);

  const fmt = (p: number): string => (p / 100).toFixed(2);

  return {
    pesinHarc: pesinHarcP / 100,
    istinafHarc: istinafHarcP / 100,
    temyizHarc: temyizHarcP / 100,
    steps: [
      { label: "Dava değeri", value: `${fmt(valueP)} TL` },
      {
        label: "Peşin harç (ilk derece)",
        detail: `${fmt(valueP)} TL × ‰${pesinRate}`,
        value: `${fmt(pesinHarcP)} TL`,
      },
      {
        label: "İstinaf peşin harcı",
        detail: `${fmt(valueP)} TL × ‰${istinafRate}`,
        value: `${fmt(istinafHarcP)} TL`,
      },
      {
        label: "Temyiz peşin harcı",
        detail: `${fmt(valueP)} TL × ‰${temyizRate}`,
        value: `${fmt(temyizHarcP)} TL`,
      },
    ],
    warnings: [
      "Harç oranları her yıl Cumhurbaşkanı Kararı ile güncellenir — yükleme öncesi güncel tarife oranını girin/teyit edin.",
      "Görevli mahkeme ve dava türüne göre maktu harç (ek-4 cetvel) söz konusu olabilir.",
      "İİK m.202 gider avansı ayrı hesaplanır: masraf kalemlerini Dosya Giderleri'nden izleyin.",
    ],
  };
}

/** İİK m.202 gider avansı önerisi — masraf kalemleri listesinden. */
export function suggestAdvanceExpense(items: Array<{ title: string; amount: number }>): {
  total: number;
  breakdown: Array<{ title: string; amount: number }>;
  note: string;
} {
  const total = Math.round(items.reduce((acc, i) => acc + i.amount, 0) * 100) / 100;
  return {
    total,
    breakdown: items,
    note:
      "İİK m.202: gider avansı, icra takibinin masrafları için ileride harcanmak üzere alınır; " +
      "kullanılmayan kısmı istenildiği anda iade edilir.",
  };
}
