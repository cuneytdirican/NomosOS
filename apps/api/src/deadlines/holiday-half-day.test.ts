/**
 * denetim bulgusu Ö-16 — tatil sorguları `isHalfDay` / `isApproximate`
 * sütunlarını ÇEKMELİDİR.
 *
 * Denetimde tespit edilen hâl: beş `holiday.findMany` çağrısının dördü
 * `select: { date, type, name }` kullanıyordu. Sütunlar gelmeyince motor
 * `buildHolidayIndex` içindeki geriye düşüşe mecbur kalıyor ve bayrağı tatilin
 * ADINDAN okumaya çalışıyordu (`name.includes("(yarım gün)")`) — dosyanın kendi
 * yorumunun "string arama kırılgandır" dediği yol. Bugün tetiklenmemesinin tek
 * sebebi veritabanındaki üç arife satırının adında o ibarenin bulunmasıydı;
 * tek bir isim düzenlemesi hesabı sessizce bozardı.
 *
 * Bu dosya iki şeyi kilitler:
 *  1. KAYNAK GÜVENCESİ — beş sorgunun BEŞİ de iki sütunu çeker (yeni bir
 *     `holiday.findMany` eklenirse o da bu kapıdan geçmek zorundadır),
 *  2. DAVRANIŞ — bayraklar motora ulaştığında arife TAM TATİL SAYILMAZ
 *     (2429 s.K. m.2/A: 13.00'e kadar mesai vardır; HMK m.93 kaydırması
 *     tetiklenmez), yaklaşık (hicri) tarihler ise teyit uyarısı doğurur.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DeadlinesService } from "./deadlines.service";
import type { AuthUser } from "../common/types";

const SRC = join(__dirname, "..");

/** Tatil sorgusu barındıran BÜTÜN dosyalar. */
const HOLIDAY_QUERY_FILES = [
  "deadlines/deadlines.service.ts",
  "enforcement/enforcement-deadlines.service.ts",
  "expert/expert-deadlines.service.ts",
  "contracts/contract-renewal.service.ts",
  "pipeline/deadline-compute.service.ts",
];

