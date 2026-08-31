import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import { decryptSecret, encryptSecret } from "@nomosos/ai";
import { PrismaService } from "../../prisma/prisma.service";
import { attemptCounter } from "../../auth/attempt-counter";
import { PlatformAuditService } from "../platform-audit.service";
import {
  PLATFORM_2FA_AUDIENCE,
  PLATFORM_CHALLENGE_TTL,
  PLATFORM_JWT_AUDIENCE,
  PLATFORM_LOCKOUT_MINUTES,
  PLATFORM_MAX_CHALLENGE_ATTEMPTS,
  PLATFORM_MAX_FAILED_ATTEMPTS,
  PLATFORM_TOKEN_TTL,
  platform2faEncryptionKey,
  platformJwtSecret,
  requireTwoFactor,
} from "../platform.constants";
import type {
  PlatformAuthUser,
  PlatformChallengePayload,
  PlatformJwtPayload,
} from "../platform.types";
import type { AdminRole } from "../platform-permissions";
import type { PlatformLoginInput, TwoFactorVerifyInput } from "./platform-auth.schemas";

/** TOTP ayarları — 30 saniyelik pencere, ±1 adım tolerans (saat kayması). */
authenticator.options = { window: 1 };

const TOTP_ISSUER = "NomosOS Platform";

/**
 * CHALLENGE DENEME SAYACI.
 *
 * `challengeToken` 10 dakika geçerlidir ve hatalı kod onu TÜKETMEZDİ; aynı
 * token'la sınırsız TOTP denemesi yapılabiliyordu (denetim bulgusu 10.2).
 * Sayaç `jti` başına tutulur; sınır aşılınca token iptal edilir.
 *
 * denetim bulgusu Ö-09: SAYAÇ ARTIK SÜREÇ BELLEĞİNDE DEĞİL.
 * Ortak kova Redis'tedir (`auth/attempt-counter.ts`); üç replikalı bir
 * kurulumda 3 denemelik sınır 9'a çıkmaz. Hesap düzeyindeki asıl kilit
 * (`PlatformUser.failedAttempts` / `lockedUntil`) zaten VERİTABANINDADIR;
 * bu sayaç onun üzerine konan ikinci settir.
 */
const CHALLENGE_WINDOW_MS = 10 * 60_000;

function consumeChallengeAttempt(jti: string): Promise<number> {
  return attemptCounter()
    .hit(`platform-2fa|${jti}`, CHALLENGE_WINDOW_MS)
    .then((hit) => hit.count);
}

function clearChallenge(jti: string): Promise<void> {
  return attemptCounter().reset(`platform-2fa|${jti}`);
}

/**
 * PLATFORM KİMLİK SERVİSİ.
 *
 * TENANT AuthService'İN KOPYASI DEĞİLDİR ve olmamalıdır:
 *   - farklı tablo (PlatformUser), farklı imza anahtarı, farklı audience,
 *   - token'da `tenantId` YOKTUR (panel bir büroya ait değildir),
 *   - iki adımlı giriş (TOTP) vardır,
 *   - başarısız giriş `ADMIN_LOGIN_FAILED` olarak PlatformAuditLog'a yazılır.
 *
 * 2FA GİZLİ ANAHTARI HİÇBİR ZAMAN DÜZ METİN SAKLANMAZ: AES-256-GCM ile
 * (MASTER_ENCRYPTION_KEY) şifrelenir — `AiProviderConfig.encryptedApiKey`
 * ile aynı desen.
 *
 * KURULUM YARIM KALIRSA VERİTABANI KİRLENMEZ: kurulum sırasında üretilen gizli
 * anahtar DB'ye değil, kısa ömürlü (10 dk) imzalı bir kurulum token'ının içine
 * ŞİFRELİ olarak konur. Kayıt ancak kullanıcı ilk kodu doğru girdiğinde
 * kalıcılaşır. Böylece "gizli anahtarı yazdım ama kullanıcı QR'ı okutmadı"
 * durumunda hesap kilitlenmez.
 */
