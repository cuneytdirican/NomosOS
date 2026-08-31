import { describe, expect, it, beforeEach } from "vitest";
import { NotificationOutboxService } from "./notification-outbox.service";
import { TenantRecipientsService } from "./tenant-recipients";
import { DeadlineReminderJob } from "./jobs/deadline-reminder.job";
import { resolveJobStatus } from "./scheduler.types";

/**
 * İDEMPOTENTLİK TESTLERİ — FAZ 6'NIN EN KRİTİK DAVRANIŞI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ Buradaki sahte Prisma, gerçek veritabanının TEK BİR ÖZELLİĞİNİ taklit    ║
 * ║ eder: `NotificationOutbox.@@unique([tenantId, dedupeKey])` kısıtı ve     ║
 * ║ ihlalde atılan P2002 hatası. Test edilen şey de tam olarak budur —      ║
 * ║ "kod ikinci kaydı yazmaya ÇALIŞIR mı" değil, "veritabanı reddettiğinde   ║
 * ║ kod bunu HATA saymadan ATLAR mı".                                        ║
 * ║                                                                          ║
 * ║ Gerçek DB'ye bağlanmayan bu kurgu bilinçlidir: `apps/api` test koşucusu  ║
 * ║ DB/DI gerektirmeyen mantığı kapsar (bkz. vitest.config.ts).              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface FakeDeadline {
  id: string;
  tenantId: string;
  title: string;
  dueDate: Date;
  status: string;
  ownerId: string | null;
  legalBasis: string | null;
  computeNote: string | null;
  case: {
    id: string;
    title: string;
    fileNumber: string | null;
    responsibleUserId: string | null;
  };
}

interface FakeUser {
  id: string;
  tenantId: string;
  role: string;
  isActive: boolean;
}

interface FakeOutboxRow {
  id: string;
  tenantId: string;
  userId: string | null;
  kind: string;
  title: string;
  body: string;
  dedupeKey: string;
  resourceType: string | null;
  resourceId: string | null;
}

/** Prisma'nın benzersizlik ihlali hatasının aynısı: `code === "P2002"`. */
class FakeUniqueViolation extends Error {
  readonly code = "P2002";
  constructor(key: string) {
    super(`Unique constraint failed on (tenantId, dedupeKey): ${key}`);
  }
}

class FakePrisma {
  readonly tenants: Array<{ id: string; name: string }> = [];
  readonly users: FakeUser[] = [];
  readonly deadlines: FakeDeadline[] = [];
  readonly outbox: FakeOutboxRow[] = [];
  /** Yazma denemesi sayacı — "ikinci koşu gerçekten YAZMAYA ÇALIŞTI mı". */
  createAttempts = 0;

  private seq = 0;

  readonly client = {
    tenant: {
      findMany: async () => this.tenants.map((t) => ({ ...t })),
    },
    user: {
      findMany: async (args: { where: { tenantId: string; isActive: boolean } }) =>
        this.users
          .filter((u) => u.tenantId === args.where.tenantId && u.isActive === args.where.isActive)
          .map((u) => ({ id: u.id, role: u.role })),
    },
    deadline: {
      findMany: async (args: {
        where: { tenantId: string; status: string; dueDate: { gte: Date; lt: Date } };
      }) =>
        this.deadlines
          .filter(
            (d) =>
              d.tenantId === args.where.tenantId &&
              d.status === args.where.status &&
              d.dueDate.getTime() >= args.where.dueDate.gte.getTime() &&
              d.dueDate.getTime() < args.where.dueDate.lt.getTime()
          )
          .map((d) => ({ ...d })),
    },
    notificationOutbox: {
      create: async (args: { data: Omit<FakeOutboxRow, "id"> }) => {
        this.createAttempts += 1;
        const { tenantId, dedupeKey } = args.data;
        // ═══ KISIT BURADA ═══ gerçek korumanın taklidi.
        if (this.outbox.some((r) => r.tenantId === tenantId && r.dedupeKey === dedupeKey)) {
          throw new FakeUniqueViolation(dedupeKey);
        }
        this.seq += 1;
        const row: FakeOutboxRow = { id: `outbox-${this.seq}`, ...args.data };
        this.outbox.push(row);
        return row;
      },
    },
  };
}

