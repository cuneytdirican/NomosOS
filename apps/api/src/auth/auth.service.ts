import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { ChangePasswordInput, LoginInput } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser, JwtPayload } from "../common/types";
import { TENANT_JWT_AUDIENCE } from "../common/jwt-audience";
import {
  CLEARED_LOCKOUT,
  lockRemainingSeconds,
  recordFailure,
} from "../common/account-lockout";
import { PASSWORD_HASH_ROUNDS, TENANT_LOCKOUT_POLICY } from "./auth.constants";

/**
 * KİRACI (BÜRO) KİMLİK SERVİSİ.
 *
 * ── DENETİM BULGUSU K-03 SONRASI ────────────────────────────────────────────
 * Üç kimlik alanının EN GENİŞ YETKİLİSİ, en korumasızıydı:
 *
 *   |              | oturum iptali      | kalıcı kilit | parola değiştirme |
 *   |--------------|--------------------|--------------|-------------------|
 *   | PlatformUser | tokenVersion       | 5 hata→30 dk | vardı             |
 *   | PortalUser   | sessionsValidFrom  | 20 hata→15dk | vardı             |
 *   | User (avukat)| YOKTU              | YOKTU        | YOKTU             |
 *
 * Sonuçları ölçüldü: (a) sızmış bir avukat parolası ürün üzerinden
 * kapatılamıyordu — tek çözüm `psql` ile elle `passwordHash` yazmaktı ve o bile
 * açık token'ı düşürmüyordu; (b) 100 farklı çıkış IP'sinden dakikada 500 deneme
 * yapılabiliyor ve hesap hiç kilitlenmiyordu (dar sayaç süreç içindeydi).
 *
 * Artık: kalıcı hesap kilidi (`common/account-lockout.ts`, portalla PAYLAŞILAN
 * saf mantık), `sessionsValidFrom` ile oturum iptali, `POST /auth/logout` ve
 * `POST /auth/change-password`.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService
  ) {}

  async login(input: LoginInput) {
    const user = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    if (!user || !user.isActive) {
      // Başarısız denemeler de denetlenir (denetim bulgusu 19). Kullanıcı
      // bulunamadığında tenantId bilinmediğinden kayıt atlanır; mesaj her iki
      // hâlde de aynıdır (hesap sayımını engellemek için).
      if (user) {
        await this.logFailedLogin(user.tenantId, user.id, input.email, "hesap pasif");
      }
      throw new UnauthorizedException("E-posta veya şifre hatalı.");
    }

    // KALICI HESAP KİLİDİ — parola doğrulamasından ÖNCE bakılır: kilitli bir
    // hesapta doğru parola da kapıyı açmamalıdır.
    const locked = lockRemainingSeconds(user);
    if (locked > 0) {
      await this.logFailedLogin(user.tenantId, user.id, input.email, "hesap kilitli");
      throw new HttpException(
        `Bu hesap çok sayıda hatalı deneme nedeniyle geçici olarak kilitlendi; ` +
          `${Math.ceil(locked / 60)} dakika sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      const nowLocked = await this.registerFailure(user);
      await this.logFailedLogin(
        user.tenantId,
        user.id,
        input.email,
        nowLocked ? "hatalı şifre — hesap kilitlendi" : "hatalı şifre"
      );
      if (nowLocked) {
        throw new HttpException(
          "Çok sayıda hatalı deneme nedeniyle hesap geçici olarak kilitlendi. " +
            `${TENANT_LOCKOUT_POLICY.lockoutMinutes} dakika sonra tekrar deneyin.`,
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      throw new UnauthorizedException("E-posta veya şifre hatalı.");
    }

    await this.clearFailures(user.id);

    const payload: JwtPayload = { sub: user.id, tenantId: user.tenantId, role: user.role };
    // GÜVENLİK: token'a audience damgası basılır (`aud: "tenant"`).
    // Platform paneli token'ı `aud: "platform"` taşır; iki taraf birbirinin
    // token'ını audience aşamasında da reddeder (ayrı imza anahtarının üstüne
    // konan ikinci kapı — bkz. common/jwt-audience.ts).
    const accessToken = await this.jwtService.signAsync(payload, {
      audience: TENANT_JWT_AUDIENCE,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      entity: "User",
      entityId: user.id,
      detail: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  /**
   * POST /auth/logout — SUNUCU TARAFI ÇIKIŞ (denetim bulgusu Ö-34).
   *
   * Eskiden büro yüzeyinde çıkış yalnızca `clearToken()` idi: ortak bir
   * bilgisayarda token 12 saat daha geçerli kalıyordu. Portal kodu bu gerekçeyi
   * kendi yazmıştı ("Yalnızca localStorage'ı silmek, ortak bir bilgisayarda
   * token'ı 8 saat daha geçerli bırakırdı") ama aynı gerekçe büro yüzeyine
   * uygulanmamıştı — üstelik orada token ömrü DAHA UZUN.
   *
   * `sessionsValidFrom` damgası tazelenir; `JwtAuthGuard` bu damgadan eski
   * token'ları reddeder. Damga KULLANICI BAZINDADIR: çıkış, o kullanıcının tüm
   * cihazlardaki oturumlarını düşürür. Bu bilinçlidir — "çıkış yaptım" diyen
   * kullanıcının beklentisi budur ve oturum bazlı iptal ayrı bir tablo ister.
   */
  async logout(user: AuthUser) {
    await this.prisma.client.user.update({
      where: { id: user.userId },
      data: { sessionsValidFrom: new Date() },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "LOGOUT",
      entity: "User",
      entityId: user.userId,
      detail: "Tüm oturumlar düşürüldü.",
    });
    return { ok: true as const, message: "Oturumunuz kapatıldı ve açık tüm oturumlarınız düşürüldü." };
  }

  /**
   * POST /auth/change-password — kendi parolasını değiştirme (denetim bulgusu K-03).
   *
   * Kullanıcı MEVCUT PAROLASINI bilmek zorundadır; çalınmış bir oturum parolayı
   * sessizce değiştiremez. Başarılı değişim `sessionsValidFrom`'u tazeler:
   * kendi oturumu dâhil TÜM açık oturumlar düşer — sızmış parolayla açılmış
   * saldırgan oturumu da. `PlatformAuthService.changePassword` ile aynı desen.
   */
  async changePassword(user: AuthUser, input: ChangePasswordInput) {
    const record = await this.prisma.client.user.findUnique({ where: { id: user.userId } });
    if (!record || !record.isActive) {
      throw new UnauthorizedException("Hesabınız bulunamadı veya pasif.");
    }

    const locked = lockRemainingSeconds(record);
    if (locked > 0) {
      throw new HttpException(
        `Hesabınız geçici olarak kilitli; ${Math.ceil(locked / 60)} dakika sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    if (!(await bcrypt.compare(input.currentPassword, record.passwordHash))) {
      await this.registerFailure(record);
      await this.logFailedLogin(
        record.tenantId,
        record.id,
        record.email,
        "parola değiştirmede mevcut parola hatalı"
      );
      throw new UnauthorizedException("Mevcut parolanız hatalı.");
    }

    if (await bcrypt.compare(input.newPassword, record.passwordHash)) {
      throw new UnauthorizedException("Yeni parola mevcut parolayla aynı olamaz.");
    }

    await this.prisma.client.user.update({
      where: { id: record.id },
      data: {
        passwordHash: await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS),
        sessionsValidFrom: new Date(),
        ...CLEARED_LOCKOUT,
      },
    });

    await this.audit.log({
      tenantId: record.tenantId,
      userId: record.id,
      action: "PASSWORD_CHANGED",
      entity: "User",
      entityId: record.id,
      detail: `${record.email} — tüm oturumlar düşürüldü.`,
    });

    return {
      ok: true as const,
      message:
        "Parolanız değiştirildi. Güvenlik gereği açık tüm oturumlarınız (bu oturum dâhil) " +
        "düşürüldü; yeni parolanızla tekrar giriş yapın.",
    };
  }

  /** Başarısız denemeyi kalıcı sayaca yazar; kilit kurulduysa `true` döner. */
  private async registerFailure(user: {
    id: string;
    failedAttempts: number;
    failureWindowEndsAt: Date | null;
    lockedUntil: Date | null;
  }): Promise<boolean> {
    const next = recordFailure(user, TENANT_LOCKOUT_POLICY);
    try {
      await this.prisma.client.user.update({ where: { id: user.id }, data: next });
    } catch (err) {
      // Sayaç tutamamak, kullanıcıya 500 döndürmek için yeterli bir gerekçe
      // değildir; dar (IP ∧ e-posta) sayaç zaten bellekte çalışmıştır.
      this.logger.warn(`Hesap kilidi sayacı yazılamadı (${user.id}): ${(err as Error).message}`);
      return false;
    }
    return next.lockedUntil !== null && next.lockedUntil.getTime() > Date.now();
  }

  /** Başarılı kimlik doğrulamada sayacı sıfırlar. */
  private async clearFailures(id: string): Promise<void> {
    await this.prisma.client.user.updateMany({
      where: { id, OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
      data: CLEARED_LOCKOUT,
    });
  }

  /** Başarısız giriş denemesini denetim günlüğüne yazar. */
  private async logFailedLogin(
    tenantId: string,
    userId: string,
    email: string,
    reason: string
  ): Promise<void> {
    await this.audit.log({
      tenantId,
      userId,
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: userId,
      detail: `${email} — ${reason}`,
    });
  }

  async me(authUser: AuthUser) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: authUser.userId, tenantId: authUser.tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        role: true,
        barNumber: true,
        isActive: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (!user) {
      throw new NotFoundException("Kullanıcı bulunamadı.");
    }
    return user;
  }
}
