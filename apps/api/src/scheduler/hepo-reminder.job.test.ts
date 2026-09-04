import { describe, expect, it, beforeEach } from "vitest";
import { NotificationOutboxService } from "./notification-outbox.service";
import { TenantRecipientsService } from "./tenant-recipients";
import { HepoReminderJob } from "./jobs/hepo-reminder.job";
import { resolveJobStatus } from "./scheduler.types";

/**
 * HEPO HATIRLATMA İŞİ TESTLERİ (Modül 28 Faz 3).
 *
 * Sahte Prisma, idempotency.test.ts ile AYNI kurguyu izler: tek taklit edilen
 * veritabanı davranışı `NotificationOutbox.@@unique([tenantId, dedupeKey])`
 * kısıtı ve ihlalde atılan P2002'dir. Test edilen taahhütler:
 *
 *  1. UYGUN olmayan kayıt, vadesi pencere gününde UYARILIR; UYGUN kayıt değil.
 *  2. Anahtar satır + pencere + alıcı + vade günü taşır — aynı işin ikinci
 *     koşusu YAZMAYA ÇALIŞIR ama veritabanı kısıtı reddeder ve iş bunu HATA
 *     SAYMAYIP ATLANIR (ATLANDI durumu).
 *  3. Vade düzeltilirse YENİ anahtar — yeni tarih için hatırlatma gider.
 *  4. Atamayı yapan pasifse büro yönetimine düşer; yönetici de yoksa
 *     `alicisiz` olarak raporlanır ve bildirim yazılmaz.
 *  5. Vadesi geçen kayıt için TEK SEFERLİK SURE_GECTI bildirimi gider.
 */

interface FakeHepoRow {
  id: string;
  tenantId: string;
  status: string;
  dueDate: Date;
  createdBy: string;
  obligation: { title: string; legalBasis: string };
  client: { name: string };
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

class FakeUniqueViolation extends Error {
  readonly code = "P2002";
  constructor(key: string) {
    super(`Unique constraint failed on (tenantId, dedupeKey): ${key}`);
  }
}

class FakePrisma {
  readonly tenants: Array<{ id: string; name: string }> = [];
  readonly users: FakeUser[] = [];
  readonly hepoRows: FakeHepoRow[] = [];
  readonly outbox: FakeOutboxRow[] = [];
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
    hepoClientObligation: {
      findMany: async (args: {
        where: {
          tenantId: string;
          status: { not: string };
          dueDate: { gte: Date; lt: Date };
        };
      }) =>
        this.hepoRows.filter(
          (r) =>
            r.tenantId === args.where.tenantId &&
            r.status !== args.where.status.not &&
            r.dueDate.getTime() >= args.where.dueDate.gte.getTime() &&
            r.dueDate.getTime() < args.where.dueDate.lt.getTime()
        ),
    },
    notificationOutbox: {
      create: async (args: { data: Omit<FakeOutboxRow, "id"> }) => {
        this.createAttempts += 1;
        const { tenantId, dedupeKey } = args.data;
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
  return new HepoReminderJob(asPrisma, outbox, recipients);
}

function baseRow(over?: Partial<FakeHepoRow>): FakeHepoRow {
  return {
    id: "hepo-row-1",
    tenantId: "tenant-a",
    status: "ACIK",
    dueDate: utc("2026-10-01"),
    createdBy: "user-avukat",
    obligation: { title: "Risk değerlendirmesi", legalBasis: "6331 s.k. m.10" },
    client: { name: "Örnek Sanayi A.Ş." },
    ...over,
  };
}

describe("hepo-reminder-daily", () => {
  const TODAY = utc("2026-09-01");
  let prisma: FakePrisma;

  beforeEach(() => {
    prisma = new FakePrisma();
    prisma.tenants.push({ id: "tenant-a", name: "A Hukuk Bürosu" });
    prisma.users.push(
      { id: "user-avukat", tenantId: "tenant-a", role: "AVUKAT", isActive: true },
      { id: "user-partner", tenantId: "tenant-a", role: "PARTNER", isActive: true },
    );
  });

  it("vadesi 30 gün sonra olan açık yükümlülük uyarılır (UYGUN değil)", async () => {
    prisma.hepoRows.push(baseRow());
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "manuel", now: TODAY });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    const row = prisma.outbox[0];
    expect(row.kind).toBe("SURE_YAKLASIYOR");
    expect(row.title).toContain("30 gün kaldı");
    expect(row.resourceType).toBe("HepoClientObligation");
    expect(row.body).toContain("Örnek Sanayi A.Ş.");
    expect(row.body).toContain("6331 s.k. m.10");
    expect(resolveJobStatus(result)).toBe("BASARILI");
  });

  it("UYGUN durumundaki kayıt HATIRLATILMAZ", async () => {
    prisma.hepoRows.push(baseRow({ status: "UYGUN" }));
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "manuel", now: TODAY });
    expect(result.created).toBe(0);
    expect(prisma.outbox).toHaveLength(0);
  });

