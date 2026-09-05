import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { assertPasswordStrength } from "../common/password-strength";
import * as bcrypt from "bcryptjs";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { CLEARED_LOCKOUT } from "../common/account-lockout";
import { PASSWORD_HASH_ROUNDS } from "../auth/auth.constants";
import { TwoFactorService } from "../auth/two-factor.service";
import type { AuthUser } from "../common/types";
import type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from "./users.dto";

/**
 * BÜRO KULLANICI YÖNETİMİ — denetim bulgusu K-03.
 *
 * Bu servis HİÇ YOKTU: `apps/api/src/users/` altında yalnız tek `GET` taşıyan
 * bir controller vardı. Sonucu: sızmış bir avukat parolası ürün üzerinden
 * kapatılamıyor, işten ayrılan bir çalışanın erişimi kesilemiyor, yanlış
 * verilmiş bir rol düzeltilemiyordu — hepsi doğrudan `psql` müdahalesi
 * gerektiriyordu.
 *
 * ── YETKİ ──────────────────────────────────────────────────────────────────
 * Tüm yazma uçları `ROLE_SETS.ONAY` (ADMIN/PARTNER). Bu bir BÜRO YÖNETİM
 * işlemidir; avukat kendi meslektaşının rolünü değiştirememelidir.
 *
 * ── KENDİ KENDİNİ KİLİTLEME KORUMASI ───────────────────────────────────────
 * Büroda en az bir aktif ADMIN/PARTNER kalmalıdır. `platform-users.service.ts`
 * tarafındaki `assertNotLastSuperAdmin` deseniyle aynı gerekçe: son yöneticiyi
 * pasifleştiren ya da rolünü düşüren bir istek, büroyu kalıcı olarak
 * yönetilemez hâle getirirdi.
 */

