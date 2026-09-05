/**
 * BÜRO KULLANICISI PAROLA SIFIRLAMA (Faz 2) — `POST /auth/forgot-password`,
 * `POST /auth/reset-password`.
 *
 * Portal deseninin (portal-auth.service) büro tarafı: ham jeton yalnız
 * e-postada; veritabanında SHA-256 özeti (`PasswordResetToken.tokenHash`).
 * Yanıt her zaman jeneriktir (hesap var/yok sızdırılmaz). Jeton 30 dakika
 * geçerli, tek kullanımlık; sıfırlama tüm oturumları düşürür ve kilidi açar.
 *
 * SMTP tanımsızsa bağlantı gönderilemez; kullanıcıya yine jenerik yanıt döner,
 * günlüğe uyarı yazılır. Geliştirmede `AUTH_DEV_ECHO_RESET_TOKEN=true` jetonu
 * yanıtta döndürür (üretimde etkisiz).
 */

import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MailService } from "../mail/mail.service";
import { webOrigin } from "../common/public-urls";
import { CLEARED_LOCKOUT } from "../common/account-lockout";
import { PASSWORD_HASH_ROUNDS } from "./auth.constants";
import { assertPasswordStrength } from "../common/password-strength";

export const RESET_TTL_MINUTES = 30;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
});
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(32).max(128),
  newPassword: z
    .string()
    .min(10, "Yeni parola en az 10 karakter olmalıdır.")
    .max(128)
    .regex(/[A-Za-z]/, "Parola en az bir harf içermelidir.")
    .regex(/\d/, "Parola en az bir rakam içermelidir."),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export function newResetToken(): string {
  return randomBytes(32).toString("hex");
}
export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export function devEchoResetToken(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_ECHO_RESET_TOKEN === "true";
}

const GENERIC = {
  ok: true as const,
  message: "Bu e-posta kayıtlıysa parola sıfırlama bağlantısı gönderildi. Gelen kutunuzu (ve istenmeyen klasörünü) kontrol edin.",
};

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async forgot(input: ForgotPasswordInput, ip: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { email: input.email },
      select: { id: true, tenantId: true, email: true, fullName: true, isActive: true },
    });
    if (!user || !user.isActive) return GENERIC;

    const raw = newResetToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
    await this.prisma.client.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.client.passwordResetToken.create({
      data: { tenantId: user.tenantId, userId: user.id, tokenHash: hashResetToken(raw), expiresAt, requestIp: ip },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      entity: "User",
      entityId: user.id,
      detail: `${user.email} — IP ${ip}`,
    });

    const link = `${webOrigin()}/sifre-sifirla?token=${raw}`;
    const res = await this.mail.send({
      to: user.email,
      subject: "NomosOS — parola sıfırlama",
      text:
        `Merhaba ${user.fullName},\n\nNomosOS hesabınız için parola sıfırlama istendi. ` +
        `Bağlantı ${RESET_TTL_MINUTES} dakika geçerlidir ve bir kez kullanılabilir:\n\n${link}\n\n` +
        "Bu isteği siz yapmadıysanız bu iletiyi yok sayın; parolanız değişmez.",
    });
    if (!res.sent) this.logger.warn(`Parola sıfırlama e-postası gönderilemedi (${user.email}): ${res.reason}`);

    if (devEchoResetToken()) {
      this.logger.warn("AUTH_DEV_ECHO_RESET_TOKEN açık: sıfırlama jetonu yanıtta dönüyor (üretimde etkisiz).");
      return { ...GENERIC, devResetToken: raw, expiresAt, mailSent: res.sent };
    }
    return GENERIC;
  }

  async reset(input: ResetPasswordInput, ip: string) {
    const record = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(input.token) },
      select: { id: true, tenantId: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException("Sıfırlama bağlantısı geçersiz ya da süresi dolmuş. Yeniden isteyin.");
    }
    const user = await this.prisma.client.user.findUnique({
      where: { id: record.userId },
      select: { id: true, email: true, fullName: true, isActive: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException("Hesap etkin değil.");
    // Faz 4: parola gücü.
    assertPasswordStrength(input.newPassword, [user.email, user.fullName]);

    await this.prisma.client.$transaction([
      this.prisma.client.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.client.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS),
          sessionsValidFrom: new Date(),
          ...CLEARED_LOCKOUT,
        },
      }),
    ]);
    await this.audit.log({
      tenantId: record.tenantId,
      userId: user.id,
      action: "PASSWORD_RESET",
      entity: "User",
      entityId: user.id,
      detail: `${user.email} — bağlantıyla sıfırlandı (IP ${ip}); tüm oturumlar düşürüldü.`,
    });
    return { ok: true as const, message: "Parolanız güncellendi. Yeni parolanızla giriş yapın." };
  }
}