@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService
  ) {}

  // ---------------------------------------------------------------- giriş

  async login(input: PlatformLoginInput, ip: string) {
    const user = await this.prisma.client.platformUser.findUnique({
      where: { email: input.email },
    });

    if (!user || !user.isActive) {
      await this.audit.log({
        actor: user ? { id: user.id, role: user.role as AdminRole, ip } : null,
        action: "ADMIN_LOGIN_FAILED",
        entity: "PlatformUser",
        entityId: user?.id,
        ipAddress: ip,
        detail: `${input.email} — ${user ? "hesap pasif" : "hesap bulunamadı"}`,
      });
      // Hesap sayımını engellemek için her iki hâlde de aynı mesaj.
      throw new UnauthorizedException("E-posta veya şifre hatalı.");
    }

    // HESAP KİLİDİ — parola doğrulamasından ÖNCE bakılır: kilitli bir hesapta
    // doğru parola da kapıyı açmamalıdır.
    this.assertNotLocked(user.lockedUntil, user.email);

    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      const locked = await this.registerFailure(user.id, user.role as AdminRole, ip, "hatalı şifre");
      throw new UnauthorizedException(
        locked
          ? this.lockMessage()
          : "E-posta veya şifre hatalı."
      );
    }

    // 1) 2FA kurulu → ikinci adım zorunlu.
    if (user.twoFactorSecret) {
      return {
        twoFactorRequired: true,
        twoFactorSetupRequired: false,
        challengeToken: await this.signChallenge({ sub: user.id, kind: "login" }),
        message: "Doğrulama uygulamanızdaki 6 haneli kodu girin.",
      };
    }

    // 2) 2FA kurulu değil ama zorunlu kılınmış → yalnız kurulum yolu açık.
    if (requireTwoFactor()) {
      return {
        twoFactorRequired: true,
        twoFactorSetupRequired: true,
        challengeToken: await this.signChallenge({ sub: user.id, kind: "setup" }),
        message:
          "Panele erişebilmek için önce iki adımlı doğrulamayı (2FA) kurmanız gerekiyor.",
      };
    }

    // 3) 2FA zorunlu değil ve kurulu değil → tek adımda oturum.
    this.logger.warn(
      `2FA olmadan panel girişi: ${user.email}. Üretim ortamında PLATFORM_REQUIRE_2FA=true olmalıdır.`
    );
    await this.clearFailures(user.id);
    return this.issueSession(user.id, user.email, user.fullName, user.role as AdminRole, false, ip);
  }

  /**
   * PAROLA DEĞİŞTİRME — kendi hesabı için TEK yol.
   *
   * Panel kullanıcı yönetimi ucundan (`PATCH /platform-users/:id`) kendi
   * parolasını değiştirmek KAPALIDIR; orası başkasının kimlik bilgisine
   * dokunan bir yönetim işlemidir ve dört-göze tabidir. Burada ise kullanıcı
   * MEVCUT PAROLASINI bilmek zorundadır ve 2FA kuruluysa geçerli bir TOTP kodu
   * girer — yani çalınmış bir oturum parolayı sessizce değiştiremez.
   *
   * Başarılı değişim `tokenVersion`'ı artırır: kendi oturumu dâhil TÜM açık
   * oturumlar düşer (spec §Güvenlik 3).
   */
  async changePassword(
    actor: PlatformAuthUser,
    input: { currentPassword: string; newPassword: string; code?: string },
    ip: string
  ) {
    const user = await this.prisma.client.platformUser.findUnique({ where: { id: actor.id } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Panel hesabı bulunamadı veya pasif.");
    }
    this.assertNotLocked(user.lockedUntil, user.email);

    const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!ok) {
      const locked = await this.registerFailure(
        user.id,
        user.role as AdminRole,
        ip,
        "parola değiştirmede mevcut parola hatalı"
      );
      throw new UnauthorizedException(
        locked ? this.lockMessage() : "Mevcut parolanız hatalı."
      );
    }

    // 2FA kuruluysa ikinci faktör BURADA DA istenir: parola değişimi, oturum
    // ele geçirilmesinin kalıcılaştırıldığı klasik adımdır.
    if (user.twoFactorSecret) {
      if (!input.code) {
        throw new BadRequestException(
          "Hesabınızda iki adımlı doğrulama kurulu. Parolayı değiştirmek için doğrulama " +
            "uygulamanızdaki 6 haneli kodu da gönderin (`code`)."
        );
      }
      const secret = this.decrypt(user.twoFactorSecret);
      if (!authenticator.verify({ token: input.code, secret })) {
        const locked = await this.registerFailure(
          user.id,
          user.role as AdminRole,
          ip,
          "parola değiştirmede hatalı TOTP kodu"
        );
        throw new UnauthorizedException(
          locked ? this.lockMessage() : "Doğrulama kodu hatalı."
        );
      }
    }

    if (await bcrypt.compare(input.newPassword, user.passwordHash)) {
      throw new BadRequestException("Yeni parola mevcut parolayla aynı olamaz.");
    }

    await this.prisma.client.platformUser.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(input.newPassword, 10),
        tokenVersion: { increment: 1 },
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    await this.audit.log({
      actor: { id: user.id, role: user.role as AdminRole, ip },
      action: "ADMIN_PASSWORD_CHANGE",
      entity: "PlatformUser",
      entityId: user.id,
      ipAddress: ip,
      detail: "Kullanıcı kendi parolasını değiştirdi; tüm oturumları sonlandırıldı.",
    });

    return {
      ok: true,
      message:
        "Parolanız değiştirildi. Güvenlik gereği bu oturum dâhil TÜM panel oturumlarınız " +
        "sonlandırıldı; lütfen yeni parolanızla tekrar giriş yapın.",
    };
  }

  // ------------------------------------------------------------------ 2FA

  /**
   * TOTP kurulumu — gizli anahtar + otpauth URI + QR (data URL) üretir.
   *
   * `challengeToken` ile (giriş sırasında) ya da mevcut panel oturumuyla
   * çağrılabilir. Zaten 2FA kurulu bir hesap için yeniden kurulum yapılmaz;
   * anahtar değişimi bir SUPER_ADMIN'in hesabı sıfırlamasını gerektirir
   * (çalınmış oturumla 2FA'nın sessizce değiştirilmesini engeller).
   */
  async setup(params: {
    challengeToken?: string;
    bearerToken?: string;
    currentPassword?: string;
    ip?: string;
  }) {
    const { userId, via } = await this.resolveSetupSubject(params);

    const user = await this.prisma.client.platformUser.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Panel hesabı bulunamadı veya pasif.");
    }

    // OTURUMLA KURULUMDA PAROLA ZORUNLU (denetim bulgusu Ö-01).
    //
    // `challengeToken` dalında parola ZATEN girilmiştir (challenge yalnız
    // başarılı `login`den sonra üretilir). `bearerToken` dalında ise eskiden
    // hiçbir şey sorulmuyordu: çalınmış bir panel oturumu, hesabın 2FA'sını
    // KENDİSİ kurup ele geçirmeyi kalıcı hâle getirebiliyordu.
    if (via === "bearer") {
      if (!params.currentPassword) {
        throw new BadRequestException(
          "Açık bir panel oturumuyla 2FA kurmak için mevcut parolanızı da göndermelisiniz " +
            "(`currentPassword`). Bu adım, çalınmış bir oturumun hesaba kalıcı olarak " +
            "yerleşmesini engeller.",
        );
      }
      if (!(await bcrypt.compare(params.currentPassword, user.passwordHash))) {
        const locked = await this.registerFailure(
          user.id,
          user.role as AdminRole,
          params.ip ?? "-",
          "2FA kurulumunda hatalı parola",
        );
        throw new UnauthorizedException(locked ? this.lockMessage() : "Mevcut parola hatalı.");
      }
    }

    if (user.twoFactorSecret) {
      throw new BadRequestException(
        "Bu hesapta iki adımlı doğrulama zaten kurulu. Yenilemek için bir SUPER_ADMIN'in " +
          "hesabınızın 2FA kaydını sıfırlaması gerekir."
      );
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Gizli anahtar DB'ye YAZILMAZ; şifreli olarak kurulum token'ına konur.
    //
    // ANAHTAR AYRIMI (denetim bulgusu K-01): burada `platform2faEncryptionKey()`
    // KULLANILMAK ZORUNDADIR. Eskiden `encryptSecret(secret)` yazılıydı, yani
    // anahtar MASTER_ENCRYPTION_KEY ile şifreleniyor ama `verify()` onu
    // `this.decrypt()` → `decryptSecret(stored, platform2faEncryptionKey())` ile
    // çözmeye çalışıyordu. İki anahtar farklı olduğu için (ikincisi birincinin
    // HMAC türevidir) çözme DAİMA "Unsupported state or unable to authenticate
    // data" ile başarısız oluyordu.
    //
    // Sonucu ölçüldü: kriptografik olarak DOĞRU üretilmiş bir TOTP kodu bile 401
    // alıyordu; üretimde `PLATFORM_REQUIRE_2FA=true` zorunlu olduğu ve tohumdaki
    // hiçbir panel hesabında 2FA kurulu olmadığı için PANEL ERİŞİMİ İLK ÜRETİM
    // AÇILIŞINDA %100 KAPALIYDI ve tek kurtarma yolu doğrudan SQL müdahalesiydi.
    // Kalıcılaştırma satırı (aşağıda `twoFactorSecret: encryptSecret(secret,
    // platform2faEncryptionKey())`) doğru anahtarı geçiyordu; hata yalnız burada
    // olduğu için fark edilmemişti.
    const setupToken = await this.signChallenge({
      sub: user.id,
      kind: "setup",
      enc: encryptSecret(secret, platform2faEncryptionKey()),
    });

    await this.audit.log({
      actor: { id: user.id, role: user.role as AdminRole, ip: "-" },
      action: "ADMIN_2FA_SETUP_START",
      entity: "PlatformUser",
      entityId: user.id,
      detail: "TOTP kurulumu başlatıldı (anahtar henüz kalıcı değil).",
    });

    return {
      setupToken,
      otpauthUrl,
      qrDataUrl,
      /**
       * Elle giriş için gereklidir (QR okutulamayan cihazlar). Anahtar bu tek
       * seferlik kurulum yanıtı dışında HİÇBİR uçtan dönmez.
       */
      manualEntryKey: secret,
      message:
        "QR kodu doğrulama uygulamanıza okutun, ardından üretilen 6 haneli kodu doğrulayın. " +
        "Kod doğrulanana kadar 2FA etkinleşmez.",
    };
  }

  /** İkinci adım: TOTP doğrulama → panel oturumu. */
  async verify(input: TwoFactorVerifyInput, ip: string) {
    let challenge: PlatformChallengePayload;
    try {
      challenge = await this.jwt.verifyAsync<PlatformChallengePayload>(input.challengeToken, {
        secret: platformJwtSecret(),
        audience: PLATFORM_2FA_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException(
        "Doğrulama oturumu geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın."
      );
    }

    const user = await this.prisma.client.platformUser.findUnique({
      where: { id: challenge.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Panel hesabı bulunamadı veya pasif.");
    }
    this.assertNotLocked(user.lockedUntil, user.email);

    // TEK KULLANIMLIK KAPI: her deneme challenge'ı biraz daha tüketir. Sınır
    // aşılınca token iptal edilir ve kullanıcı baştan giriş yapmak zorunda
    // kalır — böylece 10 dakikalık pencere sınırsız denemeye açık kalmaz.
    const attempt = await consumeChallengeAttempt(challenge.jti);
    if (attempt > PLATFORM_MAX_CHALLENGE_ATTEMPTS) {
      await this.registerFailure(
        user.id,
        user.role as AdminRole,
        ip,
        `doğrulama oturumunda ${PLATFORM_MAX_CHALLENGE_ATTEMPTS} hatalı kod — oturum iptal edildi`
      );
      throw new UnauthorizedException(
        `Bu doğrulama oturumunda ${PLATFORM_MAX_CHALLENGE_ATTEMPTS} kez hatalı kod girildi ve ` +
          "oturum iptal edildi. Lütfen baştan giriş yapın."
      );
    }

    if (challenge.kind === "setup") {
      if (!challenge.enc) {
        throw new BadRequestException(
          "Kurulum tamamlanmamış. Önce /auth/2fa/setup ucundan QR kodunu alın."
        );
      }
      const secret = this.decrypt(challenge.enc);
      if (!authenticator.verify({ token: input.code, secret })) {
        const locked = await this.registerFailure(
          user.id,
          user.role as AdminRole,
          ip,
          "kurulum kodu hatalı"
        );
        throw new UnauthorizedException(
          locked ? this.lockMessage() : "Doğrulama kodu hatalı. Lütfen tekrar deneyin."
        );
      }
      await clearChallenge(challenge.jti);
      await this.prisma.client.platformUser.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: encryptSecret(secret, platform2faEncryptionKey()),
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
      await this.audit.log({
        actor: { id: user.id, role: user.role as AdminRole, ip },
        action: "ADMIN_2FA_ENABLED",
        entity: "PlatformUser",
        entityId: user.id,
        ipAddress: ip,
        detail: "İki adımlı doğrulama etkinleştirildi.",
      });
      return this.issueSession(user.id, user.email, user.fullName, user.role as AdminRole, true, ip);
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException("Bu hesapta iki adımlı doğrulama kurulu değil.");
    }
    const secret = this.decrypt(user.twoFactorSecret);
    if (!authenticator.verify({ token: input.code, secret })) {
      const locked = await this.registerFailure(
        user.id,
        user.role as AdminRole,
        ip,
        "hatalı TOTP kodu"
      );
      throw new UnauthorizedException(
        locked ? this.lockMessage() : "Doğrulama kodu hatalı. Lütfen tekrar deneyin."
      );
    }
    await clearChallenge(challenge.jti);
    await this.clearFailures(user.id);
    return this.issueSession(user.id, user.email, user.fullName, user.role as AdminRole, true, ip);
  }

  /**
   * KİLİT AÇMA — yalnız BAŞKA bir SUPER_ADMIN (spec §Güvenlik 3).
   *
   * Kilitli kullanıcı kendi kilidini açamaz; kilit zaten "bu kimliğe hâkim
   * olan kişi kaba kuvvet deniyor olabilir" varsayımına dayanır.
   */
  async unlockUser(actor: PlatformAuthUser, targetId: string) {
    if (actor.id === targetId) {
      throw new ForbiddenException(
        "Kendi hesabınızın kilidini açamazsınız. Kilidi başka bir SUPER_ADMIN açmalıdır."
      );
    }
    const target = await this.prisma.client.platformUser.findUnique({ where: { id: targetId } });
    if (!target) throw new BadRequestException("Panel kullanıcısı bulunamadı.");

    await this.prisma.client.platformUser.update({
      where: { id: targetId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    await this.audit.log({
      actor,
      action: "ADMIN_ACCOUNT_UNLOCK",
      entity: "PlatformUser",
      entityId: targetId,
      detail: `${target.email} hesabının giriş kilidi açıldı (önceki deneme sayısı: ${target.failedAttempts}).`,
    });
    return { id: targetId, locked: false, message: `${target.email} hesabının kilidi açıldı.` };
  }

  // ------------------------------------------------------------------- me

  async me(user: PlatformAuthUser) {
    const record = await this.prisma.client.platformUser.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        twoFactorSecret: true,
        createdAt: true,
      },
    });
    if (!record) throw new UnauthorizedException("Panel hesabı bulunamadı.");
    // twoFactorSecret ASLA dönmez — yalnız kurulu olup olmadığı.
    const { twoFactorSecret, ...rest } = record;
    return {
      ...rest,
      twoFactorReady: Boolean(twoFactorSecret),
      twoFactorEnforced: requireTwoFactor(),
    };
  }

  // -------------------------------------------------------------- yardımcı

  private async resolveSetupSubject(params: {
    challengeToken?: string;
    bearerToken?: string;
  }): Promise<{ userId: string; via: "challenge" | "bearer" }> {
    if (params.challengeToken) {
      try {
        const payload = await this.jwt.verifyAsync<PlatformChallengePayload>(
          params.challengeToken,
          { secret: platformJwtSecret(), audience: PLATFORM_2FA_AUDIENCE }
        );
        if (payload.kind !== "setup") {
          throw new Error("kurulum token'ı değil");
        }
        return { userId: payload.sub, via: "challenge" };
      } catch {
        throw new UnauthorizedException(
          "Kurulum oturumu geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın."
        );
      }
    }
    if (params.bearerToken) {
      try {
        const payload = await this.jwt.verifyAsync<PlatformJwtPayload>(params.bearerToken, {
          secret: platformJwtSecret(),
          audience: PLATFORM_JWT_AUDIENCE,
        });
        return { userId: payload.sub, via: "bearer" };
      } catch {
        throw new UnauthorizedException("Panel oturumu geçersiz. Lütfen tekrar giriş yapın.");
      }
    }
    throw new UnauthorizedException(
      "2FA kurulumu için giriş adımından dönen challengeToken ya da geçerli bir panel oturumu gerekir."
    );
  }

  /** Hesap kilitliyse 403 — kalan süreyi de bildirir. */
  private assertNotLocked(lockedUntil: Date | null, email: string): void {
    if (!lockedUntil || lockedUntil.getTime() <= Date.now()) return;
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    this.logger.warn(`Kilitli panel hesabına giriş denemesi: ${email}`);
    throw new ForbiddenException(
      `Bu hesap arka arkaya ${PLATFORM_MAX_FAILED_ATTEMPTS} başarısız deneme nedeniyle ` +
        `kilitlendi. Kilit ${minutes} dakika sonra kendiliğinden düşer; daha erken açılması ` +
        "için bir SUPER_ADMIN ile görüşün."
    );
  }

  private lockMessage(): string {
    return (
      `Arka arkaya ${PLATFORM_MAX_FAILED_ATTEMPTS} başarısız deneme yapıldığı için hesap ` +
      `${PLATFORM_LOCKOUT_MINUTES} dakika kilitlendi. Kilidin erken açılması için bir ` +
      "SUPER_ADMIN ile görüşün."
    );
  }

  /**
   * Başarısız denemeyi HESAP DÜZEYİNDE sayar; sınırda kilitler.
   * Dönen değer: bu deneme kilidi tetikledi mi?
   */
  private async registerFailure(
    id: string,
    role: AdminRole,
    ip: string,
    reason: string
  ): Promise<boolean> {
    const updated = await this.prisma.client.platformUser.update({
      where: { id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true, email: true },
    });

    const locked = updated.failedAttempts >= PLATFORM_MAX_FAILED_ATTEMPTS;
    if (locked) {
      await this.prisma.client.platformUser.update({
        where: { id },
        data: {
          lockedUntil: new Date(Date.now() + PLATFORM_LOCKOUT_MINUTES * 60_000),
          failedAttempts: 0,
        },
      });
    }

    await this.audit.log({
      actor: { id, role, ip },
      action: locked ? "ADMIN_ACCOUNT_LOCKED" : "ADMIN_LOGIN_FAILED",
      entity: "PlatformUser",
      entityId: id,
      ipAddress: ip,
      detail: locked
        ? `${updated.email} — ${reason}; ${PLATFORM_MAX_FAILED_ATTEMPTS}. başarısız denemede hesap ` +
          `${PLATFORM_LOCKOUT_MINUTES} dakika kilitlendi.`
        : `${updated.email} — ${reason} (${updated.failedAttempts}/${PLATFORM_MAX_FAILED_ATTEMPTS})`,
    });
    return locked;
  }

  /** Başarılı kimlik doğrulamada sayacı sıfırlar. */
  private async clearFailures(id: string): Promise<void> {
    await this.prisma.client.platformUser.updateMany({
      where: { id, OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  private decrypt(stored: string): string {
    try {
      // Panel 2FA kayıtları AYRI anahtarla şifrelenir (spec §Güvenlik 7):
      // master anahtar bu yolda hiç kullanılmaz.
      return decryptSecret(stored, platform2faEncryptionKey());
    } catch (err) {
      // MASTER_ENCRYPTION_KEY değiştiyse ya da kayıt bozulduysa buraya düşer.
      this.logger.error(`2FA gizli anahtarı çözülemedi: ${(err as Error).message}`);
      throw new UnauthorizedException(
        "İki adımlı doğrulama kaydı okunamadı. Bir SUPER_ADMIN'in hesabınızın 2FA kaydını " +
          "sıfırlaması gerekiyor."
      );
    }
  }

  private signChallenge(payload: {
    sub: string;
    kind: "login" | "setup";
    enc?: string;
  }): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: payload.sub,
        kind: payload.kind,
        // Deneme sayacının anahtarı — her challenge KENDİ kimliğini taşır.
        jti: randomUUID(),
        ...(payload.enc ? { enc: payload.enc } : {}),
      },
      {
        secret: platformJwtSecret(),
        audience: PLATFORM_2FA_AUDIENCE,
        expiresIn: PLATFORM_CHALLENGE_TTL,
      }
    );
  }

  private async issueSession(
    id: string,
    email: string,
    fullName: string,
    role: AdminRole,
    twoFactorReady: boolean,
    ip: string
  ) {
    // Oturum sürümü token'a BASILIR; guard her istekte DB ile karşılaştırır.
    // Sürüm okuma ile token imzalama arasında bir sıfırlama olursa token zaten
    // eski sürümü taşır ve ilk istekte reddedilir — kapı açık kalmaz.
    const current = await this.prisma.client.platformUser.update({
      where: { id },
      data: { lastLoginAt: new Date() },
      select: { tokenVersion: true },
    });

    const accessToken = await this.jwt.signAsync(
      { sub: id, role, tv: current.tokenVersion },
      {
        secret: platformJwtSecret(),
        audience: PLATFORM_JWT_AUDIENCE,
        expiresIn: PLATFORM_TOKEN_TTL,
      }
    );

    await this.audit.log({
      actor: { id, role, ip },
      action: "ADMIN_LOGIN_SUCCESS",
      entity: "PlatformUser",
      entityId: id,
      ipAddress: ip,
      detail: `${email} panel oturumu açtı (2FA: ${twoFactorReady ? "var" : "yok"}).`,
    });

    return {
      twoFactorRequired: false,
      accessToken,
      user: { id, email, fullName, role, twoFactorReady },
    };
  }
}
