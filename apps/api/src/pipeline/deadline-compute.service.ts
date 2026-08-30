import { Injectable } from "@nestjs/common";
import {
  computeDeadline,
  findSystemRule,
  formatTrDate,
  type DeadlineComputationResult,
  type ProcedureCode,
  type RecessExtensionRule,
  type ServiceMethod,
} from "@nomosos/legal-core";
import { UNKNOWN_DEADLINE_RULE_KEY } from "@nomosos/legal-ai";
import { PrismaService } from "../prisma/prisma.service";
import { DeadlineRulesService } from "../deadline-rules/deadline-rules.service";
import { addYears } from "../common/dates";

/**
 * Belge hattının ve onay kuyruğunun DETERMİNİSTİK süre hesabı.
 *
 * ÜRÜN İLKESİ: AI süre HESAPLAMAZ. DEADLINE_DETECT ajanı yalnızca
 * "hangi olay, hangi tarihte, hangi kural olabilir" der; gün aritmetiği,
 * resmî/adli tatil kaydırması ve dayanak metni tamamen
 * `@nomosos/legal-core.computeDeadline` işidir. Bu servis o motoru
 * DB'deki kural ve tatil takvimiyle besler.
 *
 * FIRLATMAZ: hat bir hesabın düşmesiyle durmaz; sonuç `ok:false` döner.
 */

export interface DeadlineComputeOutcome {
  ok: boolean;
  ruleKey: string;
  ruleName?: string;
  dueDate?: Date;
  legalBasis?: string;
  /** İnsan-okur hesap izi (Deadline.computeNote'a birebir yazılır). */
  computeNote?: string;
  steps?: DeadlineComputationResult["steps"];
  warnings: string[];
  error?: string;
}

@Injectable()
export class DeadlineComputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: DeadlineRulesService
  ) {}

  async compute(params: {
    tenantId: string;
    ruleKey: string;
    triggerDate: Date;
    serviceMethod?: ServiceMethod;
  }): Promise<DeadlineComputeOutcome> {
    const { tenantId, ruleKey, triggerDate } = params;

    if (!ruleKey || ruleKey === UNKNOWN_DEADLINE_RULE_KEY) {
      return {
        ok: false,
        ruleKey,
        warnings: [],
        error:
          "Süre kuralı belirlenemedi (BELİRSİZ). Hesap yapılmadı; onay ekranından " +
          "uygulanacak kuralı seçmeniz gerekir.",
      };
    }

    let rule;
    try {
      rule = await this.rules.resolveByKey(tenantId, ruleKey);
    } catch (err) {
      return {
        ok: false,
        ruleKey,
        warnings: [],
        error: `«${ruleKey}» anahtarlı süre kuralı bulunamadı veya pasif: ${(err as Error).message}`,
      };
    }

    // Hesap penceresi: tetikleyici yılın başından itibaren 3 yıl
    // (İİK m.67 gibi 1 yıllık süreler ve adli tatil uzaması dâhil).
    const windowStart = new Date(Date.UTC(triggerDate.getUTCFullYear(), 0, 1));
    const windowEnd = addYears(triggerDate, 3);
    const holidays = await this.prisma.client.holiday.findMany({
      where: { date: { gte: windowStart, lte: windowEnd } },
      orderBy: { date: "asc" },
      select: { date: true, type: true, name: true, isHalfDay: true, isApproximate: true },
    });

    let result: DeadlineComputationResult;
    try {
      result = computeDeadline({
        ruleKey: rule.key,
        triggerDate,
        serviceMethod: params.serviceMethod,
        rule: {
          durationValue: rule.durationValue,
          durationUnit: rule.durationUnit,
          legalBasis: rule.legalBasis,
        },
        holidays,
        // Adli tatil rejimi KURALDAN gelir, istemciden/AI'dan değil.
        applyJudicialRecess: rule.judicialRecessApplies,
        recessRule: rule.recessRule as RecessExtensionRule,
        procedureCode: rule.procedureCode as ProcedureCode,
      });
    } catch (err) {
      return {
        ok: false,
        ruleKey,
        ruleName: rule.name,
        warnings: [],
        error: `Süre hesaplanamadı: ${(err as Error).message}`,
      };
    }

    const warnings = [...result.warnings];

    // Büro kuralı kanuni süreyi eziyorsa avukat bunu GÖRMELİDİR.
    if (rule.tenantId !== null && !rule.isSystem) {
      const systemRule = findSystemRule(rule.key);
      if (systemRule && systemRule.durationValue !== rule.durationValue) {
        warnings.push(
          `DİKKAT: «${rule.key}» kuralı büronuz tarafından değiştirilmiştir ` +
            `(büro: ${rule.durationValue} ${rule.durationUnit}, kanuni: ${systemRule.durationValue} ` +
            `${systemRule.durationUnit} — ${systemRule.legalBasis}).`
        );
      }
    }

    return {
      ok: true,
      ruleKey: rule.key,
      ruleName: rule.name,
      dueDate: result.dueDate,
      legalBasis: result.legalBasis,
      computeNote: buildComputeNote(result, warnings),
      steps: result.steps,
      warnings,
    };
  }
}

/** Hesap izini tek metne indirger — Deadline.computeNote ve öneri kartı için. */
export function buildComputeNote(
  result: DeadlineComputationResult,
  warnings: string[] = result.warnings
): string {
  const lines = result.steps.map(
    (step, index) => `${index + 1}. ${step.step} — ${formatTrDate(step.date)}: ${step.explanation}`
  );
  lines.push(`Dayanak: ${result.legalBasis}`);
  if (warnings.length > 0) {
    lines.push(`Uyarılar: ${warnings.join(" | ")}`);
  }
  return lines.join("\n");
}
