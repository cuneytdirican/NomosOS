import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";
import { FINE_TUNE_TRANSITIONS, type FineTuneCreateInput, type FineTuneStatusInput } from "./fine-tune.schemas";

/**
 * FINE-TUNING İŞ YÖNETİMİ (D5 / M4).
 *
 * DÜRÜSTLÜK İLKESİ: bu servis sağlayıcıya HİÇBİR ŞEY GÖNDERMEZ. Dış
 * sağlayıcı sözleşmesi + API anahtarı kurulumu gerektirdiği için iş üç
 * adımlı yürür:
 *   1. İş AÇILIR — ONAYLANMIŞ örnek havuzunun anlık görüntüsü (sayı +
 *      görev tipi kırılımı) kayda yazılır.
 *   2. Operatör MANİFESTİ (JSONL) indirir ve sağlayıcıya ELLE yükler.
 *   3. Operatör durumu izler; TAMAMLANDI'da sonuç model adını yazar.
 *
 * Örnek havuzu kiracı opt-in + örnek bazında ONAYLANDI süzgecinden geçer
 * (C3); manifest yalnız bu havuzu içerir.
 */
@Injectable()
export class FineTuneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService
  ) {}

  async list() {
    const rows = await this.prisma.client.fineTuneJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        provider: true,
        baseModel: true,
        status: true,
        sampleCount: true,
        taskTypesJson: true,
        resultModelName: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        requestedBy: { select: { fullName: true, email: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        ...r,
        taskTypes: safeParse(r.taskTypesJson),
      })),
      // Anlık havuz durumu — yeni iş açacak operatörün görmesi için.
      pool: await this.poolSnapshot(),
    };
  }

  async create(
    user: PlatformAuthUser,
    input: FineTuneCreateInput
  ) {
    const pool = await this.poolSnapshot();
    if (pool.approvedCount === 0) {
      throw new BadRequestException(
        "ONAYLANMIŞ örnek yok; iş açılamaz. Önce AI eğitim verisi havuzunda örnek onaylayın."
      );
    }
    const job = await this.prisma.client.fineTuneJob.create({
      data: {
        name: input.name,
        provider: input.provider,
        baseModel: input.baseModel,
        note: input.note ?? null,
        status: "HAZIRLANDI",
        sampleCount: pool.approvedCount,
        taskTypesJson: JSON.stringify(pool.byTaskType),
        requestedById: user.id,
      },
    });
    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "FINE_TUNE_JOB_CREATE",
      entity: "FineTuneJob",
      entityId: job.id,
      detail:
        `"${job.name}" işi açıldı (${job.provider}/${job.baseModel}). ` +
        `Anlık görüntü: ${pool.approvedCount} ONAYLANMIŞ örnek. ` +
        "Sağlayıcıya otomatik gönderim YOKTUR — manifest elle yüklenir.",
    });
    return job;
  }

  /** Durum geçişi — şerit dışına çıkış reddedilir; TAMAMLANDI model adı ister. */
  async setStatus(
    user: PlatformAuthUser,
    id: string,
    input: FineTuneStatusInput
  ) {
    const job = await this.prisma.client.fineTuneJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Fine-tuning işi bulunamadı.");
    const allowed = FINE_TUNE_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new BadRequestException(
        `"${job.status}" → "${input.status}" geçişine izin verilmez. ` +
          `İzinli geçişler: ${allowed.length > 0 ? allowed.join(", ") : "yok (iş tamamlandı)"}.`
      );
    }
    let resultModelName = job.resultModelName;
    if (input.status === "TAMAMLANDI") {
      if (!input.resultModelName || input.resultModelName.length < 2) {
        throw new BadRequestException(
          "TAMAMLANDI için sonuç model adı ZORUNLUDUR — sağlayıcının döndürdüğü model kimliğini yazın."
        );
      }
      resultModelName = input.resultModelName;
    }
    const updated = await this.prisma.client.fineTuneJob.update({
      where: { id },
      data: {
        status: input.status,
        resultModelName,
        note: input.note ?? job.note,
      },
    });
    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "FINE_TUNE_JOB_STATUS",
      entity: "FineTuneJob",
      entityId: id,
      detail:
        `"${job.name}" durumu ${job.status} → ${input.status}` +
        (input.status === "TAMAMLANDI" ? ` (sonuç modeli: ${resultModelName}).` : "."),
    });
    return updated;
  }

  /**
   * MANİFEST — işin anlık görüntüsündeki havuzun JSONL dökümü.
   * Manifest, işin AÇILIŞ anındaki havuzu değil DOLUŞ anınıkını verir;
   * sayısal tutarlılık anlık görüntü alanıyla korunur. Yalnız HAZIRLANDI
   * ve GONDERILDI durumlarında indirilebilir (eğitim başladıktan sonra
   * havuz değişmiş olabilir — yeni iş açılmalıdır).
   */
  async manifest(user: PlatformAuthUser, id: string) {
    const job = await this.prisma.client.fineTuneJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Fine-tuning işi bulunamadı.");
    if (job.status !== "HAZIRLANDI" && job.status !== "GONDERILDI") {
      throw new BadRequestException(
        `Manifest yalnız HAZIRLANDI/GONDERILDI durumunda indirilebilir (şu an ${job.status}). ` +
          "Eğitim başladıysa güncel havuz için yeni iş açın."
      );
    }
    const samples = await this.prisma.client.aiTrainingSample.findMany({
      where: { exportStatus: "ONAYLANDI" },
      orderBy: { createdAt: "asc" },
      take: 10000,
      select: { inputJson: true, outputJson: true, taskType: true, kind: true },
    });
    const jsonl = samples
      .map((s) => JSON.stringify({ task_type: s.taskType, kind: s.kind, input: safeParse(s.inputJson), output: safeParse(s.outputJson) }))
      .join("\n");
    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "FINE_TUNE_MANIFEST_EXPORT",
      entity: "FineTuneJob",
      entityId: id,
      detail: `"${job.name}" manifesti üretildi (${samples.length} ONAYLANMIŞ örnek, JSONL).`,
    });
    return { jsonl, count: samples.length };
  }

  /** ONAYLANMIŞ havuz anlık görüntüsü — sayı + görev tipi kırılımı. */
  private async poolSnapshot() {
    const rows = await this.prisma.client.aiTrainingSample.groupBy({
      by: ["taskType"],
      where: { exportStatus: "ONAYLANDI" },
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

/** Bozuk JSON kaydını sessizce { } yapar — manifest üretimi durmaz. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
