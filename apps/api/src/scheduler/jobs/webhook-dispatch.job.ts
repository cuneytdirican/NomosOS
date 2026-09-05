import { Injectable } from "@nestjs/common";
import { WebhooksService } from "../../integrations/webhooks.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * WEBHOOK DAĞITIMI (`webhook-dispatch-5dk`) — her 5 dakikada bir.
 *
 * Vadesi gelen teslimatları (BEKLIYOR, nextAttemptAt ≤ şimdi) HMAC imzalı
 * POST ile gönderir; 2xx dışı yanıt ya da zaman aşımında geri çekilme
 * merdiveniyle 5 kez yeniden dener; sonuncusu da düşerse BASARISIZ işaretler. Teslimat
 * geçmişi büro tarafından /integrations/webhooks/:id/deliveries ile izlenir.
 */
@Injectable()
export class WebhookDispatchJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.WEBHOOK_DISPATCH;
  readonly name = "Webhook dağıtımı";
  readonly defaultCron = "*/5 * * * *";
  readonly description =
    "Büro webhook aboneliklerine vadesi gelen olay teslimatlarını HMAC imzalı POST ile gönderir; " +
    "başarısızlıkta 1 dk → 5 dk → 30 dk → 2 sa → 12 sa geri çekilerek 5 kez yeniden dener; sonra başarısız işaretler.";

  constructor(private readonly webhooks: WebhooksService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const r = await this.webhooks.dispatchDue(ctx.now);
    return {
      created: r.sent,
      skipped: r.retried,
      failed: r.failed,
      detail: { gonderildi: r.sent, yenidenDenenecek: r.retried, basarisiz: r.failed },
      errors: [],
    };
  }
}
