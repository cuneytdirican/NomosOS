import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { JobStatus } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { paged, resolvePage } from "../common/pagination";
import { PlatformAuditService } from "../platform/platform-audit.service";
import type { PlatformAuthUser } from "../platform/platform.types";
import { parseJson } from "../platform/platform-serialize";
import { JobRegistryService } from "./job-registry.service";
import { JobRunnerService } from "./job-runner.service";
import { SchedulerService } from "./scheduler.service";
import { safeNextRun } from "./cron-expression";
import { JOB_AUDIT_ACTIONS, JOB_KEYS, JOB_RUN_PAGE_SIZE } from "./scheduler.constants";
import type { JobPatchInput, JobRunInput } from "./platform-jobs.schemas";

const STATUS_LABELS: Record<JobStatus, string> = {
  BASARILI: "Başarılı",
  BASARISIZ: "Başarısız",
  CALISIYOR: "Çalışıyor",
  ATLANDI: "Atlandı (yapacak iş yok)",
};

/** Panelin iş listesi satırı. */
interface JobListItem {
  key: string;
  name: string;
  description: string | null;
  cronExpression: string;
  defaultCron: string | null;
  isEnabled: boolean;
  /** Tabloda var, kodda yok — zamanlayıcıya alınmayan artık tanım. */
  isOrphan: boolean;
  isRunning: boolean;
  lastRunAt: Date | null;
  lastStatus: JobStatus | null;
  lastStatusLabel: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  nextRunAt: Date | null;
  /** Kodda var, tabloda yok olan iş için null. */
  updatedAt: Date | null;
}

/** `targetDate` gönderilmesi anlamsız olan işler. */
const TARGET_DATE_UNSUPPORTED = new Set<string>([
  JOB_KEYS.CREDIT_PERIOD_RENEWAL,
  JOB_KEYS.SUBSCRIPTION_RENEWAL,
]);

