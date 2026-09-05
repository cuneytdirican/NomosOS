/**
 * AAÜT YIL BAŞI DENETİMİ — iş testleri.
 *
 * Korunan taahhütler:
 *  1. Yılın platform tarifesi yoksa iş BAŞARISIZ raporlanır ve denetim izine düşer.
 *  2. Aralık ayında gelecek yıl da denetlenir.
 *  3. Tarife varsa RG künyesiyle sağlıklı rapor; iş rakam ÜRETMEZ.
 */

import { describe, expect, it, vi } from "vitest";
import { AautYilbasiJob } from "./jobs/aaut-yilbasi.job";
import type { VekaletUcretiService } from "../vekalet-ucreti/vekalet-ucreti.service";
import type { PlatformAuditService } from "../platform/platform-audit.service";
import type { JobExecutionContext } from "./scheduler.types";

function build(present: Record<number, string | null>) {
  const auditLog = vi.fn(async () => undefined);
  const vekalet = {
    platformTarifeVarMi: vi.fn(async (yil: number) => ({
      var: yil in present,
      rgKunye: present[yil] ?? null,
    })),
  } as unknown as VekaletUcretiService;
  const audit = { log: auditLog } as unknown as PlatformAuditService;
  return { job: new AautYilbasiJob(vekalet, audit), auditLog };
}

const ctx = (iso: string): JobExecutionContext =>
  ({ now: new Date(iso), trigger: "cron", triggeredBy: undefined }) as unknown as JobExecutionContext;

describe("AautYilbasiJob", () => {
  it("tarife eksikse BAŞARISIZ raporlar ve denetim izine yazar", async () => {
    const { job, auditLog } = build({});
    const res = await job.run(ctx("2027-01-02T04:00:00Z"));
    expect(res.failed).toBe(1);
    expect(res.errors?.[0]).toContain("2027");
    expect(res.errors?.[0]).toContain("EKSİK");
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(res.detail).toMatchObject({ eksik: [2027] });
  });

  it("Aralık'ta içinde bulunulan yıl VE gelecek yıl denetlenir", async () => {
    const { job } = build({ 2026: "RG 21.12.2025 / 32784" });
    const res = await job.run(ctx("2026-12-15T10:00:00Z"));
    expect(res.detail).toMatchObject({ denetlenenYillar: [2026, 2027], eksik: [2027] });
    expect(res.failed).toBe(1);
  });

  it("tarife varsa sağlıklı; RG künyesi raporda görünür, rakam üretilmez", async () => {
    const { job, auditLog } = build({ 2027: "RG 20.12.2026 / 33150" });
    const res = await job.run(ctx("2027-01-02T04:00:00Z"));
    expect(res.failed).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.detail).toMatchObject({ mevcut: { "2027": "RG 20.12.2026 / 33150" } });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("TR takvim yılı: UTC 31 Aralık 22:00 = TR 1 Ocak", async () => {
    const { job } = build({});
    const res = await job.run(ctx("2026-12-31T22:30:00Z"));
    expect(res.detail).toMatchObject({ denetlenenYillar: [2027] });
  });
});
