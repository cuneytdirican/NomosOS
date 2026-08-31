/**
 * AD/UNVAN NORMALİZASYONU VE BENZERLİK — TAMAMEN DETERMİNİSTİK.
 *
 * Çıkar çatışması taramasının birinci katmanı buradadır ve hiçbir aşamada
 * LLM kullanılmaz. Aynı fonksiyon hem tarama sorgusuna hem indeksteki her
 * kayda uygulanır; aksi halde eşik değerleri anlamsızlaşır (docs/moduller/
 * 11-conflict-check.md, iş kuralı 11: "hem taramada hem indekste aynı
 * fonksiyon kullanılır").
 *
 * Üç adım:
 *   1) TÜRKÇE KATLAMA — "İ/I/ı/i", "Ş/ş", "Ğ/ğ", "Ü/ü", "Ö/ö", "Ç/ç" ASCII'ye
 *      indirgenir. `String.toLowerCase()` TEK BAŞINA YETMEZ: JavaScript'in
 *      varsayılan yerelinde "I".toLowerCase() → "i" olur ve Türkçe "I"nın
 *      karşılığı "ı"dır. "IŞIK" ile "Işık" bu yüzden ayrı düşerdi.
 *   2) HUKUKİ BİÇİM EKLERİNİN ATILMASI — "A.Ş.", "Ltd. Şti.", "San. ve Tic."
 *      gibi ekler AYIRT EDİCİ DEĞİLDİR; "XYZ Gıda San. ve Tic. A.Ş." ile
 *      "XYZ Gıda" aynı tüzel kişidir. Sektör sözcükleri (gıda, inşaat,
 *      lojistik) ve "holding" KASITEN korunur — "ABC Holding" ile
 *      "ABC İnşaat" AYNI ŞEY DEĞİLDİR ve deterministik katman bunları
 *      eşleştirmemelidir (bu ayrımı yalnızca AI çıkarım katmanı "olası bağ"
 *      olarak işaretleyebilir).
 *   3) NOKTALAMA/BOŞLUK SADELEŞTİRMESİ.
 *
 * Benzerlik ölçütü Levenshtein mesafesinden türeyen 0–1 aralığında bir
 * orandır. Skor bir SIRALAMA aracıdır; karar değildir.
 */

/** Türkçe harflerin ASCII karşılıkları (büyük/küçük ayrımı kapatılır). */
const TR_FOLD: Record<string, string> = {
  İ: "i",
  I: "i",
  ı: "i",
  i: "i",
  Ş: "s",
  ş: "s",
  Ğ: "g",
  ğ: "g",
  Ü: "u",
  ü: "u",
  Ö: "o",
  ö: "o",
  Ç: "c",
  ç: "c",
  Â: "a",
  â: "a",
  Î: "i",
  î: "i",
  Û: "u",
  û: "u",
};

/**
 * Atılacak hukuki biçim / genel ticaret ekleri.
 *
 * DİKKAT: buraya sektör bildiren bir sözcük EKLENMEMELİDİR. "gida", "insaat",
 * "lojistik", "holding" ayırt edicidir; atılırlarsa birbirinden bağımsız iki
 * şirket %100 benzerlikle eşleşir ve tarama yanlış pozitif üretir.
 */
const LEGAL_FORM_TOKENS = new Set([
  "as", // A.Ş.
  "a",
  "s",
  "ltd",
  "sti",
  "std",
  "anonim",
  "limited",
  "sirket",
  "sirketi",
  "sirketleri",
  "san",
  "sanayi",
  "sanayii",
  "tic",
  "ticaret",
  "kollektif",
  "koll",
  "komandit",
  "kom",
  "adi",
  "ortakligi",
  "ortakligi",
  "ve",
  "vd",
  "isletmesi",
  "isletmeleri",
]);

/** Türkçe harf katlaması + küçük harfe indirgeme. */
export function foldTurkish(value: string): string {
  let out = "";
  for (const ch of value) {
    out += TR_FOLD[ch] ?? ch.toLowerCase();
  }
  return out;
}

/**
 * Karşılaştırma için normalize edilmiş ad.
 * "XYZ Gıda San. ve Tic. A.Ş." → "xyz gida"
 */
