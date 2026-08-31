/**
 * ŞABLON YER TUTUCU ÇÖZÜCÜSÜ — TAMAMEN DETERMİNİSTİK, AI YOK.
 *
 * Modül 19 iş kuralı 9 / kabul kriteri 9: "Şablondaki {{degisken}} alanları dosya
 * verisiyle doldurulur; çözülemeyen değişken varsa taslak onaya DÜŞMEDEN hata
 * verir."
 *
 * BURADA "BOŞ BIRAKMA" DİYE BİR SEÇENEK YOKTUR. Bir yer tutucunun sessizce boş
 * geçmesi, müvekkile "Sayın ,  sayılı dosyanızın duruşması  tarihinde" diye bir
 * metin göndermek demektir; daha kötüsü, {{tutar}} boş kalırsa para cümlesi
 * anlamını yitirir. Bu yüzden çözülemeyen her yer tutucu ADIYLA raporlanır ve
 * çağıran 400 alır.
 *
 * ALIAS POLİTİKASI — BİLİNÇLİ OLARAK DAR:
 *   Görev tanımı {{mahkeme}} diyor, seed'deki sistem şablonu {{mahkemeAdi}}
 *   yazıyor. İkisi de AYNI veriyi (Case.courtName) istiyor; bunlar eş adlardır ve
 *   birbirine bağlanır.
 *
 *   Buna karşılık {{tutar}} ↔ {{faturaTutari}} veya {{sonTarih}} ↔ {{vadeTarihi}}
 *   eş ad DEĞİLDİR: dava değeri fatura tutarı değildir, süre son günü ödeme vadesi
 *   değildir. Bunları "yakın anlamlı" diye eşlemek, müvekkile YANLIŞ BİR PARA VEYA
 *   TARİH göndermenin en sessiz yoludur. Eşlenmezler; çağıran değeri açıkça verir,
 *   vermezse hata alır.
 */

/** `{{ad}}` — Türkçe harf içeren adlar da kabul edilir. */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_ÇĞİÖŞÜçğıöşüİı]+)\s*\}\}/g;

/** Aynı veriyi isteyen eş adlar. Sadece EŞ AD; "yakın anlamlı" buraya girmez. */
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["mahkeme", "mahkemeAdi"],
  ["avukatAdi", "sorumluAvukat"],
  ["buroAdi", "buro"],
];

const ALIAS_INDEX: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>();
  for (const group of ALIAS_GROUPS) {
    for (const name of group) map.set(name, group);
  }
  return map;
})();

export type TemplateContext = Readonly<Record<string, string | null | undefined>>;

/** Çözülemeyen yer tutucu(lar) — çağıran bunu 400'e çevirir. */
export class UnresolvedPlaceholderError extends Error {
  constructor(readonly placeholders: readonly string[]) {
    super(
      `Şablondaki şu değişkenler doldurulamadı: ${placeholders.map((p) => `{{${p}}}`).join(", ")}. ` +
        "Eksik değerleri `variables` alanında gönderin; yer tutucu boş bırakılarak mesaj üretilmez.",
    );
    this.name = "UnresolvedPlaceholderError";
  }
}

