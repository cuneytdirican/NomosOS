/**
 * KİRACI (BÜRO) İKİ ADIMLI DOĞRULAMA — TOTP (Enterprise++ güvenlik paketi).
 *
 * Platform panelinde (PlatformAuthService) 2FA vardı; büronun TÜM verisine
 * bakan avukat hesabında YOKTU. Bu servis aynı disiplini kiracıya taşır:
 *
 *  - Gizli anahtar AES-256-GCM ile şifreli saklanır (`encryptSecret`,
 *    MASTER_ENCRYPTION_KEY) — düz metin hiçbir zaman yazılmaz, hiçbir uçtan dönmez.
 *  - Kurulum yarım kalırsa DB kirlenmez: anahtar 10 dakikalık imzalı kurulum
 *    token'ının İÇİNDE şifreli taşınır; ilk doğru kodda kalıcılaşır.
 *  - Tekrar oynatma koruması: `lastTotpCounter` (aynı 6 haneli kod bir kez).
 *  - Challenge başına deneme sınırı (Redis/bellek sayacı) — 10 dakikalık pencere
 *    sınırsız denemeye açık kalmaz; hesap kilidi sayacı da işler.
 *  - Açık oturumla kurulum/kapatma PAROLA ister: çalınmış bir oturum 2FA'yı
 *    kendisi kurup hesaba kalıcı yerleşemez, kapatıp da soyamaz.
 *  - Büro politikası `Tenant.require2fa` açıksa: 2FA'sız kullanıcı girişte
 *    kuruluma zorlanır ve kullanıcı 2FA'yı KAPATAMAZ (yalnız yönetici sıfırlar).
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import { decryptSecret, encryptSecret } from "@nomosos/ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { attemptCounter } from "./attempt-counter";
import { isFreshTotp, nextStoredCounter, totpCounterAt } from "../platform/auth/totp-replay";
import { lockRemainingSeconds, recordFailure, CLEARED_LOCKOUT } from "../common/account-lockout";
import { TENANT_LOCKOUT_POLICY } from "./auth.constants";
import { SessionService, type IssuedSession } from "./session.service";
import type { AuthUser } from "../common/types";

authenticator.options = { window: 1 };

const TOTP_ISSUER = "NomosOS";
/** Challenge token audience — oturum token'ıyla KARIŞMAZ. */
export const TENANT_2FA_AUDIENCE = "tenant-2fa";
const CHALLENGE_TTL = "10m";
const CHALLENGE_WINDOW_MS = 10 * 60_000;
/** Bir challenge içinde en fazla hatalı kod. */
export const TENANT_MAX_CHALLENGE_ATTEMPTS = 5;

interface ChallengePayload {
  sub: string;
  kind: "login" | "setup";
  /** kind=setup: şifreli gizli anahtar. */
  enc?: string;
  jti: string;
  aud?: string;
}

export interface TwoFactorChallenge {
  twoFactorRequired?: true;
  twoFactorSetupRequired?: true;
  challengeToken: string;
  message: string;
}

type UserRow = NonNullable<Awaited<ReturnType<PrismaService["client"]["user"]["findUnique"]>>>;

