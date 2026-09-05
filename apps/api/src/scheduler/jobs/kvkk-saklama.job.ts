import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { KvkkService } from "../../security/kvkk.service";
import { NotificationOutboxService } from "../notification-outbox.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * KVKK SAKLAMA DENETİMİ (`kvkk-saklama-aylik`) — ayın 1'i 06:00.
 *
 * NE YAPMAZ: hiçbir veriyi SİLMEZ. İmha ADMIN'in gerekçeli kararıdır.
 * NE YAPAR: her büro için (a) saklama süresi dolan KAPANDI dosya sayısı,
 * (b) yasal süresi geçmiş açık veri öznesi talebi sayısı; biri sıfırdan büyükse
 * büronun ADMIN kullanıcılarına KVKK_SAKLAMA bildirimi yazar (ay başına bir kez —
 * dedupeKey). Böylece süre dolumu sessizce geçmez, m.13/2 süresi kaçırılmaz.
 */
@Injectable()
export class KvkkSaklamaJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.KVKK_SAKLAMA;
  readonly name = "KVKK saklama süresi denetimi";
  readonly defaultCron = "0 6 1 * *";
  readonly description =
    "Her ayın 1'inde saklama süresi (kapanış + büro politikası yılı) dolan dosyaları ve yanıt süresi geçen " +
    "KVKK taleplerini sayar; büro yöneticilerine bildirim yazar. Hiçbir veri otomatik silinmez — imha, " +
    "yöneticinin gerekçeli kararıdır (Ayarlar → KVKK).";

  constructor(
    private readonly prisma: PrismaService,
    private readonly kvkk: KvkkService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const tenants = await this.prisma.client.tenant.findMany({ select: { id: true } });
    const period = ctx.now.toISOString().slice(0, 7);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const detail: Record<string, unknown> = { period, tenants: tenants.length };

    for (const t of tenants) {
      try {
        const report = await this.kvkk.retentionReportFor(t.id, ctx.now);
        if (report.candidates.length === 0 && report.overdueRequests === 0) {
          skipped += 1;
          continue;
        }
        const admins = await this.prisma.client.user.findMany({
          where: { tenantId: t.id, isActive: true, role: { in: ["ADMIN", "PARTNER"] } },
          select: { id: true },
        });
        const body =
          `${report.candidates.length} dosyada saklama süresi (${report.retentionYears} yıl) doldu` +
          (report.overdueRequests > 0 ? `; ${report.overdueRequests} KVKK talebinin 30 günlük yanıt süresi geçti` : "") +
          ". Ayarlar → KVKK ekranından inceleyin; imha yalnız gerekçeli yönetici kararıyla uygulanır.";
        for (const admin of admins) {
          const outcome = await this.outbox.enqueue({
            tenantId: t.id,
            userId: admin.id,
            kind: "KVKK_SAKLAMA",
            title: "KVKK saklama süresi denetimi",
            body,
            resourceType: "Tenant",
            resourceId: t.id,
            dedupeKey: `kvkk-saklama:${t.id}:${admin.id}:${period}`,
          });
          if (outcome === "yazildi") created += 1;
          else skipped += 1;
        }
      } catch (err) {
        failed += 1;
        if (errors.length < 5) errors.push(`${t.id}: ${(err as Error).message}`);
      }
    }
    return { created, skipped, failed, detail, errors };
  }
}
