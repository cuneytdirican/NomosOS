import { Injectable, NotFoundException } from "@nestjs/common";
import type { DeadlineRule, Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DeadlineRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /deadline-rules — sistem kuralları (tenantId=null) + büronun kendi kuralları.
   * Aynı `key` hem sistemde hem büroda varsa büro kuralı önceliklidir.
   */
  async list(
    tenantId: string,
    params: { caseType?: string; q?: string; includeInactive?: string } = {}
  ) {
    const where: Prisma.DeadlineRuleWhereInput = {
      OR: [{ tenantId: null }, { tenantId }],
    };
    if (params.includeInactive !== "true") {
      where.isActive = true;
    }
    if (params.q) {
      where.AND = [
        {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { key: { contains: params.q, mode: "insensitive" } },
            { legalBasis: { contains: params.q, mode: "insensitive" } },
          ],
        },
      ];
    }

    const rules = await this.prisma.client.deadlineRule.findMany({
      where,
      orderBy: [{ key: "asc" }],
    });

    const filtered = params.caseType
      ? rules.filter((r) => r.caseTypes.length === 0 || r.caseTypes.includes(params.caseType as string))
      : rules;

    return dedupePreferTenant(filtered);
  }

  /** Hesaplama için kural çözümü — büro kuralı sistem kuralını ezer. */
  async resolveByKey(tenantId: string, key: string): Promise<DeadlineRule> {
    const candidates = await this.prisma.client.deadlineRule.findMany({
      where: { key, isActive: true, OR: [{ tenantId: null }, { tenantId }] },
    });
    const rule = candidates.find((r) => r.tenantId === tenantId) ?? candidates.find((r) => r.tenantId === null);
    if (!rule) {
      throw new NotFoundException(`"${key}" anahtarlı süre kuralı bulunamadı veya pasif durumda.`);
    }
    return rule;
  }
}

/** Aynı key için büro kuralı varsa sistem kuralını listeden çıkarır. */
function dedupePreferTenant(rules: DeadlineRule[]): DeadlineRule[] {
  const tenantKeys = new Set(rules.filter((r) => r.tenantId !== null).map((r) => r.key));
  return rules.filter((r) => r.tenantId !== null || !tenantKeys.has(r.key));
}
