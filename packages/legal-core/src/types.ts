/**
 * @nomosos/legal-core — ortak tipler
 *
 * Bu paketteki tüm hesaplar DETERMİNİSTİKTİR. Hiçbir noktada LLM/AI çağrısı yoktur.
 * Yanlış süre hesabı avukata meslek sorumluluğu doğurduğu için her adım izlenebilir
 * (steps[]) ve her belirsizlik açıkça raporlanır (warnings[]).
 */

/** Prisma `DurationUnit` enum'u ile birebir aynı. */
export type DurationUnit = "GUN" | "HAFTA" | "AY" | "YIL";

/** Prisma `ServiceMethod` enum'u ile birebir aynı. */
export type ServiceMethod = "ELDEN" | "POSTA" | "ETEBLIGAT" | "DURUSMADA" | "DIGER";

/** Prisma `HolidayType` enum'u ile birebir aynı. */
export type HolidayType = "RESMI_TATIL" | "ADLI_TATIL";

/**
 * Tatil kaydı girdisi.
 *
 * `date` hem `Date` hem `"YYYY-MM-DD"` string kabul eder; her ikisi de UTC gün
 * bileşenlerine göre yorumlanır (bkz. `toUtcDate`).
 */
export interface HolidayInput {
  date: Date | string;
  type: HolidayType;
  /** İsteğe bağlı; uyarı metinlerinde ve hesap izinde gösterilir. */
  name?: string;
  /**
   * Yarım gün tatil mi (arife günleri — 2429 s.K. m.2/A).
   *
   * ÖNEMLİ: Yarım gün TAM TATİL DEĞİLDİR. Arife günü saat 13.00'e kadar mesai
   * vardır; HMK m.93 "son gün resmî tatile rastlarsa" kaydırması TETİKLENMEZ.
   * Motor bu günler için yalnızca "işlemi öğleden önce tamamlayınız" uyarısı üretir.
   */
  isHalfDay?: boolean;
  /**
   * Tarih kesinleşmemiş mi (hicri takvime bağlı dinî bayramlar).
   * `true` ise motor `warnings[]` içine teyit uyarısı yazar.
   */
  isApproximate?: boolean;
}

/**
 * Adli tatil uzaması rejimi.
 *
 * - `HMK_104` (varsayılan): "…adli tatilin bittiği günden itibaren bir hafta
 *   uzatılmış sayılır." → son gün = adli tatil bitişi + 7 gün.
 * - `IYUK_8`: İYUK m.8/3 — "…ara vermenin sona erdiği günü izleyen tarihten
 *   itibaren yedi gün uzamış sayılır." → son gün = (adli tatil bitişi + 1) + 7 gün.
 * - `CMK_331`: CMK m.331/4 — "Adlî tatile rastlayan süreler işlemez. Bu süreler
 *   tatilin bittiği günden itibaren üç gün uzatılmış sayılır."
 *   → son gün = adli tatil bitişi + 3 gün.
 *
 * Rejimler birbirinden gün farkıyla ayrılır; yargı koluna göre seçilmelidir.
 */
export type RecessExtensionRule = "HMK_104" | "IYUK_8" | "CMK_331";

/**
 * Sürenin tabi olduğu usul kanunu. Hesap izindeki madde referansları buna göre
 * seçilir: mekanik aynı olsa da dayanak farklıdır ve hesap izi dilekçeye
 * kopyalanabilir bir belge niteliğindedir.
 *
 * - `HMK`: m.91-93 (başlangıç, tatil kaydırması)
 * - `IIK`: m.19 ("Gün olarak tayin olunan sürelerde ilk gün hesaba katılmaz…")
 * - `CMK`: m.39
 * - `IYUK`: m.8/1
 */
export type ProcedureCode = "HMK" | "IIK" | "CMK" | "IYUK";

/** Süre motoruna verilen kural tanımı (DeadlineRule kaydından türetilir). */
export interface DeadlineRuleInput {
  durationValue: number;
  durationUnit: DurationUnit;
  legalBasis: string;
}

