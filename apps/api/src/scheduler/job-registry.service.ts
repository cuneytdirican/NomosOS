import { Injectable, NotFoundException } from "@nestjs/common";
import { UsageSnapshotJob } from "./jobs/usage-snapshot.job";
import { DeadlineReminderJob } from "./jobs/deadline-reminder.job";
import { HearingReminderJob } from "./jobs/hearing-reminder.job";
import { SubscriptionRenewalJob } from "./jobs/subscription-renewal.job";
import { CreditPeriodRenewalJob } from "./jobs/credit-period-renewal.job";
import { CreditLowWarningJob } from "./jobs/credit-low-warning.job";
import { RiskNightlyJob } from "./jobs/risk-nightly.job";
import { HepoReminderJob } from "./jobs/hepo-reminder.job";
import type { ScheduledJobHandler } from "./scheduler.types";

/**
 * İŞ KAYIT DEFTERİ — KOD, İŞİN NE OLDUĞUNUN TEK KAYNAĞIDIR.
 *
 * `ScheduledJob` TABLOSU İŞİN NE YAPTIĞINI DEĞİL, NE ZAMAN ÇALIŞACAĞINI
 * belirler. Tabloya elle bir satır eklemek yeni bir iş YARATMAZ: karşılığı
 * olmayan anahtar burada bulunamaz ve zamanlayıcı onu kuyruğa yazmaz. Bu,
 * veritabanına yazma yetkisi olan birinin keyfi kod yolu tetiklemesini
 * yapısal olarak engeller.
 *
 * Tersi de doğrudur: kodda tanımlı ama tabloda satırı olmayan bir iş, açılışta
 * varsayılan cron'uyla OLUŞTURULUR (bkz. SchedulerService.syncDefinitions).
 */
@Injectable()
export class JobRegistryService {
  private readonly handlers: Map<string, ScheduledJobHandler>;

  constructor(
    usageSnapshot: UsageSnapshotJob,
    deadlineReminder: DeadlineReminderJob,
    hearingReminder: HearingReminderJob,
    subscriptionRenewal: SubscriptionRenewalJob,
    creditPeriodRenewal: CreditPeriodRenewalJob,
    // denetim bulgusu Ö-29
    creditLowWarning: CreditLowWarningJob,
    // F2 · E2
    riskNightly: RiskNightlyJob,
    // Modül 28 (Faz 3) — HEPO vade hatırlatmaları
    hepoReminder: HepoReminderJob
  ) {
    const all: ScheduledJobHandler[] = [
      usageSnapshot,
      deadlineReminder,
      hearingReminder,
      subscriptionRenewal,
      creditPeriodRenewal,
      creditLowWarning,
      riskNightly,
      hepoReminder,
    ];
    this.handlers = new Map(all.map((h) => [h.key, h]));
  }

  all(): ScheduledJobHandler[] {
    return [...this.handlers.values()];
  }

  keys(): Set<string> {
    return new Set(this.handlers.keys());
  }

  find(key: string): ScheduledJobHandler | undefined {
    return this.handlers.get(key);
  }

  /** Bilinmeyen anahtarda Türkçe 404 — panelin yazım hatası sessizce yutulmaz. */
  require(key: string): ScheduledJobHandler {
    const handler = this.handlers.get(key);
    if (!handler) {
      throw new NotFoundException(
        `"${key}" adında bir zamanlanmış iş tanımlı değil. Tanımlı işler: ` +
          [...this.handlers.keys()].join(", ")
      );
    }
    return handler;
  }
}
