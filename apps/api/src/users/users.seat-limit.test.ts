/**
 * Koltuk sınırı (Faz 0 gelir kaçağı): büro, aboneliğindeki koltuk sayısından
 * (ve planın maxUsers tavanından) fazla AKTİF kullanıcı açamaz / yeniden
 * etkinleştiremez. Aboneliği olmayan kiracı sınırlanmaz.
 */
import { describe, expect, it, vi } from "vitest";
import { UsersService } from "./users.service";

const admin = { userId: "u-adm", tenantId: "t1", role: "ADMIN" as const };

function build(opts: { active: number; seats?: number | null; maxUsers?: number | null; subscription?: boolean }) {
  const users: any[] = [];
  const prisma = {
    client: {
      user: {
        findUnique: vi.fn(async () => null),
        count: vi.fn(async () => opts.active),
        create: vi.fn(async ({ data }: any) => {
          const u = { id: `u${users.length + 1}`, ...data, isActive: true };
          users.push(u);
          return u;
        }),
        findFirst: vi.fn(async () => ({ id: "u-target", tenantId: "t1", isActive: false, email: "x@b.com", fullName: "X", role: "AVUKAT" })),
        update: vi.fn(async ({ data }: any) => ({ id: "u-target", ...data })),
      },
      subscription: { findUnique: vi.fn(async () => (opts.subscription === false ? null : { seats: opts.seats ?? 3, planKey: "BURO" })) },
      planTier: { findUnique: vi.fn(async () => ({ name: "Büro", maxUsers: opts.maxUsers === undefined ? null : opts.maxUsers })) },
    },
  };
  const svc = new UsersService(prisma as any, { log: vi.fn() } as any, {} as any);
  return { svc, prisma };
}
const input = { email: "yeni@buro.com", fullName: "Yeni Kişi", role: "AVUKAT" as const, password: "Parola12345!" };

describe("UsersService — koltuk sınırı", () => {
  it("aktif kullanıcı sayısı koltuk sayısına ulaştıysa 409", async () => {
    const { svc, prisma } = build({ active: 3, seats: 3 });
    await expect(svc.create(admin, input as any)).rejects.toThrow(/koltuk/i);
    expect(prisma.client.user.create).not.toHaveBeenCalled();
  });

  it("koltuk boşsa oluşturur; plan maxUsers koltuktan küçükse o kazanır", async () => {
    const ok = build({ active: 2, seats: 3 });
    await expect(ok.svc.create(admin, input as any)).resolves.toBeTruthy();
    const capped = build({ active: 2, seats: 10, maxUsers: 2 });
    await expect(capped.svc.create(admin, input as any)).rejects.toThrow(/koltuk/i);
  });

  it("aboneliği olmayan kiracı sınırlanmaz", async () => {
    const { svc } = build({ active: 50, subscription: false });
    await expect(svc.create(admin, input as any)).resolves.toBeTruthy();
  });

  it("pasif kullanıcıyı yeniden etkinleştirmek de koltuk ister", async () => {
    const { svc } = build({ active: 3, seats: 3 });
    await expect(svc.update(admin, "u-target", { isActive: true } as any)).rejects.toThrow(/koltuk/i);
  });
});
