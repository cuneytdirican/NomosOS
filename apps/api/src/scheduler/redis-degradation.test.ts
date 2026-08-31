import { describe, expect, it, beforeEach, vi } from "vitest";
import { resolveRedisConfig } from "./redis-connection";
import { SchedulerService } from "./scheduler.service";

/**
 * REDIS YOKKEN DAVRANIŞ — "API AÇILMAYA DEVAM EDER" SÖZÜNÜN TESTİ.
 *
 * Bu davranış yorumla garanti edilemez. Buradaki testler, `onModuleInit`in
 * Redis erişilemezken FIRLATMADIĞINI kilitler: Nest'te bir `onModuleInit`
 * hatası uygulama açılışını komple durdurur, yani Redis kesintisi tüm büroyu
 * çalışamaz hâle getirirdi.
 */

/** Zamanlayıcının kullandığı Prisma yüzeyinin asgari sahtesi. */
function fakePrisma(rows: Array<{ key: string; cronExpression: string; isEnabled: boolean }> = []) {
  const store = [...rows];
  return {
    client: {
      scheduledJob: {
        findMany: vi.fn(async () => store.map((r) => ({ ...r }))),
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
          const found = store.find((r) => r.key === where.key);
          return found ? { ...found } : null;
        }),
        count: vi.fn(async ({ where }: { where: { key: string } }) =>
          store.filter((r) => r.key === where.key).length,
        ),
        /**
         * `create` DEĞİL `upsert` (denetim bulgusu 10): "önce bak sonra yaz"
         * iki ayrı işlemdir ve rolling deploy'da ikinci pod P2002 alır.
         * Sahte, gerçek `upsert` semantiğini taşır: varsa DOKUNMAZ, yoksa yazar.
         */
        upsert: vi.fn(
          async ({
            where,
            create,
          }: {
            where: { key: string };
            create: { key: string; cronExpression: string };
          }) => {
            const found = store.find((r) => r.key === where.key);
            if (found) return { ...found };
            store.push({ ...create, isEnabled: true });
            return { ...create, isEnabled: true };
          },
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };
}

function fakeRegistry(keys: string[] = []) {
  const handlers = keys.map((key) => ({
    key,
    name: key,
    defaultCron: "0 2 * * *",
    description: "",
    run: vi.fn(async () => ({ created: 0, skipped: 0, failed: 0 })),
  }));
  return {
    all: () => handlers,
    keys: () => new Set(keys),
    find: (k: string) => handlers.find((h) => h.key === k),
    require: (k: string) => handlers.find((h) => h.key === k)!,
  };
}

const fakeRunner = {
  runningKeys: () => [] as string[],
  runningDetails: () => [] as Array<{ key: string; startedAt: Date; ageMs: number; stalled: boolean }>,
};

type SchedulerCtor = ConstructorParameters<typeof SchedulerService>;

function build(options: {
  probeFails?: boolean;
  env?: NodeJS.ProcessEnv;
  jobs?: Array<{ key: string; cronExpression: string; isEnabled: boolean }>;
}) {
  const prisma = fakePrisma(options.jobs);
  const probe = {
    ping: vi.fn(async () => {
      if (options.probeFails) throw new Error("connect ECONNREFUSED 127.0.0.1:6379");
      return { latencyMs: 1 };
    }),
  };
  const service = new SchedulerService(
    prisma as unknown as SchedulerCtor[0],
    fakeRegistry(["usage-snapshot-daily"]) as unknown as SchedulerCtor[1],
    fakeRunner as unknown as SchedulerCtor[2],
    probe
  );
  return { service, prisma, probe };
}

describe("resolveRedisConfig", () => {
  it("REDIS_URL yoksa zamanlayıcıyı kapatır ve TÜRKÇE gerekçe verir", () => {
    const config = resolveRedisConfig({} as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.reason).toContain("REDIS_URL");
  });

  it("bozuk URL uygulamayı düşürmez, yalnız zamanlayıcıyı kapatır", () => {
    const config = resolveRedisConfig({ REDIS_URL: "bu-bir-url-degil" } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.reason).toContain("çözümlenemedi");
  });

  it("yanlış şema (http://) reddedilir", () => {
    const config = resolveRedisConfig({ REDIS_URL: "http://localhost:6379" } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.reason).toContain("redis://");
  });

  it("SCHEDULER_DISABLED=true ile açıkça kapatılabilir", () => {
    const config = resolveRedisConfig({
      REDIS_URL: "redis://localhost:6379",
      SCHEDULER_DISABLED: "true",
    } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.reason).toContain("SCHEDULER_DISABLED");
  });

  it("geçerli URL'i çözer ve BullMQ'nun zorunlu kıldığı seçenekleri kurar", () => {
    const config = resolveRedisConfig({
      REDIS_URL: "redis://localhost:6379",
    } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(true);
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(6379);
    // Worker bloklayan komutlar kullanır; bu değer `null` OLMAK ZORUNDA.
    expect(config.options.maxRetriesPerRequest).toBeNull();
    // Redis günlerce kapalı kalırsa komutlar bellekte birikmemeli.
    expect(config.options.enableOfflineQueue).toBe(false);
  });

  it("parola loglanabilir adreste GÖRÜNMEZ", () => {
    const config = resolveRedisConfig({
      REDIS_URL: "redis://kullanici:cokGizliParola@redis.example:6380/2",
    } as NodeJS.ProcessEnv);
    expect(config.display).not.toContain("cokGizliParola");
    expect(config.options.password).toBe("cokGizliParola");
  });
});

describe("SchedulerService — Redis yokken zarif düşüş", () => {
  const originalUrl = process.env.REDIS_URL;

  beforeEach(() => {
    process.env.REDIS_URL = originalUrl ?? "redis://localhost:6379";
  });

  it("REDIS_URL tanımsızken onModuleInit FIRLATMAZ", async () => {
    delete process.env.REDIS_URL;
    const { service } = build({});
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.status().mode).toBe("devre-disi");
    expect(service.status().reason).toContain("REDIS_URL");
    process.env.REDIS_URL = originalUrl ?? "redis://localhost:6379";
  });

  it("Redis erişilemezken onModuleInit FIRLATMAZ ve devre dışı kalır", async () => {
    const { service, probe } = build({ probeFails: true });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(probe.ping).toHaveBeenCalledTimes(1);
    expect(service.status().mode).toBe("devre-disi");
    expect(service.status().reason).toContain("ECONNREFUSED");
  });

  it("Redis yokken bile İŞ TANIMLARI veritabanına yazılır", async () => {
    // Kritik: tanımlar Redis'ten BAĞIMSIZDIR. Aksi hâlde Redis kapalıyken
    // panel boş bir iş listesi gösterir ve elle tetikleme de imkânsızlaşırdı.
    const { service, prisma } = build({ probeFails: true, jobs: [] });
    await service.onModuleInit();
    expect(prisma.client.scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "usage-snapshot-daily" },
        create: expect.objectContaining({ key: "usage-snapshot-daily" }),
        // Boş `update`: MEVCUT satıra dokunulmaz. Operatörün panelden
        // değiştirdiği cron/isEnabled her açılışta varsayılana dönseydi, bir
        // işi kapatmak yalnız bir sonraki dağıtıma kadar sürerdi.
        update: {},
      })
    );
  });

  /**
   * DENETİM BULGUSU 10 — TANIM EŞİTLEME YARIŞI ZAMANLAYICIYI KAPATAMAZ.
   *
   * Rolling deploy'da iki pod aynı saniyede açılır; eskiden ikincinin `create`i
   * P2002 alıyor, `guard` bunu `degrade()`e çeviriyor ve O ÖRNEKTE zamanlayıcı
   * hiç kurulmuyordu. Panel hangi pod'a düşerseniz "çalışıyor" ya da "devre
   * dışı" gösteriyordu — kararsız ve yanıltıcı bir durum raporu.
   */
  it("tanım yazımı patlasa bile zamanlayıcı KAPANMAZ (Redis sağlamken)", async () => {
    const { service, prisma } = build({ jobs: [] });
    prisma.client.scheduledJob.upsert = vi.fn(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    // Kuyruk kurulamadığı için bu ortamda "devre-disi" olabilir; kilitlenen
    // şey, gerekçenin TANIM EŞİTLEMESİ olmamasıdır.
    expect(service.status().reason ?? "").not.toContain("iş tanımları eşitlenemedi");
  });

  it("devre dışıyken resync sessizce geçer (kuyruk yok, hata da yok)", async () => {
    const { service } = build({ probeFails: true });
    await service.onModuleInit();
    await expect(service.resync()).resolves.toBeUndefined();
  });

  it("devre dışıyken onModuleDestroy hata vermez", async () => {
    const { service } = build({ probeFails: true });
    await service.onModuleInit();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it("veritabanı da erişilemezse açılış YİNE de tamamlanır", async () => {
    // Zincirin her halkası ayrı try/catch içindedir; tanım eşitlemesi patlasa
    // bile Nest açılışı devam eder ve durum panelde görünür.
    const { service, prisma } = build({ probeFails: true });
    prisma.client.scheduledJob.count = vi.fn(async () => {
      throw new Error("veritabanına ulaşılamıyor");
    });
    prisma.client.scheduledJob.findMany = vi.fn(async () => {
      throw new Error("veritabanına ulaşılamıyor");
    });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.status().mode).toBe("devre-disi");
  });

  it("durum raporu panelin ihtiyaç duyduğu alanları taşır", async () => {
    const { service } = build({ probeFails: true });
    await service.onModuleInit();
    const status = service.status();
    expect(status).toMatchObject({
      mode: "devre-disi",
      queue: expect.any(String),
      timezone: "Europe/Istanbul",
      activeSchedulers: 0,
      running: [],
    });
  });
});
