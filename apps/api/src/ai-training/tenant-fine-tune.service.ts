/**
 * KİRACI MODEL EĞİTİM İŞLERİ (kullanıcı tanımlı model eğitimi, gereksinim 2).
 *
 * Lisanslı büro (PlanTier.featuresJson.allowBYOLLM) KENDİ tanımladığı bir
 * sağlayıcı/model (AiProviderConfig) üzerinde fine-tuning işi açar.
 * Platform işleriyle (FineTuneService) aynı DÜRÜSTLÜK ilkesi geçerlidir:
 * sağlayıcıya HİÇBİR ŞEY GÖNDERİLMEZ — manifest (JSONL) indirilir, büro
 * sağlayıcısına ELLE yükler, durumu buradan izler.
 *
 * KİRACI İZOLASYONU (sert kurallar):
 *  - İş listesi, manifest ve durum geçişi YALNIZ `tenantId = user.tenantId` ile.
 *  - Seçilen providerConfig başka büronun ise 403 (başkasının anahtarıyla iş
 *    açılamaz).
 *  - Manifest yalnız BU kiracının ONAYLANMIŞ örneklerini içerir; başka
 *    büronun tek bir örneği bile karışamaz.
 *  - Lisans (allowBYOLLM) kapalıysa 403 — "Planınız kendi model eğitimini
 *    kapsamıyor". Kapı platform tarafındaki aynı PlatformAiService'tendir.
 */

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PlatformAiService } from "../ai/platform-ai.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  FINE_TUNE_TRANSITIONS,
  type FineTuneStatusInput,
  type TenantFineTuneCreateInput,
} from "../platform/fine-tune/fine-tune.schemas";

export const TENANT_FINE_TUNE_LICENSE_MESSAGE =
  "Planınız kendi model eğitimini kapsamıyor. Kendi LLM sunucunuzu/modelinizi eğitmek " +
  "için kendi model tanımlama lisansı (allowBYOLLM) gerekir; paketinizi yükseltin.";