export function normalizeName(value: string): string {
  const folded = foldTurkish(value)
    // Noktalama ve ayraçlar boşluğa dönüşür ("a.ş." → "a s ").
    .replace(/[.,;:()[\]{}"'`/\\|_+\-–—*&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const kept = folded
    .split(" ")
    .filter((token) => token.length > 0 && !LEGAL_FORM_TOKENS.has(token));

  // Tüm parçalar ek çıkarsa (ör. yalnızca "A.Ş." girilmişse) katlanmış hâl korunur;
  // boş bir normalize form her şeye %100 benzerdi.
  return kept.length > 0 ? kept.join(" ") : folded;
}

/** Levenshtein düzenleme mesafesi (iteratif, iki satırlık bellek). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/**
 * YAPISAL BENZERLİK TAVANI.
 *
 * Kapsama ve hizalama gibi YAPISAL ölçütler bu değeri aşamaz; CAKISMA eşiği
 * (0,90) yalnızca KARAKTER düzeyinde neredeyse özdeş adlarla geçilebilir.
 * İlke: "aynı kişidir" iddiası bir sezgiye değil, adın kendisine dayanmalıdır.
 * Kısaltma/parça eşleşmeleri en fazla DİKKAT üretir, insan bakar.
 */
const STRUCTURAL_CAP = 0.88;

/** Kısaltma sayılması için gereken asgari önek uzunluğu ("loj." → "lojistik"). */
const ABBREV_MIN_PREFIX = 3;

/** İki parçanın 0–1 benzerliği; kısaltma öneki özel olarak ödüllendirilir. */
function tokenScore(a: string, b: string): number {
  if (a === b) return 1;
  // "loj" ↔ "lojistik": Türk ticaret unvanlarında en yaygın kısaltma biçimi.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= ABBREV_MIN_PREFIX && long.startsWith(short)) return 0.92;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}

/**
 * İki adın 0–1 aralığındaki benzerliği (1 = normalize formları özdeş).
 *
 * ÜÇ ÖLÇÜTÜN EN BÜYÜĞÜ alınır; her biri farklı bir gerçek dünya kalıbını
 * yakalar ve hiçbiri tek başına ÇAKIŞMA ilan ettiremez:
 *
 *  1. KARAKTER ORANI (Levenshtein) — yazım hataları ve ek farkları.
 *     Tek başına 0,90'ı geçebilen ölçüt budur; çünkü adın kendisi eşleşiyordur.
 *
 *  2. KAPSAMA — kısa adın TÜM parçaları uzun adda birebir geçiyorsa yükselir.
 *     "Mehmet Yılmaz" ↔ "Mehmet Ali Yılmaz" karakter oranıyla düşük çıkar
 *     (göbek adı mesafeyi büyütür) ama aynı kişi olma ihtimali yüksektir.
 *
 *  3. HİZALAMA — parça parça eşleştirme, kısaltma önekleri dâhil.
 *     "XYZ Loj. A.Ş." ↔ "XYZ Lojistik A.Ş." SADECE bu ölçütle yakalanır:
 *     hukuki ekler atıldıktan sonra "xyz loj" ile "xyz lojistik" kalır ve
 *     karakter oranı 0,58'de kalarak eşiğin ALTINA düşerdi. Bu, docs/moduller/
 *     11'in temel örneğidir ve deterministik katmanın kaçırmaması gerekir —
 *     aksi hâlde gerçek bir karşı taraf çakışması AI'nın gri bölgesine
 *     itilirdi.
 *
 * Uzunluk farkı hizalamayı cezalandırır: tek parçalı bir sorgunun çok parçalı
 * her unvana yapışmasını önler.
 */
export function nameSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeName(aRaw);
  const b = normalizeName(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const distance = levenshtein(a, b);
  const ratio = 1 - distance / Math.max(a.length, b.length);

  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  const [shorter, longer] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  if (shorter.length === 0) return Math.max(0, Math.min(1, ratio));

  const longerSet = new Set(longer);
  const contained = shorter.filter((t) => longerSet.has(t)).length;
  const coverage = (contained / shorter.length) * STRUCTURAL_CAP;

  const alignmentRaw =
    shorter.reduce((sum, token) => sum + Math.max(...longer.map((o) => tokenScore(token, o))), 0) /
    shorter.length;
  const lengthPenalty = Math.sqrt(shorter.length / longer.length);
  const alignment = Math.min(alignmentRaw * lengthPenalty, STRUCTURAL_CAP);

  return Math.max(0, Math.min(1, Math.max(ratio, coverage, alignment)));
}

/** Skoru dört haneye yuvarlar (kayıt ve karşılaştırma tutarlılığı). */
export function roundSimilarity(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
