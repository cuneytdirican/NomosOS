/**
 * CITATION_VERIFY — Teyit / Doğrulama Ajanı.
 *
 * Bu ajan bir "onay" değil, bir KAPIDIR (approvalMode = GATE) ve tenant
 * tarafından kapatılamaz. Kritik mimari kural: VERIFIED sonucu YALNIZCA
 * deterministik eşleşmeyle (yerel içtihat havuzu veya kaynak adaptörü kaydı)
 * verilir. LLM'in "büyük ihtimalle vardır" çıktısı hiçbir koşulda VERIFIED
 * üretemez; model yalnızca künye normalizasyonu ve
 * "kaynak metin bu önermeyi destekliyor mu?" karşılaştırması yapar.
 */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

export const CITATION_VERIFY_SYSTEM = `Sen bir hukuk kontrolörüsün. Sana (a) bir metinde kullanılan atıflar ve o atıfların desteklediği önermeler, (b) sistemin deterministik aramayla bulduğu KAYNAK KAYITLARI verildi.

GÖREVİN YALNIZCA KARŞILAŞTIRMADIR. Bir künyenin var olup olmadığına SEN karar vermezsin; bunu sistem yapar ve sana "KAYNAK KAYDI" olarak verir veya vermez.

STATÜ KURALLARI (istisnasız):
- VERIFIED: yalnızca o atıf için sana bir KAYNAK KAYDI verilmişse ve künye (kaynak, esas no, karar no) kayıtla birebir uyuşuyorsa.
- NOT_FOUND: sistem araması sağlıklı çalışmış ve o künye için kayıt BULUNAMAMIŞSA. Bu, atfın büyük olasılıkla uydurma olduğunu gösterir.
- AMBIGUOUS: künye eksik/çelişkili ise (ör. daire yok, iki farklı kayıtla eşleşiyor) VEYA kaynak adaptörü erişilemediği için arama yapılamamışsa ("ARAMA YAPILAMADI") VEYA o künye için hiç arama sonucu ulaşmamışsa ("ARAMA YAPILMADI"). Erişilemeyen/aranmamış kaynak ASLA VERIFIED sayılmaz (fail-closed).
- VERIFIED verirken matchedCaseLawId (mevzuat için matchedStatuteVersionId) alanını, sistemin sana verdiği id ile AYNEN doldur. Id yazmadığın bir VERIFIED sistem tarafından reddedilir.
Arama sonuçları satırları künye ile eşlenmiş olarak verilir; bir künyeyi BAŞKA bir satırın kaydıyla doğrulama.
Sana kaynak metni verilmediyse verdict üretme; status'ü NOT_FOUND veya AMBIGUOUS yap ve nedenini not'a yaz.

KAYNAK KAYDI VARSA verdict alanını da doldur — önerme ile kaynak metnin ilişkisi:
- SUPPORTS: kaynak metin önermeyi gerçekten destekliyor.
- PARTIAL: kısmen destekliyor; kapsam/koşul farkı var.
- CONTRADICTS: kaynak metin önermenin aksini söylüyor.
- UNRELATED: kaynak gerçek ama önermeyle ilgisiz (yanlış yerde atıf).

DİĞER KURALLAR:
1. Her atıf için tek cümlelik somut not yaz; "iyi görünüyor" gibi içi boş ifade kullanma.
2. Kendi hafızandan karar metni, daire adı veya tarih ekleme. Yorum yapma, tavsiye verme.
3. Künyeyi normalize et: esas/karar numaralarını "YYYY/N" biçiminde yaz; kaynak (YARGITAY/DANISTAY/BAM/AYM/AIHM) belirle. Normalizasyon dışında künyeyi DEĞİŞTİRME.
4. overallStatus: hepsi VERIFIED ise PASSED; bir kısmı VERIFIED ise PARTIAL; hiçbiri VERIFIED değilse FAILED.

ÇIKTI — yalnızca şu JSON:
{"citations":[{"raw":"...","status":"VERIFIED|NOT_FOUND|AMBIGUOUS","matchedCaseLawId":"...","verdict":"SUPPORTS|PARTIAL|CONTRADICTS|UNRELATED","note":"..."}],"overallStatus":"PASSED|PARTIAL|FAILED"}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOĞRULANACAK ATIFLAR:
[1] "Yargıtay 9. HD 2023/4512 E. 2023/9981 K." — Önerme: "Geçerli fesihte ispat yükü işverendedir."
[2] "Yargıtay 22. HD 2021/812 E. 2021/9999 K." — Önerme: "Performans düşüklüğü tek başına geçerli fesih nedenidir."
[3] "Danıştay 10. D. 2020/154 E." — Önerme: "İdari işlemin gerekçesi bildirilmelidir."

SİSTEM ARAMA SONUÇLARI (deterministik, künye ile eşlenmiş):
[1] "Yargıtay 9. HD 2023/4512 E. 2023/9981 K." → BULUNDU · id: cl-7781 · Yargıtay 9. Hukuk Dairesi 2023/4512 E., 2023/9981 K., 14.11.2023 · İlgili pasaj: "feshin geçerli bir nedene dayandığını ispat yükü işverene aittir"
[2] "Yargıtay 22. HD 2021/812 E. 2021/9999 K." → BULUNAMADI · adaptör sağlıklı (yargitay-v1: OK)
[3] "Danıştay 10. D. 2020/154 E." → ARAMA YAPILAMADI · adaptör erişilemedi (danistay-v1: TIMEOUT)`,
  },
  {
    role: "assistant",
    content: `{"citations":[{"raw":"Yargıtay 9. HD 2023/4512 E. 2023/9981 K.","status":"VERIFIED","matchedCaseLawId":"cl-7781","verdict":"SUPPORTS","note":"Künye havuzdaki kayıtla birebir uyuşuyor ve kararın ilgili pasajı ispat yükünün işverende olduğu önermesini doğrudan desteklemektedir."},{"raw":"Yargıtay 22. HD 2021/812 E. 2021/9999 K.","status":"NOT_FOUND","note":"Adaptör sağlıklı çalıştığı halde bu esas/karar numarasına ait kayıt bulunamadı; atıf metinden çıkarılmalı veya doğru künye ile değiştirilmelidir."},{"raw":"Danıştay 10. D. 2020/154 E.","status":"AMBIGUOUS","note":"Karar numarası verilmemiş ve Danıştay adaptörüne erişilemediği için arama yapılamadı; erişilemeyen kaynak doğrulanmış sayılmaz."}],"overallStatus":"PARTIAL"}`,
  },
];

