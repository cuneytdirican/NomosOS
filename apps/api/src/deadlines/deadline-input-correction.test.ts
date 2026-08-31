/**
 * denetim bulgusu K-14 — kural motorundan üretilen sürenin GİRDİSİ
 * düzeltilebilmelidir.
 *
 * Denetimde tespit edilen hâl: `updateDeadlineSchema` yalnız
 * title/dueDate/ownerId/legalBasis alıyordu; `triggerDate`/`serviceMethod`
 * YOKTU. Servis kural kaynaklı sürede `dueDate` değişikliğini reddedip
 * "tetikleyici tarihi düzeltip yeniden hesaplayın" diyordu — ama o işlemi
 * yapacak uç üründe yoktu. Avukatın elinde yalnız kaydı SİLMEK kalıyordu.
 *
 * Bu dosya `PATCH /deadlines/:id/inputs` davranışını kilitler:
 *  1. girdi düzeltilince motor YENİDEN KOŞAR ve son günü kendisi yazar,
 *  2. ilk tespit (`originalTriggerDate`/`originalServiceMethod`/
 *     `originalDueDate`) DONDURULUR ve ikinci düzeltmede EZİLMEZ,
 *  3. hesap izi (`computeNote`) hem yeni hesabı hem düzeltme farkını taşır,
 *  4. SEKRETER ve STAJYER düzeltemez; AuditLog yazılır.
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeadlinesService } from "./deadlines.service";
import { correctDeadlineInputsSchema } from "./deadlines.dto";
import type { AuthUser } from "../common/types";

const TENANT = "tenant-1";
const CASE_ID = "case-1";
const DEADLINE_ID = "deadline-1";

const user = (role: AuthUser["role"], userId = "u-avukat"): AuthUser =>
  ({ userId, tenantId: TENANT, role, email: `${userId}@demo.local` }) as AuthUser;

/** HMK m.345 — istinaf: 2 hafta, adli tatilde uzar. */
const ISTINAF_RULE = {
  id: "rule-1",
  tenantId: null,
  key: "HMK_ISTINAF",
  name: "İstinaf başvuru süresi",
  description: null,
  durationValue: 2,
  durationUnit: "HAFTA",
  legalBasis: "HMK m.345 — 2 hafta",
  caseTypes: ["DAVA"],
  judicialRecessApplies: true,
  recessRule: "HMK_104",
  procedureCode: "HMK",
  isActive: true,
  isSystem: true,
};

/** 2026 takviminin testte kullanılan parçası (arife satırları bayraklı). */
const HOLIDAYS_2026 = [
  { date: new Date(Date.UTC(2026, 9, 28)), type: "RESMI_TATIL", name: "Cumhuriyet Bayramı Arifesi", isHalfDay: true, isApproximate: false },
  { date: new Date(Date.UTC(2026, 9, 29)), type: "RESMI_TATIL", name: "Cumhuriyet Bayramı", isHalfDay: false, isApproximate: false },
];

interface DeadlineRow {
  id: string;
  title: string;
  status: string;
  caseId: string;
  dueDate: Date;
  source: string;
  ruleKey: string | null;
  triggerDate: Date | null;
  serviceMethod: string | null;
  originalTriggerDate: Date | null;
  originalServiceMethod: string | null;
  originalDueDate: Date | null;
  correctionCount: number;
}

function baseRow(over: Partial<DeadlineRow> = {}): DeadlineRow {
  return {
    id: DEADLINE_ID,
    title: "İstinaf başvuru süresi",
    status: "ONAYLANDI",
    caseId: CASE_ID,
    // 18.08.2026 tebliğ + 2 hafta → 01.09.2026 (denetim raporundaki senaryo).
    dueDate: new Date(Date.UTC(2026, 8, 1)),
    source: "KURAL",
    ruleKey: "HMK_ISTINAF",
    triggerDate: new Date(Date.UTC(2026, 7, 18)),
    serviceMethod: "POSTA",
    originalTriggerDate: null,
    originalServiceMethod: null,
    originalDueDate: null,
    correctionCount: 0,
    ...over,
  };
}

