/**
 * D6-B — MÜKERRER MÜVEKKİL TESPİTİ (benzerlik motoru).
 *
 * DETERMİNİSTİKTİR — AI YOKTUR (ürün ilkesi: çelişki kontrolü ve kimlik
 * eşleştirmesi yeniden üretilebilir olmak zorundadır; iki kez çalıştırınca
 * iki farklı sonuç veren bir "tahmin" kabul edilemez).
 *
 * İki düzey:
 *   1. Tam eşleşme — vergi no / TCKN / e-posta / telefon (bunlar ZATEN kaydı
 *      engelleyen kimlik alanlarıdır; tespit uyarısı bunları da listeler).
 *   2. Ad benzerliği — normalize edilmiş ad karşılaştırması:
 *      a) Türkçe karakter/küçük harf normalizasyonu
 *      b) hukuki eklerin ayıklanması (A.Ş., Ltd., Şti., "ve Ticaret"…)
 *      c) Jaro-Winkler benzerliği ≥ eşik (0.86) veya normalize birebir eşlik
 *
 * Jaro-Winkler seçimi: kişi/şirket adlarındaki YER DEĞİŞİMİNE (ad-soyad
 * sıralaması, "AŞ" eklemesi) toleranslı, kısa dizgelerde kararlı, ağırlığı
 * öne veren bir dizgi benzerliğidir — tam da "aynı müvekkil başka yazımla
 * girilmiş mi" sorusuna uyar. Levenshtein mesafesi tek harf hatalarına
 * duyarsızdır ama eklenen/çıkan kelimelerde (ör. "Holding") cezalandırır.
 */

/** Ad benzerliği eşiği — AMPİRİK ölçüldü (thresh-probe): 0.90.
 * "Deniz Tekstil"×"Deniz Lojistik" = 0.890, "Kaya İnşaat"×"Kaya Ticaret" =
 * 0.841 (yanlış pozitifler — eşiğin altında); yazım hataları ve ek farkları
 * 0.94–1.00 (eşiğin üstünde). 0.86'da "aynı ilk kelime + benzer ikinci
 * kelime" yanlış pozitif üretiyordu. */
export const NAME_SIMILARITY_THRESHOLD = 0.9;

/** Türkçe karakter eşlemesi — karşılaştırma ASCII benzeri düzleme iner. */
const TR_MAP: Record<string, string> = {
  ç: "c", Ç: "c",
  ğ: "g", Ğ: "g",
  ı: "i", I: "i",
  İ: "i", i: "i",
  ö: "o", Ö: "o",
  ş: "s", Ş: "s",
  ü: "u", Ü: "u",
};

/**
 * Ad normalizasyonu: Türkçe karakter → ASCII, küçük harf, noktalama → boşluk,
 * hukuki eklerin ayıklanması, boşlukların tekleştirilmesi.
 */
export function normalizeName(raw: string): string {
  let s = (raw ?? "").toLocaleLowerCase("tr-TR");
  s = s.replace(/[çÇğĞıIİiöÖşŞüÜ]/g, (ch) => TR_MAP[ch] ?? ch);
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  // Ekleri SONDAN ayıkla ("ABC Holding A.Ş." → "abc"); ortadaki ekler kalır —
  // "Holding ABC" tuhaf yazımlarında fazla agresif ayıklama yanlış eşleşme
  // üretir. Çoklu kelimeli ekler ("ve ticaret", "a s") için BİRLEŞİK diziye
  // karşı regex ile tekrarlı ayıklama.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(
      /(?: ve ticaret| ve tic| anonim sirketi| limited sirketi| ltd sti| hukuk burosu| a s|as|ltd|sti|limited|holding|grup|hukuk)$/,
      ""
    ).trim();
    // Adın TAMAMI ek olamaz ("Holding" gibi tek kelimelik adı silme).
    if (next === s || next.length === 0) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * JARO-WINKLER benzerliği — [0, 1]; 1 = özdeş.
 * Standart algoritma: Jaro uzaklığı + önek bonusu (p = 0.1, l ≤ 4).
 */
export function jaroWinkler(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  // Eşleşme penceresi — klasik tanım: floor(max(|s1|,|s2|)/2) − 1
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatch = new Array<boolean>(la).fill(false);
  const bMatch = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Transpozisyonlar
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const m = matches;
  const jaro = (m / la + m / lb + (m - transpositions) / m) / 3;

  // Winkler önek bonusu
  let prefix = 0;
  const maxPrefix = Math.min(4, la, lb);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Ad benzerliği kararı — normalize birebir eşlik VEYA Jaro-Winkler ≥ eşik.
 * Tek ANLAMLI KAYNAKTIR; hizmet ve olası istemci aynı işlevi kullanır.
 */
export function isSimilarName(a: string, b: string): { similar: boolean; score: number } {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length === 0 || nb.length === 0) return { similar: false, score: 0 };
  if (na === nb) return { similar: true, score: 1 };
  const score = jaroWinkler(na, nb);
  return { similar: score >= NAME_SIMILARITY_THRESHOLD, score };
}