function utc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function buildJob(prisma: FakePrisma) {
  const asPrisma = prisma as unknown as ConstructorParameters<typeof NotificationOutboxService>[0];
  const outbox = new NotificationOutboxService(asPrisma);
  const recipients = new TenantRecipientsService(asPrisma);
  return new DeadlineReminderJob(asPrisma, outbox, recipients);
}

describe("deadline-reminder-daily — idempotentlik", () => {
  const TODAY = utc("2026-09-01");
  let prisma: FakePrisma;

  beforeEach(() => {
    prisma = new FakePrisma();
    prisma.tenants.push({ id: "tenant-a", name: "A Hukuk Bürosu" });
    prisma.users.push(
      { id: "avukat-1", tenantId: "tenant-a", role: "AVUKAT", isActive: true },
      { id: "ortak-1", tenantId: "tenant-a", role: "PARTNER", isActive: true }
    );
    prisma.deadlines.push({
      id: "deadline-1",
      tenantId: "tenant-a",
      title: "İstinaf süresi son günü",
      // Bugün 01.09 → 04.09 tam olarak "3 gün kala" penceresidir.
      dueDate: utc("2026-09-04"),
      status: "ONAYLANDI",
      ownerId: "avukat-1",
      legalBasis: "HMK m.345 — 2 hafta",
      computeNote: null,
      case: {
        id: "case-1",
        title: "Ali Veli / X A.Ş.",
        fileNumber: "2026/145",
        responsibleUserId: "avukat-1",
      },
    });
  });

  it("AYNI İŞİ İKİ KEZ ÇALIŞTIRMAK TEK BİLDİRİM ÜRETİR", async () => {
    const job = buildJob(prisma);

    const first = await job.run({ trigger: "cron", now: TODAY });
    expect(first.created).toBe(1);
    expect(first.skipped).toBe(0);
    expect(prisma.outbox).toHaveLength(1);

    const second = await job.run({ trigger: "cron", now: TODAY });
    // Kod yazmayı DENEDİ (yarış koşullarına açık "önce bak" yolu yok)…
    expect(prisma.createAttempts).toBe(2);
    // …ama veritabanı reddetti ve kod bunu HATA saymadan atladı.
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);
    // KRİTİK: kuyrukta hâlâ TEK kayıt var.
    expect(prisma.outbox).toHaveLength(1);
  });

  it("ikinci koşu ATLANDI durumuna düşer, BASARISIZ değil", async () => {
    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: TODAY });
    const second = await job.run({ trigger: "manuel", now: TODAY });
    expect(resolveJobStatus(second)).toBe("ATLANDI");
  });

  it("elle tetikleme cron koşusunun üstüne çift bildirim EKLEMEZ", async () => {
    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: TODAY });
    await job.run({ trigger: "manuel", now: TODAY, triggeredBy: "ops-1" });
    expect(prisma.outbox).toHaveLength(1);
  });

  it("7/3/1 pencerelerinin her biri AYRI bildirim üretir", async () => {
    prisma.deadlines[0].dueDate = utc("2026-09-08"); // 7 gün kala
    const job = buildJob(prisma);
    const atSeven = await job.run({ trigger: "cron", now: TODAY });
    expect(atSeven.created).toBe(1);

    // Dört gün sonra aynı süre "3 gün kala" penceresine girer.
    const atThree = await job.run({ trigger: "cron", now: utc("2026-09-05") });
    expect(atThree.created).toBe(1);
    expect(prisma.outbox).toHaveLength(2);

    // Bir gün kala üçüncü ve son hatırlatma.
    const atOne = await job.run({ trigger: "cron", now: utc("2026-09-07") });
    expect(atOne.created).toBe(1);
    expect(prisma.outbox).toHaveLength(3);
    expect(prisma.outbox.every((r) => r.kind === "SURE_YAKLASIYOR")).toBe(true);
  });

  it("geçmiş süre için bildirim TEK KEZ üretilir, her gün tekrarlamaz", async () => {
    prisma.deadlines[0].dueDate = utc("2026-08-28"); // 4 gün önce doldu
    const job = buildJob(prisma);

    const day1 = await job.run({ trigger: "cron", now: TODAY });
    expect(day1.created).toBe(1);
    expect(prisma.outbox[0].kind).toBe("SURE_GECTI");

    const day2 = await job.run({ trigger: "cron", now: utc("2026-09-02") });
    const day3 = await job.run({ trigger: "cron", now: utc("2026-09-03") });
    expect(day2.created + day3.created).toBe(0);
    expect(prisma.outbox).toHaveLength(1);
  });

  it("AI ÖNERİSİ (BEKLIYOR) süreler için hatırlatma ÜRETİLMEZ", async () => {
    // Ürün ilkesi: AI çıktısı ÖNERİDİR. Onaylanmamış bir tarih için
    // "3 gün kaldı" demek, öneriyi sessizce kesinleşmiş sayardı.
    prisma.deadlines[0].status = "BEKLIYOR";
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "cron", now: TODAY });
    expect(result.created).toBe(0);
    expect(prisma.outbox).toHaveLength(0);
  });

  it("TAMAMLANDI / IPTAL süreler kapsam dışıdır", async () => {
    prisma.deadlines[0].status = "TAMAMLANDI";
    const job = buildJob(prisma);
    expect((await job.run({ trigger: "cron", now: TODAY })).created).toBe(0);
  });

  it("sahipsiz süre büro yöneticilerine düşer ve alıcı başına AYRI kayıt yazılır", async () => {
    prisma.users.push({
      id: "yonetici-1",
      tenantId: "tenant-a",
      role: "ADMIN",
      isActive: true,
    });
    prisma.deadlines[0].ownerId = null;
    prisma.deadlines[0].case.responsibleUserId = null;

    const job = buildJob(prisma);
    const result = await job.run({ trigger: "cron", now: TODAY });

    // ADMIN + PARTNER = 2 alıcı. Alıcı dedupeKey'in parçası olmasaydı
    // ikinci kayıt P2002 alıp sessizce düşer, yönetici haberdar olmazdı.
    expect(result.created).toBe(2);
    expect(new Set(prisma.outbox.map((r) => r.userId))).toEqual(
      new Set(["ortak-1", "yonetici-1"])
    );
  });

  it("PASİF kullanıcı alıcı olamaz; kayıt yöneticilere düşer", async () => {
    prisma.users[0].isActive = false; // avukat-1 pasifleşti
    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: TODAY });
    expect(prisma.outbox.map((r) => r.userId)).toEqual(["ortak-1"]);
  });
});

