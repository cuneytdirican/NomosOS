import { beforeEach, describe, expect, it } from "vitest";
import { NotificationOutboxService } from "./notification-outbox.service";
import { TenantRecipientsService } from "./tenant-recipients";
import { CreditLowWarningJob } from "./jobs/credit-low-warning.job";
import { creditLowKey } from "./dedupe-key";
import { evaluateCreditWarning } from "./credit-threshold";
import { resolveJobStatus } from "./scheduler.types";

/**
 * REGRESYON — denetim bulgusu Ö-29 (%80 kredi uyarısı hiç üretilmiyordu).
 *
 * İki ayrı şey kanıtlanır:
 *   1. EŞİK KARARI doğru (saf fonksiyon) — özellikle "satın alınan bakiye
 *      kalanı büyütür" kuralı; naif `consumed/included` ölçüsü dolu keseli
 *      büroyu yanlışlıkla uyarırdı.
 *   2. YAZIM İDEMPOTENT — iş saatte bir koşar; dönem başına TEK bildirim
 *      gider, dönem yenilenince yeniden uyarılır.
 *
 * Sahte Prisma, gerçek veritabanının tek bir özelliğini taklit eder:
 * `@@unique([tenantId, dedupeKey])` ve ihlalde P2002 (bkz. idempotency.test.ts).
 */

interface FakeWallet {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  includedCredits: number;
  includedConsumed: number;
  purchasedCredits: number;
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
  readonly wallets: FakeWallet[] = [];
  readonly users: FakeUser[] = [];
  readonly outbox: FakeOutboxRow[] = [];
  createAttempts = 0;
  private seq = 0;

