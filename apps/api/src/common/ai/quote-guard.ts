/**
 * ALINTI DOĞRULAMA — "kaynak gösterme zorunlu, uydurma yasak" ilkesinin
 * SUNUCU TARAFINDAKİ uygulaması.
 *
 * `packages/legal-ai`in output-guard'ı bir bulguda kaynak alanının DOLU olup
 * olmadığına bakar; DOĞRU olup olmadığına bakamaz — çünkü kaynak metni onda
 * yoktur. Model "alıntı" diye kendi cümlesini yazarsa guard'dan geçer.
 *
 * Bu dosya ikinci ve asıl kapıdır: her alıntının KAYNAK METİNDE GERÇEKTEN
 * geçtiğini doğrular. Geçmeyen bulgu ELENİR ve elenme yanıtta görünür
 * (docs/moduller/20, kabul kriteri 3: "bulunamayan alıntı elenir ve loglanır").
 *
 * NEDEN COMMON/AI ALTINDA (denetim bulgusu Ö-20): kural ilk olarak sözleşme
 * incelemesi için yazılmış ve `contracts/` altında durmuştu. Sonucu: kapı
 * `contracts`, `poa` ve `communication` yollarında çağrılıyor, ama BELGE HATTI
 * (`pipeline/`) ve SİMÜLASYON (`simulation/`) yollarında SIFIR kez çağrılıyordu.
 * Oysa uydurma alıntının en tehlikeli olduğu yerler tam olarak orasıydı:
 *
 *   · DEADLINE_DETECT `{"eventDate":"2026-08-12","sourceQuote":"Bilirkişi raporu
 *     12.08.2026 tarihinde tebliğ edilmiş olmakla"}` üretir; bu cümle belgede
 *     yoktur, gerçek tarih 22.08'dir. Alıntı `DocumentActionProposal.sourceQuote`a
 *     yazılır ve avukata "Belgeden alıntı: «…»" diye gösterilir. Avukat alıntıyı
 *     GÖRDÜĞÜ İÇİN onaylar; deterministik motor 12.08'den hesaplar.
 *   · KARSI_DILEKCE_ZAYIFLIK, karşı dilekçede bulunmayan bir "çelişki alıntısı"
 *     üretir (şemada zorunlu alan); avukat replik dilekçesinde bu cümleyi karşı
 *     tarafa atfeder.
 *
 * Kapı artık ORTAK bir yerdedir ki hiçbir yeni AI yolu onu "başka modülün
 * dosyası" diye atlamasın. `contracts/quote-guard.ts` bu dosyayı yeniden
 * dışa aktarır (geriye dönük uyum).
 *
 * NORMALİZASYON: birebir karşılaştırma pratikte çok kırılgandır — model
 * satır sonlarını, çift boşlukları ve tırnak işaretlerini değiştirir. Bu
 * yüzden karşılaştırma "anlamı değiştirmeyen" farklara kapatılır:
 *   • ardışık boşluklar tek boşluğa,
 *   • Türkçe/tipografik tırnak ve tire çeşitleri düz karşılıklarına,
 *   • baş/son noktalama kırpılır,
 *   • Türkçe yerelde küçük harfe indirilir (İ/I ayrımı korunur).
 * Kelime SIRASI ve İÇERİĞİ korunur: model cümleyi yeniden yazarsa eşleşmez.
 */

/** Alıntının anlamlı sayılması için gereken asgari uzunluk (karakter). */
export const MIN_QUOTE_LENGTH = 12;

/** Tipografik varyantları düzleştirip boşlukları tekleştirir. */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    // denetim bulgusu Ö-33b: bölünemez boşluk (U+00A0) kaynakta GÖRÜNMEZ bir
    // karakter olarak duruyordu; kaçış dizisiyle yazmak hem lint'in
    // `no-irregular-whitespace` kuralını karşılar hem de niyeti okunur kılar.
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'`.,;:()[\]-]+|[\s"'`.,;:()[\]-]+$/g, "")
    .toLocaleLowerCase("tr-TR");
}

/** Alıntı kaynak metinde geçiyor mu. */
export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const needle = normalizeForQuoteMatch(quote);
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return normalizeForQuoteMatch(sourceText).includes(needle);
}

export interface DroppedQuoteFinding {
  /** Elenen bulgunun dizideki sırası (1'den başlar, kullanıcıya gösterilir). */
  index: number;
  /** İnsan-okur etiket. */
  label: string;
  reason: "ALINTI_METINDE_BULUNAMADI" | "ALINTI_YOK" | "ALINTI_COK_KISA";
  /** Modelin verdiği alıntı (kırpılmış) — şeffaflık için yanıtta döner. */
  quote?: string;
}

export interface QuoteFilterResult<T> {
  kept: T[];
  dropped: DroppedQuoteFinding[];
}

/**
 * Bulgu dizisini alıntı doğrulamasından geçirir.
 *
 * @param items      Model bulguları.
 * @param sourceText Alıntının aranacağı KAYNAK metin (sözleşme/vekaletname).
 * @param getQuote   Bulgudan alıntıyı okur.
 * @param getLabel   Elenme kaydında gösterilecek etiket.
 */
export function filterByVerbatimQuote<T>(
  items: readonly T[],
  sourceText: string,
  getQuote: (item: T) => string | undefined | null,
  getLabel: (item: T, index: number) => string,
): QuoteFilterResult<T> {
  const kept: T[] = [];
  const dropped: DroppedQuoteFinding[] = [];

  items.forEach((item, i) => {
    const quote = getQuote(item)?.trim();
    if (!quote) {
      dropped.push({ index: i + 1, label: getLabel(item, i), reason: "ALINTI_YOK" });
      return;
    }
    if (normalizeForQuoteMatch(quote).length < MIN_QUOTE_LENGTH) {
      dropped.push({
        index: i + 1,
        label: getLabel(item, i),
        reason: "ALINTI_COK_KISA",
        quote: quote.slice(0, 160),
      });
      return;
    }
    if (!quoteAppearsIn(quote, sourceText)) {
      dropped.push({
        index: i + 1,
        label: getLabel(item, i),
        reason: "ALINTI_METINDE_BULUNAMADI",
        quote: quote.slice(0, 160),
      });
      return;
    }
    kept.push(item);
  });

  return { kept, dropped };
}

/** Elenme gerekçelerinin Türkçe karşılığı (yanıt ve günlük için). */
export const DROP_REASON_LABELS: Record<DroppedQuoteFinding["reason"], string> = {
  ALINTI_YOK: "Bulgu metinden alıntı taşımıyor.",
  ALINTI_COK_KISA: `Alıntı ${MIN_QUOTE_LENGTH} karakterden kısa; kaynak sayılmadı.`,
  ALINTI_METINDE_BULUNAMADI:
    "Alıntı kaynak metinde birebir bulunamadı; bulgu uydurulmuş sayılarak elendi.",
};
