import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { JobRegistryService } from "./job-registry.service";
import { JobRunnerService } from "./job-runner.service";
import { isValidCron, safeNextRun } from "./cron-expression";
import { REDIS_PROBE, resolveRedisConfig, type RedisProbe } from "./redis-connection";
import {
  SCHEDULER_QUEUE_NAME,
  SCHEDULER_TIMEZONE,
  WORKER_LOCK_DURATION_MS,
} from "./scheduler.constants";
import type { JobRunSummary } from "./scheduler.types";

/**
 * ZAMANLAYICI DURUMU — `GET /api/admin/v1/jobs` yanıtında görünür.
 *
 * "calisiyor"  → BullMQ kuyruğu ve worker ayakta; cron tetikliyor.
 * "devre-disi" → Redis yok/erişilemiyor. İşler CRON'DAN tetiklenmez;
 *                elle tetikleme ÇALIŞIR.
 */
export type SchedulerMode = "calisiyor" | "devre-disi";

export interface SchedulerStatus {
  mode: SchedulerMode;
  /** Kapalıysa Türkçe gerekçe. */
  reason: string | null;
  redis: string;
  queue: string;
  timezone: string;
  /** Kuyruğa yazılmış (aktif) zamanlayıcı sayısı. */
  activeSchedulers: number;
  /** Şu anda bu süreçte çalışan işler. */
  running: string[];
  /**
   * Çalışan işlerin YAŞI. Kilit süreç içidir; bir arıza sonucu anahtarın
   * asılı kalıp kalmadığı ancak yaşına bakılarak anlaşılır. `stalled: true`
   * olan bir satır "iş sürüyor" değil "iş takılmış olabilir" demektir
   * (denetim bulgusu 2).
   */
  runningDetails: Array<{ key: string; startedAt: Date; ageMs: number; stalled: boolean }>;
}

