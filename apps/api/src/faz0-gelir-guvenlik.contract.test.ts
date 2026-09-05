/**
 * FAZ 0 — GELİR KAÇAĞI + GÜVENLİK tek satırlık kritikler (sözleşme testleri).
 * Üç persona boşluk analizinden (5 Eylül 2026) çıkan, kanıtı dosya:satır olan
 * bulguların kapandığını kaynak/yapılandırma üzerinden doğrular.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_TASK_TYPES } from "@nomosos/shared";

const root = join(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");

describe("Faz 0 — üretim yapılandırması", () => {
  const prod = read("docker-compose.prod.yml");
  it("AI_TIMEOUT_MS tek kez tanımlı (ikinci tanım 60 sn'ye eziyordu)", () => {
    expect(prod.match(/^\s*AI_TIMEOUT_MS:/gm)?.length).toBe(1);
    expect(prod).toContain("AI_TIMEOUT_MS: ${AI_TIMEOUT_MS:-180000}");
  });
  it("API_PUBLIC_URL zorunlu, METRICS_TOKEN geçirilir, web demo sayfası derlemede kapalı", () => {
    expect(prod).toMatch(/API_PUBLIC_URL: \$\{API_PUBLIC_URL:\?/);
    expect(prod).toContain("METRICS_TOKEN: ${METRICS_TOKEN");
    expect(prod).toMatch(/NEXT_PUBLIC_DISABLE_DEMO: "?1"?/);
    const dockerfile = read("apps", "web", "Dockerfile");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_DISABLE_DEMO");
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_DISABLE_DEMO=$NEXT_PUBLIC_DISABLE_DEMO");
    const env = read("docker-compose.prod.env.example");
    for (const k of ["API_PUBLIC_URL=", "METRICS_TOKEN="]) expect(env).toContain(k);
  });
  it("seed üretimde açık kapı ile çalışmaz", () => {
    const seed = read("packages", "db", "src", "seed.ts");
    expect(seed).toContain('process.env.NODE_ENV === "production"');
    expect(seed).toContain("SEED_ALLOW_PROD");
  });
});

describe("Faz 0 — güvenlik", () => {
  it("sohbet eki boyut sınırı Multer'da, tür doğrulaması her iki yolda", () => {
    const ctrl = read("apps", "api", "src", "chat", "chat.controller.ts");
    expect(ctrl).toMatch(/FileInterceptor\("file", \{ limits: \{ fileSize: MAX_UPLOAD_BYTES \} \}\)/);
    const svc = read("apps", "api", "src", "chat", "chat.service.ts");
    expect(svc.match(/assertAttachmentType\(/g)?.length).toBeGreaterThanOrEqual(3); // tanım + presign + multipart
    expect(svc).toContain("validateUpload(");
    expect(svc).toContain("UnsupportedMediaTypeException");
  });
});

describe("Faz 0 — gelir kaçağı", () => {
  it("kiracı açılışında kredi cüzdanı + TAHSIS hareketi aynı işlemde; açılışta cüzdansız kiracı yedeklemesi", () => {
    const exec = read("apps", "api", "src", "platform", "approvals", "platform-approval-executor.service.ts");
    expect(exec).toContain("tx.creditWallet.create(");
    expect(exec).toContain('type: "TAHSIS"');
    const startup = read("apps", "api", "src", "credits", "credits-startup.service.ts");
    expect(startup).toContain("ensureWalletsForAllTenants(");
  });
  it("koltuk sınırı users.create ve yeniden etkinleştirmede", () => {
    const users = read("apps", "api", "src", "users", "users.service.ts");
    expect(users.match(/assertSeatAvailable\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("TRIAL süresi / PAST_DUE toleransı guard'da 402", () => {
    const guard = read("apps", "api", "src", "common", "guards", "tenant-status.guard.ts");
    expect(guard).toContain("PAYMENT_REQUIRED");
    expect(guard).toContain("trialEndsAt");
    expect(guard).toContain("PAST_DUE_GRACE_DAYS");
  });
  it("seed fiyat listesi kataloğun TAMAMINI kapsar (fiyatsız kredili uç bedava çalışmasın)", () => {
    const seed = read("packages", "db", "src", "seed.ts");
    const missing = AI_TASK_TYPES.filter((t) => !seed.includes(`taskType: "${t}"`));
    expect(missing, `seed'de fiyatı olmayan görev tipleri: ${missing.join(", ")}`).toEqual([]);
  });
});