@Injectable()
export class PlatformJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistryService,
    private readonly runner: JobRunnerService,
    private readonly scheduler: SchedulerService,
    private readonly audit: PlatformAuditService
  ) {}

  /**
   * İş tanımları + son çalışma durumu + zamanlayıcı durumu.
   *
   * AÇIKLAMA VE AD KODDAN GELİR, tablodaki `name` alanı yalnız yedektir:
   * bir işin NE YAPTIĞI koddadır; tabloya elle yazılmış bir açıklama, kod
   * değiştiğinde sessizce yalan söylerdi.
   */
  async list() {
    const rows = await this.prisma.client.scheduledJob.findMany({ orderBy: { key: "asc" } });
    const known = this.registry.keys();
    const running = new Set(this.runner.runningKeys());
    const now = new Date();

    const items: JobListItem[] = rows.map((row) => {
      const handler = this.registry.find(row.key);
      return {
        key: row.key,
        name: handler?.name ?? row.name,
        description: handler?.description ?? null,
        cronExpression: row.cronExpression,
        defaultCron: handler?.defaultCron ?? null,
        isEnabled: row.isEnabled,
        /**
         * Kodda karşılığı olmayan tanım: tabloya elle eklenmiş ya da kaldırılmış
         * bir işin artığı. Zamanlayıcıya alınmaz; panelde AÇIKÇA işaretlenir ki
         * "açık ama hiç çalışmıyor" gizemi doğmasın.
         */
        isOrphan: !known.has(row.key),
        isRunning: running.has(row.key),
        lastRunAt: row.lastRunAt,
        lastStatus: row.lastStatus,
        lastStatusLabel: row.lastStatus ? STATUS_LABELS[row.lastStatus] : null,
        lastError: row.lastError,
        lastDurationMs: row.lastDurationMs,
        // Kayıtlı değer bayat olabilir (kapanış/açılış arası geçen zaman);
        // listede TAZE hesaplanır, tablo yalnız kalıcılık içindir.
        nextRunAt: row.isEnabled ? safeNextRun(row.cronExpression, now) : null,
        updatedAt: row.updatedAt,
      };
    });

    // Kodda tanımlı ama tabloda satırı olmayan iş (açılışta oluşturma
    // başarısız olduysa) da görünür olmalı.
    for (const handler of this.registry.all()) {
      if (rows.some((r) => r.key === handler.key)) continue;
      items.push({
        key: handler.key,
        name: handler.name,
        description: handler.description,
        cronExpression: handler.defaultCron,
        defaultCron: handler.defaultCron,
        isEnabled: false,
        isOrphan: false,
        isRunning: false,
        lastRunAt: null,
        lastStatus: null,
        lastStatusLabel: null,
        lastError: "Tanım veritabanında yok; API yeniden başlatıldığında oluşturulur.",
        lastDurationMs: null,
        nextRunAt: null,
        updatedAt: null,
      });
    }

    return { items, scheduler: this.scheduler.status() };
  }

  /** Bir işin çalışma geçmişi (append-only `JobRun`). */
  async runs(key: string, query: { status?: string; page?: string; limit?: string }) {
    await this.requireDefinition(key);

    const where: { jobKey: string; status?: JobStatus } = { jobKey: key };
    if (query.status) {
      const status = query.status.toUpperCase() as JobStatus;
      if (!(status in STATUS_LABELS)) {
        throw new BadRequestException(
          `Geçersiz durum süzgeci. Kabul edilenler: ${Object.keys(STATUS_LABELS).join(", ")}.`
        );
      }
      where.status = status;
    }

    const page = resolvePage(query, JOB_RUN_PAGE_SIZE);
    const [rows, total] = await Promise.all([
      this.prisma.client.jobRun.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.jobRun.count({ where }),
    ]);

    return paged(
      rows.map((row) => ({
        id: row.id,
        jobKey: row.jobKey,
        /**
         * Tanımlı işlerin HEPSİ kiracılar arasıdır; bu alan bugün daima
         * null'dur ve panel onu "genel iş" olarak okumalıdır. Etkilenen büro
         * kırılımı `detail` içindedir (denetim bulgusu 12).
         */
        tenantId: row.tenantId,
        tenantScope: row.tenantId === null ? ("tum-kiracilar" as const) : ("tek-kiraci" as const),
        status: row.status,
        statusLabel: STATUS_LABELS[row.status],
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        /**
         * Bitmemiş koşuda süre BİLİNMEZ. Açılıştaki süpürücü, altı saatten
         * eski `CALISIYOR` satırlarını "kesilmiş koşu" olarak kapatır; bu
         * yüzden kalıcı olarak null kalan bir satır artık beklenmez
         * (denetim bulgusu 13).
         */
        durationMs: row.finishedAt
          ? row.finishedAt.getTime() - row.startedAt.getTime()
          : null,
        itemsProcessed: row.itemsProcessed,
        errorMessage: row.errorMessage,
        detail: parseJson<Record<string, unknown> | null>(row.detailJson, null),
      })),
      total,
      page
    );
  }

  /**
   * ELLE TETİKLEME.
   *
   * DÖRT-GÖZ GEREKTİRMEZ (görev tanımı): işler idempotenttir ve yıkıcı bir
   * etkileri yoktur — en kötü ihtimalle zaten var olan bildirimler atlanır.
   * Buna karşılık DENETİM İZİNE YAZILIR: kimin hangi gece işini ne zaman
   * elle çalıştırdığı, bir bildirim dalgası ya da kota sıfırlaması
   * incelendiğinde ilk sorulacak sorudur.
   *
   * REDIS'E İHTİYAÇ DUYMAZ: koşu bu süreçte, kuyruğa uğramadan yapılır.
   * Zamanlayıcı devre dışıyken operatörün elinde kalan tek yol budur.
   */
  async trigger(user: PlatformAuthUser, key: string, body: JobRunInput) {
    const handler = this.registry.require(key);

    let targetDate: Date | undefined;
    if (body.targetDate) {
      if (TARGET_DATE_UNSUPPORTED.has(key)) {
        throw new BadRequestException(
          `"${key}" işi hedef gün kabul etmez: parasal/abonelik durumu geriye dönük ` +
            "hesaplanamaz. Gövdeyi boş gönderin."
        );
      }
      const parsed = new Date(`${body.targetDate}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException("Hedef gün çözümlenemedi.");
      }
      if (parsed.getTime() > Date.now()) {
        throw new BadRequestException("Hedef gün gelecekte olamaz.");
      }
      targetDate = parsed;
    }

    await this.audit.log({
      actor: user,
      action: JOB_AUDIT_ACTIONS.MANUAL_RUN,
      entity: "ScheduledJob",
      entityId: key,
      detail:
        `Zamanlanmış iş elle tetiklendi: ${handler.name}` +
        (body.targetDate ? ` (hedef gün ${body.targetDate})` : ""),
    });

    const summary = await this.runner.run(handler, {
      trigger: "manuel",
      now: new Date(),
      targetDate,
      triggeredBy: user.id,
    });

    return { ...summary, statusLabel: STATUS_LABELS[summary.status] };
  }

  /**
   * Tanım güncelleme (aç/kapat, cron değiştir).
   *
   * Değişiklik ANINDA kuyruğa yansıtılır (`scheduler.resync`): aksi hâlde
   * "kapattım ama gece yine çalıştı" davranışı doğar ve operatör bir sonraki
   * dağıtımı beklemek zorunda kalırdı.
   */
  async patch(user: PlatformAuthUser, key: string, body: JobPatchInput) {
    const existing = await this.requireDefinition(key);

    const data: { isEnabled?: boolean; cronExpression?: string; nextRunAt?: Date | null } = {};
    const changes: string[] = [];

    if (body.isEnabled !== undefined && body.isEnabled !== existing.isEnabled) {
      data.isEnabled = body.isEnabled;
      changes.push(`durum: ${existing.isEnabled ? "açık" : "kapalı"} → ${body.isEnabled ? "açık" : "kapalı"}`);
    }
    if (body.cronExpression !== undefined && body.cronExpression !== existing.cronExpression) {
      data.cronExpression = body.cronExpression;
      changes.push(`cron: "${existing.cronExpression}" → "${body.cronExpression}"`);
    }
    if (changes.length === 0) {
      return this.toDefinitionDto(existing);
    }

    const enabled = data.isEnabled ?? existing.isEnabled;
    const cron = data.cronExpression ?? existing.cronExpression;
    data.nextRunAt = enabled ? safeNextRun(cron, new Date()) : null;

    const updated = await this.prisma.client.scheduledJob.update({ where: { key }, data });

    await this.audit.log({
      actor: user,
      action: JOB_AUDIT_ACTIONS.PATCH,
      entity: "ScheduledJob",
      entityId: key,
      detail: `Zamanlanmış iş güncellendi — ${changes.join("; ")}.`,
    });

    await this.scheduler.resync();

    return this.toDefinitionDto(updated);
  }

  private async requireDefinition(key: string) {
    const row = await this.prisma.client.scheduledJob.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(
        `"${key}" anahtarlı zamanlanmış iş tanımı bulunamadı.`
      );
    }
    return row;
  }

  private toDefinitionDto(row: {
    key: string;
    name: string;
    cronExpression: string;
    isEnabled: boolean;
    lastRunAt: Date | null;
    lastStatus: JobStatus | null;
    lastError: string | null;
    lastDurationMs: number | null;
    nextRunAt: Date | null;
    updatedAt: Date;
  }) {
    const handler = this.registry.find(row.key);
    return {
      key: row.key,
      name: handler?.name ?? row.name,
      description: handler?.description ?? null,
      cronExpression: row.cronExpression,
      isEnabled: row.isEnabled,
      lastRunAt: row.lastRunAt,
      lastStatus: row.lastStatus,
      lastStatusLabel: row.lastStatus ? STATUS_LABELS[row.lastStatus] : null,
      lastError: row.lastError,
      lastDurationMs: row.lastDurationMs,
      nextRunAt: row.nextRunAt,
      updatedAt: row.updatedAt,
      scheduler: this.scheduler.status(),
    };
  }
}