@Injectable()
export class TenantFineTuneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platformAi: PlatformAiService,
  ) {}

  /** Lisans + rol kapısı — her yazma ucu buradan geçer. */
  private async assertLicensed(user: AuthUser, action: string): Promise<void> {
    assertRole(user, ROLE_SETS.ONAY, action);
    if (!(await this.platformAi.byoAllowed(user.tenantId))) {
      throw new ForbiddenException(TENANT_FINE_TUNE_LICENSE_MESSAGE);
    }
  }

  /** GET — büronun kendi işleri + lisans durumu + kendi havuz anlık görüntüsü. */
  async list(user: AuthUser) {
    const licensed = await this.platformAi.byoAllowed(user.tenantId);
    const rows = await this.prisma.client.fineTuneJob.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        provider: true,
        baseModel: true,
        providerConfigId: true,
        status: true,
        sampleCount: true,
        taskTypesJson: true,
        resultModelName: true,
        note: true,
        requestedByUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      licensed,
      licenseMessage: licensed ? null : TENANT_FINE_TUNE_LICENSE_MESSAGE,
      items: rows.map((r) => ({ ...r, taskTypes: safeParse(r.taskTypesJson) })),
      pool: await this.poolSnapshot(user.tenantId),
    };
  }

  /** POST — kendi sağlayıcısı üzerinde iş aç (lisans + sahiplik + boş havuz kapıları). */
  async create(user: AuthUser, input: TenantFineTuneCreateInput) {
    await this.assertLicensed(user, "model eğitim işi açma");

    // SAHİPLİK: providerConfig bu büronun olmalı. Bulunamadı ile "başkasının"
    // ayrımı yapılmaz — kimlik sızdırmamak için ikisi de 403.
    const provider = await this.prisma.client.aiProviderConfig.findFirst({
      where: { id: input.providerConfigId, tenantId: user.tenantId, isActive: true },
      select: { id: true, name: true, type: true, defaultModel: true, origin: true },
    });
    if (!provider) {
      throw new ForbiddenException(
        "Seçilen model büronuzun tanımlı ve aktif sağlayıcıları arasında değil. Yalnız kendi tanımladığınız modeller seçilebilir.",
      );
    }

    const pool = await this.poolSnapshot(user.tenantId);
    if (pool.approvedCount === 0) {
      throw new BadRequestException(
        "Büronuzun ONAYLANMIŞ eğitim örneği yok; iş açılamaz. Önce AI eğitim verisi rızasını açın ve " +
          "örneklerin platform tarafından onaylanmasını bekleyin.",
      );
    }

    const job = await this.prisma.client.fineTuneJob.create({
      data: {
        tenantId: user.tenantId,
        providerConfigId: provider.id,
        name: input.name,
        provider: `${provider.name} (${provider.type})`,
        baseModel: provider.defaultModel,
        note: input.note ?? null,
        status: "HAZIRLANDI",
        sampleCount: pool.approvedCount,
        taskTypesJson: JSON.stringify(pool.byTaskType),
        requestedByUserId: user.userId,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FINE_TUNE_JOB_CREATE",
      entity: "FineTuneJob",
      entityId: job.id,
      detail:
        `"${job.name}" kiracı eğitim işi açıldı (${job.provider} / ${job.baseModel}` +
        `${provider.origin === "IMPORTED" ? ", içe aktarılmış model" : ""}). ` +
        `Anlık görüntü: ${pool.approvedCount} ONAYLANMIŞ örnek (yalnız bu büro). Sağlayıcıya otomatik gönderim YOKTUR.`,
    });
    return job;
  }

  /** Şerit denetimli durum geçişi — yalnız kendi işi. */
  async setStatus(user: AuthUser, id: string, input: FineTuneStatusInput) {
    await this.assertLicensed(user, "model eğitim işi durum değişikliği");
    const job = await this.requireOwn(user, id);
    const allowed = FINE_TUNE_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new BadRequestException(
        `"${job.status}" → "${input.status}" geçişine izin verilmez. ` +
          `İzinli geçişler: ${allowed.length > 0 ? allowed.join(", ") : "yok (iş tamamlandı)"}.`,
      );
    }
    let resultModelName = job.resultModelName;
    if (input.status === "TAMAMLANDI") {
      if (!input.resultModelName || input.resultModelName.length < 2) {
        throw new BadRequestException(
          "TAMAMLANDI için sonuç model adı ZORUNLUDUR — sağlayıcınızın döndürdüğü model kimliğini yazın.",
        );
      }
      resultModelName = input.resultModelName;
    }
    const updated = await this.prisma.client.fineTuneJob.update({
      where: { id: job.id },
      data: { status: input.status, resultModelName, note: input.note ?? job.note },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FINE_TUNE_JOB_STATUS",
      entity: "FineTuneJob",
      entityId: job.id,
      detail:
        `"${job.name}" durumu ${job.status} → ${input.status}` +
        (input.status === "TAMAMLANDI" ? ` (sonuç modeli: ${resultModelName}).` : "."),
    });
    return updated;
  }

  /** Manifest — YALNIZ bu kiracının ONAYLANMIŞ örnekleri. */
  async manifest(user: AuthUser, id: string) {
    await this.assertLicensed(user, "model eğitim manifesti indirme");
    const job = await this.requireOwn(user, id);
    if (job.status !== "HAZIRLANDI" && job.status !== "GONDERILDI") {
      throw new BadRequestException(
        `Manifest yalnız HAZIRLANDI/GONDERILDI durumunda indirilebilir (şu an ${job.status}).`,
      );
    }
    const samples = await this.prisma.client.aiTrainingSample.findMany({
      // KİRACI SÜZGECİ ZORUNLU: başka büronun örneği bu manifeste GİREMEZ.
      where: { tenantId: user.tenantId, exportStatus: "ONAYLANDI" },
      orderBy: { createdAt: "asc" },
      take: 10000,
      select: { inputJson: true, outputJson: true, taskType: true, kind: true },
    });
    const jsonl = samples
      .map((s) =>
        JSON.stringify({ task_type: s.taskType, kind: s.kind, input: safeParse(s.inputJson), output: safeParse(s.outputJson) }),
      )
      .join("\n");
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "FINE_TUNE_MANIFEST_EXPORT",
      entity: "FineTuneJob",
      entityId: job.id,
      detail: `"${job.name}" manifesti üretildi (${samples.length} ONAYLANMIŞ örnek, yalnız bu büro).`,
    });
    return { jsonl, count: samples.length };
  }

  private async requireOwn(user: AuthUser, id: string) {
    const job = await this.prisma.client.fineTuneJob.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!job) throw new NotFoundException("Model eğitim işi bulunamadı.");
    return job;
  }

  /** Kiracı süzgeçli havuz anlık görüntüsü. */
  private async poolSnapshot(tenantId: string) {
    const rows = await this.prisma.client.aiTrainingSample.groupBy({
      by: ["taskType"],
      where: { tenantId, exportStatus: "ONAYLANDI" },
      _count: { _all: true },
    });
    const byTaskType: Record<string, number> = {};
    let approvedCount = 0;
    for (const r of rows) {
      byTaskType[r.taskType] = r._count._all;
      approvedCount += r._count._all;
    }
    return { approvedCount, byTaskType };
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
