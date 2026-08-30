/**
 * @nomosos/legal-core
 *
 * NomosOS'un deterministik hukuk çekirdeği. Süre hesabı burada yapılır ve
 * HİÇBİR AŞAMADA AI/LLM KULLANILMAZ (bkz. docs/moduller/04-sure-motoru.md,
 * Gereksinim 4). AI yalnızca tebliğ tarihi ve kural TESPİTİ yapar; gün hesabı
 * daima bu paketten geçer.
 *
 * Tipik kullanım (apps/api):
 *
 * ```ts
 * import { computeDeadline, getSystemRule, toRuleInput } from "@nomosos/legal-core";
 *
 * const rule = await prisma.deadlineRule.findFirst({ where: { tenantId: null, key } });
 * const holidays = await prisma.holiday.findMany({ where: { year: { in: [y, y + 1] } } });
 *
 * const result = computeDeadline({
 *   ruleKey: rule.key,
 *   triggerDate,
 *   serviceMethod,
 *   rule: { durationValue: rule.durationValue, durationUnit: rule.durationUnit, legalBasis: rule.legalBasis },
 *   holidays,
 *   applyJudicialRecess: rule.judicialRecessApplies, // varsayılan: true
 *   recessRule: rule.recessRule,                     // HMK_104 | IYUK_8 | CMK_331
 *   procedureCode: rule.procedureCode,               // HMK | IIK | CMK | IYUK
 * });
 * ```
 */

// ── Tipler ──────────────────────────────────────────────────────────────────
export type {
  DeadlineComputationInput,
  DeadlineComputationResult,
  DeadlineComputationStep,
  DeadlineRuleInput,
  DeadlineStepCode,
  DurationUnit,
  HolidayInput,
  HolidayType,
  ProcedureCode,
  RecessExtensionRule,
  ServiceMethod,
  SystemDeadlineRule,
} from "./types";
export { DEADLINE_STEP_CODES } from "./types";

// ── Süre motoru ─────────────────────────────────────────────────────────────
export {
  CMK_331_UZAMA_GUN,
  ETEBLIGAT_VARSAYIM_GUN,
  HMK_104_UZAMA_GUN,
  IYUK_8_UZAMA_GUN,
  addDuration,
  computeDeadline,
} from "./deadline-engine";

// ── Tatil takvimi ───────────────────────────────────────────────────────────
export type { HolidayIndex, TrHoliday } from "./holidays";
export {
  APPROXIMATE_HOLIDAY_MARKER,
  HALF_DAY_HOLIDAY_MARKER,
  JUDICIAL_RECESS_END,
  JUDICIAL_RECESS_START,
  SUPPORTED_HOLIDAY_YEARS,
  TR_HOLIDAYS_2026,
  buildHolidayIndex,
  expandJudicialRecess,
  fixedOfficialHolidays,
  halfDayHolidaysOn,
  isFullDayOfficialHoliday,
  isInJudicialRecess,
  isNonWorkingDay,
  isOfficialHoliday,
  judicialRecessEndFor,
  judicialRecessRange,
  nextWorkingDay,
  officialHolidaysOn,
  previousWorkingDay,
  strictNextWorkingDay,
  toHolidayInputs,
} from "./holidays";

// ── Kural seti ──────────────────────────────────────────────────────────────
export {
  PLANNED_RULE_KEYS,
  SYSTEM_DEADLINE_RULES,
  SYSTEM_DEADLINE_RULE_KEYS,
  findSystemRule,
  getSystemRule,
  systemRulesForCaseType,
  toRuleInput,
} from "./rules";

// ── Tarih yardımcıları ──────────────────────────────────────────────────────
export {
  addDays,
  addMonths,
  addYears,
  dateOnly,
  daysInMonth,
  diffDays,
  formatTrDate,
  formatTrDateLong,
  isSameDay,
  isValidDate,
  isWeekend,
  parseDateOnly,
  toIsoDateKey,
  toUtcDate,
  trMonthName,
  trWeekdayName,
} from "./date-utils";