/** Şablon gövdesindeki yer tutucu adları (tekrarsız, görülme sırasıyla). */
export function extractPlaceholders(template: string): string[] {
  const found: string[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Bir yer tutucunun değeri.
 *
 * BOŞ/whitespace değer ÇÖZÜLMEMİŞ sayılır: `courtName = ""` olan bir dosyada
 * "{{mahkeme}} nezdinde görülen" cümlesi " nezdinde görülen"e dönüşürdü.
 */
function resolve(context: TemplateContext, name: string): string | undefined {
  const names = ALIAS_INDEX.get(name) ?? [name];
  for (const candidate of names) {
    const value = context[candidate];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Şablonda çözülemeyecek yer tutucular — RENDER ETMEDEN önce bakmak için. */
export function missingPlaceholders(template: string, context: TemplateContext): string[] {
  return extractPlaceholders(template).filter((name) => resolve(context, name) === undefined);
}

/**
 * Şablonu bağlamla doldurur. Tek bir yer tutucu bile çözülemezse
 * {@link UnresolvedPlaceholderError} fırlatır — kısmi metin ÜRETİLMEZ.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const missing = missingPlaceholders(template, context);
  if (missing.length > 0) throw new UnresolvedPlaceholderError(missing);

  PLACEHOLDER_RE.lastIndex = 0;
  return template.replace(PLACEHOLDER_RE, (_full, name: string) => {
    // `missing` boş olduğuna göre burada daima bir değer vardır.
    return resolve(context, name) as string;
  });
}

/* -------------------------------------------------------------------------- *
 * Otomatik bağlam — kayıttan gelen, DETERMİNİSTİK türetilen değerler
 * -------------------------------------------------------------------------- */

/**
 * Otomatik bağlamın ham girdisi.
 *
 * TİPİN KENDİSİ BİR GÜVENLİK SINIRIDIR: burada strateji, risk skoru, iç not,
 * simülasyon veya karşı taraf alanı YOKTUR (Modül 19 iş kuralı 8). Şablon
 * çözücü, taşıyamadığı veriyi sızdıramaz.
 */
export interface AutoContextSource {
  clientName: string;
  tenantName: string;
  /** Sorumlu avukat; yoksa taslağı hazırlayan kullanıcı. */
  lawyerName?: string | null;
  case?: {
    fileNumber?: string | null;
    courtName?: string | null;
    subject?: string | null;
    title?: string | null;
    /** Prisma.Decimal'in `toFixed(2)` çıktısı — float ARİTMETİĞİ YOK. */
    amountDecimalString?: string | null;
  } | null;
  /** Sıradaki duruşma (varsa). */
  hearingAt?: Date | null;
  /** En yakın açık sürenin son günü (varsa). */
  nextDeadlineAt?: Date | null;
  nextDeadlineTitle?: string | null;
}

/** Türkiye sabit ofseti (+03:00) — 2016'dan beri yaz saati yoktur. */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

function trParts(date: Date): { d: string; m: string; y: string; hh: string; mm: string } {
  const t = new Date(date.getTime() + TR_OFFSET_MS);
  return {
    d: String(t.getUTCDate()).padStart(2, "0"),
    m: String(t.getUTCMonth() + 1).padStart(2, "0"),
    y: String(t.getUTCFullYear()),
    hh: String(t.getUTCHours()).padStart(2, "0"),
    mm: String(t.getUTCMinutes()).padStart(2, "0"),
  };
}

/** 14.10.2026 — müvekkile giden metinde kullanılan biçim (TR yerel takvim). */
export function formatTrDateForClient(date: Date): string {
  const p = trParts(date);
  return `${p.d}.${p.m}.${p.y}`;
}

/** 10:30 — TR yerel saat. */
export function formatTrTimeForClient(date: Date): string {
  const p = trParts(date);
  return `${p.hh}:${p.mm}`;
}

/**
 * "1234567.89" → "1.234.567,89 TL".
 *
 * GİRDİ DECIMAL DİZESİDİR, `number` DEĞİLDİR: para hiçbir aşamada float'a
 * dönüşmez (ortak karar 5). Basamak ayırma tamamen dize işlemidir.
 */
export function formatTryFromDecimalString(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPartRaw, fracRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  const frac = (fracRaw + "00").slice(0, 2);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${frac} TL`;
}

/**
 * Kayıttan türetilen yer tutucu değerleri.
 *
 * Değeri olmayan alan bağlama KONMAZ (undefined). Böylece şablon o yer tutucuyu
 * kullanıyorsa `renderTemplate` hata verir — "veri yok" sessizce boş metne
 * dönüşmez.
 */
export function autoTemplateContext(source: AutoContextSource): TemplateContext {
  const context: Record<string, string | undefined> = {
    muvekkilAdi: source.clientName,
    buroAdi: source.tenantName,
    avukatAdi: source.lawyerName ?? undefined,
    dosyaNo: source.case?.fileNumber ?? undefined,
    mahkeme: source.case?.courtName ?? undefined,
    dosyaKonusu: source.case?.subject ?? source.case?.title ?? undefined,
    tutar: source.case?.amountDecimalString
      ? formatTryFromDecimalString(source.case.amountDecimalString)
      : undefined,
    durusmaTarihi: source.hearingAt ? formatTrDateForClient(source.hearingAt) : undefined,
    durusmaSaati: source.hearingAt ? formatTrTimeForClient(source.hearingAt) : undefined,
    sonTarih: source.nextDeadlineAt ? formatTrDateForClient(source.nextDeadlineAt) : undefined,
    sonTarihKonusu: source.nextDeadlineTitle ?? undefined,
  };
  return context;
}

/**
 * Otomatik bağlam + kullanıcının verdiği değerler.
 *
 * KULLANICI DEĞERİ ÜSTTEDİR: avukat, kayıttaki mahkeme adını düzeltmek isteyebilir.
 * Boş dizeyle geçersiz kılma yapılamaz (boş = "verilmedi").
 */
export function mergeTemplateContext(
  auto: TemplateContext,
  overrides: Readonly<Record<string, string>> | undefined,
): TemplateContext {
  if (!overrides) return auto;
  const merged: Record<string, string | null | undefined> = { ...auto };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string" && value.trim().length > 0) merged[key] = value;
  }
  return merged;
}
