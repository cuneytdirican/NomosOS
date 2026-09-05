/**
 * KİRACI 2FA (TOTP) — servis testleri (Enterprise++ güvenlik paketi).
 *
 * Korunan taahhütler:
 *  1. Parola doğru + 2FA kurulu → oturum DEĞİL challenge döner (twoFactorRequired).
 *  2. Büro politikası zorunlu + 2FA yok → kurulum challenge'ı (twoFactorSetupRequired).
 *  3. Kurulum: anahtar DB'ye yazılmaz; doğru kodla verify → kalıcılaşır + oturum.
 *  4. Aynı kod ikinci kez KABUL EDİLMEZ (tekrar oynatma).
 *  5. Hatalı kod hesap kilidi sayacını işletir; deneme sınırı aşılınca challenge iptal.
 *  6. Politika zorunluysa kullanıcı 2FA'yı kapatamaz (403).
 *  7. Gizli anahtar hiçbir yanıtta düz metin dönmez (yalnız kurulum anındaki manualEntryKey).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { authenticator } from "otplib";
import * as bcrypt from "bcryptjs";
import { TwoFactorService } from "./two-factor.service";
import { SessionService } from "./session.service";
import type { UserSessionsService } from "./user-sessions.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import { resetAttemptCounterForTests } from "./attempt-counter";

// Şifreleme anahtarı (encryptSecret/decryptSecret MASTER_ENCRYPTION_KEY ister).
beforeAll(() => {
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? "a".repeat(64);
  resetAttemptCounterForTests();
});

const jwt = new JwtService({ secret: "test-secret-".repeat(4) });

interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
  passwordHash: string;
  isActive: boolean;
  twoFactorSecret: string | null;
  lastTotpCounter: number | null;
  failedAttempts: number;
  failureWindowEndsAt: Date | null;
  lockedUntil: Date | null;
  sessionsValidFrom: Date | null;
}

function harness(opts: { require2fa?: boolean; secret?: string | null } = {}) {
  const user: UserRow = {
    id: "u-1",
    tenantId: "t-1",
    email: "av@buro.av.tr",
    fullName: "Av. Test",
    role: "AVUKAT",
    passwordHash: bcrypt.hashSync("Parola-123456", 4),
    isActive: true,
    twoFactorSecret: null,
    lastTotpCounter: null,
    failedAttempts: 0,
    failureWindowEndsAt: null,
    lockedUntil: null,
    sessionsValidFrom: null,
  };
  const audit: string[] = [];
  const client = {
    user: {
      findUnique: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: { data: Partial<UserRow> }) => {
        Object.assign(user, data);
        return { ...user };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { OR?: unknown[] }; data: Partial<UserRow> }) => {
        // lastTotpCounter koşullu yazımı: null ya da küçükse yaz.
        if ("lastTotpCounter" in data) {
          const next = data.lastTotpCounter as number;
          if (user.lastTotpCounter === null || user.lastTotpCounter < next) {
            user.lastTotpCounter = next;
            return { count: 1 };
          }
          return { count: 0 };
        }
        Object.assign(user, data);
        void where;
        return { count: 1 };
      }),
    },
    tenant: {
      findUnique: vi.fn(async () => ({ require2fa: opts.require2fa ?? false, sessionMaxHours: null })),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  const auditSvc = { log: vi.fn(async (e: { action: string }) => void audit.push(e.action)) } as unknown as AuditService;
  const sessions = { record: vi.fn(async () => undefined) } as unknown as UserSessionsService;
  const session = new SessionService(prisma, jwt, auditSvc, sessions);
  const svc = new TwoFactorService(prisma, jwt, auditSvc, session);
  return { svc, user, audit, setSecretEncrypted: (enc: string) => void (user.twoFactorSecret = enc) };
}

describe("loginChallenge", () => {
  it("2FA kurulu değil, politika yok → null (normal oturum)", async () => {
    const h = harness();
    expect(await h.svc.loginChallenge(h.user as never)).toBeNull();
  });

  it("büro politikası zorunlu + 2FA yok → kurulum challenge'ı", async () => {
    const h = harness({ require2fa: true });
    const c = await h.svc.loginChallenge(h.user as never);
    expect(c?.twoFactorSetupRequired).toBe(true);
    expect(c?.challengeToken).toBeTruthy();
  });
});

describe("kurulum → doğrulama → giriş", () => {
  it("anahtar kurulumda DB'ye yazılmaz; doğru kodla kalıcılaşır ve oturum üretir; aynı kod tekrar reddedilir", async () => {
    const h = harness();
    const setup = await h.svc.setupWithSession(
      { userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as never,
      "Parola-123456",
    );
    expect(setup.qrDataUrl.startsWith("data:image/png")).toBe(true);
    expect(setup.manualEntryKey.length).toBeGreaterThan(10);
    // Henüz kalıcı değil.
    expect(h.user.twoFactorSecret).toBeNull();

    const code = authenticator.generate(setup.manualEntryKey);
    const session = await h.svc.verify({ challengeToken: setup.setupToken, code });
    expect(session.accessToken).toBeTruthy();
    expect(session.user.email).toBe("av@buro.av.tr");
    // Kalıcılaştı ve ŞİFRELİ (düz anahtar değil).
    expect(h.user.twoFactorSecret).not.toBeNull();
    expect(h.user.twoFactorSecret).not.toBe(setup.manualEntryKey);
    expect(h.audit).toContain("USER_2FA_ENABLED");

    // Artık giriş challenge ister.
    const c = await h.svc.loginChallenge(h.user as never);
    expect(c?.twoFactorRequired).toBe(true);

    // TEKRAR OYNATMA: aynı kod ikinci kez kabul edilmez.
    await expect(h.svc.verify({ challengeToken: c!.challengeToken, code })).rejects.toThrow(/zaten kullanılmış/);
  });

  it("yanlış parola ile kurulum başlatılamaz", async () => {
    const h = harness();
    await expect(
      h.svc.setupWithSession({ userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as never, "yanlis"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.user.failedAttempts).toBe(1);
  });

  it("hatalı kod deneme sınırını aşınca challenge iptal edilir", async () => {
    const h = harness();
    const setup = await h.svc.setupWithSession({ userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as never, "Parola-123456");
    let lastMessage = "";
    for (let i = 0; i < 6; i += 1) {
      try {
        await h.svc.verify({ challengeToken: setup.setupToken, code: "000000" });
      } catch (err) {
        lastMessage = (err as Error).message;
      }
    }
    expect(lastMessage).toContain("iptal edildi");
    expect(h.user.twoFactorSecret).toBeNull();
  });
});

describe("kapatma", () => {
  it("büro politikası zorunluysa kullanıcı kapatamaz (403)", async () => {
    const h = harness({ require2fa: true });
    const setup = await h.svc.setupWithChallenge((await h.svc.loginChallenge(h.user as never))!.challengeToken);
    await h.svc.verify({ challengeToken: setup.setupToken, code: authenticator.generate(setup.manualEntryKey) });
    await expect(
      h.svc.disable({ userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as never, {
        currentPassword: "Parola-123456",
        code: authenticator.generate(setup.manualEntryKey),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("politika yoksa parola + güncel kodla kapanır; yönetici sıfırlaması oturumları düşürür", async () => {
    const h = harness();
    const setup = await h.svc.setupWithSession({ userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as never, "Parola-123456");
    await h.svc.verify({ challengeToken: setup.setupToken, code: authenticator.generate(setup.manualEntryKey) });
    // Bir sonraki adımı bekle (aynı kod tekrar sayılır) — sayaç ileri: lastTotpCounter'ı geri al.
    h.user.lastTotpCounter = null;
    const res = await h.svc.disable({ userId: "u-1", tenantId: "t-1", role: "AVUKAT" } as never, {
      currentPassword: "Parola-123456",
      code: authenticator.generate(setup.manualEntryKey),
    });
    expect(res.ok).toBe(true);
    expect(h.user.twoFactorSecret).toBeNull();

    await h.svc.adminReset({ userId: "admin", tenantId: "t-1", role: "ADMIN" } as never, "u-1", "av@buro.av.tr");
    expect(h.user.sessionsValidFrom).toBeInstanceOf(Date);
    expect(h.audit).toContain("USER_2FA_RESET");
  });
});
