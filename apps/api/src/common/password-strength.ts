/**
 * PAROLA GÜCÜ (Faz 4) — zxcvbn (Dropbox) tahmin-direnci + bağlam sözlüğü.
 *
 * Kural: skor ≥ 3 (10^8+ tahmin) VE e-posta/ad soyad parçalarını içermemeli. Zod şeması
 * uzunluğu (≥10) denetler; bu yardımcı SUNUCU TARAFINDA, parola karma yazılmadan hemen önce
 * çağrılır (büro kullanıcısı oluşturma, parola değiştirme/sıfırlama, portal parola).
 * Geri bildirim Türkçe: kullanıcı neyi düzelteceğini anlar; ham skor sızdırılmaz.
 *
 * Neden zxcvbn: "büyük harf + rakam + sembol" kuralı `Parola123!` gibi sözlük
 * parolalarını geçirir; zxcvbn sözlük, klavye deseni, tarih ve tekrarları tanır.
 */

import { BadRequestException } from "@nestjs/common";
import zxcvbn from "zxcvbn";

export const MIN_PASSWORD_SCORE = 3;
/** Skor 3 tek başına yetmez: "Parola123456!" 3 puan alıyordu (10^8). En az 10^9 tahmin istenir. */
export const MIN_GUESSES_LOG10 = 9;

/**
 * zxcvbn sözlükleri İngilizcedir; Türkçe hukuk/büro bağlamında en sık görülen kelimeler
 * kullanıcı girdisi sözlüğü olarak eklenir (tek başına ya da rakamla birleşince zayıf sayılır).
 */
export const TR_COMMON_WORDS = [
  "parola", "sifre", "şifre", "hukuk", "avukat", "buro", "büro", "dava", "adalet", "mahkeme", "nomosos",
  "istanbul", "ankara", "izmir", "turkiye", "türkiye", "merhaba", "hosgeldin", "hoşgeldin", "demo",
  "admin", "yonetici", "kullanici", "sistem", "baro", "icra", "vekil", "muvekkil", "müvekkil",
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor", "123456", "qwerty", "asdfgh",
];

const FEEDBACK_TR: Record<string, string> = {
  "Use a few words, avoid common phrases": "Birkaç ilişkisiz kelime kullanın; yaygın ifadelerden kaçının.",
  "No need for symbols, digits, or uppercase letters": "Sembol/rakam zorunlu değil; uzunluk ve öngörülemezlik önemli.",
  "Add another word or two. Uncommon words are better.": "Bir-iki kelime daha ekleyin; nadir kelimeler daha iyidir.",
  "Straight rows of keys are easy to guess": "Klavyede yan yana tuşlar kolay tahmin edilir.",
  "Short keyboard patterns are easy to guess": "Kısa klavye desenleri kolay tahmin edilir.",
  "Repeats like \"aaa\" are easy to guess": "\"aaa\" gibi tekrarlar kolay tahmin edilir.",
  "Repeats like \"abcabcabc\" are only slightly harder to guess than \"abc\"": "\"abcabc\" gibi tekrarlar zayıftır.",
  "Sequences like abc or 6543 are easy to guess": "abc / 6543 gibi diziler kolay tahmin edilir.",
  "Recent years are easy to guess": "Yakın yıllar kolay tahmin edilir.",
  "Dates are often easy to guess": "Tarihler genellikle kolay tahmin edilir.",
  "This is a top-10 common password": "Bu, en yaygın 10 paroladan biri.",
  "This is a top-100 common password": "Bu, en yaygın 100 paroladan biri.",
  "This is a very common password": "Bu çok yaygın bir parola.",
  "This is similar to a commonly used password": "Yaygın bir parolaya çok benziyor.",
  "A word by itself is easy to guess": "Tek başına bir kelime kolay tahmin edilir.",
  "Names and surnames by themselves are easy to guess": "Ad ve soyadlar tek başına kolay tahmin edilir.",
  "Common names and surnames are easy to guess": "Yaygın ad ve soyadlar kolay tahmin edilir.",
  "Capitalization doesn't help very much": "Baş harfi büyütmek pek yardımcı olmaz.",
  "All-uppercase is almost as easy to guess as all-lowercase": "Tamamı büyük harf, tamamı küçük harf kadar kolay.",
  "Reversed words aren't much harder to guess": "Ters yazılmış kelimeler pek daha zor değildir.",
  "Predictable substitutions like '@' instead of 'a' don't help very much": "'a' yerine '@' gibi tahmin edilebilir değişimler pek yardımcı olmaz.",
};

function tr(msg: string): string {
  return FEEDBACK_TR[msg] ?? msg;
}

/** Parola bağlam parçalarını (e-posta yerel kısmı, ad soyad kelimeleri) içeriyor mu? */
function containsContext(password: string, context: string[]): string | null {
  const lower = password.toLowerCase();
  for (const raw of context) {
    for (const part of raw.toLowerCase().split(/[@._\-\s]+/)) {
      if (part.length >= 4 && lower.includes(part)) return part;
    }
  }
  return null;
}

export interface PasswordStrengthResult {
  ok: boolean;
  score: number;
  reason: string | null;
}

/** Harfler dışındaki her şey atılınca geriye tek bir sözlük kelimesi kalıyor mu? ("Parola123456!" → "parola") */
function dictionaryCore(password: string): string | null {
  const letters = password.toLocaleLowerCase("tr-TR").replace(/[^a-zçğıöşü]/g, "");
  return letters.length >= 3 && TR_COMMON_WORDS.includes(letters) ? letters : null;
}

export function evaluatePassword(password: string, context: string[] = []): PasswordStrengthResult {
  const hit = containsContext(password, context);
  if (hit) return { ok: false, score: 0, reason: `Parola, hesap bilgilerinizden bir parça içeriyor ("${hit}"); e-posta ve ad soyadınızı parolada kullanmayın.` };
  const core = dictionaryCore(password);
  if (core) return { ok: false, score: 1, reason: `Parola, yaygın bir kelimeye ("${core}") rakam/sembol eklenmiş biçimde; bu kalıp ilk denenenler arasındadır. Birkaç ilişkisiz kelime ya da uzun bir cümle seçin.` };
  const result = zxcvbn(password, [...TR_COMMON_WORDS, ...context]);
  if (result.score >= MIN_PASSWORD_SCORE && result.guesses_log10 >= MIN_GUESSES_LOG10) return { ok: true, score: result.score, reason: null };
  const hints = [result.feedback.warning, ...result.feedback.suggestions].filter(Boolean).map(tr);
  return {
    ok: false,
    score: result.score,
    reason: `Parola yeterince güçlü değil (tahmin direnci ${result.score}/4, en az ${MIN_PASSWORD_SCORE} gerekir). ${hints.join(" ") || "Daha uzun ve öngörülemez bir parola seçin."}`,
  };
}

/** Zayıf parolada 400 (Türkçe gerekçe). */
export function assertPasswordStrength(password: string, context: string[] = []): void {
  const r = evaluatePassword(password, context);
  if (!r.ok) throw new BadRequestException(r.reason ?? "Parola yeterince güçlü değil.");
}
