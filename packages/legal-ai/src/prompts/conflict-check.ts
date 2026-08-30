/** CONFLICT_INFERENCE — Conflict Check Ajanı (Modül 11 / Modül 21 ajan 8). */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

export const CONFLICT_CHECK_SYSTEM = `Görevin: yeni bir müvekkil/karşı taraf kaydı ile büronun mevcut taraf indeksi arasında ÇIKAR ÇATIŞMASI riski doğurabilecek eşleşmeleri tespit etmek.

Deterministik eşleşmeyi (birebir aynı vergi/kimlik numarası, birebir aynı unvan) sistem zaten yapar. Senin işin, kuralların kaçırdığı NİTEL benzerlikleri yakalamaktır: unvan varyasyonları ("XYZ Loj. A.Ş." ↔ "XYZ Lojistik Anonim Şirketi"), ticari ad değişiklikleri, grup şirketi ilişkisi, aynı gerçek kişinin farklı yazımı, aynı adres/temsilci üzerinden bağ.

KURALLAR:
1. Her eşleşme için indeksteki KAYIT REFERANSINI (recordRef) ve benzerliğin somut gerekçesini yaz. Gerekçesiz eşleşme elenir.
2. severity: KIRMIZI = aynı kişi/şirket olma ihtimali yüksek veya doğrudan karşı taraf çakışması; SARI = ilişkili olabilir, insan incelemesi gerekli; YESIL = zayıf benzerlik, bilgi amaçlı.
3. TAHMİN ÜRETME. İndekste olmayan bir şirket ilişkisi ("muhtemelen aynı gruptandır") iddia etme; yalnızca sana verilen kayıtlardaki verilere dayan.
4. Eşleşme yoksa matches boş dizi ve overallSeverity YESIL olsun. "Emin olmak için kontrol edin" gibi doldurma kayıt üretme.
5. Bu bir ÖNERİDİR; KIRMIZI/SARI bulguda müvekkil kabulü PARTNER onayına düşer, kararı sistem değil insan verir.

ÇIKTI — yalnızca şu JSON:
{"matches":[{"matchType":"AYNI_KISI|BENZER_UNVAN|ILISKILI_SIRKET|KARSI_TARAF|DIGER","recordRef":"...","similarityReason":"...","severity":"YESIL|SARI|KIRMIZI","sourceQuote":"..."}],"overallSeverity":"YESIL|SARI|KIRMIZI"}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `YENİ TARAF: "XYZ Loj. A.Ş." · Tüzel kişi · Sıfat: MÜVEKKİL ADAYI
MEVCUT TARAF İNDEKSİ:
- [client-12] "XYZ Lojistik Anonim Şirketi" · müvekkil · 3 açık dosya
- [party-455] "XYZ Lojistik A.Ş." · KARŞI TARAF · dosya 2025/77 (derdest)
- [client-31] "ABC Gıda Ltd. Şti." · müvekkil`,
  },
  {
    role: "assistant",
    content: `{"matches":[{"matchType":"KARSI_TARAF","recordRef":"party-455","similarityReason":"Yeni taraf unvanı, 2025/77 sayılı derdest dosyada KARŞI TARAF olarak kayıtlı \\"XYZ Lojistik A.Ş.\\" ile aynı ticari unvanın kısaltılmış yazımıdır; aynı tüzel kişi olması kuvvetle muhtemeldir.","severity":"KIRMIZI","sourceQuote":"[party-455] \\"XYZ Lojistik A.Ş.\\" · KARŞI TARAF · dosya 2025/77 (derdest)"},{"matchType":"BENZER_UNVAN","recordRef":"client-12","similarityReason":"\\"XYZ Loj. A.Ş.\\" ile \\"XYZ Lojistik Anonim Şirketi\\" arasında unvan kısaltması düzeyinde birebir örtüşme vardır; mevcut müvekkil kaydıyla aynı tüzel kişi olabilir.","severity":"SARI","sourceQuote":"[client-12] \\"XYZ Lojistik Anonim Şirketi\\" · müvekkil · 3 açık dosya"}],"overallSeverity":"KIRMIZI"}`,
  },
];

export const conflictCheckPrompt: PromptSpec = {
  taskType: "CONFLICT_INFERENCE",
  name: "Çıkar Çatışması Taraması",
  system: CONFLICT_CHECK_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface ConflictCheckPromptInput {
  /** Yeni taraf tanımı (ad/unvan + tip + sıfat). */
  newPartyLabel: string;
  /** Mevcut taraf indeksinin ilgili kesiti (kayıt referanslı satırlar). */
  partyIndexLines: readonly string[];
}

export function buildConflictCheckMessages(input: ConflictCheckPromptInput): LlmMessage[] {
  const index = input.partyIndexLines.length
    ? input.partyIndexLines.map((l) => `- ${l}`).join("\n")
    : "- (indeks boş)";
  return buildMessages(
    conflictCheckPrompt,
    `YENİ TARAF: ${input.newPartyLabel}\nMEVCUT TARAF İNDEKSİ:\n${index}`,
  );
}
