/**
 * Sistem (tenant'lar arası ortak) süre kuralları — TEK KAYNAK.
 *
 * `packages/db/src/seed.ts` bu listeyi doğrudan import eder; iki dosyada elle
 * kopya tutulmaz. Kural değişikliği yalnızca burada yapılır.
 *
 * `judicialRecessApplies` alanı HMK m.103'teki "adli tatilde görülecek dava ve
 * işler" istisnasına ve ilgili kanunun kapsam sınırına göre belirlenir:
 * o kapsama giren işlerde süreler adli tatilde işlemeye devam eder, dolayısıyla
 * m.104 uzaması uygulanmaz.
 *
 * `procedureCode` hesap izindeki madde referanslarını seçer (HMK m.92/93 yerine
 * icra sürelerinde İİK m.19, ceza sürelerinde CMK m.39 gösterilir).
 */

import type { DeadlineRuleInput, SystemDeadlineRule } from "./types";

export const SYSTEM_DEADLINE_RULES: SystemDeadlineRule[] = [
  {
    key: "HMK_CEVAP",
    name: "Cevap dilekçesi süresi",
    description: "Dava dilekçesinin tebliğinden itibaren cevap dilekçesi verme süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.127 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "HMK_CEVABA_CEVAP",
    name: "Cevaba cevap (replik) süresi",
    description: "Cevap dilekçesinin tebliğinden itibaren cevaba cevap dilekçesi süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.136 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "HMK_IKINCI_CEVAP",
    name: "İkinci cevap (düplik) süresi",
    description: "Cevaba cevap dilekçesinin tebliğinden itibaren ikinci cevap dilekçesi süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.136 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "HMK_BILIRKISI_ITIRAZ",
    name: "Bilirkişi raporuna itiraz süresi",
    description: "Bilirkişi raporunun tebliğinden itibaren itiraz süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.281 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    // DÜZELTİLDİ (denetim bulgusu 8): eski `HMK_ISLAH_BEYAN` kuralı "ıslaha karşı
    // beyan süresi" adıyla HMK m.181'e atıf yapıyordu; hem madde hem muhatap
    // yanlıştı. HMK m.181 ISLAH EDEN TARAFA, ıslah ettiği usul işlemini yapması
    // için verilen bir haftalık süredir: "Kısmen ıslaha başvuran tarafa, ıslah
    // ettiği usul işlemini yapması için bir haftalık süre verilir."
    //
    // KARŞI TARAFIN ıslaha karşı beyan süresi HMK'da düzenlenmemiştir;
    // uygulamada mahkemece takdiren (çoğunlukla iki hafta, kıyasen m.127)
    // verilir. Sabit süreli bir sistem kuralı olarak modellenemeyeceği için
    // ayrı bir kural eklenmemiştir — kullanıcı bunu MANUEL süre olarak girmelidir.
    key: "HMK_ISLAH_USUL_ISLEMI",
    name: "Islah eden tarafın usul işlemini yapma süresi",
    description:
      "Kısmen ıslaha başvuran tarafa, ıslah ettiği usul işlemini yapması için verilen süre. " +
      "Karşı tarafın ıslaha karşı beyan süresi HMK'da düzenlenmemiştir; mahkemece takdiren verilir (manuel süre giriniz).",
    durationValue: 1,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.181 — 1 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "HMK_ISTINAF",
    name: "İstinaf başvuru süresi",
    description: "Gerekçeli kararın tebliğinden itibaren istinaf kanun yoluna başvuru süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.345 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "HMK_TEMYIZ",
    name: "Temyiz süresi",
    description: "Bölge adliye mahkemesi kararının tebliğinden itibaren temyiz süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.361 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    // DÜZELTİLDİ (denetim bulgusu 18): eski anahtar `HMK_KARAR_DUZELTME_YOK`
    // yaptığı işi anlatmıyordu ve tek kural iki ayrı maddeyi karşılıyordu.
    key: "HMK_ISTINAFA_CEVAP",
    name: "İstinaf dilekçesine cevap süresi",
    description: "İstinaf dilekçesinin tebliğinden itibaren cevap süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.347 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "HMK_TEMYIZE_CEVAP",
    name: "Temyiz dilekçesine cevap süresi",
    description: "Temyiz dilekçesinin tebliğinden itibaren cevap süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "HMK m.365 — 2 hafta",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "IIK_ODEME_EMRI_ITIRAZ",
    name: "Ödeme emrine itiraz süresi (ilamsız takip)",
    description:
      "İLAMSIZ takipte ödeme emrinin tebliğinden itibaren itiraz süresi. " +
      "KAMBİYO SENETLERİNE MAHSUS TAKİPLERDE GEÇERLİ DEĞİLDİR — orada süre 5 gündür (İİK m.168/5); " +
      "«Kambiyo takibinde ödeme emrine itiraz süresi» kuralını kullanınız.",
    durationValue: 7,
    durationUnit: "GUN",
    legalBasis: "İİK m.62 — 7 gün",
    caseTypes: ["ICRA"],
    // DÜZELTİLDİ (denetim bulgusu 12): eski gerekçe "HMK m.103/1-ç" diyordu;
    // (ç) bendi İŞÇİ DAVALARIDIR, icra-iflas değil. Kaldı ki olağan icra takip
    // süreleri zaten m.103 kapsamında değildir. Doğru gerekçe: HMK m.104
    // yalnızca "BU KANUNUN tayin ettiği süreler"i kapsar; İİK m.19'da adli tatil
    // uzaması öngörülmemiştir. (İflas ve konkordato işleri m.103/1-e'dedir.)
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    // EKLENDİ (denetim bulgusu 13 — listedeki en riskli eksik):
    // Kambiyo takibinde tek seçenek olarak m.62'nin 7 günlük süresi sunulursa
    // avukat 2 gün geç hesaplar ve itiraz hakkı düşer.
    key: "IIK_KAMBIYO_ODEME_EMRI_ITIRAZ",
    name: "Kambiyo takibinde ödeme emrine itiraz süresi",
    description:
      "Kambiyo senetlerine mahsus haciz yoluyla takipte ödeme emrinin tebliğinden itibaren " +
      "icra mahkemesine itiraz süresi. İlamsız takipteki 7 günlük süreden (İİK m.62) FARKLIDIR.",
    durationValue: 5,
    durationUnit: "GUN",
    legalBasis: "İİK m.168/5 — 5 gün",
    caseTypes: ["ICRA"],
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    // DÜZELTİLDİ (denetim bulgusu 2): eski tek kural "İİK m.96 — 7 gün" idi ve
    // her iki hâlde de yanlış sonuç veriyordu. İİK m.96/2'de istihkak iddiasına
    // karşı diyecekleri bildirme (İTİRAZ) süresi ÜÇ GÜNDÜR: "…üç gün içinde
    // bildirilmesi için alacaklı ve borçluya bir muhtıra tebliğ eder. Sükûtları
    // hâlinde istihkak iddiasını kabul etmiş sayılırlar."
    key: "IIK_ISTIHKAK_ITIRAZ",
    name: "İstihkak iddiasına itiraz süresi",
    description:
      "Haciz sırasında ileri sürülen istihkak iddiasına karşı alacaklı/borçlunun " +
      "diyeceklerini bildirme süresi. Sükût hâlinde istihkak iddiası kabul edilmiş sayılır.",
    durationValue: 3,
    durationUnit: "GUN",
    legalBasis: "İİK m.96/2 — 3 gün",
    caseTypes: ["ICRA"],
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    // 7 günlük süre m.96'ya değil, istihkak DAVASI açma mühletine aittir.
    key: "IIK_ISTIHKAK_DAVA",
    name: "İstihkak davası açma süresi",
    description: "İcra mahkemesince verilen mühlet içinde istihkak davası açma süresi.",
    durationValue: 7,
    durationUnit: "GUN",
    legalBasis: "İİK m.97 — 7 gün",
    caseTypes: ["ICRA", "DAVA"],
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    key: "IIK_IHALENIN_FESHI",
    name: "İhalenin feshi talebi süresi",
    description: "İhale tarihinden (öğrenmeden) itibaren ihalenin feshini isteme süresi.",
    durationValue: 7,
    durationUnit: "GUN",
    legalBasis: "İİK m.134 — 7 gün",
    caseTypes: ["ICRA"],
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    key: "IIK_SIKAYET",
    name: "İcra dairesi işlemine şikâyet süresi",
    description: "İcra dairesinin işlemine karşı icra mahkemesine şikâyet süresi.",
    durationValue: 7,
    durationUnit: "GUN",
    legalBasis: "İİK m.16 — 7 gün",
    caseTypes: ["ICRA"],
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    key: "IIK_ITIRAZIN_IPTALI",
    name: "İtirazın iptali davası açma süresi",
    description: "İtirazın tebliğinden itibaren itirazın iptali davası açma süresi.",
    durationValue: 1,
    durationUnit: "YIL",
    legalBasis: "İİK m.67 — 1 yıl",
    caseTypes: ["ICRA", "DAVA"],
    // Hak düşürücü nitelikte bir yıllık süre; adli tatil uzaması uygulanmaz.
    judicialRecessApplies: false,
    procedureCode: "IIK",
  },
  {
    key: "TUKETICI_HAKEM_ITIRAZ",
    name: "Tüketici hakem heyeti kararına itiraz süresi",
    description: "Hakem heyeti kararının tebliğinden itibaren tüketici mahkemesine itiraz süresi.",
    durationValue: 15,
    durationUnit: "GUN",
    // ⚠ TEYİT GEREKİR (denetim bulgusu 19): 15 günlük SÜRE doğrudur; ancak
    // 7251/7327 s.K. değişiklikleri sonrası fıkra numarasının güncel metinde
    // m.70/3 olup olmadığı bir hukukçuya doğrulatılmalıdır.
    legalBasis: "6502 sayılı TKHK m.70/3 — 15 gün",
    caseTypes: ["DAVA"],
    // ⚠ TEYİT GEREKİR (denetim bulgusu 19): HMK m.104 lafzen "BU KANUNUN tayin
    // ettiği süreler"i kapsar; buradaki süre 6502 s.K. ile belirlenmiştir.
    // Uygulamada hukuk yargılamasına ilişkin özel kanun sürelerine de m.104'ün
    // uygulandığı kabul edilir. Avukat lehine (daha geniş) olan bu kabul
    // korunmuştur; yine de teyit ediniz.
    judicialRecessApplies: true,
    procedureCode: "HMK",
  },
  {
    key: "CMK_ISTINAF",
    name: "Ceza — istinaf başvuru süresi",
    description: "Hükmün tefhim veya tebliğinden itibaren istinaf başvuru süresi.",
    durationValue: 7,
    durationUnit: "GUN",
    legalBasis: "CMK m.273 — 7 gün",
    caseTypes: ["CEZA"],
    judicialRecessApplies: true,
    recessRule: "CMK_331",
    procedureCode: "CMK",
  },
  {
    key: "CMK_TEMYIZ",
    name: "Ceza — temyiz süresi",
    description: "Bölge adliye mahkemesi kararının tefhim/tebliğinden itibaren temyiz süresi.",
    durationValue: 15,
    durationUnit: "GUN",
    legalBasis: "CMK m.291 — 15 gün",
    caseTypes: ["CEZA"],
    judicialRecessApplies: true,
    recessRule: "CMK_331",
    procedureCode: "CMK",
  },
  {
    key: "IYUK_DAVA_ACMA",
    name: "İdari dava açma süresi (idare mahkemesi)",
    description:
      "İdari işlemin tebliğinden itibaren idare mahkemesinde dava açma süresi. " +
      "VERGİ MAHKEMELERİNDE SÜRE 30 GÜNDÜR — «Vergi davası açma süresi» kuralını kullanınız.",
    durationValue: 60,
    durationUnit: "GUN",
    legalBasis: "İYUK m.7/1 — 60 gün",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    recessRule: "IYUK_8",
    procedureCode: "IYUK",
  },
  {
    // EKLENDİ (denetim bulgusu 13): set yalnızca 60 günü içeriyordu ve
    // caseTypes ["DAVA"] olduğu için vergi dosyalarında da öneriliyordu.
    key: "IYUK_VERGI_DAVA_ACMA",
    name: "Vergi davası açma süresi (vergi mahkemesi)",
    description: "Vergi mahkemelerinde dava açma süresi — idare mahkemesindeki 60 günden farklıdır.",
    durationValue: 30,
    durationUnit: "GUN",
    legalBasis: "İYUK m.7/1 — 30 gün",
    caseTypes: ["DAVA"],
    judicialRecessApplies: true,
    recessRule: "IYUK_8",
    procedureCode: "IYUK",
  },
  {
    key: "IS_ISE_IADE",
    name: "İşe iade — arabuluculuk son tutanağı sonrası dava süresi",
    description:
      "Arabuluculuk son tutanağının düzenlendiği tarihten itibaren işe iade davası açma süresi.",
    durationValue: 2,
    durationUnit: "HAFTA",
    legalBasis: "4857 sayılı İş K. m.20 — 2 hafta",
    caseTypes: ["DAVA", "ARABULUCULUK"],
    // DÜZELTİLDİ (denetim bulgusu 12): eski gerekçe "HMK m.103/1-b" diyordu;
    // (b) bendi NAFAKA, SOYBAĞI, VELAYET VE VESAYET davalarıdır.
    // İşçi davaları HMK m.103/1-ç'dedir: "Hizmet akdi veya iş sözleşmesi
    // sebebiyle işçilerin açtıkları davalar" — adli tatilde de görülür.
    judicialRecessApplies: false,
    procedureCode: "HMK",
  },
];