  readonly client = {
    creditWallet: {
      findMany: async () => this.wallets.map((w) => ({ ...w })),
    },
    user: {
      findMany: async (args: { where: { tenantId: string; isActive: boolean } }) =>
        this.users
          .filter((u) => u.tenantId === args.where.tenantId && u.isActive === args.where.isActive)
          .map((u) => ({ id: u.id, role: u.role })),
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
  return new CreditLowWarningJob(
    asPrisma,
    new NotificationOutboxService(asPrisma),
    new TenantRecipientsService(asPrisma),
  );
}

const NOW = utc("2026-09-10");

describe("evaluateCreditWarning — eşik kararı (Ö-29)", () => {
  it("%80 tüketimde uyarı üretilir", () => {
    const d = evaluateCreditWarning({
      includedCredits: 500,
      includedConsumed: 400,
      purchasedCredits: 0,
    });
    expect(d.warn).toBe(true);
    expect(d.kalan).toBe(100);
    expect(d.tuketimOrani).toBeCloseTo(0.8);
  });

  it("%79'da uyarı YOKTUR (eşik altında erken alarm yok)", () => {
    const d = evaluateCreditWarning({
      includedCredits: 500,
      includedConsumed: 395,
      purchasedCredits: 0,
    });
    expect(d.warn).toBe(false);
  });

  it("SATIN ALINAN BAKİYE UYARIYI DÜŞÜRÜR — dolu keseli büro uyarılmaz", () => {
    // Dahil kota tamamen bitmiş (naif ölçüyle %100) ama 5.000 kredi satın alınmış.
    const d = evaluateCreditWarning({
      includedCredits: 500,
      includedConsumed: 500,
      purchasedCredits: 5000,
    });
    expect(d.warn).toBe(false);
    expect(d.kalan).toBe(5000);
  });

  it("dahil kotası olmayan (BYO-LLM) cüzdan hiç uyarılmaz", () => {
    const d = evaluateCreditWarning({
      includedCredits: 0,
      includedConsumed: 0,
      purchasedCredits: 0,
    });
    expect(d.warn).toBe(false);
    expect(d.gerekce).toContain("BYO-LLM");
  });

  it("bakiye tamamen bittiğinde de uyarı üretilir (402'den önceki son şans)", () => {
    const d = evaluateCreditWarning({
      includedCredits: 500,
      includedConsumed: 500,
      purchasedCredits: 0,
    });
    expect(d.warn).toBe(true);
    expect(d.kalan).toBe(0);
  });
});

describe("credit-low-warning-hourly — idempotentlik (Ö-29)", () => {
  let prisma: FakePrisma;

  beforeEach(() => {
    prisma = new FakePrisma();
    prisma.users.push(
      { id: "ortak-1", tenantId: "buro-a", role: "PARTNER", isActive: true },
      { id: "yonetici-1", tenantId: "buro-a", role: "ADMIN", isActive: true },
      { id: "avukat-1", tenantId: "buro-a", role: "AVUKAT", isActive: true },
      { id: "stajyer-1", tenantId: "buro-a", role: "STAJYER", isActive: true },
    );
    prisma.wallets.push({
      tenantId: "buro-a",
      periodStart: utc("2026-09-01"),
      periodEnd: utc("2026-10-01"),
      includedCredits: 500,
      includedConsumed: 410,
      purchasedCredits: 0,
    });
  });

  it("eşiği geçen büroda YÖNETİME bildirim üretir (avukat/stajyer görmez)", async () => {
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "cron", now: NOW });

    expect(result.created).toBe(2);
    expect(prisma.outbox.map((r) => r.userId).sort()).toEqual(["ortak-1", "yonetici-1"]);
    expect(prisma.outbox[0].kind).toBe("KREDI_AZALDI");
    expect(prisma.outbox[0].title).toContain("%82");
  });

  it("SAATTE BİR KOŞSA DA DÖNEM BAŞINA TEK BİLDİRİM GİDER", async () => {
    const job = buildJob(prisma);
    const first = await job.run({ trigger: "cron", now: NOW });
    expect(first.created).toBe(2);

    // Aynı dönem içinde on iki koşu daha (yarım gün).
    for (let i = 0; i < 12; i += 1) {
      const again = await job.run({ trigger: "cron", now: NOW });
      expect(again.created).toBe(0);
      expect(again.skipped).toBe(2);
      expect(again.failed).toBe(0);
      expect(resolveJobStatus(again)).toBe("ATLANDI");
    }

    // Kod her koşuda yazmayı DENEDİ (yarışa açık "önce bak" yolu yok)…
    expect(prisma.createAttempts).toBe(26);
    // …ama kuyrukta hâlâ iki kayıt var.
    expect(prisma.outbox).toHaveLength(2);
  });

  it("elle tetikleme cron koşusunun üstüne çift bildirim EKLEMEZ", async () => {
    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: NOW });
    await job.run({ trigger: "manuel", now: NOW, triggeredBy: "ops-1" });
    expect(prisma.outbox).toHaveLength(2);
  });

  it("DÖNEM YENİLENİNCE YENİDEN UYARILIR (uyarı sonsuza dek susturulmaz)", async () => {
    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: NOW });
    expect(prisma.outbox).toHaveLength(2);

    // Dönem yenilendi: kota sıfırlandı, ay içinde yine %80'i geçildi.
    prisma.wallets[0].periodStart = utc("2026-10-01");
    prisma.wallets[0].periodEnd = utc("2026-11-01");
    prisma.wallets[0].includedConsumed = 450;

    const next = await job.run({ trigger: "cron", now: utc("2026-10-20") });
    expect(next.created).toBe(2);
    expect(prisma.outbox).toHaveLength(4);
  });

  it("eşiğin altındaki büro hiç bildirim almaz", async () => {
    prisma.wallets[0].includedConsumed = 100;
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "cron", now: NOW });
    expect(result.created).toBe(0);
    expect(prisma.createAttempts).toBe(0);
    expect(result.detail?.esikAltinda).toBe(0);
  });

  it("BÜROLAR BİRBİRİNİ ETKİLEMEZ (tenant izolasyonu)", async () => {
    prisma.users.push({ id: "ortak-b", tenantId: "buro-b", role: "PARTNER", isActive: true });
    prisma.wallets.push({
      tenantId: "buro-b",
      periodStart: utc("2026-09-01"),
      periodEnd: utc("2026-10-01"),
      includedCredits: 500,
      includedConsumed: 10,
      purchasedCredits: 0,
    });

    const job = buildJob(prisma);
    await job.run({ trigger: "cron", now: NOW });
    expect(prisma.outbox.every((r) => r.tenantId === "buro-a")).toBe(true);
  });

  it("aktif ADMIN/PARTNER yoksa iş patlamaz, alicisiz raporlar", async () => {
    prisma.users.splice(0, prisma.users.length);
    prisma.users.push({ id: "avukat-1", tenantId: "buro-a", role: "AVUKAT", isActive: true });
    const job = buildJob(prisma);
    const result = await job.run({ trigger: "cron", now: NOW });
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.detail?.alicisiz).toBe(1);
  });

  it("dedupe anahtarı dönem ve alıcı taşır", () => {
    expect(creditLowKey("buro-a", utc("2026-09-01"), "ortak-1")).toBe(
      "KREDI_AZALDI:buro-a:2026-09-01:ortak-1",
    );
  });
});
