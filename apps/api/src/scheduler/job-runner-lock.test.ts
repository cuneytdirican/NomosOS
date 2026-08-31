import { describe, expect, it, vi } from "vitest";
import { JobRunnerService } from "./job-runner.service";
import type { JobExecutionContext, ScheduledJobHandler } from "./scheduler.types";

/**
 * İŞ KİLİDİ — denetim bulgusu 2 (KRİTİK).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN BU TEST VAR:                                                       ║
 * ║ `running.add(...)` ile `try/finally` arasında `await` edilen bir DB      ║
 * ║ yazımı vardı (`jobRun.create`). O yazım fırlatırsa `finally` HİÇ         ║
 * ║ çalışmıyor ve anahtar kümede KALICI olarak asılı kalıyordu. Bir          ║
 * ║ saniyelik bağlantı kesintisi, süre hatırlatmalarını API yeniden          ║
 * ║ başlatılana kadar TAMAMEN durduruyordu — üstelik panelde iş "çalışıyor"  ║
 * ║ görünüyor, `lastError` boş kalıyordu. Bir hukuk ürününde en pahalı       ║
 * ║ sessiz arıza budur: kimse fark etmeden süre kaçırılır.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

function fakeHandler(key = "deadline-reminder-daily"): ScheduledJobHandler {
  return {
    key,
    name: key,
    defaultCron: "0 7 * * *",
    description: "",
    run: vi.fn(async () => ({ created: 1, skipped: 0, failed: 0 })),
  } as unknown as ScheduledJobHandler;
}

function fakePrisma(options: { createFails?: boolean } = {}) {
  return {
    client: {
      jobRun: {
        create: vi.fn(async () => {
          if (options.createFails) throw new Error("Timed out fetching a new connection from pool");
          return { id: "run-1" };
        }),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      scheduledJob: {
        findUnique: vi.fn(async () => ({ key: "k", isEnabled: true, cronExpression: "0 7 * * *" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };
}

const ctx: JobExecutionContext = { trigger: "cron", now: new Date("2026-08-31T04:00:00.000Z") };

describe("JobRunnerService — kilit sızıntısı", () => {
  it("koşu kaydı YAZILAMAZSA kilit ÇÖZÜLÜR ve iş bir daha çalıştırılabilir", async () => {
    const prisma = fakePrisma({ createFails: true });
    const runner = new JobRunnerService(prisma as never);
    const handler = fakeHandler();

    await expect(runner.run(handler, ctx)).rejects.toThrow(/connection/i);
    // ASIL İDDİA: anahtar asılı kalmadı.
    expect(runner.runningKeys()).toEqual([]);

    // Bir sonraki koşu "zaten çalışıyor" hatasına DÜŞMEZ; DB toparlandığında
    // gece işleri kendiliğinden geri gelir.
    const healthy = new JobRunnerService(fakePrisma() as never);
    await expect(healthy.run(handler, ctx)).resolves.toMatchObject({ jobKey: handler.key });
    expect(healthy.runningKeys()).toEqual([]);
  });

  it("koşu kaydı açılamazsa İŞ HİÇ ÇALIŞTIRILMAZ — denetim izi olmadan bildirim üretilmez", async () => {
    const prisma = fakePrisma({ createFails: true });
    const runner = new JobRunnerService(prisma as never);
    const handler = fakeHandler();
    await expect(runner.run(handler, ctx)).rejects.toThrow();
    expect(handler.run).not.toHaveBeenCalled();
  });

  it("başarılı koşudan sonra da kilit çözülür", async () => {
    const runner = new JobRunnerService(fakePrisma() as never);
    await runner.run(fakeHandler(), ctx);
    expect(runner.runningKeys()).toEqual([]);
  });

  it("işin kendisi patlasa bile kilit çözülür ve koşu BASARISIZ kapatılır", async () => {
    const prisma = fakePrisma();
    const runner = new JobRunnerService(prisma as never);
    const handler = fakeHandler();
    (handler.run as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("tenant patladı"));

    const summary = await runner.run(handler, ctx);
    expect(summary.status).toBe("BASARISIZ");
    expect(runner.runningKeys()).toEqual([]);
  });

  it("eş zamanlı ikinci koşu reddedilir ama kilidi BOZMAZ", async () => {
    const prisma = fakePrisma();
    const runner = new JobRunnerService(prisma as never);
    const handler = fakeHandler();
    let release!: () => void;
    const gate = new Promise<{ created: number; skipped: number; failed: number }>((resolve) => {
      release = () => resolve({ created: 0, skipped: 0, failed: 0 });
    });
    (handler.run as ReturnType<typeof vi.fn>).mockImplementationOnce(() => gate);

    const first = runner.run(handler, ctx);
    await vi.waitFor(() => expect(runner.runningKeys()).toHaveLength(1));
    // İlk koşu askıdayken ikinci çağrı çakışma hatası almalı.
    await expect(runner.run(handler, ctx)).rejects.toThrow(/zaten çalışıyor/);
    expect(runner.runningKeys()).toEqual([handler.key]);

    release();
    await first;
    expect(runner.runningKeys()).toEqual([]);
  });

  it("uzun süredir çalışan iş YAŞIYLA BİRLİKTE raporlanır — sonsuz koşu görünür olmalı", async () => {
    const prisma = fakePrisma();
    const runner = new JobRunnerService(prisma as never);
    const handler = fakeHandler();
    // Deferred, mock'tan ÖNCE kurulur: `mockImplementation` içinde atanan bir
    // kapanış değişkenine güvenmek mikro-görev sırasına bağımlı olurdu.
    let release!: () => void;
    const gate = new Promise<{ created: number; skipped: number; failed: number }>((resolve) => {
      release = () => resolve({ created: 0, skipped: 0, failed: 0 });
    });
    (handler.run as ReturnType<typeof vi.fn>).mockImplementationOnce(() => gate);

    const running = runner.run(handler, ctx);
    // Kilit `jobRun.create` await'inden SONRA gözlemlenebilir; birkaç mikro
    // görev bekleyip anahtarın kurulmasını garantile.
    await vi.waitFor(() => expect(runner.runningKeys()).toHaveLength(1));
    const details = runner.runningDetails(new Date(Date.now() + 60 * 60 * 1000));
    expect(details).toHaveLength(1);
    expect(details[0].stalled).toBe(true);
    expect(details[0].ageMs).toBeGreaterThan(0);

    release();
    await running;
  });

  it("askıda kalmış CALISIYOR satırları açılışta KESİLMİŞ KOŞU olarak kapatılır", async () => {
    const prisma = fakePrisma();
    prisma.client.jobRun.updateMany = vi.fn(async () => ({ count: 2 }));
    const runner = new JobRunnerService(prisma as never);

    const closed = await runner.sweepStaleRuns(new Date("2026-08-31T12:00:00.000Z"));
    expect(closed).toBe(2);
    const call = (prisma.client.jobRun.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.status).toBe("CALISIYOR");
    expect(call.data.status).toBe("BASARISIZ");
    // Satır SİLİNMEZ; kanıt durur, belirsizlik biter.
    expect(String(call.data.errorMessage)).toContain("Kesilmiş koşu");
  });

  it("süpürme hatası açılışı DÜŞÜRMEZ — temizlik bir yan işlemdir", async () => {
    const prisma = fakePrisma();
    prisma.client.jobRun.updateMany = vi.fn(async () => {
      throw new Error("veritabanına ulaşılamıyor");
    });
    const runner = new JobRunnerService(prisma as never);
    await expect(runner.onModuleInit()).resolves.toBeUndefined();
  });
});
