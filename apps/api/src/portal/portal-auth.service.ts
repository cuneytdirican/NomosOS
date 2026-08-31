import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { PortalAuditService } from "./portal-audit.service";
import {
  CLEARED_ACCOUNT_LOCKOUT,
  accountLockRemainingSeconds,
  recordAccountFailure,
} from "./portal-account-lockout";
import { PortalLockoutStore } from "./portal-lockout";
import { hashPortalToken } from "./portal-token";
import {
  PORTAL_BCRYPT_ROUNDS,
  PORTAL_JWT_AUDIENCE,
  PORTAL_RESET_CREATED_BY,
  PORTAL_RESET_TTL_MINUTES,
  PORTAL_TOKEN_TTL,
  portalEchoResetToken,
  portalJwtSecret,
} from "./portal.constants";
import type {
  PortalAcceptInviteInput,
  PortalForgotPasswordInput,
  PortalInviteCheckInput,
  PortalLoginInput,
  PortalResetPasswordInput,
} from "./portal.schemas";
import type { PortalAuthUser, PortalJwtPayload } from "./portal.types";
import { newPortalToken } from "./portal-token";

/**
 * Aynı e-posta için taranacak AZAMİ aday hesap sayısı.
 *
 * `PortalUser` benzersizliği `[tenantId, email]`'dir: aynı e-posta farklı
 * bürolarda portal hesabı olabilir (bir şirketin muhasebecisi iki büroyla
 * çalışıyor olabilir). Giriş gövdesinde büro bilgisi yoksa adaylar parola ile
 * ayrıştırılır. Üst sınır, tek istekte ödenecek bcrypt maliyetini sabitler.
 */
const MAX_LOGIN_CANDIDATES = 5;

