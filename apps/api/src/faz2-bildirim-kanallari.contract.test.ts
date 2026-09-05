/**
 * FAZ 2 — BİLDİRİM GERÇEK KANALLAR sözleşme testleri: SMTP/MailService, kanal
 * kayıt defteri (Netgsm/WhatsApp), Expo push, dağıtım + budama işleri, büro parola
 * sıfırlama, demo talebi e-postası, duyuru ucu + web şeridi, Mailpit test servisi.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_ROUTES, NOTIFICATION_ROUTES } from "@nomosos/shared";
import { JOB_KEYS } from "./scheduler/scheduler.constants";

const root = join(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");
const schema = read("packages", "db", "prisma", "schema.prisma");

describe("Faz 2 — SMTP + kanal kayıt defteri", () => {
  it("nodemailer bağımlılığı; MailModule @Global; registry env'e göre SMTP/Netgsm/WhatsApp kaydeder", () => {
    expect(JSON.parse(read("apps", "api", "package.json")).dependencies.nodemailer).toBeTruthy();
    expect(read("apps", "api", "src", "mail", "mail.module.ts")).toContain("@Global()");
    expect(read("apps", "api", "src", "app.module.ts")).toContain("MailModule");
    const reg = read("apps", "api", "src", "communication", "channel-providers.ts");
    expect(reg).toContain("new SmtpChannelProvider(mail)");
    expect(reg).toContain("new NetgsmSmsProvider(sms)");
    expect(reg).toContain("new WhatsAppCloudProvider(wa)");
    const ext = read("apps", "api", "src", "communication", "external-providers.ts");
    expect(ext).toContain("/sms/rest/v2/send");
    expect(ext).toContain("graph.facebook.com");
  });
});

describe("Faz 2 — push + dağıtım işleri", () => {
  it("PUSH_PROVIDER=expo → ExpoPushProvider; işler kayıtlı; outbox dispatchedAt", () => {
    const mod = read("apps", "api", "src", "scheduler", "scheduler.module.ts");
    expect(mod).toContain('process.env.PUSH_PROVIDER === "expo" ? new ExpoPushProvider() : new NoopPushProvider()');
    expect(JOB_KEYS.BILDIRIM_DAGITIMI).toBe("bildirim-dagitimi-5dk");
    expect(JOB_KEYS.BILDIRIM_TEMIZLIGI).toBe("bildirim-temizligi-gunluk");
    const registry = read("apps", "api", "src", "scheduler", "job-registry.service.ts");
    expect(registry).toContain("bildirimDagitimi");
    expect(registry).toContain("bildirimTemizligi");
    expect(schema).toContain("dispatchedAt DateTime?");
    expect(read("packages", "db", "prisma", "migrations", "20260925100000_faz2_bildirim_kanallari", "migration.sql")).toContain('ADD COLUMN "dispatchedAt"');
    // Mobil: gerçek Expo jetonu
    const pt = read("apps", "mobile", "src", "api", "push-token.ts");
    expect(pt).toContain("getExpoPushTokenAsync");
    expect(pt).toContain("PUSH_PROVIDER_CONFIGURED = true");
    expect(JSON.parse(read("apps", "mobile", "package.json")).dependencies["expo-notifications"]).toBeTruthy();
  });
});

describe("Faz 2 — parola sıfırlama + demo + duyuru", () => {
  it("uçlar, model, web sayfaları, giriş bağlantısı, duyuru şeridi", () => {
    expect(AUTH_ROUTES.forgotPassword).toBe("/auth/forgot-password");
    expect(AUTH_ROUTES.resetPassword).toBe("/auth/reset-password");
    expect(NOTIFICATION_ROUTES.announcements).toBe("/notifications/announcements");
    const ctrl = read("apps", "api", "src", "auth", "auth.controller.ts");
    expect(ctrl).toContain('@Post("auth/forgot-password")');
    expect(ctrl).toContain('@Post("auth/reset-password")');
    expect(schema).toContain("model PasswordResetToken");
    expect(read("apps", "api", "src", "demo-talep", "demo-talep.service.ts")).toContain("PLATFORM_NOTIFY_EMAIL");
    expect(read("apps", "api", "src", "scheduler", "notifications.controller.ts")).toContain('@Get("announcements")');
    expect(read("apps", "web", "src", "app", "sifre-unuttum", "page.tsx")).toContain("/auth/forgot-password");
    expect(read("apps", "web", "src", "app", "sifre-sifirla", "page.tsx")).toContain("/auth/reset-password");
    expect(read("apps", "web", "src", "app", "giris", "page.tsx")).toContain('href="/sifre-unuttum"');
    expect(read("apps", "web", "src", "app", "app", "layout.tsx")).toContain("<AnnouncementBanner />");
  });

  it("test yığınında Mailpit + SMTP; prod compose SMTP değişkenlerini geçirir; .env.example belgeler", () => {
    const test = read("docker-compose.test.yml");
    expect(test).toContain("axllent/mailpit");
    expect(test).toContain('SMTP_HOST: "mailpit"');
    const prod = read("docker-compose.prod.yml");
    expect(prod).toContain("SMTP_HOST: ${SMTP_HOST:-}");
    expect(prod).toContain("PUSH_PROVIDER: ${PUSH_PROVIDER:-}");
    const env = read(".env.example");
    for (const k of ["SMTP_HOST", "SMS_PROVIDER_BASE_URL", "WHATSAPP_PHONE_NUMBER_ID", "PUSH_PROVIDER", "PLATFORM_NOTIFY_EMAIL"]) expect(env).toContain(k);
  });
});
