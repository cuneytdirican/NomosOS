import { Injectable } from "@nestjs/common";
import { UserSessionsService } from "../../auth/user-sessions.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * OTURUM KAYDI TEMİZLİĞİ (`oturum-temizligi-gunluk`) — her gün 04:00.
 *
 * Süresi ya da iptali 30 günü geçmiş `UserSession` satırlarını siler. Açık
 * oturumlara DOKUNMAZ; yalnız listede zaten görünmeyen tarihçeyi budar
 * (denetim izi ayrı tabloda kalır — LOGIN_SUCCESS / SESSION_REVOKE).
 */
@Injectable()
export class OturumTemizligiJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.OTURUM_TEMIZLIGI;
  readonly name = "Oturum kaydı temizliği";
  readonly defaultCron = "0 4 * * *";
  readonly description =
    "Süresi ya da iptali 30 günü geçmiş cihaz oturumu kayıtlarını siler; açık oturumlara dokunmaz. " +
    "Giriş/çıkış olayları denetim izinde kalır.";

  constructor(private readonly sessions: UserSessionsService) {}

  async run(ctx: JobExecutionContext): Promise<JobResult> {
    const silinen = await this.sessions.purgeStale(ctx.now);
    return { created: 0, skipped: 0, failed: 0, detail: { silinen }, errors: [] };
  }
}
