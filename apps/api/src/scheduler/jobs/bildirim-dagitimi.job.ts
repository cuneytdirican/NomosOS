import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { MailService } from "../../mail/mail.service";
import { webOrigin } from "../../common/public-urls";
import { NotificationOutboxService } from "../notification-outbox.service";
import { PUSH_PROVIDER, type PushMessage, type PushProvider, type PushTarget } from "../push/push-provider";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * BİLDİRİM DAĞITIMI (`bildirim-dagitimi-5dk`) — Faz 2.
 *
 * Bildirim kutusundaki (NotificationOutbox) satırlar uygulama içinde zaten
 * görünür; bu iş onları DIŞARI taşır: kullanıcı tercihine göre e-posta
 * (SMTP) ve/veya push (Expo). Her satır bir kez dağıtılır (`dispatchedAt`);
 * kanal kapalı ya da sağlayıcı yapılandırılmamışsa satır yine damgalanır ve
 * kırılımda "atlandı" olarak görünür — tekrar tekrar denenmez.
 *
 * E-posta metni bildirim başlığı + gövdesi + uygulama bağlantısıdır; push
 * metni `buildPushPayload` ile türetilir (kaynak sızdırmaz).
 */
@Injectable()
export class BildirimDagitimiJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.BILDIRIM_DAGITIMI;
  readonly name = "Bildirim dağıtımı (e-posta / push)";
  readonly defaultCron = "*/5 * * * *";
  readonly description =
    "Bekleyen bildirimleri kullanıcı tercihine göre e-posta (SMTP) ve push (Expo) ile dışarı taşır. " +
    "Her bildirim bir kez dağıtılır; kanal tanımsızsa atlanır ve kırılımda görünür.";
  private readonly logger = new Logger(BildirimDagitimiJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly outbox: NotificationOutboxService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const rows = await this.prisma.client.notificationOutbox.findMany({
      where: {
        dispatchedAt: null,
        status: { in: ["BEKLIYOR", "GONDERILDI"] },
        userId: { not: null },
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: ctx.now } }],
      },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, tenantId: true, userId: true, kind: true, title: true, body: true, resourceType: true, resourceId: true },
    });

    let emailSent = 0;
    let pushSent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const userCache = new Map<string, { email: string; fullName: string; isActive: boolean } | null>();
    const tokenCache = new Map<string, PushTarget[]>();

    for (const row of rows) {
      const userId = row.userId as string;
      try {
        const prefs = await this.outbox.preferredChannels(row.tenantId, userId, row.kind);
        if (!userCache.has(userId)) {
          userCache.set(
            userId,
            await this.prisma.client.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true, isActive: true } }),
          );
        }
        const user = userCache.get(userId);
        let delivered = false;

        if (prefs.email && user?.isActive && this.mail.configured) {
          const res = await this.mail.send({
            to: user.email,
            subject: `NomosOS — ${row.title}`,
            text: `${row.body}\n\nUygulamada görüntülemek için: ${webOrigin()}/app/bildirimler\n\nBu ileti NomosOS bildirim tercihlerinize göre gönderildi; tercihleri Ayarlar > Bildirimler'den değiştirebilirsiniz.`,
          });
          if (res.sent) {
            emailSent += 1;
            delivered = true;
          } else errors.push(`${row.id}: e-posta ${res.reason}`);
        }

        if (prefs.push && this.push.configured) {
          if (!tokenCache.has(userId)) {
            const tokens = await this.prisma.client.deviceToken.findMany({
              where: { tenantId: row.tenantId, userId, isActive: true },
              select: { token: true, platform: true },
            });
            tokenCache.set(userId, tokens);
          }
          const targets = tokenCache.get(userId) ?? [];
          if (targets.length > 0) {
            const msg: PushMessage = {
              tenantId: row.tenantId,
              userId,
              kind: row.kind,
              data: row.resourceType && row.resourceId ? { resourceType: row.resourceType, resourceId: row.resourceId } : undefined,
            };
            const res = await this.push.send([msg], targets);
            if (res.delivered > 0) {
              pushSent += res.delivered;
              delivered = true;
            }
            const invalid = (this.push as { invalidTokens?: string[] }).invalidTokens ?? [];
            if (invalid.length > 0) {
              await this.prisma.client.deviceToken.updateMany({ where: { token: { in: invalid } }, data: { isActive: false } });
              tokenCache.delete(userId);
            }
          }
        }

        await this.prisma.client.notificationOutbox.update({
          where: { id: row.id },
          data: { dispatchedAt: ctx.now, ...(delivered ? { sentAt: ctx.now } : {}) },
        });
        if (!delivered) skipped += 1;
      } catch (err) {
        failed += 1;
        const msg = (err as Error).message;
        errors.push(`${row.id}: ${msg}`);
        this.logger.warn(`Bildirim dağıtılamadı (${row.id}): ${msg}`);
      }
    }

    return {
      created: emailSent + pushSent,
      skipped,
      failed,
      detail: {
        islenen: rows.length,
        eposta: emailSent,
        push: pushSent,
        smtpTanimli: this.mail.configured,
        pushSaglayici: this.push.configured ? this.push.name : "yok",
      },
      errors: errors.slice(0, 10),
    };
  }
}