/** Sistem kurallarının anahtarları. */
export const SYSTEM_DEADLINE_RULE_KEYS: string[] = SYSTEM_DEADLINE_RULES.map((r) => r.key);

const RULE_BY_KEY = new Map<string, SystemDeadlineRule>(
  SYSTEM_DEADLINE_RULES.map((r) => [r.key, r]),
);

/**
 * Faz 1'de kapsam dışı bırakılan, ancak süre kaçırma riski taşıdığı için
 * Faz 2'de eklenmesi gereken kurallar (denetim bulgusu 13):
 *   - İİK m.89 haciz ihbarnameleri (7 / 7 / 15 gün)
 *   - İİK m.33 icranın geri bırakılması (7 gün)
 *   - İİK m.169/a
 *   - HMK m.394 ihtiyati tedbire itiraz (1 hafta)
 *   - HMK m.317/2 basit yargılamada cevap (2 hafta)
 *   - Islaha karşı beyan (mahkemece takdiren verilen süre — sabit değil)
 */
export const PLANNED_RULE_KEYS: readonly string[] = [
  "IIK_HACIZ_IHBARNAMESI",
  "IIK_ICRANIN_GERI_BIRAKILMASI",
  "HMK_IHTIYATI_TEDBIRE_ITIRAZ",
  "HMK_BASIT_YARGILAMA_CEVAP",
];

/** Anahtara göre sistem kuralını bulur; yoksa `undefined`. */
export function findSystemRule(key: string): SystemDeadlineRule | undefined {
  return RULE_BY_KEY.get(key);
}

/** Anahtara göre sistem kuralını bulur; yoksa Türkçe hata fırlatır. */
export function getSystemRule(key: string): SystemDeadlineRule {
  const rule = RULE_BY_KEY.get(key);
  if (!rule) {
    throw new Error(`Bilinmeyen süre kuralı: "${key}".`);
  }
  return rule;
}

/** Dosya türüne uygun sistem kurallarını süzer. */
export function systemRulesForCaseType(caseType: string): SystemDeadlineRule[] {
  return SYSTEM_DEADLINE_RULES.filter((r) => r.caseTypes.includes(caseType));
}

/** Sistem kuralından motorun beklediği `rule` girdisini üretir. */
export function toRuleInput(rule: SystemDeadlineRule): DeadlineRuleInput {
  return {
    durationValue: rule.durationValue,
    durationUnit: rule.durationUnit,
    legalBasis: rule.legalBasis,
  };
}
