import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { observeAiCall, observeHttp, observeOcr, readBackupTimestamp, registry, renderMetrics, resetMetrics } from "./metrics.registry";

describe("metrics.registry", () => {
  beforeEach(() => resetMetrics());

  it("HTTP/AI/OCR gözlemleri Prometheus çıktısında rota kalıbı ve etiketle görünür", async () => {
    observeHttp("get", "/api/v1/cases/:id", 200, 120);
    observeHttp("POST", "/api/v1/cases", 500, 30);
    observeAiCall("ok", 2500);
    observeAiCall("provider_error", 100);
    observeOcr(4000);
    const text = await renderMetrics();
    expect(text).toMatch(/nomosos_http_requests_total\{[^}]*method="GET"[^}]*route="\/api\/v1\/cases\/:id"[^}]*status="200"[^}]*\} 1/);
    expect(text).toMatch(/nomosos_http_requests_total\{[^}]*method="POST"[^}]*route="\/api\/v1\/cases"[^}]*status="500"[^}]*\} 1/);
    expect(text).toMatch(/nomosos_http_request_duration_seconds_bucket\{[^}]*le="0.25"[^}]*route="\/api\/v1\/cases\/:id"[^}]*\} 1/);
    expect(text).toMatch(/nomosos_ai_calls_total\{[^}]*outcome="ok"[^}]*\} 1/);
    expect(text).toMatch(/nomosos_ai_calls_total\{[^}]*outcome="provider_error"[^}]*\} 1/);
    expect(text).toContain("nomosos_ocr_duration_seconds_sum");
    expect(text).toContain("process_resident_memory_bytes"); // varsayılan süreç metrikleri
  });

  it("yedek tazeliği: durum dosyasından Unix sn; dosya yok/bozuk → 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "nomosos-backup-"));
    const file = join(dir, "last-success.json");
    writeFileSync(file, JSON.stringify({ finishedAt: "2026-09-06T03:15:00Z" }));
    expect(readBackupTimestamp(file)).toBe(Math.floor(Date.parse("2026-09-06T03:15:00Z") / 1000));
    expect(readBackupTimestamp(join(dir, "yok.json"))).toBe(0);
    writeFileSync(file, "{bozuk");
    expect(readBackupTimestamp(file)).toBe(0);
  });

  it("12 iş metriği kayıtlı", async () => {
    const names = (await registry.getMetricsAsJSON()).map((m) => m.name);
    for (const n of [
      "nomosos_http_request_duration_seconds",
      "nomosos_http_requests_total",
      "nomosos_ai_calls_total",
      "nomosos_ai_call_duration_seconds",
      "nomosos_queue_jobs",
      "nomosos_ocr_duration_seconds",
      "nomosos_backup_last_success_timestamp_seconds",
      "nomosos_credit_wallets_negative_total",
      "nomosos_subscriptions",
      "nomosos_platform_invoices_overdue_total",
      "nomosos_db_up",
      "nomosos_scheduler_job_failures_total",
    ]) expect(names).toContain(n);
  });
});
