import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CreditService } from "./credit.service";

/**
 * KREDİ DÖNEMİ YENİLEME — ÇİFT TAHSİS PENCERESİ (denetim bulgusu 6).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN BU TEST VAR:                                                       ║
 * ║ `renewPeriod` dönem bitiş kontrolünü İŞLEM DIŞINDA yapıyor, sonra işlem   ║
 * ║ içinde cüzdanı KOŞULSUZ güncelliyordu. İşin idempotentlik savunması       ║
 * ║ ("ikinci koşuda süzgece takılmaz") yalnız SIRALI koşular için doğrudur.   ║
 * ║                                                                          ║
 * ║ `JobRunnerService` kilidi SÜREÇ İÇİDİR. İki API örneği çalışıyorsa ya da  ║
 * ║ cron ile panelden tetikleme çakışırsa iki çağrı da o kontrolü geçer, iki  ║
 * ║ işlem açılır ve İKİ `TAHSIS` hareketi yazılırdı: büro o dönem için ÇİFT   ║
 * ║ dahil kota alır, `includedConsumed` iki kez sıfırlanır ve `balanceAfter`  ║
 * ║ mutabakatı bozulurdu. Kredi paraya eşdeğerdir; bu bir muhasebe hatasıdır. ║
 * ║ Üstelik ikinci koşunun `SURESI_DOLDU` satırı 0 yanar (kota zaten          ║
 * ║ sıfırlanmıştır) ve defter "hiç yanmadı" derdi.                            ║
 * ║                                                                          ║
 * ║ Koruma artık İŞLEMİN İÇİNDE, yazmanın kendisindedir: koşullu             ║
 * ║ `updateMany` yarışı kaybeden çağrıya `count === 0` döndürür ve o çağrı    ║
 * ║ HİÇBİR ŞEY yazmadan `ConflictException` ile çıkar.                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

interface TxSpy {
  updateManyCount: number;
  calls: string[];
}

function buildService(spy: TxSpy, options: { periodEndPast?: boolean } = {}) {
  const wallet = {
    tenantId: "t1",
    // İşlem DIŞINDAKİ ön kontrol geçsin diye dönem bitmiş görünür.
    periodEnd: options.periodEndPast === false ? new Date("2099-01-01") : new Date("2020-01-01"),
    periodStart: new Date("2019-12-01"),
    includedCredits: 500,
    includedConsumed: 5,
    documentQuota: 100,
    documentUsed: 3,
    purchasedCredits: 0,
    reservedCredits: 0,
  };

  const tx = {
    creditWallet: {
      updateMany: vi.fn(async () => {
        spy.calls.push("wallet.updateMany");
        return { count: spy.updateManyCount };
      }),
      findUniqueOrThrow: vi.fn(async () => {
        spy.calls.push("wallet.findUniqueOrThrow");
        return { ...wallet };
      }),
      update: vi.fn(async () => {
        spy.calls.push("wallet.update");
        return { ...wallet, includedCredits: 2000, includedConsumed: 0 };
      }),
    },
    creditTransaction: {
      create: vi.fn(async ({ data }: { data: { type: string } }) => {
        spy.calls.push(`tx.create:${data.type}`);
        return {};
      }),
    },
  };

  const prisma = {
    client: {
      creditWallet: { findUnique: vi.fn(async () => ({ ...wallet })) },
      subscription: { findUnique: vi.fn(async () => ({ planKey: "PROFESYONEL", seats: 4 })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };

  const service = new CreditService(
    prisma as never,
    { log: vi.fn(async () => undefined) } as never,
    {} as never,
    {} as never,
  );
  return { service, tx };
}

describe("CreditService.renewPeriod — çift tahsis koruması", () => {
  it("YARIŞI KAZANAN çağrı normal yeniler: SURESI_DOLDU + TAHSIS yazılır", async () => {
    const spy: TxSpy = { updateManyCount: 1, calls: [] };
    const { service } = buildService(spy);

    const result = await service.renewPeriod("t1", { note: "test" });

    expect(result.yeniKota).toBeGreaterThan(0);
    // Koşullu yazma İLK adımdır: "bu dönemi ben yeniliyorum" ilanı.
    expect(spy.calls[0]).toBe("wallet.updateMany");
    expect(spy.calls).toContain("tx.create:SURESI_DOLDU");
    expect(spy.calls).toContain("tx.create:TAHSIS");
  });

  it("YARIŞI KAYBEDEN çağrı HİÇBİR ŞEY yazmaz ve ConflictException fırlatır", async () => {
    const spy: TxSpy = { updateManyCount: 0, calls: [] };
    const { service } = buildService(spy);

    await expect(service.renewPeriod("t1")).rejects.toBeInstanceOf(ConflictException);

    // ASIL İDDİA: ikinci TAHSIS yok, ikinci SURESI_DOLDU yok, cüzdan güncellemesi yok.
    expect(spy.calls).toEqual(["wallet.updateMany"]);
    expect(spy.calls.filter((c) => c.startsWith("tx.create"))).toHaveLength(0);
  });

  it("kaybeden çağrının hatası ANLAŞILIR: bu bir arıza değil, korumadır", async () => {
    const spy: TxSpy = { updateManyCount: 0, calls: [] };
    const { service } = buildService(spy);
    await expect(service.renewPeriod("t1")).rejects.toThrow(/çift tahsis koruması/);
  });

  it("dönem bitmemişse işlem HİÇ AÇILMAZ (force'suz erken yenileme yasak)", async () => {
    const spy: TxSpy = { updateManyCount: 1, calls: [] };
    const { service } = buildService(spy, { periodEndPast: false });
    await expect(service.renewPeriod("t1")).rejects.toThrow(/Dönem henüz bitmedi/);
    expect(spy.calls).toEqual([]);
  });

  it("force ile erken yenilemede koşul aranmaz ama yazma yine TEK adımdır", async () => {
    const spy: TxSpy = { updateManyCount: 1, calls: [] };
    const { service } = buildService(spy, { periodEndPast: false });
    await service.renewPeriod("t1", { force: true });
    expect(spy.calls[0]).toBe("wallet.updateMany");
    expect(spy.calls).toContain("tx.create:TAHSIS");
  });
});
