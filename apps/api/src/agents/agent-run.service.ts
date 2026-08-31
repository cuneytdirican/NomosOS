/**
 * F2 · E1 — AJAN KOŞUSU İZLEYİCİSİ.
 *
 * Her LLM çağrısı için bir `AgentRun` satırı: ajan kim, hangi girdiyle, hangi
 * durumla döndü, ne kadar sürdü. `AiUsageLog` İÇ MUHASEBEDİR (token/kredi);
 * `AgentRun` İZDİR — "hangi ajan ne yapıyor" sorusunun cevabı.
 *
 * İLKELER:
 *  - EN İYİ ÇABA (best-effort): iz yazımı HİÇBİR ZAMAN ana akışı bozmaz; yazım
 *    hatası yalnız günlüğe düşer.
 *  - KVKK: TAM METİN ASLA yazılmaz. Girdi özeti alan adları + uzunluklar +
 *    MASKELENMİŞ kısa alıntı taşır; maskeleme öncesi metin kayda girmez.
 *  - Başarısızlık da iz bırakır: sağlayıcı arızası (BASARISIZ) ve guard'ın
 *    elediği çıktı (REDDEDILDI) farklı durumlardır — "neden yarım kaldı"
 *    sorusunun cevabı bu ayrımdadır.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { scanPii } from "@nomosos/ai";
import { agentForTask } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";

export type AgentRunStatus = "BASARILI" | "BASARISIZ" | "REDDEDILDI";

export const AGENT_INPUT_QUOTE_CHARS = 160;

export interface RecordAgentRunInput {
  tenantId: string;
  userId?: string | null;
  taskType: string;
  status: AgentRunStatus;
  model?: string | null;
  providerType?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  piiMasked?: boolean;
  entity?: string | null;
  entityId?: string | null;
  /** Dışa giden metinler (ÖZETİ yazılır, kendisi ASLA). */
  outboundTexts?: readonly string[];
  /** Guard'ın elediği sorunlar (REDDEDILDI durumunda). */
  rejectionDetail?: string | null;
  /** Sağlayıcı arıza mesajı (BASARISIZ durumunda). */
  errorMessage?: string | null;
}

/**
 * Girdi ÖZETİ — KVKK sözleşmesi: alan adları, uzunluklar ve MASKELİ kısa alıntı.
 * Alıntıdaki kişisel veri kalıpları noktalanır; kalıpsız risk için alıntı
 * kısalığı sınır koyar.
 */
export function buildInputSummary(texts: readonly string[]): string {
  const quotes = texts.slice(0, 5).map((t) => {
    const masked = scanPii(t).maskedText;
    const short = masked.slice(0, AGENT_INPUT_QUOTE_CHARS);
    return short.length < masked.length ? `${short}…` : short;
  });
  return JSON.stringify({
    parcaSayisi: texts.length,
    toplamKarakter: texts.reduce((acc, t) => acc + t.length, 0),
    alintilar: quotes,
  });
}

@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Koşu izi yazar — asla throw etmez. */
  async record(input: RecordAgentRunInput): Promise<void> {
    try {
      const agent = agentForTask(input.taskType);
      const data: Prisma.AgentRunUncheckedCreateInput = {
        tenantId: input.tenantId,
        agentKey: agent.agentKey,
        taskType: input.taskType,
        status: input.status,
        userId: input.userId ?? null,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        model: input.model ?? null,
        providerType: input.providerType ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        durationMs: input.durationMs ?? null,
        piiMasked: input.piiMasked ?? false,
        inputSummaryJson: input.outboundTexts ? buildInputSummary(input.outboundTexts) : null,
        outputSummaryJson: null,
        errorMessage:
          input.status === "REDDEDILDI"
            ? input.rejectionDetail?.slice(0, 1000) ?? null
            : input.errorMessage?.slice(0, 1000) ?? null,
      };
      await this.prisma.client.agentRun.create({ data });
    } catch (err) {
      // İz yazımı ana akışı bozmaz; hatası görünebilir olsun.
      this.logger.warn(`AgentRun yazılamadı (${input.taskType}): ${(err as Error).message}`);
    }
  }

  /** Kiracı iz görünümü — GET /ai/agent-runs. */
  async list(
    tenantId: string,
    query: { agentKey?: string; taskType?: string; status?: string; take?: number },
  ) {
    const take = Math.min(Math.max(query.take ?? 50, 1), 200);
    const where: Prisma.AgentRunWhereInput = { tenantId };
    if (query.agentKey) where.agentKey = query.agentKey;
    if (query.taskType) where.taskType = query.taskType;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.client.agentRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          agentKey: true,
          taskType: true,
          status: true,
          model: true,
          providerType: true,
          inputTokens: true,
          outputTokens: true,
          durationMs: true,
          piiMasked: true,
          entity: true,
          entityId: true,
          inputSummaryJson: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
      this.prisma.client.agentRun.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({ ...r, inputSummary: safeParse(r.inputSummaryJson), inputSummaryJson: undefined })),
      total,
      take,
    };
  }
}

function safeParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
