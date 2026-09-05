import { afterEach, describe, expect, it, vi } from "vitest";
import * as bcrypt from "bcryptjs";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { MailService } from "../mail/mail.service";
import { PasswordResetService, forgotPasswordSchema, hashResetToken, resetPasswordSchema } from "./password-reset.service";

function build(user: { id: string; tenantId: string; email: string; fullName: string; isActive: boolean } | null) {
  const tokens: Array<Record<string, unknown>> = [];
  const userUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    client: {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
          user && (where.email === user.email || where.id === user.id) ? user : null),
        update: vi.fn(async (a: { data: Record<string, unknown> }) => { userUpdates.push(a.data); return {}; }),
      },
      passwordResetToken: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { tokens.push({ ...data, id: "prt-1", usedAt: null }); return data; }),
        findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(tokens[0], data); return {}; }),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  } as unknown as PrismaService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  const mailSend = vi.fn(async () => ({ sent: true, messageId: "<m>" }));
  const mail = { configured: true, send: mailSend } as unknown as MailService;
  return { svc: new PasswordResetService(prisma, audit, mail), tokens, userUpdates, mailSend, audit };
}

const USER = { id: "u1", tenantId: "t1", email: "av@buro.tr", fullName: "Av. Ayşe", isActive: true };

afterEach(() => {
  delete process.env.AUTH_DEV_ECHO_RESET_TOKEN;
});

describe("PasswordResetService", () => {
  it("bilinmeyen e-posta: jenerik yanıt, e-posta yok, jeton yok", async () => {
    const b = build(null);
    const r = await b.svc.forgot({ email: "yok@x.tr" }, "1.1.1.1");
    expect(r.ok).toBe(true);
    expect(b.mailSend).not.toHaveBeenCalled();
    expect(b.tokens).toHaveLength(0);
  });

  it("bilinen kullanıcı: özet saklanır, ham jeton yalnız e-postada; dev echo yanıtta döner", async () => {
    process.env.AUTH_DEV_ECHO_RESET_TOKEN = "true";
    const b = build(USER);
    const r = (await b.svc.forgot({ email: "av@buro.tr" }, "1.1.1.1")) as { devResetToken?: string };
    expect(r.devResetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(b.tokens[0].tokenHash).toBe(hashResetToken(r.devResetToken as string));
    expect(b.tokens[0].tokenHash).not.toBe(r.devResetToken);
    const mailArg = (b.mailSend.mock.calls[0] as unknown[])[0] as { to: string; text: string };
    expect(mailArg.to).toBe("av@buro.tr");
    expect(mailArg.text).toContain(`/sifre-sifirla?token=${r.devResetToken}`);
    expect(b.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "PASSWORD_RESET_REQUESTED" }));
  });

  it("reset: geçerli jeton parolayı günceller, oturumları düşürür, jetonu tüketir; ikinci kullanım 401", async () => {
    process.env.AUTH_DEV_ECHO_RESET_TOKEN = "true";
    const b = build(USER);
    const { devResetToken } = (await b.svc.forgot({ email: "av@buro.tr" }, "ip")) as { devResetToken: string };
    const r = await b.svc.reset({ token: devResetToken, newPassword: "YeniParola2026" }, "ip");
    expect(r.ok).toBe(true);
    expect(b.userUpdates[0].sessionsValidFrom).toBeInstanceOf(Date);
    expect(await bcrypt.compare("YeniParola2026", b.userUpdates[0].passwordHash as string)).toBe(true);
    expect(b.tokens[0].usedAt).toBeInstanceOf(Date);
    await expect(b.svc.reset({ token: devResetToken, newPassword: "YeniParola2026" }, "ip")).rejects.toThrow("geçersiz");
  });

  it("süresi dolmuş ya da uydurma jeton 401", async () => {
    const b = build(USER);
    await expect(b.svc.reset({ token: "a".repeat(64), newPassword: "YeniParola2026" }, "ip")).rejects.toThrow("geçersiz");
    b.tokens.push({ tokenHash: hashResetToken("b".repeat(64)), expiresAt: new Date(Date.now() - 1000), usedAt: null, userId: "u1", tenantId: "t1", id: "x" });
    await expect(b.svc.reset({ token: "b".repeat(64), newPassword: "YeniParola2026" }, "ip")).rejects.toThrow("geçersiz");
  });

  it("şemalar: e-posta normalize edilir; parola en az 10 karakter + harf + rakam", () => {
    expect(forgotPasswordSchema.parse({ email: "  AV@Buro.TR " }).email).toBe("av@buro.tr");
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(64), newPassword: "kisa1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(64), newPassword: "sadeceharflerrr" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(64), newPassword: "Guclu2026Parola" }).success).toBe(true);
  });
});