describe("Ö-16 · tatil sorguları yarım gün / yaklaşık sütunlarını çeker", () => {
  it("her `holiday.findMany` çağrısı isHalfDay ve isApproximate seçer", () => {
    let checked = 0;
    for (const rel of HOLIDAY_QUERY_FILES) {
      const source = readFileSync(join(SRC, rel), "utf8");
      // Her çağrının gövdesini `holiday.findMany(` ile onu izleyen ilk
      // `select: { ... }` bloğu üzerinden yakala.
      const parts = source.split("holiday.findMany(");
      expect(parts.length - 1, `${rel}: holiday.findMany çağrısı bulunamadı`).toBeGreaterThan(0);
      for (const part of parts.slice(1)) {
        const select = /select:\s*\{([^}]*)\}/.exec(part);
        expect(select, `${rel}: tatil sorgusunda select bloğu yok`).not.toBeNull();
        expect(select![1], `${rel}: tatil sorgusu isHalfDay çekmiyor`).toContain("isHalfDay");
        expect(select![1], `${rel}: tatil sorgusu isApproximate çekmiyor`).toContain("isApproximate");
        checked += 1;
      }
    }
    // Denetim raporundaki sayım: beş çağrı.
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// DAVRANIŞ: bayraklar motora ulaşınca ne olur, ulaşmazsa ne olurdu.
// ---------------------------------------------------------------------------

const RULE = {
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

const user: AuthUser = { userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as AuthUser;

/**
 * 28.10.2026 Çarşamba — Cumhuriyet Bayramı Arifesi (YARIM GÜN).
 * 29.10.2026 Perşembe — Cumhuriyet Bayramı (TAM TATİL).
 * 20.03.2026 — Ramazan Bayramı 1. gün (YAKLAŞIK — hicri).
 */
function holidayRows(opts: { flags: boolean; markersInName: boolean }) {
  const name = (base: string, suffix: string) => (opts.markersInName ? `${base} ${suffix}` : base);
  const rows: any[] = [
    {
      date: new Date(Date.UTC(2026, 9, 28)),
      type: "RESMI_TATIL",
      name: name("Cumhuriyet Bayramı Arifesi", "(yarım gün)"),
    },
    { date: new Date(Date.UTC(2026, 9, 29)), type: "RESMI_TATIL", name: "Cumhuriyet Bayramı" },
    {
      date: new Date(Date.UTC(2026, 2, 20)),
      type: "RESMI_TATIL",
      name: name("Ramazan Bayramı 1. gün", "(yaklaşık)"),
    },
  ];
  if (opts.flags) {
    rows[0].isHalfDay = true;
    rows[0].isApproximate = false;
    rows[1].isHalfDay = false;
    rows[1].isApproximate = false;
    rows[2].isHalfDay = false;
    rows[2].isApproximate = true;
  }
  return rows;
}

function service(rows: any[]) {
  const findMany = vi.fn(async () => rows);
  const prisma = { client: { holiday: { findMany } } };
  const rules = { resolveByKey: vi.fn(async () => RULE) };
  return {
    findMany,
    svc: new DeadlinesService(prisma as any, { log: vi.fn() } as any, rules as any),
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("Ö-16 · yarım gün ve yaklaşık tatilin hesaba etkisi", () => {
  it("servis, motora giden tatil sorgusunda iki bayrağı da ister", async () => {
    const { svc, findMany } = service(holidayRows({ flags: true, markersInName: true }));
    await svc.compute(user, { ruleKey: "HMK_ISTINAF", triggerDate: new Date(Date.UTC(2026, 9, 14)) } as any);
    const args = (findMany.mock.calls[0] as unknown as any[])[0];
    expect(args.select.isHalfDay).toBe(true);
    expect(args.select.isApproximate).toBe(true);
  });

  it("SON GÜN arifeye düşerse süre O GÜN biter — kaydırma YOKTUR", async () => {
    // 14.10.2026 + 2 hafta = 28.10.2026 (Cumhuriyet Bayramı Arifesi, yarım gün).
    // 2429 s.K. m.2/A: o gün 13.00'e kadar mesai vardır; gün "resmî tatile
    // rastlamış" sayılmaz ve HMK m.93 kaydırması TETİKLENMEZ.
    const { svc } = service(holidayRows({ flags: true, markersInName: true }));
    const out = await svc.compute(user, {
      ruleKey: "HMK_ISTINAF",
      triggerDate: new Date(Date.UTC(2026, 9, 14)),
    } as any);

    expect(iso(out.dueDate)).toBe("2026-10-28");
    // Kaydırma yerine AÇIK UYARI: işlem öğleden önce tamamlanmalıdır.
    expect(out.warnings.join(" ")).toContain("13.00");
    expect(out.warnings.join(" ")).toContain("yarım gün");
  });

  it("bayraklar gelmezse arife TAM TATİL sanılır ve avukata var olmayan 2 gün kazandırılırdı", async () => {
    // Ö-16'nın somut zararı: sütunlar `select` dışında kalır VE tatilin adı
    // düzenlenirse (ör. "(yarım gün)" ibaresi kaldırılırsa) motorun geriye
    // düşüşü de çalışmaz. O hâlde 28.10 tam tatil, 29.10 tam tatil sayılır ve
    // son gün 30.10'a kayar — hak düşürücü sürede iki günlük sahte pay.
    const { svc } = service(holidayRows({ flags: false, markersInName: false }));
    const out = await svc.compute(user, {
      ruleKey: "HMK_ISTINAF",
      triggerDate: new Date(Date.UTC(2026, 9, 14)),
    } as any);

    expect(iso(out.dueDate)).toBe("2026-10-30");
  });

  it("yaklaşık (hicri) tatil hesap aralığına düşerse teyit uyarısı üretilir", async () => {
    // 10.03.2026 + 2 hafta → aralık Ramazan Bayramı'nı kapsar.
    const { svc } = service(holidayRows({ flags: true, markersInName: false }));
    const out = await svc.compute(user, {
      ruleKey: "HMK_ISTINAF",
      triggerDate: new Date(Date.UTC(2026, 2, 10)),
    } as any);

    expect(out.warnings.join(" ")).toContain("kesinleşmemiş");
    expect(out.warnings.join(" ")).toContain("20.03.2026");
  });

  it("bayrak gelmezse yaklaşık tatil uyarısı SESSİZCE kaybolur", async () => {
    const { svc } = service(holidayRows({ flags: false, markersInName: false }));
    const out = await svc.compute(user, {
      ruleKey: "HMK_ISTINAF",
      triggerDate: new Date(Date.UTC(2026, 2, 10)),
    } as any);

    expect(out.warnings.join(" ")).not.toContain("kesinleşmemiş");
  });
});