function randomJti(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly session: SessionService,
  ) {}

  // ------------------------------------------------------------------ //
  // Challenge (giriş akışının ikinci adımı)
  // ------------------------------------------------------------------ //

  /** Parola doğrulandıktan sonra: 2FA gerekli mi, kurulum gerekli mi? */
  async loginChallenge(user: UserRow): Promise<TwoFactorChallenge | null> {
    if (user.twoFactorSecret) {
      return {
        twoFactorRequired: true,
        challengeToken: await this.signChallenge({ sub: user.id, kind: "login" }),
        message: "Doğrulama uygulamanızdaki 6 haneli kodu girin.",
      };
    }
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { require2fa: true },
    });
    if (tenant?.require2fa) {
      return {
        twoFactorSetupRequired: true,
        challengeToken: await this.signChallenge({ sub: user.id, kind: "setup" }),
        message:
          "Büronuzun güvenlik politikası iki adımlı doğrulamayı zorunlu kılıyor. Devam etmek için " +
          "doğrulama uygulamasını (Google/Microsoft Authenticator vb.) kurun.",
      };
    }
    return null;
  }

  // ------------------------------------------------------------------ //
  // Kurulum
  // ------------------------------------------------------------------ //

  /** Açık oturumla kurulum — mevcut parola ZORUNLU. */
  async setupWithSession(auth: AuthUser, currentPassword: string) {
    const user = await this.requireActive(auth.userId);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      await this.registerFailure(user, "2FA kurulumunda hatalı parola");
      throw new UnauthorizedException("Mevcut parola hatalı.");
    }
    return this.beginSetup(user);
  }

  /** Girişte zorunlu kurulum — challenge (parola zaten doğrulanmış). */
  async setupWithChallenge(challengeToken: string) {
    const challenge = await this.readChallenge(challengeToken);
    if (challenge.kind !== "setup") {
      throw new BadRequestException("Bu doğrulama oturumu kurulum için değil.");
    }
    const user = await this.requireActive(challenge.sub);
    return this.beginSetup(user);
  }

  private async beginSetup(user: UserRow) {
    if (user.twoFactorSecret) {
      throw new BadRequestException(
        "Bu hesapta iki adımlı doğrulama zaten kurulu. Yenilemek için önce kapatın ya da büro yöneticinizden sıfırlamasını isteyin.",
      );
    }
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    // Gizli anahtar DB'ye YAZILMAZ — şifreli olarak kurulum token'ında taşınır.
    const setupToken = await this.signChallenge({ sub: user.id, kind: "setup", enc: encryptSecret(secret) });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "USER_2FA_SETUP_START",
      entity: "User",
      entityId: user.id,
      detail: "TOTP kurulumu başlatıldı (anahtar henüz kalıcı değil).",
    });
    return {
      setupToken,
      otpauthUrl,
      qrDataUrl,
      /** QR okutulamayan cihazlar için elle giriş; yalnız bu yanıtta döner. */
      manualEntryKey: secret,
      message:
        "QR kodu doğrulama uygulamanıza okutun, ardından üretilen 6 haneli kodu doğrulayın. " +
        "Kod doğrulanana kadar 2FA etkinleşmez.",
    };
  }

  // ------------------------------------------------------------------ //
  // Doğrulama → oturum
  // ------------------------------------------------------------------ //

  async verify(input: { challengeToken: string; code: string }): Promise<IssuedSession> {
    const challenge = await this.readChallenge(input.challengeToken);
    const user = await this.requireActive(challenge.sub);
    this.assertNotLocked(user);

    // TEK KULLANIMLIK KAPI: her deneme challenge'ı tüketir.
    const attempt = (await attemptCounter().hit(`tenant-2fa|${challenge.jti}`, CHALLENGE_WINDOW_MS)).count;
    if (attempt > TENANT_MAX_CHALLENGE_ATTEMPTS) {
      await this.registerFailure(user, `doğrulama oturumunda ${TENANT_MAX_CHALLENGE_ATTEMPTS} hatalı kod — oturum iptal`);
      throw new UnauthorizedException(
        `Bu doğrulama oturumunda ${TENANT_MAX_CHALLENGE_ATTEMPTS} kez hatalı kod girildi ve oturum iptal edildi. Baştan giriş yapın.`,
      );
    }

    if (challenge.kind === "setup") {
      if (!challenge.enc) {
        throw new BadRequestException("Kurulum tamamlanmamış: önce QR kodunu alın (setup).");
      }
      const secret = decryptSecret(challenge.enc);
      const fresh = this.verifyFresh(user, input.code, secret);
      if (!fresh.ok) {
        await this.registerFailure(user, fresh.replay ? "kurulumda TOTP kodu tekrar kullanıldı" : "kurulum kodu hatalı");
        throw new UnauthorizedException(
          fresh.replay
            ? "Bu doğrulama kodu zaten kullanılmış. Yeni kodu bekleyip tekrar deneyin."
            : "Doğrulama kodu hatalı. Lütfen tekrar deneyin.",
        );
      }
      await attemptCounter().reset(`tenant-2fa|${challenge.jti}`);
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: encryptSecret(secret),
          lastTotpCounter: nextStoredCounter(fresh.counter, user.lastTotpCounter),
          ...CLEARED_LOCKOUT,
        },
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: "USER_2FA_ENABLED",
        entity: "User",
        entityId: user.id,
        detail: `${user.email} — iki adımlı doğrulama etkinleştirildi.`,
      });
      return this.session.issue(this.toSessionUser(user), "parola+2fa");
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException("Bu hesapta iki adımlı doğrulama kurulu değil.");
    }
    const fresh = this.verifyFresh(user, input.code, decryptSecret(user.twoFactorSecret));
    if (!fresh.ok) {
      await this.registerFailure(user, fresh.replay ? "girişte TOTP kodu tekrar kullanıldı" : "hatalı TOTP kodu");
      throw new UnauthorizedException(
        fresh.replay
          ? "Bu doğrulama kodu zaten kullanılmış. Yeni kodu bekleyip tekrar deneyin."
          : "Doğrulama kodu hatalı. Lütfen tekrar deneyin.",
      );
    }
    await attemptCounter().reset(`tenant-2fa|${challenge.jti}`);
    await this.markUsed(user.id, fresh.counter);
    await this.prisma.client.user.updateMany({
      where: { id: user.id, OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
      data: CLEARED_LOCKOUT,
    });
    return this.session.issue(this.toSessionUser(user), "parola+2fa");
  }

  // ------------------------------------------------------------------ //
  // Kapatma / sıfırlama
  // ------------------------------------------------------------------ //

  /** Kullanıcı kendi 2FA'sını kapatır — parola + güncel kod; büro politikası zorunluysa YASAK. */
  async disable(auth: AuthUser, input: { currentPassword: string; code: string }) {
    const user = await this.requireActive(auth.userId);
    if (!user.twoFactorSecret) {
      throw new BadRequestException("Bu hesapta iki adımlı doğrulama kurulu değil.");
    }
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { require2fa: true },
    });
    if (tenant?.require2fa) {
      throw new ForbiddenException(
        "Büronuzun güvenlik politikası iki adımlı doğrulamayı zorunlu kılıyor; kapatılamaz. " +
          "Cihaz değişimi için büro yöneticinizden 2FA sıfırlaması isteyin.",
      );
    }
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      await this.registerFailure(user, "2FA kapatmada hatalı parola");
      throw new UnauthorizedException("Mevcut parola hatalı.");
    }
    const fresh = this.verifyFresh(user, input.code, decryptSecret(user.twoFactorSecret));
    if (!fresh.ok) {
      await this.registerFailure(user, "2FA kapatmada hatalı kod");
      throw new UnauthorizedException("Doğrulama kodu hatalı ya da zaten kullanılmış.");
    }
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: null, lastTotpCounter: null },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "USER_2FA_DISABLED",
      entity: "User",
      entityId: user.id,
      detail: `${user.email} — iki adımlı doğrulama kullanıcı tarafından kapatıldı.`,
    });
    return { ok: true as const, message: "İki adımlı doğrulama kapatıldı." };
  }

  /**
   * Yönetici sıfırlaması (cihaz kaybı): anahtar silinir, TÜM oturumlar düşer.
   * Politika zorunluysa kullanıcı bir sonraki girişte yeniden kurar.
   */
  async adminReset(actor: AuthUser, targetId: string, targetEmail: string) {
    await this.prisma.client.user.update({
      where: { id: targetId },
      data: { twoFactorSecret: null, lastTotpCounter: null, sessionsValidFrom: new Date() },
    });
    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: "USER_2FA_RESET",
      entity: "User",
      entityId: targetId,
      detail: `${targetEmail} — 2FA yönetici tarafından sıfırlandı; oturumlar düşürüldü.`,
    });
  }

  // ------------------------------------------------------------------ //
  // Yardımcılar
  // ------------------------------------------------------------------ //

  private async signChallenge(payload: Omit<ChallengePayload, "jti" | "aud">): Promise<string> {
    return this.jwt.signAsync(
      { ...payload, jti: randomJti() },
      { audience: TENANT_2FA_AUDIENCE, expiresIn: CHALLENGE_TTL },
    );
  }

  private async readChallenge(token: string): Promise<ChallengePayload> {
    try {
      return await this.jwt.verifyAsync<ChallengePayload>(token, { audience: TENANT_2FA_AUDIENCE });
    } catch {
      throw new UnauthorizedException("Doğrulama oturumu geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın.");
    }
  }

  private async requireActive(id: string): Promise<UserRow> {
    const user = await this.prisma.client.user.findUnique({ where: { id } });
    if (!user || !user.isActive) throw new UnauthorizedException("Hesap bulunamadı veya pasif.");
    return user;
  }

  private assertNotLocked(user: UserRow): void {
    const locked = lockRemainingSeconds(user);
    if (locked > 0) {
      throw new HttpException(
        `Bu hesap geçici olarak kilitli; ${Math.ceil(locked / 60)} dakika sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** TOTP'yi tekrar oynatma kontrolüyle doğrular. */
  private verifyFresh(
    user: { lastTotpCounter: number | null },
    code: string,
    secret: string,
  ): { ok: true; counter: number } | { ok: false; replay: boolean } {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return { ok: false, replay: false };
    const counter = totpCounterAt(delta, Date.now());
    if (!isFreshTotp(counter, user.lastTotpCounter)) return { ok: false, replay: true };
    return { ok: true, counter };
  }

  /** Kullanılan adımı KOŞULLU yazar (eşzamanlı tekrar: yalnız biri geçer). */
  private async markUsed(userId: string, counter: number): Promise<void> {
    await this.prisma.client.user.updateMany({
      where: { id: userId, OR: [{ lastTotpCounter: null }, { lastTotpCounter: { lt: counter } }] },
      data: { lastTotpCounter: counter },
    });
  }

  private async registerFailure(user: UserRow, reason: string): Promise<void> {
    const next = recordFailure(user, TENANT_LOCKOUT_POLICY);
    await this.prisma.client.user.update({ where: { id: user.id }, data: next }).catch(() => undefined);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: user.id,
      detail: `${user.email} — ${reason}`,
    });
  }

  private toSessionUser(user: UserRow) {
    return { id: user.id, tenantId: user.tenantId, email: user.email, fullName: user.fullName, role: user.role };
  }
}
