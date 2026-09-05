/**
 * AAÜT PLATFORM TARİFESİ — öncelik ve kaynak gösterimi testleri
 * (açılış öncesi hazır veri planı, Aşama 2).
 *
 * Korunan taahhütler:
 *  1. Büro tarifesi varsa o kullanılır (kaynak BURO) — platform ezmez.
 *  2. Büro tarifesi yoksa platform tarifesi kullanılır (kaynak PLATFORM, RG künyesi döner).
 *  3. İkisi de yoksa 404 — sistem rakam uydurmaz.
 *  4. Platform tarifesi kaydı RG künyesiyle denetim izine düşer.
 */

import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { VekaletUcretiService } from "./vekalet-ucreti.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PlatformAuditService } from "../platform/platform-audit.service";
import type { AuthUser } from "../common/types";
import type { PlatformAuthUser } from "../platform/platform.types";

const USER = { userId: "u-1", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;
const ACTOR = { id: "pu-1", role: "SUPER_ADMIN", ip: "127.0.0.1" } as PlatformAuthUser;

const KADEMELER = JSON.stringify([
  { limitKurus: "20000000", ucretKurus: "3700000" },
  { limitKurus: null, ucretKurus: "1000000" },
]);

function tarifeRow(extra: Record<string, unknown>) {
  return {
    maktuKademelerJson: KADEMELER,
    maktuTekrarJson: null,
    nispiOranYuzde: new Prisma.Decimal("16.50"),
    kdvOrani: new Prisma.Decimal("20"),
    ...extra,
  };
}

function build(opts: { buro?: boolean; platform?: boolean }) {
  const platformAuditLog = vi.fn(async () => undefined);
  const upserts: Record<string, unknown>[] = [];
  const client = {
    vekaletTarife: {
      findUnique: vi.fn(async () => (opts.buro ? tarifeRow({ id: "vt-1", tenantId: "buro-A", yil: 2026 }) : null)),
    },
    platformVekaletTarife: {
      findUnique: vi.fn(async () =>
        opts.platform ? tarifeRow({ id: "pvt-1", yil: 2026, rgKunye: "RG 21.12.2025 / 32784" }) : null,
      ),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => {
        upserts.push(args.create);
        return tarifeRow({ id: "pvt-2", yil: 2027, rgKunye: args.create.rgKunye });
      }),
    },
  };
  const svc = new VekaletUcretiService(
    { client } as unknown as PrismaService,
    { log: vi.fn(async () => undefined) } as unknown as AuditService,
    { log: platformAuditLog } as unknown as PlatformAuditService,
  );
  return { svc, platformAuditLog, upserts };
}

describe("tarife önceliği: büro > platform > 404", () => {
  it("büro tarifesi varsa kaynak BURO (platform kaydı olsa bile)", async () => {
    const { svc } = build({ buro: true, platform: true });
    const r = await svc.hesapla(USER, "10000000", 2026);
    expect(r.tarifeKaynagi).toBe("BURO");
    expect(r.rgKunye).toBeNull();
    expect(r.not).toContain("büronuzun girdiği");
  });

  it("büro tarifesi yoksa PLATFORM tarifesi kullanılır ve RG künyesi görünür", async () => {
    const { svc } = build({ buro: false, platform: true });
    const r = await svc.hesapla(USER, "10000000", 2026);
    expect(r.tarifeKaynagi).toBe("PLATFORM");
    expect(r.rgKunye).toBe("RG 21.12.2025 / 32784");
    expect(r.not).toContain("Resmî Gazete");
    // Motor gerçekten hesapladı (rakam uydurma yok, tarifeden).
    expect(BigInt(r.toplamKurus)).toBeGreaterThan(0n);
    const t = await svc.tarifeGetir("buro-A", 2026);
    expect(t.kaynak).toBe("PLATFORM");
  });

  it("ikisi de yoksa 404 — mesaj büro ve platformu birlikte söyler", async () => {
    const { svc } = build({});
    await expect(svc.hesapla(USER, "10000000", 2026)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.hesapla(USER, "10000000", 2026)).rejects.toThrow(/platform varsayılanı da/);
  });
});

describe("platform tarifesi kaydı", () => {
  it("RG künyesiyle upsert edilir ve platform denetim izine düşer", async () => {
    const { svc, platformAuditLog, upserts } = build({});
    const r = await svc.platformTarifeKaydet(ACTOR, {
      yil: 2027,
      kademeler: [{ limitKurus: null, ucretKurus: "5000000" }],
      tekrar: null,
      nispiOranYuzde: "16.50",
      kdvOrani: "20",
      rgKunye: "RG 20.12.2026 / 33150",
    });
    expect(upserts[0]).toMatchObject({ yil: 2027, rgKunye: "RG 20.12.2026 / 33150", updatedBy: "pu-1" });
    expect(r.rgKunye).toBe("RG 20.12.2026 / 33150");
    expect(platformAuditLog).toHaveBeenCalledTimes(1);
    expect(String((platformAuditLog.mock.calls[0] as unknown as [{ detail: string }])[0].detail)).toContain("RG=");
  });

  it("platformTarifeVarMi yıl başı işine var/yok + künye verir", async () => {
    const { svc } = build({ platform: true });
    expect(await svc.platformTarifeVarMi(2026)).toEqual({ var: true, rgKunye: "RG 21.12.2025 / 32784" });
  });
});