export interface DeadlineComputationInput {
  /** DeadlineRule.key — yalnızca izleme/raporlama için; hesabı etkilemez. */
  ruleKey: string;
  /** Tebliğ / tefhim / olay tarihi. Gün hassasiyetinde, UTC gün bileşenleriyle yorumlanır. */
  triggerDate: Date;
  serviceMethod?: ServiceMethod;
  rule: DeadlineRuleInput;
  holidays: HolidayInput[];
  /**
   * Adli tatil uzaması (HMK m.104 / İYUK m.8/3 / CMK m.331/4) uygulansın mı.
   *
   * VARSAYILAN: `true` (uygulanır). HMK m.104 "ayrıca bir karara gerek
   * olmaksızın" işlediğinden, uzamanın uygulanmaması bilinçli bir karar
   * olmalıdır: yalnızca HMK m.103 istisnaları (icra-iflas işleri, işçi
   * davaları vb.) için kuralda açıkça `false` verilir.
   *
   * NOT: Bu alan eskiden `skipJudicialRecess` adını taşıyordu ve adı yaptığı
   * işin TERSİNİ söylüyordu. Hukuki hesapta iki anlamlı alan tehlikeli olduğu
   * için eski ad geriye dönük uyumluluk bırakılmadan kaldırılmıştır.
   */
  applyJudicialRecess?: boolean;
  /** Adli tatil uzaması rejimi. Varsayılan: `HMK_104`. */
  recessRule?: RecessExtensionRule;
  /** Hesap izindeki madde referanslarının seçileceği usul kanunu. Varsayılan: `HMK`. */
  procedureCode?: ProcedureCode;
}

/** Hesap izinin tek bir adımı. Kullanıcı arayüzünde satır satır gösterilir. */
export interface DeadlineComputationStep {
  /** Makine tarafından okunabilen adım kodu (bkz. `DeadlineStepCode`). */
  step: string;
  /** Adım sonundaki tarih (UTC gün başı). */
  date: Date;
  /** Türkçe, madde referanslı açıklama. */
  explanation: string;
}

export interface DeadlineComputationResult {
  /** Sürenin son günü (UTC gün başı). */
  dueDate: Date;
  /** Hesabın adım adım izi. */
  steps: DeadlineComputationStep[];
  /** Uygulanan kuralın mevzuat dayanağı. */
  legalBasis: string;
  /** Teyit gerektiren hususlar (yaklaşık bayram tarihi, eksik takvim, yarım gün vb.). */
  warnings: string[];
}

/** Hesap izinde kullanılan adım kodları. */
export const DEADLINE_STEP_CODES = {
  TETIK: "TETIK",
  TEBLIGAT_DUZELTMESI: "TEBLIGAT_DUZELTMESI",
  BASLANGIC: "BASLANGIC",
  SURE_EKLEME: "SURE_EKLEME",
  ADLI_TATIL: "ADLI_TATIL",
  TATIL_KAYDIRMASI: "TATIL_KAYDIRMASI",
  SON_GUN: "SON_GUN",
} as const;

export type DeadlineStepCode = (typeof DEADLINE_STEP_CODES)[keyof typeof DEADLINE_STEP_CODES];

/** Sistem (tenant'lar arası ortak) süre kuralı tanımı. packages/db seed'i ile birebir aynıdır. */
export interface SystemDeadlineRule {
  key: string;
  name: string;
  description: string;
  durationValue: number;
  durationUnit: DurationUnit;
  legalBasis: string;
  caseTypes: string[];
  /**
   * Bu kuralın süresi adli tatile tabi mi (HMK m.104 uzaması uygulanır mı).
   * İcra takipleri (İİK m.51-52) ve ceza yargılaması (CMK m.331) bakımından adli
   * tatil süreleri durdurmaz; bu kurallarda `false`'tur.
   */
  judicialRecessApplies: boolean;
  /** Adli tatil uygulanıyorsa hangi rejimle. */
  recessRule?: RecessExtensionRule;
  /** Hesap izinde kullanılacak usul kanunu referansı. Varsayılan: `HMK`. */
  procedureCode?: ProcedureCode;
}
