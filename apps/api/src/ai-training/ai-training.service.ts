/**
 * AI EĞİTİM VERİSİ (geliştirme planı C3) — onay/ret/düzeltme örnekleri.
 *
 * KVKK İLKESİ: Toplama YALNIZCA opt-in kiracıdan yapılır
 * (Tenant.aiTrainingOptIn, varsayılan KAPALI). Toplanan her örnek PII
 * kapısından MASKELİ geçer (scanPii); ham kişisel veri ASLA depolanmaz.
 *
 * Kaynaklar (bu oturumda): belge öneri kararları (DOCUMENT_ACTION öneri
 * kabul/ret). Sonraki aşamalara bırakılan kaynaklar da AYNI kanaldan eklenir:
 * belge sınıf düzeltmeleri, dilekçe bölüm düzenlemeleri.
 */

import { Injectable, Logger } from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";

export type TrainingSampleKind = "ONAY" | "RED" | "DUZELTME";

@Injectable()
export class AiTrainingDataService {
  private readonly logger = new Logger(AiTrainingDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Kiracı opt-in mi? Toplamayan çağrılar bunu kontrol eder. */
  async optIn(tenantId: string): Promise<boolean> {
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { aiTrainingOptIn: true },
    });
    return t?.aiTrainingOptIn === true;
  }

  /**
   * Örnek kaydet — MASKELE. Çağıran karar anında çağırır; opt-in değilse
   * sessizce hiçbir şey yazmaz (koleksiyon yok sayılır).
   */
  async recordDecision(input: {
    tenantId: string;
    taskType: string;
    kind: TrainingSampleKind;
    /** Modelin girdisi (JSON-serialize edilebilir) — MASKELİ saklanır. */
    modelInput: unknown;
    /** Model çıktısı (JSON) — MASKELİ saklanır. */
    modelOutput: unknown;
    /** Avukat kararı/düzeltmesi (JSON). */
    feedback: unknown;
    userId?: string;
  }): Promise<void> {
    if (!(await this.optIn(input.tenantId))) return;
    try {
      await this.prisma.client.aiTrainingSample.create({
        data: {
          tenantId: input.tenantId,
          taskType: input.taskType,
          kind: input.kind,
          inputJson: this.masked(input.modelInput),
          outputJson: this.masked(input.modelOutput),
          feedbackJson: this.masked(input.feedback),
        },
      });
    } catch (err) {
      // Eğitim verisi asla ana akışı bozmaz.
      this.logger.warn(`Eğitim örneği yazılamadı: ${(err as Error).message}`);
    }
  }

  /** Değeri JSON'a çevirip PII maskesinden geçirir. */
  private masked(value: unknown): string {
    let text: string;
    try {
      text = typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      text = String(value);
    }
    const scan = scanPii(text);
    return scan.maskedText;
  }

  /** Kiracı görünümü — kendi örnekleri (maske zaten uygulandı). */
  async listForTenant(user: AuthUser, filters: { kind?: string; taskType?: string }) {
    return this.prisma.client.aiTrainingSample.findMany({
      where: {
        tenantId: user.tenantId,
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.taskType ? { taskType: filters.taskType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        taskType: true,
        kind: true,
        exportStatus: true,
        createdAt: true,
      },
    });
  }

  /** Rıza durumu + özet sayaçlar (kiracı ayar ekranı). */
  async tenantSummary(user: AuthUser) {
    const [tenant, total, byKind] = await Promise.all([
      this.prisma.client.tenant.findUnique({
        where: { id: user.tenantId },
        select: { aiTrainingOptIn: true },
      }),
      this.prisma.client.aiTrainingSample.count({ where: { tenantId: user.tenantId } }),
      this.prisma.client.aiTrainingSample.groupBy({
        by: ["kind"],
        where: { tenantId: user.tenantId },
        _count: { kind: true },
      }),
    ]);
    return {
      optIn: tenant?.aiTrainingOptIn ?? false,
      total,
      byKind: byKind.map((g) => ({ kind: g.kind, count: g._count.kind })),
      note:
        "Rıza açıkken, avukat onay/ret/düzeltmeleri (kişisel veriler MASKELENEREK) " +
        "ürüm geliştirmek için toplanır. Rıza her zaman kapatılabilir; kapatmak mevcut " +
        "örneklerin dışa aktarımını durdurur.",
    };
  }

  /** Rıza değişikliği — büro düzeyinde açık karar (ADMIN/PARTNER). */
  async setOptIn(user: AuthUser, optIn: boolean) {
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: user.tenantId },
      select: { id: true, aiTrainingOptIn: true },
    });
    if (!tenant) return;
    await this.prisma.client.tenant.update({
      where: { id: tenant.id },
      data: { aiTrainingOptIn: optIn },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_TRAINING_OPT_IN_CHANGE",
      entity: "Tenant",
      entityId: tenant.id,
      detail: `aiTrainingOptIn: ${tenant.aiTrainingOptIn} → ${optIn}`,
    });
    return { optIn };
  }

  /**
   * JSONL DIŞA AKTARIM (platform) — yalnız ONAYLANMIŞ örnekler; dört-göz izlidir.
   * JSONL satırı: {"messages":[{"role":"system","content":…},{"role":"user",…},{"role":"assistant",…}]}
   * fine-tune uyumlu biçimdir.
   */
  async exportJsonl(limit: number): Promise<string> {
    const rows = await this.prisma.client.aiTrainingSample.findMany({
      where: { exportStatus: "ONAYLANDI" },
      orderBy: { createdAt: "asc" },
      take: Math.min(limit, 10000),
    });
    const lines = rows.map((r) => {
      let input: Record<string, unknown> = {};
      let output: Record<string, unknown> = {};
      try {
        input = JSON.parse(r.inputJson) as Record<string, unknown>;
      } catch {
        /* bozuksa boş */
      }
      try {
        output = JSON.parse(r.outputJson) as Record<string, unknown>;
      } catch {
        /* bozuksa boş */
      }
      const sample = {
        messages: [
          { role: "system", content: `NomosOS ${r.taskType} görevi` },
          { role: "user", content: JSON.stringify(input) },
          { role: "assistant", content: JSON.stringify(output) },
          { role: "user", content: `Avukat kararı: ${r.kind}` },
        ],
        meta: { kind: r.kind, tenantIdHash: undefined },
      };
      return JSON.stringify(sample);
    });
    return lines.join("\n");
  }
}
