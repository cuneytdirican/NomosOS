/**
 * KREDİ KOŞU BAĞLAMI — birim testleri.
 *
 * Kilitlenen davranış: "çıktısı KULLANILMAYAN çağrıdan kredi alınmaz"
 * (iş kuralı 4). Denetimde tespit edilen kaçak tam buradaydı: risk ve çatışma
 * servisleri sağlayıcı/çıktı hatasını yutup HTTP 200 + `degraded` dönüyor,
 * interceptor bunu BAŞARI görüyor ve kayıt düşürülmediği için tam ücret
 * tahsil ediliyordu.
 */

import { describe, expect, it } from "vitest";
import { creditRunContext, type CreditRunStore } from "./credit-context";

const newStore = (): CreditRunStore => ({
  tenantId: "t1",
  taskType: "RISK_ASSESS",
  calls: [],
});

const call = (over: Partial<CreditRunStore["calls"][number]> = {}) => ({
  aiUsageLogId: "log-1",
  taskType: "RISK_ASSESS",
  model: "m",
  providerType: "ANTHROPIC",
  inputTokens: 100,
  ...over,
});

describe("creditRunContext", () => {
  it("bağlam YOKKEN record() sessizce hiçbir şey yapmaz (fail-open)", () => {
    // Kredi kapısı devrede değilken AI çağrısı çalışmaya devam etmelidir;
    // kredi muhasebesi avukatın işini durduracak bir şey değildir.
    expect(() => creditRunContext.record(call())).not.toThrow();
    expect(creditRunContext.current()).toBeUndefined();
  });

  it("bağlam içinde record() çağrıyı biriktirir", () => {
    const store = newStore();
    creditRunContext.run(store, () => {
      creditRunContext.record(call());
      creditRunContext.record(call({ aiUsageLogId: "log-2" }));
    });
    expect(store.calls).toHaveLength(2);
  });

  it("discard() tüm koşuyu düşürür — 'degraded' dönen servis kendini ücretsizleştirir", () => {
    const store = newStore();
    creditRunContext.run(store, () => {
      creditRunContext.record(call());
      creditRunContext.discard();
    });
    expect(store.calls).toHaveLength(0);
  });

  it("discard(id) YALNIZ o kaydı düşürür, diğer çağrılar ücretlendirilmeye devam eder", () => {
    const store = newStore();
    creditRunContext.run(store, () => {
      creditRunContext.record(call({ aiUsageLogId: "log-1" }));
      creditRunContext.record(call({ aiUsageLogId: "log-2" }));
      creditRunContext.discard("log-1");
    });
    expect(store.calls.map((c) => c.aiUsageLogId)).toEqual(["log-2"]);
  });

  it("discard() bağlam yokken güvenlidir", () => {
    expect(() => creditRunContext.discard()).not.toThrow();
    expect(() => creditRunContext.discard("log-1")).not.toThrow();
  });

  it("bağlam ASENKRON zincirin derinliğine taşınır", async () => {
    const store = newStore();
    await creditRunContext.run(store, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      // Yürütücü, çağrı zincirinin herhangi bir derinliğinden bildirebilmeli.
      creditRunContext.record(call());
    });
    expect(store.calls).toHaveLength(1);
  });

  it("iç içe koşular birbirinin kaydını görmez", () => {
    const outer = newStore();
    const inner: CreditRunStore = { ...newStore(), taskType: "STRATEGY_BUILD", calls: [] };
    creditRunContext.run(outer, () => {
      creditRunContext.record(call({ aiUsageLogId: "dis" }));
      creditRunContext.run(inner, () => {
        creditRunContext.record(call({ aiUsageLogId: "ic" }));
      });
    });
    expect(outer.calls.map((c) => c.aiUsageLogId)).toEqual(["dis"]);
    expect(inner.calls.map((c) => c.aiUsageLogId)).toEqual(["ic"]);
  });
});