/**
 * Zamanlama farkını kapatmak için kullanılan sahte özet.
 *
 * Hesap yoksa `bcrypt.compare` hiç çalıştırılmazsa yanıt gözle görülür biçimde
 * hızlı döner ve "bu e-posta kayıtlı değil" bilgisi zamanlamadan okunabilir.
 * Bu sabit özet, var olmayan hesapta da bir tur bcrypt maliyeti ödetir.
 */
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.Vg5oS1yZ7O7z1nD8m5N4hL8kQ2Wa";

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  /**
   * DAR SAYAÇ — anahtar **IP ∧ e-posta** (5 hata → 15 dakika).
   *
   * Denetim bulgusu 9: bu sayaç eskiden YALNIZ e-posta ile anahtarlanıyordu ve
   * kiracı içermiyordu. Sonucu iki ayrı sorundu: (a) bir müvekkilin e-postasını
   * bilen herkes o hesabı hedefli biçimde kilitleyebiliyordu, (b) aynı e-posta
   * BAŞKA bürolarda da portal hesabıysa hepsi birlikte kilitleniyordu.
   * Anahtara IP eklenince saldırgan yalnızca kendi çıkışını kilitler.
   *
   * Dağıtık denemeye karşı ikinci ve KALICI duvar `PortalUser` satırındadır
   * (portal-account-lockout.ts) ve eşiği çok daha yüksektir.
   */
  private readonly lockout = new PortalLockoutStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: PortalAuditService
  ) {}

  /* ------------------------------------------------------------------ *
   * POST /portal/auth/login
   * ------------------------------------------------------------------ */

  async login(input: PortalLoginInput, ip: string) {
    // DAR SAYAÇ ANAHTARI: IP ∧ e-posta. Yalnız e-posta olsaydı, e-postayı bilen
    // herkes hesabı hedefli biçimde kilitleyebilirdi (denetim bulgusu 9).
    const narrowKey = `${ip}|${input.email}`;

    const locked = this.lockout.remainingLockSeconds(narrowKey);
    if (locked > 0) {
      throw new HttpException(
        `Çok fazla hatalı deneme yapıldı. Giriş bu bağlantı için geçici olarak ` +
          `kilitlendi; ${Math.ceil(locked / 60)} dakika sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const candidates = await this.prisma.client.portalUser.findMany({
      where: {
        email: input.email,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        email: true,
        fullName: true,
        passwordHash: true,
        isActive: true,
        failedAttempts: true,
        failureWindowEndsAt: true,
        lockedUntil: true,
        client: { select: { name: true, isActive: true } },
      },
      take: MAX_LOGIN_CANDIDATES,
      orderBy: { createdAt: "asc" },
    });

    // ── SABİT MALİYETLİ PAROLA KARŞILAŞTIRMASI (denetim bulgusu 10) ─────────
    //
    // Eskiden sahte özet turu YALNIZCA aday yokken çalışıyor, aday varsa 1..5
    // gerçek `bcrypt.compare` yapılıyordu. Yanıt süresi böylece "bu e-postayla
    // portal hesabı var mı ve kaç büroda var" bilgisini taşıyordu (rounds=10'da
    // tur başına ~60-100 ms — ölçülebilir bir fark). Portal kullanıcıları
    // müvekkillerdir; o listenin kendisi büronun müşteri listesidir.
    //
    // Artık aday sayısı ne olursa olsun DAİMA MAX_LOGIN_CANDIDATES tur çalışır;
    // eşleşme bulunduktan sonra da kalan turlar sahte özetle tamamlanır.
    let matched: (typeof candidates)[number] | undefined;
    for (let i = 0; i < MAX_LOGIN_CANDIDATES; i += 1) {
      const candidate = candidates[i];
      const hash = candidate?.passwordHash ?? DUMMY_HASH;
      const ok = await bcrypt.compare(input.password, hash);
      if (ok && candidate && !matched) matched = candidate;
    }

    // KALICI HESAP KİLİDİ — parola doğru olsa bile açılmaz.
    if (matched && accountLockRemainingSeconds(matched) > 0) {
      const remaining = accountLockRemainingSeconds(matched);
      throw new HttpException(
        `Bu hesap çok sayıda hatalı deneme nedeniyle geçici olarak kilitlendi; ` +
          `${Math.ceil(remaining / 60)} dakika sonra tekrar deneyin.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // TEK BİÇİMLİ HATA: "hesap yok", "parola yanlış", "hesap pasif" ve
    // "müvekkil kaydı pasif" durumlarının HEPSİ aynı mesajı döndürür.
    // Farklı mesajlar, portalda hangi e-postaların kayıtlı olduğunu sayan bir
    // tarayıcıya doğrudan bilgi verirdi.
    if (!matched || !matched.isActive || !matched.client.isActive) {
      this.lockout.recordFailure(narrowKey);
      // KALICI SAYAÇ YALNIZ PAROLASI EŞLEŞEN ADAYA YAZILIR (denetim bulgusu Ö-03).
      //
      // Eskiden `recordAccountFailures(candidates)` çağrılıyordu ve yorumu
      // "kiracılar arası yan etki yapısal olarak imkânsızdır" diyordu — kod tam
      // tersini yapıyordu. `login` adayları e-postayla, `tenantId` süzgeci
      // OLMADAN çekiyor (arayüz `tenantId` hiç göndermiyor); yanlış parolayla
      // yapılan her deneme, o e-postanın kayıtlı olduğu HER BÜRODAKİ hesabın
      // sayacını artırıyordu. İki büronun portalında hesabı olan bir mali
      // müşavir, A'da 20 hatalı denemeyle B'deki hesabını da kilitliyordu.
      //
      // Artık: parola eşleşmişse (hesap pasif / müvekkil pasif dalı) yalnız O
      // kayda yazılır. Parola hiçbir adayla eşleşmediyse hiçbir kalıcı sayaç
      // yazılmaz; kaba kuvvete karşı savunma dar (IP ∧ e-posta) sayaçtır —
      // saldırganın başka kiracıdaki bir hesabı kilitleyebilmesi, o hesabın
      // parolasını zaten bilmesini gerektirir ki bu senaryoda kilit anlamsızdır.
      //
      // TEK ADAY İSTİSNASI: e-posta yalnız BİR kayıtla eşleşiyorsa belirsizlik
      // yoktur ve kalıcı sayaç yazılır. Bu, hesap kilidinin asıl amacını
      // (dağıtık kaba kuvvet) korur — vakaların ezici çoğunluğu budur — ve yan
      // etki üretebilecek tek durum olan ÇOK ADAYLI hâli dışarıda bırakır.
      await this.recordAccountFailures(
        matched ? [matched] : candidates.length === 1 ? candidates : [],
      );
      if (matched) {
        await this.audit.log({
          tenantId: matched.tenantId,
          portalUserId: matched.id,
          action: "PORTAL_LOGIN_FAILED",
          ipAddress: ip,
          resourceType: "PortalUser",
          resourceId: matched.id,
        });
      }
      throw new UnauthorizedException("E-posta veya parola hatalı.");
    }

    this.lockout.clear(narrowKey);

    const accessToken = await this.signToken(matched);

    await this.prisma.client.portalUser.update({
      where: { id: matched.id },
      data: { lastLoginAt: new Date(), ...CLEARED_ACCOUNT_LOCKOUT },
    });

    await this.audit.log({
      tenantId: matched.tenantId,
      portalUserId: matched.id,
      action: "PORTAL_LOGIN",
      ipAddress: ip,
      resourceType: "PortalUser",
      resourceId: matched.id,
    });

    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: PORTAL_TOKEN_TTL,
      portalUser: {
        id: matched.id,
        email: matched.email,
        fullName: matched.fullName,
        clientId: matched.clientId,
        clientName: matched.client.name,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * POST /portal/auth/accept-invite
   * ------------------------------------------------------------------ */

  /**
   * Daveti kabul eder ve portal hesabını AÇAR.
   *
   * Davet token'ı YALNIZCA hesap açar. Parola sıfırlama token'ları aynı
   * tabloda durur ama `createdBy` sentineliyle ayrılır; bir sıfırlama
   * bağlantısı buradan hesap açamaz (bkz. portal.constants.ts).
   */
  async acceptInvite(input: PortalAcceptInviteInput, ip: string) {
    const tokenHash = hashPortalToken(input.token);
    const invite = await this.prisma.client.portalInvite.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        createdBy: true,
        client: { select: { name: true, isActive: true } },
      },
    });

    // Geçersiz / kullanılmış / süresi dolmuş / yanlış türdeki token: TEK mesaj.
    if (
      !invite ||
      invite.usedAt ||
      invite.expiresAt <= new Date() ||
      invite.createdBy === PORTAL_RESET_CREATED_BY
    ) {
      throw new BadRequestException(
        "Davet bağlantısı geçersiz veya süresi dolmuş. Avukatınızdan yeni davet isteyin."
      );
    }
    if (!invite.client.isActive) {
      throw new BadRequestException(
        "Bu müvekkil kaydı için portal erişimi kapalıdır. Avukatınızla görüşün."
      );
    }

    const existing = await this.prisma.client.portalUser.findUnique({
      where: { tenantId_email: { tenantId: invite.tenantId, email: invite.email } },
      select: { id: true },
    });
    if (existing) {
      // Davet zaten bir hesaba dönüşmüş. Token'ı burada da tüketiyoruz ki
      // elde kalan bağlantı bir daha denenemesin.
      await this.prisma.client.portalInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
      throw new BadRequestException(
        "Bu e-posta için zaten bir portal hesabı var. Giriş yapın ya da parolanızı sıfırlayın."
      );
    }

    const passwordHash = await bcrypt.hash(input.password, PORTAL_BCRYPT_ROUNDS);
    const now = new Date();

    // Hesap açma ve davet tüketimi TEK İŞLEMDE: token'ın iki hesap açması
    // (yarış durumu) mümkün olmamalıdır.
    const created = await this.prisma.client.$transaction(async (tx) => {
      const consumed = await tx.portalInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: now },
      });
      if (consumed.count === 0) {
        throw new BadRequestException("Davet bağlantısı geçersiz veya süresi dolmuş.");
      }
      return tx.portalUser.create({
        data: {
          tenantId: invite.tenantId,
          clientId: invite.clientId,
          email: invite.email,
          fullName: input.fullName,
          passwordHash,
          isActive: true,
          invitedBy: invite.createdBy,
          invitedAt: now,
          activatedAt: now,
        },
        select: { id: true, tenantId: true, email: true, fullName: true },
      });
    });

    await this.audit.log({
      tenantId: created.tenantId,
      portalUserId: created.id,
      action: "PORTAL_INVITE_ACCEPTED",
      ipAddress: ip,
      resourceType: "PortalUser",
      resourceId: created.id,
    });

    // OTURUM DOĞRUDAN AÇILIR. Müvekkil daveti kabul ederken hem token'a sahip
    // olduğunu hem de kendi belirlediği parolayı bildiğini kanıtlamıştır;
    // ardından "şimdi bir de giriş yapın" demek, aynı kanıtı ikinci kez
    // istemekten başka bir şey yapmaz. Yanıt biçimi `login` ile AYNIDIR ki
    // arayüz iki akışı tek kod yoluyla işleyebilsin.
    const accessToken = await this.signToken({
      id: created.id,
      tenantId: created.tenantId,
      clientId: invite.clientId,
    });

    return {
      ok: true,
      message: "Portal hesabınız oluşturuldu.",
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: PORTAL_TOKEN_TTL,
      portalUser: {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
        clientId: invite.clientId,
        clientName: invite.client.name,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * POST /portal/auth/invite/check
   * ------------------------------------------------------------------ */

  /**
   * Davetin geçerliliğini ve kime açıldığını bildirir (ekran ön kontrolü).
   *
   * Token GÖVDEDE gelir — yolda değil (bkz. portal.schemas.ts). Dönen bilgi,
   * token'ı elinde tutanın zaten öğreneceği bilgidir: kendi e-postası ve bağlı
   * olduğu müvekkil kaydının adı. Geçersiz/kullanılmış/süresi dolmuş token
   * için `valid: false` döner; NEDEN geçersiz olduğu söylenmez.
   */
  async checkInvite(input: PortalInviteCheckInput) {
    const invite = await this.prisma.client.portalInvite.findFirst({
      where: { tokenHash: hashPortalToken(input.token) },
      select: {
        email: true,
        expiresAt: true,
        usedAt: true,
        createdBy: true,
        tenantId: true,
        client: { select: { name: true, isActive: true } },
      },
    });

    const usable =
      invite !== null &&
      invite.usedAt === null &&
      invite.expiresAt > new Date() &&
      invite.createdBy !== PORTAL_RESET_CREATED_BY &&
      invite.client.isActive;

    if (!invite || !usable) {
      return {
        valid: false as const,
        message:
          "Davet bağlantısı geçersiz veya süresi dolmuş. Avukatınızdan yeni davet isteyin.",
      };
    }

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: invite.tenantId },
      select: { name: true },
    });

    return {
      valid: true as const,
      email: invite.email,
      clientName: invite.client.name,
      officeName: tenant?.name ?? null,
      expiresAt: invite.expiresAt,
    };
  }

  /* ------------------------------------------------------------------ *
   * POST /portal/auth/forgot-password
   * ------------------------------------------------------------------ */

  /**
   * Parola sıfırlama talebi.
   *
   * HESAP OLSUN OLMASIN AYNI YANIT DÖNER. Aksi hâlde uç, hangi e-postaların
   * portalda kayıtlı olduğunu sayan ücretsiz bir araca dönerdi — ve portal
   * kullanıcıları müvekkillerdir, yani listenin kendisi müşteri listesidir.
   *
   * E-POSTA GÖNDERİMİ YOKTUR: portal için bir e-posta sağlayıcısı
   * yapılandırılmamıştır. Sahte bir "gönderildi" akışı UYDURULMAZ; token
   * üretilir, özeti saklanır ve gerçek gönderim altyapısı bağlandığında
   * buradan tetiklenir. Geliştirme ortamında ham token, açık bir ortam
   * değişkeniyle (PORTAL_DEV_ECHO_RESET_TOKEN) yanıta eklenebilir.
   */
  async forgotPassword(input: PortalForgotPasswordInput, ip: string) {
    const genericResponse = {
      ok: true as const,
      message:
        "Bu e-posta portalda kayıtlıysa parola sıfırlama bağlantısı gönderilecektir. " +
        "Bağlantı ulaşmazsa avukatınızla görüşün.",
    };

    // DETERMİNİSTİK SEÇİM (denetim bulgusu Ö-04).
    //
    // Eskiden `findFirst` `orderBy` OLMADAN çağrılıyordu; aynı e-posta birden
    // çok kiracıda kayıtlıysa (`@@unique([tenantId,email])` buna izin verir)
    // hangi hesabın parolasının sıfırlanacağı veritabanının döndürme sırasına
    // kalıyordu. Kullanıcı Büro B'de sıfırlama isteyip A'daki parolası
    // değişebiliyor, `resetPassword` `sessionsValidFrom`'u tazelediği için
    // A'daki açık oturumları da sessizce düşüyordu — üstelik yanıt bilinçli
    // olarak jenerik olduğu için hiçbir geri bildirim yoktu.
    //
    // Aynı dosyadaki `login()` zaten `orderBy: { createdAt: "asc" }` taşıyor;
    // ikisi artık AYNI hesabı seçer. Belirsizlik varsa (birden çok kiracı) ve
    // istemci `tenantId` göndermediyse hiçbir işlem yapılmaz — yanlış hesabın
    // parolasını sıfırlamaktansa jenerik yanıt döndürmek doğrudur.
    const matches = await this.prisma.client.portalUser.findMany({
      where: {
        email: input.email,
        isActive: true,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        client: { isActive: true },
      },
      select: { id: true, tenantId: true, clientId: true, email: true },
      orderBy: { createdAt: "asc" },
      take: MAX_LOGIN_CANDIDATES,
    });
    if (matches.length > 1) {
      this.logger.warn(
        `Parola sıfırlama isteği birden çok kiracıda eşleşti (${matches.length}); ` +
          "tenantId belirtilmediği için işlem yapılmadı.",
      );
      return genericResponse;
    }
    const user = matches[0];
    if (!user) return genericResponse;

    const raw = newPortalToken();
    const expiresAt = new Date(Date.now() + PORTAL_RESET_TTL_MINUTES * 60_000);

    // Aynı hesap için bekleyen eski sıfırlama talepleri tüketilir: elde birden
    // çok geçerli bağlantı kalmasın.
    await this.prisma.client.portalInvite.updateMany({
      where: {
        tenantId: user.tenantId,
        email: user.email,
        createdBy: PORTAL_RESET_CREATED_BY,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    await this.prisma.client.portalInvite.create({
      data: {
        tenantId: user.tenantId,
        clientId: user.clientId,
        email: user.email,
        tokenHash: hashPortalToken(raw),
        expiresAt,
        createdBy: PORTAL_RESET_CREATED_BY,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      portalUserId: user.id,
      action: "PORTAL_PASSWORD_RESET_REQUESTED",
      ipAddress: ip,
      resourceType: "PortalUser",
      resourceId: user.id,
    });

    if (portalEchoResetToken()) {
      this.logger.warn(
        "PORTAL_DEV_ECHO_RESET_TOKEN açık: sıfırlama token'ı yanıtta dönüyor. " +
          "Bu ayar üretimde ETKİSİZDİR."
      );
      return { ...genericResponse, devResetToken: raw, expiresAt };
    }
    return genericResponse;
  }

  /* ------------------------------------------------------------------ *
   * POST /portal/auth/reset-password
   * ------------------------------------------------------------------ */

  async resetPassword(input: PortalResetPasswordInput, ip: string) {
    const tokenHash = hashPortalToken(input.token);
    const record = await this.prisma.client.portalInvite.findFirst({
      where: { tokenHash, createdBy: PORTAL_RESET_CREATED_BY },
      select: { id: true, tenantId: true, email: true, expiresAt: true, usedAt: true },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException(
        "Sıfırlama bağlantısı geçersiz veya süresi dolmuş. Yeniden talep edin."
      );
    }

    const user = await this.prisma.client.portalUser.findUnique({
      where: { tenantId_email: { tenantId: record.tenantId, email: record.email } },
      select: { id: true, tenantId: true, isActive: true, client: { select: { isActive: true } } },
    });
    if (!user || !user.isActive || !user.client.isActive) {
      throw new BadRequestException(
        "Sıfırlama bağlantısı geçersiz veya süresi dolmuş. Yeniden talep edin."
      );
    }

    const passwordHash = await bcrypt.hash(input.password, PORTAL_BCRYPT_ROUNDS);
    await this.prisma.client.$transaction(async (tx) => {
      const consumed = await tx.portalInvite.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count === 0) {
        throw new BadRequestException("Sıfırlama bağlantısı zaten kullanılmış.");
      }
      await tx.portalUser.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // Kilit temizlenir: parolayı sıfırlayan meşru kullanıcı, önceki hatalı
          // denemelerin cezasını çekmemeli.
          ...CLEARED_ACCOUNT_LOCKOUT,
          // PAROLA DEĞİŞTİ → MEVCUT TÜM OTURUMLAR ÖLÜR. Parolasını "hesabım ele
          // geçirildi" diye sıfırlayan kullanıcının, saldırganın elindeki
          // token'ın 8 saat daha yaşadığını öğrenmesi kabul edilemez.
          sessionsValidFrom: new Date(),
        },
      });
    });

    // Dar (IP ∧ e-posta) sayaç bellek içidir ve anahtarı IP taşır; belirli bir
    // IP'nin sayacını buradan temizleyemeyiz. Kalıcı hesap sayacı yukarıda
    // sıfırlandı; dar sayaç zaten en fazla 15 dakikada kendiliğinden düşer.

    await this.audit.log({
      tenantId: user.tenantId,
      portalUserId: user.id,
      action: "PORTAL_PASSWORD_RESET",
      ipAddress: ip,
      resourceType: "PortalUser",
      resourceId: user.id,
    });

    return { ok: true, message: "Parolanız güncellendi. Yeni parolanızla giriş yapabilirsiniz." };
  }

  /* ------------------------------------------------------------------ *
   * GET /portal/auth/me
   * ------------------------------------------------------------------ */

  async me(user: PortalAuthUser) {
    const record = await this.prisma.client.portalUser.findFirst({
      where: { id: user.portalUserId, tenantId: user.tenantId },
      select: {
        id: true,
        email: true,
        fullName: true,
        clientId: true,
        lastLoginAt: true,
        activatedAt: true,
        client: { select: { id: true, name: true, type: true } },
      },
    });
    if (!record) throw new NotFoundException("Portal hesabı bulunamadı.");

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });

    return {
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      lastLoginAt: record.lastLoginAt,
      activatedAt: record.activatedAt,
      client: record.client,
      /** Büro adı — portal başlığında gösterilir (white-label). */
      officeName: tenant?.name ?? null,
    };
  }

  /* ------------------------------------------------------------------ *
   * POST /portal/auth/logout
   * ------------------------------------------------------------------ */

  /**
   * SUNUCU TARAFI ÇIKIŞ (denetim bulgusu 7).
   *
   * Önceden böyle bir uç YOKTU: arayüz `POST /portal/auth/logout` çağırıyor,
   * 404 alıyor ve yalnızca `localStorage`'ı siliyordu. Ortak bilgisayardan
   * çıkan bir müvekkilin token'ı 8 saat daha geçerli kalıyordu; o aradan
   * kopyalayan biri kullanabilirdi.
   *
   * Artık hesabın `sessionsValidFrom` damgası tazelenir ve bu andan ÖNCE
   * üretilmiş TÜM portal token'ları `PortalJwtGuard`'ın 6. kapısında düşer —
   * yalnız bu tarayıcıdaki değil, çalınmış olabilecek her kopya.
   */
  async logout(user: PortalAuthUser) {
    await this.prisma.client.portalUser.update({
      where: { id: user.portalUserId },
      data: { sessionsValidFrom: new Date() },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      portalUserId: user.portalUserId,
      action: "PORTAL_LOGOUT",
      ipAddress: user.ip,
      resourceType: "PortalUser",
      resourceId: user.portalUserId,
    });

    return {
      ok: true,
      message:
        "Oturumunuz kapatıldı. Bu hesap için daha önce üretilmiş tüm oturumlar da " +
        "geçersiz kılındı.",
    };
  }

  /* ------------------------------------------------------------------ *
   * Yardımcılar
   * ------------------------------------------------------------------ */

  /**
   * Hatalı denemeyi ADAY HESAPLARIN SATIRINA yazar.
   *
   * Yazma başarısız olursa giriş akışı bozulmaz: sayaç tutamamak, kullanıcıya
   * 500 döndürmek için yeterli bir gerekçe değildir (dar IP sayacı zaten
   * bellekte çalışmıştır).
   */
  private async recordAccountFailures(
    candidates: readonly {
      id: string;
      failedAttempts: number;
      failureWindowEndsAt: Date | null;
      lockedUntil: Date | null;
    }[]
  ): Promise<void> {
    const now = new Date();
    for (const candidate of candidates) {
      try {
        await this.prisma.client.portalUser.update({
          where: { id: candidate.id },
          data: recordAccountFailure(candidate, now),
        });
      } catch (err) {
        this.logger.warn(
          `Portal hesap kilidi sayacı yazılamadı (${candidate.id}): ${(err as Error).message}`
        );
      }
    }
  }

  private async signToken(user: {
    id: string;
    tenantId: string;
    clientId: string;
  }): Promise<string> {
    const payload: PortalJwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      clientId: user.clientId,
    };
    // AYRI ANAHTAR + AYRI AUDIENCE: bu token büro (/api/v1/**) ve panel
    // (/api/admin/v1/**) uçlarında imza ve audience aşamasında düşer.
    return this.jwtService.signAsync(payload, {
      secret: portalJwtSecret(),
      audience: PORTAL_JWT_AUDIENCE,
      expiresIn: PORTAL_TOKEN_TTL,
    });
  }
}
