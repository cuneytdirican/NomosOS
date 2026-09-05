/**
 * FAZ 4 — OPERASYON/SRE sözleşme testleri: readiness, JSON günlük + x-request-id, metrikler +
 * uyarı kuralları, global oran sınırı, parola gücü, anahtar rotasyonu, yedek/geri yükleme,
 * CD iş akışı, Caddyfile, OpenAPI, biçim/husky, belge güncellemeleri.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEALTH_ROUTES } from "@nomosos/shared";

const root = join(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");

describe("Faz 4 — gözlemlenebilirlik", () => {
  it("readiness ucu + compose liveness; JSON günlük ve istek bağlamı main.ts'te; filtre reqId kullanır", () => {
    expect(HEALTH_ROUTES.ready).toBe("/health/ready");
    expect(read("apps", "api", "src", "health", "health.controller.ts")).toContain('@Get("ready")');
    const main = read("apps", "api", "src", "main.ts");
    expect(main).toContain("requestContextMiddleware(");
    expect(main).toContain("createAppLogger()");
    expect(main).toContain('SwaggerModule.setup("api/docs"');
    expect(main).toContain('process.env.NODE_ENV !== "production"');
    expect(read("apps", "api", "src", "common", "filters", "all-exceptions.filter.ts")).toContain("currentRequestId()");
  });

  it("12 metrik + alerts.yml eşleşir; AI/OCR enstrümante; deploy.yml readiness dumanı", () => {
    const reg = read("apps", "api", "src", "metrics", "metrics.registry.ts");
    const alerts = read("prometheus", "alerts.yml");
    for (const m of [
      "nomosos_http_request_duration_seconds",
      "nomosos_http_requests_total",
      "nomosos_ai_calls_total",
      "nomosos_queue_jobs",
      "nomosos_ocr_duration_seconds",
      "nomosos_backup_last_success_timestamp_seconds",
      "nomosos_credit_wallets_negative_total",
      "nomosos_subscriptions",
      "nomosos_platform_invoices_overdue_total",
      "nomosos_db_up",
      "nomosos_scheduler_job_failures_total",
    ]) {
      expect(reg).toContain(`name: "${m}"`);
      expect(alerts).toContain(m);
    }
    expect(read("apps", "api", "src", "assistant", "assistant-llm.service.ts")).toContain('observeAiCall("provider_error"');
    expect(read("apps", "api", "src", "pipeline", "ocr.ts")).toContain("observeOcr(");
    expect(JSON.parse(read("apps", "api", "package.json")).dependencies["prom-client"]).toBeTruthy();
  });
});

describe("Faz 4 — sertleştirme", () => {
  it("global oran sınırı guard'ı JwtAuthGuard'dan önce; parola gücü 4 noktada; rotasyon betiği", () => {
    const app = read("apps", "api", "src", "app.module.ts");
    expect(app.indexOf("useClass: GlobalRateLimitGuard")).toBeLessThan(app.indexOf("useClass: JwtAuthGuard"));
    for (const f of [["users", "users.service.ts"], ["auth", "auth.service.ts"], ["auth", "password-reset.service.ts"], ["portal", "portal-auth.service.ts"]]) {
      expect(read("apps", "api", "src", ...f)).toContain("assertPasswordStrength(");
    }
    expect(JSON.parse(read("apps", "api", "package.json")).dependencies.zxcvbn).toBeTruthy();
    expect(JSON.parse(read("apps", "api", "package.json")).scripts["key:rotate"]).toContain("rotate-master-key");
    expect(read("apps", "api", "src", "scripts", "rotate-master-key.ts")).toContain("eInvoiceSettings");
  });

  it("yedek/geri yükleme betikleri, compose backup + caddy servisleri, Caddyfile IP kısıtı, CD iş akışı", () => {
    expect(existsSync(join(root, "scripts", "prod-restore.sh"))).toBe(true);
    expect(existsSync(join(root, "scripts", "backup-container.sh"))).toBe(true);
    const compose = read("docker-compose.prod.yml");
    expect(compose).toContain("nomosos-prod-backup");
    expect(compose).toContain("profiles: [edge]");
    expect(compose).toContain("${IMAGE_REGISTRY:-nomosos}/api");
    expect(compose).toContain("BACKUP_STATUS_FILE: /backups/last-success.json");
    const caddy = read("deploy", "Caddyfile");
    expect(caddy).toContain("remote_ip {$ADMIN_ALLOWED_IPS}");
    expect(caddy).toContain("Strict-Transport-Security");
    const deploy = read(".github", "workflows", "deploy.yml");
    expect(deploy).toContain('tags: ["v*"]');
    expect(deploy).toContain("prod-migrate.sh");
    expect(deploy).toContain("/api/v1/health/ready");
    expect(read("scripts", "backup-container.sh")).toContain("last-success.json");
  });

  it("biçim/husky/lint-staged, CHANGELOG/CONTRIBUTING, README ve dağıtım belgesi güncel; kök ekran görüntüleri yok", () => {
    expect(existsSync(join(root, ".prettierrc"))).toBe(true);
    expect(existsSync(join(root, ".husky", "pre-commit"))).toBe(true);
    expect(existsSync(join(root, "CHANGELOG.md"))).toBe(true);
    expect(existsSync(join(root, "CONTRIBUTING.md"))).toBe(true);
    expect(JSON.parse(read("package.json")).scripts.prepare).toBe("husky");
    expect(read("README.md")).toContain("Faz 4");
    const dep = read("docs", "uretim-dagitimi.md");
    expect(dep).toContain("/health/ready");
    expect(dep).toContain("prod-restore.sh");
    expect(dep).not.toContain("Kuyruk yoktur");
    expect(existsSync(join(root, "duman-diff-sayfa-pencereli.png"))).toBe(false);
  });
});