describe("tenant izolasyonu", () => {
  it("bir büronun süresi BAŞKA büronun kullanıcısına bildirilmez", async () => {
    const prisma = new FakePrisma();
    prisma.tenants.push({ id: "tenant-a", name: "A" }, { id: "tenant-b", name: "B" });
    prisma.users.push(
      { id: "a-avukat", tenantId: "tenant-a", role: "AVUKAT", isActive: true },
      { id: "b-avukat", tenantId: "tenant-b", role: "AVUKAT", isActive: true },
      { id: "b-ortak", tenantId: "tenant-b", role: "PARTNER", isActive: true }
    );
    // BOZUK VERİ SENARYOSU: B kiracısının süresi, A kiracısının kullanıcısını
    // sahip gösteriyor (veri göçü hatası, elle düzeltme, eski kayıt).
    prisma.deadlines.push({
      id: "deadline-b",
      tenantId: "tenant-b",
      title: "Cevap süresi",
      dueDate: utc("2026-09-04"),
      status: "ONAYLANDI",
      ownerId: "a-avukat",
      legalBasis: null,
      computeNote: null,
      case: { id: "c", title: "Dosya", fileNumber: null, responsibleUserId: "a-avukat" },
    });

    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: utc("2026-09-01") });

    // Alıcı, B kiracısının AKTİF kullanıcı kümesine karşı doğrulanır;
    // "a-avukat" kümede olmadığı için kayıt B'nin yöneticisine düşer.
    expect(prisma.outbox).toHaveLength(1);
    expect(prisma.outbox[0].tenantId).toBe("tenant-b");
    expect(prisma.outbox[0].userId).toBe("b-ortak");
    expect(prisma.outbox.some((r) => r.userId === "a-avukat")).toBe(false);
  });
});