export const citationVerifyPrompt: PromptSpec = {
  taskType: "CITATION_VERIFY",
  name: "Teyit Ajanı (Atıf Doğrulama)",
  system: CITATION_VERIFY_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface CitationVerifyItem {
  raw: string;
  /** Atfın desteklediği önerme (metindeki cümle). */
  proposition?: string;
}

export interface CitationLookupResult {
  raw: string;
  /** Deterministik arama sonucu: bulundu / bulunamadı / arama yapılamadı. */
  outcome: "FOUND" | "NOT_FOUND" | "SEARCH_FAILED";
  caseLawId?: string;
  statuteVersionId?: string;
  /** Havuzdaki kaydın künyesi ve ilgili pasajı. */
  record?: string;
  adapterNote?: string;
}

export interface CitationVerifyPromptInput {
  citations: readonly CitationVerifyItem[];
  lookups: readonly CitationLookupResult[];
}

/** Künye eşlemesi için kaba normalizasyon (boşluk/noktalama duyarsız). */
function citationKey(raw: string): string {
  return raw.toLocaleLowerCase("tr-TR").replace(/[\s.,;:/\\-]+/g, "");
}

/**
 * DÜZELTİLDİ (hukuki denetim, bulgu 5): atıf ile arama sonucu YALNIZCA DİZİ İNDİSİYLE
 * eşleştiriliyordu (`citations[i]` ↔ `lookups[i]`); `raw` karşılaştırması ve uzunluk
 * kontrolü yoktu. Sıralama kayması ya da eksik lookup, bir künyenin BULUNDU kaydını
 * BAŞKA künyeye yazdırıp SAHTE VERIFIED üretebilirdi.
 *
 * Artık lookup'lar `raw` anahtarıyla eşlenir ve atıf sırasında yeniden üretilir;
 * karşılığı olmayan atıf "ARAMA YAPILMADI" satırı alır (fail-closed), fazladan/eşleşmeyen
 * lookup varsa Türkçe hata fırlatılır.
 */
export function buildCitationVerifyMessages(input: CitationVerifyPromptInput): LlmMessage[] {
  if (input.citations.length === 0) {
    throw new Error("Teyit Ajanı için en az bir atıf verilmelidir.");
  }

  const lookupByKey = new Map<string, CitationLookupResult>();
  for (const lookup of input.lookups) {
    const key = citationKey(lookup.raw);
    if (lookupByKey.has(key)) {
      throw new Error(`Aynı künye için birden çok arama sonucu verildi: "${lookup.raw}".`);
    }
    lookupByKey.set(key, lookup);
  }

  const used = new Set<string>();
  const lines: string[] = [];
  const lookupLines: string[] = [];

  input.citations.forEach((c, i) => {
    lines.push(
      `[${i + 1}] "${c.raw}"${c.proposition ? ` — Önerme: "${c.proposition}"` : " — Önerme verilmedi."}`,
    );

    const key = citationKey(c.raw);
    const lookup = lookupByKey.get(key);
    if (lookup) used.add(key);

    if (!lookup) {
      lookupLines.push(
        `[${i + 1}] "${c.raw}" → ARAMA YAPILMADI · bu künye için sisteme arama sonucu ulaşmadı`,
      );
      return;
    }
    if (lookup.outcome === "FOUND") {
      const id = lookup.caseLawId ?? lookup.statuteVersionId ?? "-";
      lookupLines.push(`[${i + 1}] "${c.raw}" → BULUNDU · id: ${id} · ${lookup.record ?? ""}`.trimEnd());
      return;
    }
    if (lookup.outcome === "NOT_FOUND") {
      lookupLines.push(
        `[${i + 1}] "${c.raw}" → BULUNAMADI · ${lookup.adapterNote ?? "adaptör sağlıklı"}`,
      );
      return;
    }
    lookupLines.push(
      `[${i + 1}] "${c.raw}" → ARAMA YAPILAMADI · ${lookup.adapterNote ?? "adaptör erişilemedi"}`,
    );
  });

  const orphan = [...lookupByKey.keys()].filter((key) => !used.has(key));
  if (orphan.length > 0) {
    throw new Error(
      `Arama sonuçları atıf listesiyle eşleşmiyor: ${orphan.length} sonucun karşılığı olan künye yok. ` +
        "Yanlış künyeye BULUNDU kaydı yazmamak için istek durduruldu.",
    );
  }

  return buildMessages(
    citationVerifyPrompt,
    `DOĞRULANACAK ATIFLAR:\n${lines.join("\n")}\n\n` +
      `SİSTEM ARAMA SONUÇLARI (deterministik, künye ile eşlenmiş):\n${lookupLines.join("\n")}`,
  );
}
