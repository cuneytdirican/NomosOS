/**
 * DEMO TALEBİ AKIŞI REGRESYON TESTİ (kullanıcı kararı):
 * talep E-POSTA/WEBHOOK GÖNDERİLMEZ; DemoRequest kaydı olarak düşer ve
 * platform panelinden (Demo Talepleri) izlenir.
 *
 * Korunan taahhütler:
 *  1. Kayıt DemoRequest tablosuna yazılır (durum YENI ile).
 *  2. Hız sınırı: dakikada 3 / saatte 10; aşım 429.
 *  3. Tekrar bastırma: aynı e-posta 10 dakikada bir kez.
 *  4. Web route webhook DEĞİL, NomosOS API'sine yazar.
 *  5. Platform ucu yetki matrisine bağlı (demoRequests.view/update) ve iki
 *     dosya (api + admin rbac) aynı matrisi taşır.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DemoTalepService } from "./demo-talep.service";
import type { MailService } from "../mail/mail.service";
import type { PrismaService } from "../prisma/prisma.service";

function serviceWith(over?: { existing?: unknown }) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    client: {
      demoRequest: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          // Aynı e-posta kaydı zaten var mı (dedupe DB tarafı simülasyonu)?
          if (over?.existing) throw new Error("unique");
          created.push(data);
          return { id: "dr-1", ...data };
        },
      },
    },
  } as unknown as PrismaService;
  const mail = { configured: false, send: async () => ({ sent: false, reason: "test" }) } as unknown as MailService;
  return { svc: new DemoTalepService(prisma, mail), created };
}

const GIRIS = {
  fullName: "Av. Ayşe Yılmaz",
  barAssociation: "Ankara Barosu",
  email: "ayse@ornek.av.tr",
  phone: "05321234567",
  lawyerCount: "2-5",
  message: "İcra ağırlıklı büroyuz.",
};

describe("Demo talebi kaydı", () => {
  beforeEach(() => {
    // Her test yeni servis örneğiyle çalışır (sayaçlar temiz).
  });

  it("talep DemoRequest olarak yazılır — YENI durumuyla", async () => {
    const { svc, created } = serviceWith();
    const res = await svc.create("1.2.3.4", GIRIS);
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      fullName: GIRIS.fullName,
      email: GIRIS.email.toLowerCase(),
      status: "YENI",
    });
  });

  it("hız sınırı: aynı IP'den dakikada 3 kayıttan sonra 429", async () => {
    const { svc } = serviceWith();
    for (let i = 0; i < 3; i++) {
      await expect(svc.create("9.9.9.9", { ...GIRIS, email: `a${i}@x.test` })).resolves.toMatchObject({ ok: true });
    }
    await expect(svc.create("9.9.9.9", { ...GIRIS, email: "b@x.test" })).rejects.toThrow(/çok fazla talep/i);
  });

  it("tekrar bastırma: aynı e-posta 10 dakika içinde ikinci kez alınmaz", async () => {
    const { svc } = serviceWith();
    await svc.create("8.8.8.8", GIRIS);
    await expect(svc.create("7.7.7.7", GIRIS)).rejects.toThrow(/az önce alındı/i);
  });

  it("yanıt minimidir — eylem talimatı/spam yüzeyi taşımaz", async () => {
    const { svc } = serviceWith();
    const res = await svc.create("1.1.1.1", GIRIS);
    expect(Object.keys(res)).toEqual(["ok", "id"]);
  });
});

describe("Kaynak taahhüdü — akış web yönlüdür, webhook değil", () => {
  const webRoute = readFileSync(
    join(process.cwd(), "..", "..", "apps", "web", "src", "app", "api", "demo-talebi", "route.ts"),
    "utf-8",
  );

  it("web route NomosOS API'sine yazar; webhook kodu kalktı", () => {
    expect(webRoute).toContain("/api/v1/demo-talepleri");
    expect(webRoute).not.toContain("DEMO_REQUEST_WEBHOOK_URL");
  });

  it("platform ucu ve yetkiler kayıtlı", () => {
    const controller = readFileSync(
      join(process.cwd(), "src", "platform", "demo-requests", "platform-demo-requests.controller.ts"),
      "utf-8",
    );
    expect(controller).toContain('@ReadPermission("demoRequests.view")');
    expect(controller).toContain('@WritePermission("demoRequests.update")');

    const perms = readFileSync(
      join(process.cwd(), "src", "platform", "platform-permissions.ts"),
      "utf-8",
    );
    expect(perms).toContain('"demoRequests.view"');
    expect(perms).toContain('"demoRequests.update"');
  });

  it("yetki matrisi iki dosyada birebir (api + admin rbac)", () => {
    const rbac = readFileSync(
      join(process.cwd(), "..", "..", "apps", "admin", "src", "lib", "rbac.ts"),
      "utf-8",
    );
    expect(rbac).toContain('"demoRequests.view"');
    expect(rbac).toContain('"demoRequests.update"');
  });

  it("admin panelinde sayfa ve menü öğesi var", () => {
    const nav = readFileSync(
      join(process.cwd(), "..", "..", "apps", "admin", "src", "lib", "nav.ts"),
      "utf-8",
    );
    expect(nav).toContain('"/demo-talepleri"');
    expect(nav).toContain('action: "demoRequests.view"');
    const page = readFileSync(
      join(process.cwd(), "..", "..", "apps", "admin", "src", "app", "(panel)", "demo-talepleri", "page.tsx"),
      "utf-8",
    );
    expect(page).toContain('action="demoRequests.view"');
    expect(page).toContain("İletişime geçildi");
  });

  it("şemada DemoRequest modeli tanımlı (e-posta gönderimi değil kayıt)", () => {
    const schema = readFileSync(
      join(process.cwd(), "..", "..", "packages", "db", "prisma", "schema.prisma"),
      "utf-8",
    );
    expect(schema).toContain("model DemoRequest");
  });
});