describe("NotificationOutboxService", () => {
  it("P2002'yi yutar ve `atlandi` döner; başka hatayı FIRLATIR", async () => {
    const prisma = new FakePrisma();
    const service = new NotificationOutboxService(
      prisma as unknown as ConstructorParameters<typeof NotificationOutboxService>[0]
    );
    const entry = {
      tenantId: "t1",
      userId: "u1",
      kind: "SURE_YAKLASIYOR" as const,
      title: "x",
      body: "y",
      dedupeKey: "SURE_YAKLASIYOR:d1:3g:u1",
    };
    expect(await service.enqueue(entry)).toBe("yazildi");
    expect(await service.enqueue(entry)).toBe("atlandi");

    // Benzersizlik DIŞINDAKİ hatalar yutulmaz: bağlantı kopması "atlandı" gibi
    // görünseydi, hiç yazılmamış bildirimler başarılı sayılırdı.
    prisma.client.notificationOutbox.create = async () => {
      throw new Error("bağlantı koptu");
    };
    await expect(service.enqueue({ ...entry, dedupeKey: "baska" })).rejects.toThrow(
      "bağlantı koptu"
    );
  });

  it("enqueueMany tek satırın hatasında diğerlerini yazmaya DEVAM eder", async () => {
    const prisma = new FakePrisma();
    const service = new NotificationOutboxService(
      prisma as unknown as ConstructorParameters<typeof NotificationOutboxService>[0]
    );
    const original = prisma.client.notificationOutbox.create;
    let call = 0;
    prisma.client.notificationOutbox.create = async (args) => {
      call += 1;
      if (call === 2) throw new Error("geçici arıza");
      return original.call(prisma.client.notificationOutbox, args);
    };

    const base = { tenantId: "t1", userId: "u1", kind: "DURUSMA_YARIN" as const, title: "t", body: "b" };
    const result = await service.enqueueMany([
      { ...base, dedupeKey: "k1" },
      { ...base, dedupeKey: "k2" },
      { ...base, dedupeKey: "k3" },
    ]);

    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("k2");
  });
});

describe("resolveJobStatus", () => {
  it("üretim varsa BASARILI", () => {
    expect(resolveJobStatus({ created: 3, skipped: 0, failed: 0 })).toBe("BASARILI");
  });

  it("üretim yok ama atlanan varsa ATLANDI — ikinci koşunun normal sonucu", () => {
    expect(resolveJobStatus({ created: 0, skipped: 5, failed: 0 })).toBe("ATLANDI");
  });

  it("yapacak hiçbir şey yoksa BASARILI (atlanacak bir şey de yok)", () => {
    expect(resolveJobStatus({ created: 0, skipped: 0, failed: 0 })).toBe("BASARILI");
  });

  it("tek hata bile BASARISIZ yapar — kısmi başarı gizlenmez", () => {
    expect(resolveJobStatus({ created: 10, skipped: 2, failed: 1 })).toBe("BASARISIZ");
  });
});

describe("TenantRecipientsService.resolve", () => {
  const audience = {
    tenantId: "t1",
    activeUserIds: new Set(["u1", "u2"]),
    fallbackUserIds: ["u2"],
  };

  it("tercih edilen kimlik kiracının aktif kullanıcısıysa yalnız o kişi", () => {
    expect(TenantRecipientsService.resolve(audience, "u1")).toEqual(["u1"]);
  });

  it("boş kimlikte yöneticilere düşer", () => {
    expect(TenantRecipientsService.resolve(audience, null)).toEqual(["u2"]);
  });

  it("BAŞKA kiracıya ait kimlik ASLA alıcı olmaz", () => {
    expect(TenantRecipientsService.resolve(audience, "yabanci-kullanici")).toEqual(["u2"]);
  });

  it("yönetici de yoksa boş döner (iş bunu `alicisiz` raporlar)", () => {
    expect(
      TenantRecipientsService.resolve(
        { tenantId: "t1", activeUserIds: new Set(), fallbackUserIds: [] },
        null
      )
    ).toEqual([]);
  });
});