/**
 * ZAMANLANMIŞ İŞ ALTYAPISI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ AÇILIŞ ASLA BAŞARISIZ OLMAZ.                                             ║
 * ║ `onModuleInit` içindeki HER adım kendi try/catch'i içindedir. Redis yok, ║
 * ║ Redis parolalı, kuyruk bozuk — hiçbiri API'yi düşürmez. Bu bilinçli bir  ║
 * ║ takastır: zamanlayıcı KAYBEDİLEBİLİR bir yetenektir, dosya/süre/duruşma  ║
 * ║ erişimi değildir. Sessizlik yerine `logger.error` ile büyük bir uyarı    ║
 * ║ basılır ve durum panelde `scheduler.mode` alanında görünür.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private mode: SchedulerMode = "devre-disi";
  private reason: string | null = "Zamanlayıcı henüz başlatılmadı.";
  private activeSchedulers = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistryService,
    private readonly runner: JobRunnerService,
    @Inject(REDIS_PROBE) private readonly probe: RedisProbe
  ) {}

  async onModuleInit(): Promise<void> {
    /**
     * 1) Tanımlar: Redis'ten BAĞIMSIZ. Kuyruk hiç kurulmasa da panel işleri
     *    listeleyebilmeli ve elle tetikleyebilmelidir.
     *
     * BU ADIMIN HATASI ZAMANLAYICIYI KAPATMAZ (denetim bulgusu 10).
     * `guard` her hatada `degrade()` çağırıyordu; oysa tanım eşitleme hatası
     * zamanlayıcının kendisiyle ilgili değildir. Rolling deploy'da iki pod
     * aynı saniyede açıldığında ikincisi P2002 alıyor, `degrade` çağrılıyor ve
     * o örnekte kuyruk HİÇ kurulmuyordu; panel hangi pod'a düşerseniz
     * "çalışıyor" ya da "devre dışı" gösteriyordu.
     */
    await this.note("iş tanımları eşitlenemedi", () => this.syncDefinitions());
    await this.note("sonraki çalışma zamanları hesaplanamadı", () => this.refreshNextRunAt());
    // 2) Kuyruk: başarısız olabilir; olursa devre dışı kalınır.
    await this.guard("zamanlayıcı başlatılamadı", () => this.start());
  }

  async onModuleDestroy(): Promise<void> {
    await this.teardown();
  }

  status(): SchedulerStatus {
    const config = resolveRedisConfig();
    return {
      mode: this.mode,
      reason: this.reason,
      redis: config.display,
      queue: SCHEDULER_QUEUE_NAME,
      timezone: SCHEDULER_TIMEZONE,
      activeSchedulers: this.activeSchedulers,
      running: this.runner.runningKeys(),
      runningDetails: this.runner.runningDetails(),
    };
  }

  // ==========================================================================
  // Tanım eşitleme (veritabanı)
  // ==========================================================================

  /**
   * Kodda tanımlı ama tabloda satırı olmayan işleri OLUŞTURUR.
   *
   * MEVCUT SATIRA DOKUNULMAZ. Operatörün panelden değiştirdiği `cronExpression`
   * ve `isEnabled` değerleri, her açılışta varsayılana geri dönseydi "kapattım,
   * yine çalıştı" davranışı doğardı — bir işi kapatmak, ancak bir sonraki
   * dağıtıma kadar süren geçici bir dilek olurdu. Tohumlama (`seed.ts`) da
   * aynı sözleşmeyi kullanır.
   */
  private async syncDefinitions(): Promise<void> {
    let created = 0;
    for (const handler of this.registry.all()) {
      /**
       * `upsert` — "ÖNCE BAK SONRA YAZ" DEĞİL (denetim bulgusu 10).
       *
       * `findUnique` + `create` iki ayrı işlemdir ve aralarında başka bir
       * süreç aynı satırı yazabilir; `ScheduledJob.key` benzersiz olduğu için
       * ikinci `create` P2002 fırlatır. Modülün kendi felsefesi bu deseni
       * başka yerde açıkça reddediyor (`notification-outbox.service.ts`), ama
       * burada tam olarak o yapılıyordu.
       *
       * `update: {}` BOŞTUR ve bilinçlidir: mevcut satıra DOKUNULMAZ.
       * Operatörün panelden değiştirdiği `cronExpression`/`isEnabled` her
       * açılışta varsayılana dönseydi, bir işi kapatmak ancak bir sonraki
       * dağıtıma kadar süren geçici bir dilek olurdu.
       */
      const before = await this.prisma.client.scheduledJob.count({ where: { key: handler.key } });
      await this.prisma.client.scheduledJob.upsert({
        where: { key: handler.key },
        create: {
          key: handler.key,
          name: handler.name,
          cronExpression: handler.defaultCron,
        },
        update: {},
      });
      if (before === 0) created += 1;
    }
    if (created > 0) {
      this.logger.log(`${created} zamanlanmış iş tanımı oluşturuldu (varsayılan cron ile).`);
    }
  }

  /** Açık işlerin `nextRunAt` alanını tazeler (Redis gerekmez). */
  async refreshNextRunAt(from: Date = new Date()): Promise<void> {
    const rows = await this.prisma.client.scheduledJob.findMany({
      select: { key: true, cronExpression: true, isEnabled: true },
    });
    for (const row of rows) {
      const next = row.isEnabled ? safeNextRun(row.cronExpression, from) : null;
      await this.prisma.client.scheduledJob.updateMany({
        where: { key: row.key },
        data: { nextRunAt: next },
      });
    }
  }

  // ==========================================================================
  // BullMQ
  // ==========================================================================

  private async start(): Promise<void> {
    const config = resolveRedisConfig();
    if (!config.enabled) {
      this.degrade(config.reason ?? "Redis yapılandırması çözülemedi.");
      return;
    }

    try {
      const { latencyMs } = await this.probe.ping(config);
      this.logger.log(`Redis erişilebilir (${config.display}, ${latencyMs} ms).`);
    } catch (err) {
      this.degrade(
        `Redis'e bağlanılamadı (${config.display}): ${(err as Error).message}`
      );
      return;
    }

    /**
     * Kuyruk ve worker'a HAM SEÇENEKLER verilir, paylaşılan bir istemci değil.
     * BullMQ worker'ı bloklayan komutlar kullanır; aynı bağlantıyı kuyrukla
     * paylaşmak kuyruk komutlarını worker'ın bloklamasının arkasında bekletir.
     */
    this.queue = new Queue(SCHEDULER_QUEUE_NAME, { connection: { ...config.options } });
    /**
     * 'error' DİNLEYİCİSİ ZORUNLUDUR. Redis açılıştan SONRA düşerse, dinleyicisi
     * olmayan bir 'error' olayı Node'da yakalanamayan istisnaya dönüşür ve
     * API sürecini düşürür — yani "Redis'e sert bağımlılık yok" sözü, ilk
     * kesintide bozulurdu.
     */
    this.queue.on("error", (err) =>
      this.logger.warn(`Kuyruk bağlantı hatası: ${err.message}`)
    );

    this.worker = new Worker(
      SCHEDULER_QUEUE_NAME,
      async (job: Job) => this.process(job),
      {
        connection: { ...config.options },
        // TEK EŞ ZAMANLI İŞ: gece işleri veritabanını tarar; paralel çalışmaları
        // hem gereksiz hem de `ScheduledJob.last*` alanlarında yarış üretir.
        concurrency: 1,
        /**
         * KİLİT SÜRESİ AÇIKÇA VERİLİR (denetim bulgusu 13).
         * BullMQ varsayılanı 30 saniyedir; yüzlerce kiracılı bir kurulumda süre
         * işi bunu rahatça aşar ve kuyruk işi "stalled" sayıp YENİDEN DAĞITIR.
         * O anda aynı iş ikinci kez başlar; bildirimler `dedupeKey` sayesinde
         * çiftlenmez ama `JobRun` günlüğü okunmaz hâle gelir.
         */
        lockDuration: WORKER_LOCK_DURATION_MS,
        stalledInterval: WORKER_LOCK_DURATION_MS,
        // Takılan bir iş en fazla bir kez yeniden dağıtılsın; ötesi gürültüdür.
        maxStalledCount: 1,
      }
    );
    this.worker.on("error", (err) =>
      this.logger.warn(`Worker bağlantı hatası: ${err.message}`)
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error(`Kuyruk işi başarısız (${job?.name ?? "?"}): ${err.message}`)
    );

    await this.syncSchedulers();

    this.mode = "calisiyor";
    this.reason = null;
    this.logger.log(
      `Zamanlayıcı çalışıyor — kuyruk "${SCHEDULER_QUEUE_NAME}", ` +
        `saat dilimi ${SCHEDULER_TIMEZONE}, ${this.activeSchedulers} aktif iş.`
    );
  }

  /**
   * Veritabanındaki tanımları BullMQ tekrarlayan işlerine yansıtır.
   *
   * `upsertJobScheduler` anahtar bazlıdır: aynı anahtarla ikinci çağrı yeni bir
   * zamanlayıcı YARATMAZ, mevcudu günceller. Bu yüzden birden çok API örneği
   * aynı anda açılsa da tek bir cron kaydı oluşur ve iş gecede bir kez tetiklenir.
   */
  async syncSchedulers(): Promise<void> {
    if (!this.queue) return;
    const known = this.registry.keys();
    const rows = await this.prisma.client.scheduledJob.findMany();
    const wanted = new Set<string>();

    for (const row of rows) {
      // Kodda karşılığı olmayan satır KUYRUĞA YAZILMAZ (bkz. JobRegistryService).
      if (!known.has(row.key)) {
        this.logger.warn(
          `"${row.key}" tanımının kodda karşılığı yok; zamanlayıcıya eklenmedi.`
        );
        continue;
      }
      if (!row.isEnabled) continue;
      if (!isValidCron(row.cronExpression)) {
        this.logger.error(
          `"${row.key}" işinin cron ifadesi geçersiz ("${row.cronExpression}"); ` +
            "iş zamanlanmadı. Panelden düzeltin."
        );
        continue;
      }
      await this.queue.upsertJobScheduler(
        row.key,
        { pattern: row.cronExpression, tz: SCHEDULER_TIMEZONE },
        {
          name: row.key,
          data: { key: row.key },
          /**
           * SAKLAMA POLİTİKASI (denetim bulgusu 14).
           * BullMQ tamamlanan/başarısız iş kayıtlarını Redis'te SINIRSIZ
           * biriktirir: günde beş iş × yıllar, sessizce büyüyen bir anahtar
           * kümesi demektir. Koşu geçmişinin gerçek kaynağı `JobRun` tablosudur;
           * Redis'te yalnız son birkaç kayıt tutulur.
           *
           * `attempts: 1` ÖZELLİKLE ÖNEMLİDİR: `JobRunnerService` eş zamanlı
           * ikinci koşuyu `ConflictException` ile reddeder ve o istisna yeniden
           * denemeye dönmemelidir. İşin kendi hatası da zaten fırlatılmaz,
           * `BASARISIZ` koşu olarak kapatılır.
           */
          opts: {
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 100 },
            attempts: 1,
          },
        }
      );
      wanted.add(row.key);
    }

    // Kapatılan / kaldırılan işlerin kuyruktaki zamanlayıcısı TEMİZLENİR;
    // aksi hâlde panelden kapatılan bir iş Redis'te yaşamaya devam ederdi.
    const existing = await this.queue.getJobSchedulers();
    for (const scheduler of existing) {
      if (!wanted.has(scheduler.key)) {
        await this.queue.removeJobScheduler(scheduler.key);
        this.logger.log(`Kuyruktan kaldırıldı: ${scheduler.key}`);
      }
    }

    this.activeSchedulers = wanted.size;
  }

  /** Tanım değiştiğinde (PATCH) kuyruğu tazeler. Redis kapalıysa sessizce geçer. */
  async resync(): Promise<void> {
    if (this.mode !== "calisiyor") return;
    await this.guard("kuyruk eşitlenemedi", () => this.syncSchedulers());
  }

  private async process(job: Job): Promise<JobRunSummary | { atlandi: true }> {
    const key = typeof job.data?.key === "string" ? job.data.key : job.name;
    const handler = this.registry.find(key);
    if (!handler) {
      this.logger.warn(`Kuyruktan bilinmeyen iş geldi ve atlandı: ${key}`);
      return { atlandi: true };
    }
    // Tanım arada kapatılmış olabilir (kuyruk temizliği bir sonraki eşitlemede
    // olur); kapalı işi ÇALIŞTIRMAMAK, kapatma emrini anında geçerli kılar.
    const definition = await this.prisma.client.scheduledJob.findUnique({ where: { key } });
    if (definition && !definition.isEnabled) {
      this.logger.log(`"${key}" kapalı olduğu için çalıştırılmadı.`);
      return { atlandi: true };
    }
    return this.runner.run(handler, { trigger: "cron", now: new Date() });
  }

  // ==========================================================================
  // Yardımcılar
  // ==========================================================================

  private degrade(reason: string): void {
    this.mode = "devre-disi";
    this.reason = reason;
    this.activeSchedulers = 0;
    this.logger.error(
      "╔═══════════════════════════════════════════════════════════════════╗\n" +
        "║ ZAMANLANMIŞ İŞLER DEVRE DIŞI                                      ║\n" +
        "╚═══════════════════════════════════════════════════════════════════╝\n" +
        `Neden: ${reason}\n` +
        "API normal çalışmaya devam ediyor; yalnız GECE İŞLERİ tetiklenmiyor:\n" +
        "  · süre ve duruşma hatırlatmaları üretilmez,\n" +
        "  · kullanım fotoğrafı alınmaz,\n" +
        "  · kredi dönemi ve abonelik denetimi çalışmaz.\n" +
        "Elle tetikleme ÇALIŞMAYA DEVAM EDER: POST /api/admin/v1/jobs/:key/run"
    );
  }

  /** Adımı sarmalar; hata uygulamayı düşürmez, açıkça loglanır. */
  private async guard(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.degrade(`${label}: ${(err as Error).message}`);
    }
  }

  /**
   * `guard`ın YUMUŞAK sürümü: hata loglanır ama zamanlayıcı KAPATILMAZ.
   * Zamanlayıcının kendisiyle ilgisi olmayan yardımcı adımlar (tanım eşitleme,
   * `nextRunAt` tazeleme) bunu kullanır — bir tanım yazımının patlaması gece
   * işlerini tetiklemeyi engellememelidir.
   */
  private async note(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `${label}: ${(err as Error).message}. Zamanlayıcı bu yüzden KAPATILMADI; ` +
          "tanım tablosu bir sonraki açılışta ya da panelden düzeltilebilir."
      );
    }
  }

  private async teardown(): Promise<void> {
    try {
      await this.worker?.close();
    } catch (err) {
      this.logger.debug(`Worker kapatılamadı: ${(err as Error).message}`);
    }
    try {
      await this.queue?.close();
    } catch (err) {
      this.logger.debug(`Kuyruk kapatılamadı: ${(err as Error).message}`);
    }
    this.worker = null;
    this.queue = null;
  }
}
