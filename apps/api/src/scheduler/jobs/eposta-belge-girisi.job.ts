import { Injectable } from "@nestjs/common";
import { MailIngestService } from "../../mail-ingest/mail-ingest.service";
import { JOB_KEYS } from "../scheduler.constants";
import type { JobExecutionContext, JobResult, ScheduledJobHandler } from "../scheduler.types";

/**
 * E-POSTA İLE BELGE GİRİŞİ (`eposta-belge-girisi-5dk`) — 5 dakikada bir.
 *
 * Etkin posta kutusu ayarı olan her kiracı için yeni iletilerin ekleri belge hattına
 * verilir (dosya numarası eşleşmesi → dosya; yoksa triyaj). Tur başına kiracı başına
 * en çok 25 ileti; gerisi sonraki tura kalır (UID imleci).
 */
@Injectable()
export class EpostaBelgeGirisiJob implements ScheduledJobHandler {
  readonly key = JOB_KEYS.EPOSTA_BELGE_GIRISI;
  readonly name = "E-posta ile belge girişi";
  readonly defaultCron = "*/5 * * * *";
  readonly description = "Bağlı IMAP posta kutularındaki yeni iletilerin eklerini belge hattına alır; dosya numarası eşleşirse dosyaya, yoksa triyaja yazar.";

  constructor(private readonly mailIngest: MailIngestService) {}

  async run(_ctx: JobExecutionContext): Promise<JobResult> {
    const res = await this.mailIngest.syncAll();
    const created = res.outcomes.reduce((a, o) => a + o.documents, 0);
    const skipped = res.outcomes.reduce((a, o) => a + o.skipped, 0);
    const errors = res.outcomes.flatMap((o) => o.errors.map((e) => `${o.tenantId}: ${e}`)).slice(0, 10);
    return {
      created,
      skipped,
      failed: errors.length,
      detail: { kiraci: res.tenants, ileti: res.outcomes.reduce((a, o) => a + o.messages, 0), dosyayaBagli: res.outcomes.reduce((a, o) => a + o.matched, 0), triyaj: res.outcomes.reduce((a, o) => a + o.triage, 0) },
      errors,
    };
  }
}
