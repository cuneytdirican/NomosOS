/**
 * Entegrasyon testi yardımcıları — gerçek AppModule'ü ayağa kaldırır (Faz 5).
 *
 * `INTEGRATION_DATABASE_URL` yoksa `integrationEnabled()` false döner ve test dosyaları
 * `describe.skipIf` ile atlanır. Uygulama, `main.ts` ile aynı global öneki, filtreyi ve
 * istek bağlamı ara katmanını kullanır; Swagger ve dinleme portu yoktur (supertest doğrudan
 * Express örneğine bağlanır).
 */
import "reflect-metadata";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";

export function integrationEnabled(): boolean {
  return Boolean(process.env.INTEGRATION_DATABASE_URL?.trim());
}

export const DEMO = {
  partner: { email: "partner@demo.nomosos.local", password: "Demo1234!" },
  avukat: { email: "avukat@demo.nomosos.local", password: "Demo1234!" },
  platform: { email: "superadmin@nomosos.local", password: "Demo1234!" },
};

let app: INestApplication | null = null;

export async function bootApp(): Promise<INestApplication> {
  if (app) return app;
  process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "entegrasyon-testi-icin-atilabilir-jwt-anahtari-0123456789";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.SCHEDULER_DISABLED = process.env.SCHEDULER_DISABLED || "true";
  process.env.RATE_LIMIT_BACKEND = "memory";
  process.env.MODULE_ACCESS_CACHE_TTL_MS = "0"; // plan değişikliği anında etkili (test 8)
  process.env.TRUSTED_PROXY_HOPS = "0";
  process.env.PLATFORM_REQUIRE_2FA = "false";
  process.env.LOG_FORMAT = "json";
  process.env.LOG_LEVEL = "warn";
  process.env.ODEME_SAGLAYICI = process.env.ODEME_SAGLAYICI || "SIMULASYON";
  process.env.S3_BUCKET = process.env.S3_BUCKET || "nomosos-belgeler";

  const { AppModule } = await import("../src/app.module");
  const { AllExceptionsFilter } = await import("../src/common/filters/all-exceptions.filter");
  const { requestContextMiddleware } = await import("../src/common/request-context");
  const { ADMIN_ROUTE_PREFIX } = await import("../src/platform/platform.constants");

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: ["error", "warn"] });
  nest.setGlobalPrefix("api/v1", {
    exclude: [
      { path: `${ADMIN_ROUTE_PREFIX}/(.*)`, method: RequestMethod.ALL },
      { path: "metrics", method: RequestMethod.GET },
    ],
  });
  nest.use(requestContextMiddleware({ log: () => undefined }));
  nest.useBodyParser("json", { limit: "1mb" });
  nest.useGlobalFilters(new AllExceptionsFilter());
  await nest.init();
  app = nest;
  return nest;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
}

export function http() {
  if (!app) throw new Error("bootApp() önce çağrılmalı");
  return request(app.getHttpServer());
}

export async function loginTenant(email = DEMO.partner.email, password = DEMO.partner.password): Promise<string> {
  const res = await http().post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200 && res.status !== 201) throw new Error(`giriş başarısız (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  const token = res.body.accessToken as string | undefined;
  if (!token) throw new Error("accessToken yok (2FA challenge?)");
  return token;
}

export async function loginPlatform(): Promise<string> {
  const res = await http().post("/api/admin/v1/auth/login").send(DEMO.platform);
  const token = res.body.accessToken as string | undefined;
  if (!token) throw new Error(`platform girişi başarısız (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  return token;
}