function harness(row: DeadlineRow) {
  const updates: any[] = [];
  const timeline: any[] = [];
  const audits: any[] = [];
  let current = { ...row };

  const tx = {
    deadline: {
      update: vi.fn(async ({ data }: any) => {
        updates.push(data);
        const next: any = { ...current };
        for (const [k, v] of Object.entries(data)) {
          next[k] = v && typeof v === "object" && "increment" in (v as any) ? (next[k] ?? 0) + (v as any).increment : v;
        }
        current = next;
        return next;
      }),
    },
    timelineEvent: { create: vi.fn(async ({ data }: any) => timeline.push(data)) },
  };

  const prisma = {
    client: {
      deadline: { findFirst: vi.fn(async () => ({ ...current })) },
      holiday: { findMany: vi.fn(async () => HOLIDAYS_2026) },
      case: { update: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    },
  };
  const audit = { log: vi.fn(async (entry: any) => audits.push(entry)) };
  const rules = { resolveByKey: vi.fn(async () => ISTINAF_RULE) };

  const service = new DeadlinesService(prisma as any, audit as any, rules as any);
  return { service, prisma, audit, rules, updates, timeline, audits, get row() { return current; } };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("K-14 · süre girdisi düzeltme (PATCH /deadlines/:id/inputs)", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(baseRow());
  });

  it("gerekçe zorunludur ve en az bir girdi gönderilmelidir", () => {
    // Gerekçesiz düzeltme, denetim izinde "sebepsiz tarih oynaması" olurdu.
    expect(correctDeadlineInputsSchema.safeParse({ triggerDate: "2026-08-20" }).success).toBe(false);
    // Yalnız gerekçe göndermek de düzeltme değildir.
    expect(
      correctDeadlineInputsSchema.safeParse({ reason: "Tebligat parçası incelendi." }).success
    ).toBe(false);
    expect(
      correctDeadlineInputsSchema.safeParse({
        triggerDate: "2026-08-20",
        reason: "Tebligat parçasından gerçek tebliğ tarihi 20.08.2026 olarak okundu.",
      }).success
    ).toBe(true);
  });

  it("tetikleyici tarih düzeltilince MOTOR yeniden koşar ve son günü kendisi yazar", async () => {
    const before = h.row.dueDate;
    const out = await h.service.correctInputs(user("AVUKAT"), DEADLINE_ID, {
      triggerDate: new Date(Date.UTC(2026, 7, 20)),
      reason: "Tebligat parçasından gerçek tebliğ tarihi 20.08.2026 olarak okundu.",
    } as any);

    // Son gün İSTEMCİDEN gelmedi; motorun ürettiği değer yazıldı.
    expect(iso(out.deadline.dueDate as Date)).toBe(iso(new Date(Date.UTC(2026, 8, 3))));
    expect(out.dueDateChanged).toBe(true);
    expect(iso(out.previousDueDate as Date)).toBe(iso(before));
    expect(out.steps.length).toBeGreaterThan(0);
    // Hesap izi tazelendi ve motorun dayanağını taşıyor.
    expect(h.updates[0].computeNote).toContain("HMK m.345");
  });

  it("ilk tespit ile düzeltme arasındaki FARK kayıtta saklanır (Modül 04 KK8)", async () => {
    await h.service.correctInputs(user("AVUKAT"), DEADLINE_ID, {
      triggerDate: new Date(Date.UTC(2026, 7, 20)),
      serviceMethod: "ELDEN",
      reason: "Tebligat parçasından gerçek tebliğ tarihi 20.08.2026 olarak okundu.",
    } as any);

    const data = h.updates[0];
    expect(iso(data.originalTriggerDate)).toBe("2026-08-18");
    expect(data.originalServiceMethod).toBe("POSTA");
    expect(iso(data.originalDueDate)).toBe("2026-09-01");
    expect(data.correctedById).toBe("u-avukat");
    expect(data.correctedAt).toBeInstanceOf(Date);
    expect(data.correctionCount).toEqual({ increment: 1 });

    // İz metni "ne sanıyorduk / ne çıktı" farkını okunur biçimde taşır.
    expect(data.computeNote).toContain("GİRDİ DÜZELTMESİ");
    expect(data.computeNote).toContain("18.08.2026");
    expect(data.computeNote).toContain("20.08.2026");
    expect(data.computeNote).toContain("01.09.2026");
    expect(data.computeNote).toContain("Tebligat parçasından");

    // Safahata düşer ve denetim kaydı yazılır.
    expect(h.timeline).toHaveLength(1);
    expect(h.timeline[0].title).toContain("Süre girdisi düzeltildi");
    expect(h.audits[0].action).toBe("DEADLINE_INPUTS_CORRECT");
    expect(h.audits[0].entityId).toBe(DEADLINE_ID);
  });

  it("İKİNCİ düzeltme ilk tespiti EZMEZ", async () => {
    h = harness(
      baseRow({
        correctionCount: 1,
        triggerDate: new Date(Date.UTC(2026, 7, 20)),
        originalTriggerDate: new Date(Date.UTC(2026, 7, 18)),
        originalServiceMethod: "POSTA",
        originalDueDate: new Date(Date.UTC(2026, 8, 1)),
        dueDate: new Date(Date.UTC(2026, 8, 3)),
      })
    );

    await h.service.correctInputs(user("PARTNER", "u-ortak"), DEADLINE_ID, {
      triggerDate: new Date(Date.UTC(2026, 7, 21)),
      reason: "UYAP tebligat çıktısı ile üçüncü kez karşılaştırıldı.",
    } as any);

    const data = h.updates[0];
    expect(data.originalTriggerDate).toBeUndefined();
    expect(data.originalDueDate).toBeUndefined();
    expect(data.originalServiceMethod).toBeUndefined();
    // İlk tespit izde HÂLÂ görünür.
    expect(data.computeNote).toContain("İLK TESPİT");
    expect(data.computeNote).toContain("18.08.2026");
    expect(data.computeNote).toContain("Düzeltme sırası: 2");
  });

  it("SEKRETER ve STAJYER süre girdisini düzeltemez", async () => {
    for (const role of ["SEKRETER", "STAJYER"] as const) {
      await expect(
        h.service.correctInputs(user(role), DEADLINE_ID, {
          triggerDate: new Date(Date.UTC(2026, 7, 20)),
          reason: "Tebligat parçası incelendi.",
        } as any)
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    // Yetkisiz istek hiçbir yazma yapmadı.
    expect(h.updates).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });

  it("MANUEL süre bu uçtan düzeltilmez; kapanmış süre hiç düzeltilmez", async () => {
    const manual = harness(baseRow({ source: "MANUEL", ruleKey: null }));
    await expect(
      manual.service.correctInputs(user("AVUKAT"), DEADLINE_ID, {
        triggerDate: new Date(Date.UTC(2026, 7, 20)),
        reason: "Tebligat parçası incelendi.",
      } as any)
    ).rejects.toBeInstanceOf(BadRequestException);

    const done = harness(baseRow({ status: "TAMAMLANDI" }));
    await expect(
      done.service.correctInputs(user("AVUKAT"), DEADLINE_ID, {
        triggerDate: new Date(Date.UTC(2026, 7, 20)),
        reason: "Tebligat parçası incelendi.",
      } as any)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("PATCH /deadlines/:id reddi artık VAR OLAN bir ucu gösterir", async () => {
    const err = await h.service
      .update(user("AVUKAT"), DEADLINE_ID, { dueDate: new Date(Date.UTC(2026, 8, 3)) } as any)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain("/deadlines/:id/inputs");
  });
});
