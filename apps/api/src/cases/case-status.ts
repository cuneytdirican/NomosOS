import { BadRequestException } from "@nestjs/common";
import type { CaseStatus } from "@nomosos/shared";

/**
 * Dosya yaşam döngüsü durum makinesi (Modül 02 — kural 2).
 * ACIK → DERDEST → KARAR → (ISTINAF → TEMYIZ) → KESINLESTI → ICRADA → KAPANDI → ARSIV
 * Bozma hâlinde ISTINAF/TEMYIZ → DERDEST dönüşü mümkündür.
 */
export const CASE_STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  ACIK: ["DERDEST", "KARAR", "KAPANDI", "ARSIV"],
  DERDEST: ["KARAR", "KAPANDI", "ARSIV"],
  KARAR: ["ISTINAF", "KESINLESTI", "ICRADA", "DERDEST", "KAPANDI"],
  ISTINAF: ["TEMYIZ", "KESINLESTI", "DERDEST", "KAPANDI"],
  TEMYIZ: ["KESINLESTI", "DERDEST", "KAPANDI"],
  KESINLESTI: ["ICRADA", "KAPANDI", "ARSIV"],
  ICRADA: ["KESINLESTI", "KAPANDI", "ARSIV"],
  KAPANDI: ["ARSIV", "DERDEST"],
  ARSIV: [],
};

/** Kapanış sayılan durumlar — açık süre/görev kontrolü bunlarda yapılır. */
export const CLOSING_STATUSES: CaseStatus[] = ["KAPANDI", "ARSIV"];

/** UI rozetleri için Türkçe etiketler. */
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  ACIK: "Açık",
  DERDEST: "Derdest",
  KARAR: "Karar",
  ISTINAF: "İstinaf",
  TEMYIZ: "Temyiz",
  KESINLESTI: "Kesinleşti",
  ICRADA: "İcrada",
  KAPANDI: "Kapandı",
  ARSIV: "Arşiv",
};

/**
 * Geçiş geçerli değilse anlamlı Türkçe 400 fırlatır:
 * "2026/145 dosyası KAPANDI durumundan ISTINAF durumuna geçirilemez."
 */
export function assertCaseStatusTransition(
  caseLabel: string,
  from: CaseStatus,
  to: CaseStatus
): void {
  if (from === to) {
    throw new BadRequestException(`${caseLabel} dosyası zaten ${to} durumunda.`);
  }
  const allowed = CASE_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    const allowedText = allowed.length > 0 ? allowed.join(", ") : "yok";
    throw new BadRequestException(
      `${caseLabel} dosyası ${from} durumundan ${to} durumuna geçirilemez. İzinli geçişler: ${allowedText}.`
    );
  }
}
