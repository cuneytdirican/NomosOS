/**
 * SÜRE MOTORU HESAP İZİ — TANITIM SİTESİNİN TEK KANITI, MOTORDAN ÜRETİLİR.
 *
 * NEDEN BU DOSYA VAR:
 * Ana sayfadaki hesap izi kartı, "süreyi yapay zekâ değil kural motoru hesaplar"
 * iddiasının tek somut kanıtıdır ve docs/08 onu "gerçek çıktı" diye tanımlar.
 * Ama metinler `content.ts` içine ELLE yazılmıştı ve motordan sapmıştı:
 *
 *   Vitrinde : "HMK m.92: tebliğ günü hesaba katılmaz"
 *   Motorda  : "HMK m.91 + m.92/2: süre, tebliğ tarihinden işler ve son
 *               haftada karşılık gelen günde biter"
 *
 * Örnek HMK m.345 İSTİNAF süresidir ve birimi HAFTA'dır. m.92/1'in "tebliğ
 * günü sayılmaz" kuralı GÜN sürelerine aittir; hafta/ay/yıl sürelerinde tebliğ
 * günü dışlanmaz, karşılık gelen gün esas alınır. Motor bu ayrımı bilerek yapar
 * (deadline-engine.ts, "denetim bulgusu 16"); yani tanıtım sitesi, motorun
 * özellikle kaçındığı hukuken yanlış ifadeyi vitrine koymuştu. Sonuç tarihi
 * doğru, GEREKÇE yanlıştı — ki bir hukuk ürününde asıl satılan gerekçedir.
 *
 * ÇÖZÜM: iz artık elle yazılmaz. `computeDeadline` derleme anında çağrılır ve
 * kartın her satırı motorun O GİRDİ İÇİN ürettiği açıklamadan gelir. Motor
 * değişirse vitrin de değişir; sapma yapısal olarak imkânsızdır.
 *
 * ÖRNEĞİN TETİK TARİHİ NEDEN 10.07.2026:
 * Önceki örnek 18.08.2026 idi — adli tatilin (20 Temmuz – 31 Ağustos, HMK
 * m.102) tam içi. Son gün tatilin dışına düştüğü için m.104 uzaması gerçekten
 * uygulanmıyordu ve hesap doğruydu; ama izde adli tatile TEK SATIR bile
 * değinilmiyordu. Bu tarihi gören bir Türk avukatının ilk sorusu "adli tatil
 * nerede?" olur ve sitenin alan bilgisi iddiası ilk anda sorgulanır.
 *
 * 10.07.2026 tetiğinde ham son gün 24.07.2026'ya, yani adli tatilin İÇİNE
 * düşer; motor m.104 uzamasını UYGULAR ve bu adımı kendi ağzından yazar.
 * Böylece kart, kaçınılan bir soruyu cevaplamak yerine motorun en değerli
 * davranışını gösterir.
 *
 * SUNUCU BİLEŞENİ: `DeadlineFeature` istemci bileşeni değildir; bu modül
 * istemci paketine girmez.
 */

import {
  computeDeadline,
  getSystemRule,
  toHolidayInputs,
  parseDateOnly,
  toRuleInput,
  TR_HOLIDAYS_2026,
} from "@nomosos/legal-core";

/** Vitrindeki örneğin girdisi — motorun gerçek parametreleri. */
const SAMPLE = {
  ruleKey: "HMK_ISTINAF",
  triggerDate: "2026-07-10",
  serviceMethod: "POSTA",
} as const;

/**
 * Adım kodu → karttaki kısa etiket. Motorun AÇIKLAMA METNİNİ değiştirmez;
 * yalnız satırın soluna okunur bir başlık koyar.
 *
 * `DeadlineComputationStep.step` alanı `string` olarak tiplenmiştir (kod
 * `DeadlineStepCode` değerlerinden gelir); eşleme bu yüzden `string` anahtarlı
 * tutulur ve bilinmeyen kodda motorun kendi kodu gösterilir.
 */
const STEP_LABELS: Record<string, string> = {
  TETIK: "Tetik tarihi",
  TEBLIGAT_DUZELTMESI: "Tebligat düzeltmesi",
  BASLANGIC: "Başlangıç",
  SURE_EKLEME: "Süre ekleme",
  ADLI_TATIL: "Adli tatil",
  TATIL_KAYDIRMASI: "Tatil kaydırması",
  SON_GUN: "Son gün",
};

export interface DeadlineTraceStep {
  no: string;
  label: string;
  /** MOTORUN KENDİ AÇIKLAMASI — elle düzenlenmez. */
  value: string;
}

function formatTr(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}.${m}.${date.getUTCFullYear()}`;
}

function buildTrace() {
  const rule = toRuleInput(getSystemRule(SAMPLE.ruleKey));
  const result = computeDeadline({
    ruleKey: SAMPLE.ruleKey,
    rule,
    triggerDate: parseDateOnly(SAMPLE.triggerDate),
    serviceMethod: SAMPLE.serviceMethod,
    holidays: toHolidayInputs(TR_HOLIDAYS_2026),
  });

  // SON_GUN adımı kartın altındaki sonuç şeridinde ayrıca gösterilir; listede
  // tekrar edilmez.
  const steps: DeadlineTraceStep[] = result.steps
    .filter((s) => s.step !== "SON_GUN")
    .map((s, index) => ({
      no: String(index + 1),
      label: STEP_LABELS[s.step] ?? s.step,
      value: s.explanation,
    }));

  return {
    /** "10.07.2026 tebliğ · İstinaf süresi (HMK m.345 — 2 hafta)" */
    header: `${formatTr(parseDateOnly(SAMPLE.triggerDate))} tebliğ · ${
      getSystemRule(SAMPLE.ruleKey).name
    } (${result.legalBasis})`,
    steps,
    resultValue: formatTr(result.dueDate),
    warnings: result.warnings,
  };
}

/**
 * Kart içeriği. Modül yüklenirken BİR KEZ hesaplanır; `computeDeadline` saf ve
 * deterministiktir (ağ yok, saat yok, rastgelelik yok).
 */
export const deadlineTrace = buildTrace();