  it("idempotent: ikinci koşu yazmaya çalışır, kısıt reddeder, ATLANDI sayılır", async () => {
    prisma.hepoRows.push(baseRow());
    const job = buildJob(prisma);
    const first = await job.run({ trigger: "manuel", now: TODAY });
    expect(first.created).toBe(1);
    const attemptsAfterFirst = prisma.createAttempts;
    const second = await job.run({ trigger: "manuel", now: TODAY });
    // Gerçekten YAZMAYA ÇALIŞTI (atlanma "sessiz find" değil, kısıt reddi).
    expect(prisma.createAttempts).toBe(attemptsAfterFirst + 1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);
    expect(resolveJobStatus(second)).toBe("ATLANDI");
  });

  it("vade düzeltilirse yeni anahtar — yeni tarih için yeniden hatırlatılır", async () => {
    prisma.hepoRows.push(baseRow()); // vade 2026-10-01
    const job = buildJob(prisma);
    await job.run({ trigger: "manuel", now: TODAY }); // 30g hatırlatması yazıldı
    // Vade 2026-10-08'e çekildi; 2026-10-01'de bakıldığında 7 gün kala
    // penceresindedir ve ANAHTAR VADE GÜNÜNÜ TAŞIDIĞI için yeniden yazılır.
    prisma.hepoRows[0].dueDate = utc("2026-10-08");
    const after = await job.run({ trigger: "manuel", now: utc("2026-10-01") });
    expect(after.created).toBe(1);
    expect(prisma.outbox).toHaveLength(2);
    expect(prisma.outbox[1].title).toContain("7 gün kaldı");
  });

  it("atamayı yapan pasifse büro yönetimine düşer", async () => {
    prisma.users[0].isActive = false; // avukat pasif
    prisma.hepoRows.push(baseRow());
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "manuel", now: TODAY });
    expect(result.created).toBe(1);
    expect(prisma.outbox[0].userId).toBe("user-partner");
    expect(result.detail?.yonetimeDusenYukumluluk).toBe(1);
  });

  it("yönetici de yoksa alıcısız raporlanır, bildirim yazılmaz", async () => {
    // Avukat aktif ama atamayı yapan AYRILMIŞ bir kullanıcı: hedef çözülemez,
    // büroda da ADMIN/PARTNER yok → bildirim yazılmaz, alicisiz raporlanır.
    prisma.users.length = 0;
    prisma.users.push({ id: "user-avukat", tenantId: "tenant-a", role: "AVUKAT", isActive: true });
    prisma.hepoRows.push(baseRow({ createdBy: "ayrilmis-kullanici" }));
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "manuel", now: TODAY });
    expect(result.created).toBe(0);
    expect(prisma.outbox).toHaveLength(0);
    expect(result.detail?.alicisizYukumluluk).toBe(1);
  });

  it("vadesi geçen kayıt için tek seferlik SURE_GECTI bildirimi", async () => {
    prisma.hepoRows.push(baseRow({ dueDate: utc("2026-08-20") }));
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "manuel", now: TODAY });
    expect(result.created).toBe(1);
    const row = prisma.outbox[0];
    expect(row.kind).toBe("SURE_GECTI");
    expect(row.title).toContain("VADE GEÇTİ");
    // İkinci koşu: tek seferlik — ATLANDI.
    const second = await job.run({ trigger: "cron", now: TODAY });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