/** Yanıt beyaz listesi — parola karması ve kilit sayaçları DÖNMEZ. */
const USER_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  fullName: true,
  role: true,
  barNumber: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly twoFactor: TwoFactorService
  ) {}

  /**
   * GET /users — atama seçicileri için sadeleştirilmiş liste.
   *
   * VERİ MİNİMİZASYONU: yalnızca atama için gereken alanlar döner (kimlik, ad,
   * rol). E-posta ve baro sicili BU UÇTAN DÖNMEZ.
   *
   * ROL KAPISI (denetim bulgusu İ-03): eskiden kapı yoktu ve STAJYER token'ı ile
   * tüm büro personelinin rol dağılımı okunabiliyordu. Rol dağılımı iç bilgidir;
   * atama seçicisini besleyen ekranlar HUKUKI rolündedir.
   */
  async listForAssignment(user: AuthUser) {
    assertRole(user, ROLE_SETS.OPERASYON, "büro personel listesini görüntüleme");
    return this.prisma.client.user.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      select: { id: true, fullName: true, role: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: 200, // İ-05: sunucu tavanına (200) uydur — 500 istense de sessizce 200'e düşer
    });
  }

  /** GET /users/manage — yönetim listesi (e-posta ve kilit durumu dâhil). */
  async listForManagement(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcı yönetimi");
    const rows = await this.prisma.client.user.findMany({
      where: { tenantId: user.tenantId },
      select: { ...USER_PUBLIC_SELECT, lockedUntil: true, twoFactorSecret: true },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
      take: 200, // İ-05: sunucu tavanına (200) uydur
    });
    const now = Date.now();
    return rows.map(({ lockedUntil, twoFactorSecret, ...rest }) => ({
      ...rest,
      /** Hesap şu anda kilitli mi — sayaç değerleri yanıta konmaz. */
      isLocked: lockedUntil !== null && lockedUntil.getTime() > now,
      /** 2FA kurulu mu — gizli anahtar ASLA dönmez. */
      twoFactorEnabled: twoFactorSecret !== null,
    }));
  }

  /**
   * YÖNETİCİ 2FA SIFIRLAMASI (cihaz kaybı). Anahtar silinir, oturumlar düşer;
   * büro politikası zorunluysa kullanıcı bir sonraki girişte yeniden kurar.
   * Kendi 2FA'sını yönetici bu yoldan sıfırlayamaz (kapatma ucu parola+kod ister).
   */
  async resetTwoFactor(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcısının 2FA sıfırlaması");
    if (id === user.userId) {
      throw new ForbiddenException("Kendi iki adımlı doğrulamanızı buradan sıfırlayamazsınız; Güvenlik ayarlarından parola + kod ile kapatın.");
    }
    const target = await this.requireUser(user.tenantId, id);
    await this.twoFactor.adminReset(user, target.id, target.email);
    return { ok: true as const, message: `${target.fullName} için 2FA sıfırlandı; tüm oturumları düşürüldü.` };
  }

  /**
   * KOLTUK SINIRI (Faz 0 gelir kaçağı): büro, aboneliğindeki koltuk sayısından
   * ve planın `maxUsers` tavanından fazla AKTİF kullanıcı açamaz. Aboneliği
   * olmayan kiracı sınırlanmaz (kayıt eksikliği erişim kararı değildir).
   */
  private async assertSeatAvailable(tenantId: string): Promise<void> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { tenantId },
      select: { seats: true, planKey: true },
    });
    if (!subscription) return;
    const plan = await this.prisma.client.planTier.findUnique({
      where: { key: subscription.planKey },
      select: { maxUsers: true, name: true },
    });
    const limit = plan?.maxUsers != null ? Math.min(subscription.seats, plan.maxUsers) : subscription.seats;
    const active = await this.prisma.client.user.count({ where: { tenantId, isActive: true } });
    if (active >= limit) {
      throw new ConflictException(
        `Koltuk sınırı: aboneliğiniz ${limit} aktif kullanıcı içeriyor (şu an ${active}). ` +
          "Kullanıcı eklemek için bir kullanıcıyı pasifleştirin ya da koltuk sayısını artırın.",
      );
    }
  }

  /** POST /users */
  async create(user: AuthUser, input: CreateUserInput) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcısı oluşturma");

    // `User.email` GLOBAL olarak tekildir (şemada `@unique`, bileşik değil):
    // aynı e-posta başka bir büroda kayıtlıysa da çakışır. Hata mesajı bu ayrımı
    // AÇMAZ — başka bir büronun kullanıcı listesini sızdırmamak için.
    const existing = await this.prisma.client.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException("Bu e-posta adresi zaten kullanılıyor.");
    }
    // Faz 4: parola gücü (zxcvbn ≥ 3; e-posta/ad soyad parçası içeremez).
    assertPasswordStrength(input.password, [input.email, input.fullName]);
    await this.assertSeatAvailable(user.tenantId);

    const created = await this.prisma.client.user.create({
      data: {
        tenantId: user.tenantId,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        barNumber: input.barNumber?.trim() || null,
        passwordHash: await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS),
      },
      select: USER_PUBLIC_SELECT,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "USER_CREATE",
      entity: "User",
      entityId: created.id,
      detail: `${created.email} (${created.role})`,
    });
    return created;
  }

  /** PATCH /users/:id */
  async update(user: AuthUser, id: string, input: UpdateUserInput) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcısı güncelleme");
    const target = await this.requireUser(user.tenantId, id);

    const losingAdmin =
      (input.isActive === false && target.isActive) ||
      (input.role !== undefined &&
        !ROLE_SETS.ONAY.includes(input.role) &&
        ROLE_SETS.ONAY.includes(target.role));
    if (losingAdmin) {
      await this.assertNotLastAdmin(user.tenantId, target.id);
    }

    const deactivating = input.isActive === false && target.isActive;
    // Yeniden etkinleştirme de koltuk tüketir.
    if (input.isActive === true && !target.isActive) await this.assertSeatAvailable(user.tenantId);

    const updated = await this.prisma.client.user.update({
      where: { id: target.id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.barNumber !== undefined ? { barNumber: input.barNumber ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        // PASİFLEŞTİRME OTURUMLARI DA DÜŞÜRÜR. `jwt-auth.guard.ts` `isActive`
        // kontrolü 30 sn önbellekli olduğu için tek başına ~30 sn gecikirdi;
        // damga tazelenince önbellekteki kayıt da geçersiz olur.
        ...(deactivating ? { sessionsValidFrom: new Date() } : {}),
        // Yeniden aktifleştirme kilidi temizler: hesap devredilmiş olabilir.
        ...(input.isActive === true ? { ...CLEARED_LOCKOUT, sessionsValidFrom: new Date() } : {}),
      },
      select: USER_PUBLIC_SELECT,
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: input.isActive === false ? "USER_DEACTIVATE" : "USER_UPDATE",
      entity: "User",
      entityId: target.id,
      detail: `${target.email} — güncellenen alanlar: ${Object.keys(input).join(", ")}`,
    });
    return updated;
  }

  /**
   * POST /users/:id/reset-password — yönetici parola sıfırlama (K-03 Senaryo A).
   *
   * Sızmış bir avukat parolasının ürün içindeki KAPATMA yolu budur. Hedefin tüm
   * oturumları düşer: yalnız parolayı değiştirmek, saldırganın elindeki 12
   * saatlik token'ı geçersiz kılmazdı.
   */
  async resetPassword(user: AuthUser, id: string, input: ResetUserPasswordInput) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcısının parolasını sıfırlama");
    const target = await this.requireUser(user.tenantId, id);

    await this.prisma.client.user.update({
      where: { id: target.id },
      data: {
        passwordHash: await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS),
        sessionsValidFrom: new Date(),
        ...CLEARED_LOCKOUT,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "USER_PASSWORD_RESET",
      entity: "User",
      entityId: target.id,
      detail: `${target.email} — parola yönetici tarafından sıfırlandı, tüm oturumlar düşürüldü.`,
    });

    return {
      ok: true as const,
      message:
        `${target.fullName} kullanıcısının parolası değiştirildi ve açık tüm oturumları ` +
        "düşürüldü. Yeni parolayı kullanıcıya güvenli bir kanaldan iletin.",
    };
  }

  /**
   * POST /users/:id/revoke-sessions — parolaya dokunmadan oturumları düşürür.
   *
   * "Telefonumu kaybettim" senaryosu: parola sızmamıştır, ama açık oturumlar
   * kapatılmalıdır.
   */
  async revokeSessions(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcısının oturumlarını düşürme");
    const target = await this.requireUser(user.tenantId, id);

    await this.prisma.client.user.update({
      where: { id: target.id },
      data: { sessionsValidFrom: new Date() },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "USER_SESSIONS_REVOKED",
      entity: "User",
      entityId: target.id,
      detail: target.email,
    });
    return { ok: true as const, message: `${target.fullName} kullanıcısının tüm oturumları düşürüldü.` };
  }

  /** POST /users/:id/unlock — kilidi elle kaldırır. */
  async unlock(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "büro kullanıcısının hesap kilidini kaldırma");
    const target = await this.requireUser(user.tenantId, id);
    await this.prisma.client.user.update({ where: { id: target.id }, data: CLEARED_LOCKOUT });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "USER_UNLOCK",
      entity: "User",
      entityId: target.id,
      detail: target.email,
    });
    return { ok: true as const, message: `${target.fullName} hesabının kilidi kaldırıldı.` };
  }

  // ---------------------------------------------------------------- yardımcı

  private async requireUser(tenantId: string, id: string) {
    const found = await this.prisma.client.user.findFirst({
      where: { id, tenantId },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
    if (!found) throw new NotFoundException("Kullanıcı bulunamadı.");
    return found;
  }

  /**
   * Büroda en az bir aktif ADMIN/PARTNER kalmalıdır.
   *
   * Aksi hâlde büro kalıcı olarak yönetilemez hâle gelirdi: kullanıcı açacak,
   * rol verecek, parola sıfırlayacak kimse kalmaz ve kurtarma yalnız doğrudan
   * SQL müdahalesi olurdu — tam olarak bu düzeltmenin ortadan kaldırdığı durum.
   */
  private async assertNotLastAdmin(tenantId: string, excludeUserId: string): Promise<void> {
    const remaining = await this.prisma.client.user.count({
      where: {
        tenantId,
        isActive: true,
        role: { in: ROLE_SETS.ONAY },
        NOT: { id: excludeUserId },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        "Büroda en az bir aktif yönetici (ADMIN) veya ortak (PARTNER) kalmalıdır. " +
          "Önce başka bir kullanıcıya yönetici yetkisi verin.",
      );
    }
  }
}
