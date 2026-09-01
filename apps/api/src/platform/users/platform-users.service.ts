import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { PlatformApprovalsService } from "../approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../approvals/approval-actions";
import { MIN_ACTIVE_SUPER_ADMINS } from "../platform.constants";
import { superAdminFloorViolation } from "./super-admin-floor";
import { canMutate } from "../platform-permissions";
import type { PlatformAuthUser } from "../platform.types";
import type { PlatformUserCreateInput, PlatformUserPatchInput } from "./platform-users.schemas";

/** bcrypt maliyeti — üç kimlik alanında da 12 (denetim bulgusu İ-02/F2-Ö-01). */
const BCRYPT_ROUNDS = 12;

/**
 * PANEL PERSONELİ YÖNETİMİ — yalnızca SUPER_ADMIN.
 *
 * DÖRT KORUMA (spec §İş Kuralları 5, 15 + kabul kriteri 11):
 *   1. **Self-signup yoktur**: hesaplar yalnız mevcut bir SUPER_ADMIN
 *      tarafından açılır.
 *   2. **En az iki aktif SUPER_ADMIN**: sonuncusu silinemez, pasifleştirilemez,
 *      rolü düşürülemez. Aksi hâlde dört-göz işlemleri kalıcı olarak kilitlenir.
 *   3. **Kimse kendi rolünü değiştiremez / kendini pasifleştiremez**: yetki
 *      yükseltmenin en kısa yolu budur.
 *   4. **SUPER_ADMIN ataması dört-göz onayına tabidir** (matris:
 *      platform_user.assign_super_admin → four_eyes).
 *
 * HARD DELETE YOKTUR: silme, `isActive=false` demektir. Denetim izindeki
 * `platformUserId` bağının kopmaması, "kim yaptı" sorusunun 10 yıl sonra da
 * yanıtlanabilmesi için şarttır.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly approvals: PlatformApprovalsService
  ) {}

  async list() {
    const rows = await this.prisma.client.platformUser.findMany({
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { fullName: "asc" }],
      // Alan bazlı beyaz liste: `twoFactorSecret` ve `passwordHash` HİÇBİR
      // yanıtta yer almaz.
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        twoFactorSecret: true,
        lockedUntil: true,
        failedAttempts: true,
      },
    });
    const now = Date.now();
    return {
      items: rows.map(({ twoFactorSecret, lockedUntil, ...rest }) => ({
        ...rest,
        twoFactorReady: Boolean(twoFactorSecret),
        /** Kaba kuvvet kilidi — kilidi BAŞKA bir SUPER_ADMIN açar. */
        locked: Boolean(lockedUntil && lockedUntil.getTime() > now),
        lockedUntil,
      })),
      total: rows.length,
      activeSuperAdmins: rows.filter((r) => r.isActive && r.role === "SUPER_ADMIN").length,
      note: `Sistemde her an en az ${MIN_ACTIVE_SUPER_ADMINS} aktif SUPER_ADMIN bulunmalıdır.`,
    };
  }

  /**
   * PANEL PERSONELİ AÇMA — HER ROL İÇİN DÖRT-GÖZ.
   *
   * Eskiden yalnız SUPER_ADMIN ataması onaya düşerdi; diğer roller DOĞRUDAN
   * açılırdı. Bu, dört-göz kuralını tek kişiyle delmenin en kısa yoluydu:
   * kendi iade talebini onaylatmak isteyen bir SUPER_ADMIN, `payment.refund`
   * yetkili bir BILLING_ADMIN açıp (parolasını kendisi belirlediği için) o
   * kimlikle kendi talebini onaylardı. "Talep eden ≠ onaylayan" ve "onaylayanın
   * yetkisi olmalı" kapılarının ikisi de biçimsel olarak sağlanır, fiilen
   * delinirdi (denetim bulgusu 1).
   *
   * Parola talep anında HASH'lenir; `payloadJson` düz parola taşımaz.
   */
  async create(user: PlatformAuthUser, input: PlatformUserCreateInput) {
    // denetim bulgusu K-11: hesap AÇMAK dört-göz olan ayrı bir aksiyondur.
    if (!canMutate(user.role, "platform_user.create")) {
      throw new ForbiddenException(
        "Rolünüz panel kullanıcısı açamaz; bu işlem dört-göz onayına tabidir."
      );
    }
    const existing = await this.prisma.client.platformUser.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new BadRequestException("Bu e-posta ile bir panel kullanıcısı zaten var.");
    }
    if (!input.reason || input.reason.trim().length < 10) {
      throw new BadRequestException(
        "Panel kullanıcısı açmak için en az 10 karakterlik gerekçe zorunludur; işlem " +
          "dört-göz onayına tabidir."
      );
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    if (input.role === "SUPER_ADMIN") {
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.PLATFORM_USER_SUPER_ADMIN,
        payload: {
          newUser: { email: input.email, fullName: input.fullName, passwordHash },
          reason: input.reason,
        },
        summary: `Yeni SUPER_ADMIN: ${input.email}.`,
      });
    }

    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.PLATFORM_USER_CREATE,
      payload: {
        newUser: {
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          role: input.role,
        },
        reason: input.reason,
      },
      summary: `Yeni panel kullanıcısı: ${input.email} (${input.role}). Gerekçe: ${input.reason}`,
    });
  }

  async patch(user: PlatformAuthUser, id: string, input: PlatformUserPatchInput) {
    const target = await this.prisma.client.platformUser.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("Panel kullanıcısı bulunamadı.");

    // KORUMA 3 — kendi rolünü/durumunu değiştirmek yasak.
    if (target.id === user.id && (input.role !== undefined || input.isActive !== undefined)) {
      throw new ForbiddenException(
        "Kendi rolünüzü veya hesap durumunuzu değiştiremezsiniz. Bu işlemi başka bir " +
          "SUPER_ADMIN yapmalıdır."
      );
    }

    // KORUMA 5 — KENDİ parolası/2FA'sı bu uçtan değişmez.
    // Burası "başkasının kimlik bilgisine dokunma" ucudur ve dört-göze tabidir;
    // kişinin kendi parolası mevcut parola + TOTP ile ayrı uçtan değişir.
    if (target.id === user.id && (input.password !== undefined || input.resetTwoFactor)) {
      throw new ForbiddenException(
        "Kendi parolanızı veya 2FA kaydınızı bu uçtan değiştiremezsiniz. " +
          "Parola için POST /auth/change-password ucunu kullanın (mevcut parola ve — 2FA " +
          "kuruluysa — doğrulama kodu gerekir)."
      );
    }

    /**
     * KORUMA 6 — BAŞKASININ PAROLASI / 2FA'SI DÖRT-GÖZE TABİDİR.
     *
     * Rol değişmediği için `PLATFORM_USER_SUPER_ADMIN` kuyruğu hiç tetiklenmiyor
     * ve bir SUPER_ADMIN, başka bir SUPER_ADMIN'in parolasını + 2FA'sını tek
     * istekte sıfırlayıp o kimliğe geçebiliyordu (denetim bulgusu 1). Kimlik
     * bilgisini ele geçirmek, dört-göz için gereken "ikinci insanı" üretmenin
     * ta kendisidir.
     */
    if (input.password !== undefined || input.resetTwoFactor) {
      /**
       * denetim bulgusu K-11: uç `platform_user.manage` ile bağlıdır (ad
       * düzeltme, kilit açma bu satırla doğrudan yapılır) ama KİMLİK BİLGİSİ
       * SIFIRLAMA kendi dört-göz satırına sahiptir. Guard karışık ucun en dar
       * seviyesini bilemez; kapıyı burada kuruyoruz ki yetki kararı yine
       * matristen gelsin, koda gömülü bir rol adından değil.
       */
      if (!canMutate(user.role, "platform_user.credential_reset")) {
        throw new ForbiddenException(
          "Rolünüz başka bir panel kullanıcısının parolasını/2FA kaydını sıfırlayamaz."
        );
      }
      if (!input.reason || input.reason.trim().length < 10) {
        throw new BadRequestException(
          "Başka bir panel kullanıcısının parolasını/2FA kaydını sıfırlamak için en az " +
            "10 karakterlik gerekçe zorunludur; işlem dört-göz onayına tabidir."
        );
      }
      if (input.role !== undefined || input.isActive !== undefined || input.fullName !== undefined) {
        throw new BadRequestException(
          "Kimlik bilgisi sıfırlaması (parola / 2FA) dört-göz onayına tabidir ve aynı " +
            "istekte rol, durum ya da ad değişikliğiyle birlikte gönderilemez. Ayrı istek gönderin."
        );
      }
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.PLATFORM_USER_CREDENTIAL_RESET,
        payload: {
          targetUserId: id,
          ...(input.password !== undefined
            ? { passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) }
            : {}),
          resetTwoFactor: Boolean(input.resetTwoFactor),
          reason: input.reason,
        },
        summary:
          `${target.email} için ` +
          [input.password !== undefined ? "parola sıfırlama" : null, input.resetTwoFactor ? "2FA sıfırlama" : null]
            .filter(Boolean)
            .join(" + ") +
          `. Gerekçe: ${input.reason}`,
      });
    }

    // KORUMA 4 — SUPER_ADMIN'e yükseltme dört-göz.
    if (input.role === "SUPER_ADMIN" && target.role !== "SUPER_ADMIN") {
      if (!input.reason || input.reason.trim().length < 10) {
        throw new BadRequestException(
          "SUPER_ADMIN ataması için en az 10 karakterlik gerekçe zorunludur."
        );
      }
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.PLATFORM_USER_SUPER_ADMIN,
        payload: { targetUserId: id, reason: input.reason },
        summary: `${target.email} rolü ${target.role} → SUPER_ADMIN olacak.`,
      });
    }

    /**
     * KORUMA 2 — SUPER_ADMIN'İ DÜŞÜRMEK / PASİFLEŞTİRMEK DE DÖRT-GÖZDÜR.
     *
     * denetim bulgusu Ö-02: spec §Roller madde 7 "yeni SUPER_ADMIN atama /
     * mevcut SUPER_ADMIN'i DÜŞÜRME" der, kodda yalnız ATAMA onaya düşüyordu.
     * Düşürme tek imzalı olduğu sürece tek kişi sistemi taban sayının altına
     * indirip TÜM dört-göz işlemlerini kilitleyebilirdi.
     *
     * Eşik de düzeltildi: `remaining === 0` değil, `remaining <
     * MIN_ACTIVE_SUPER_ADMINS` (bkz. super-admin-floor.ts). Burada YALNIZCA
     * erken geri bildirim için bakılır; bağlayıcı sayım onay anında
     * transaction içinde yapılır.
     */
    const losesSuperAdmin =
      target.role === "SUPER_ADMIN" &&
      ((input.role !== undefined && input.role !== "SUPER_ADMIN") || input.isActive === false);
    if (losesSuperAdmin) {
      await this.assertSuperAdminFloor(target.id);
      if (!input.reason || input.reason.trim().length < 10) {
        throw new BadRequestException(
          "SUPER_ADMIN rolünü düşürmek veya hesabı pasifleştirmek için en az 10 karakterlik " +
            "gerekçe zorunludur; işlem dört-göz onayına tabidir."
        );
      }
      const mode = input.isActive === false ? "deactivate" : "demote";
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.PLATFORM_USER_SUPER_ADMIN,
        payload: { targetUserId: id, mode, reason: input.reason },
        summary:
          mode === "deactivate"
            ? `${target.email} (SUPER_ADMIN) pasifleştirilecek.`
            : `${target.email} rolü SUPER_ADMIN → ${input.role} olacak.`,
      });
    }

    const data: Prisma.PlatformUserUpdateInput = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.role !== undefined) data.role = input.role;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    /**
     * ROL DEĞİŞİMİ AÇIK OTURUMLARI DÜŞÜRÜR.
     *
     * Guard rolü DB'den tazelediği için yetki anında daralır; yine de oturum
     * sürümü artırılır: rol düşürme çoğu zaman "bu kişiye artık güvenmiyoruz"
     * demektir ve o hâlde elindeki token'ın hiç yaşamaması gerekir.
     */
    if (input.role !== undefined && input.role !== target.role) {
      data.tokenVersion = { increment: 1 };
    }

    const updated = await this.prisma.client.platformUser.update({
      where: { id },
      data,
      select: { id: true, email: true, role: true, isActive: true },
    });

    await this.audit.log({
      actor: user,
      action: "PLATFORM_USER_UPDATE",
      entity: "PlatformUser",
      entityId: id,
      detail:
        `${target.email} güncellendi. Rol ${target.role} → ${updated.role}, ` +
        `durum ${target.isActive ? "aktif" : "pasif"} → ${updated.isActive ? "aktif" : "pasif"}.` +
        `${input.role !== undefined && input.role !== target.role ? " Açık oturumları sonlandırıldı." : ""}` +
        `${input.reason ? ` Gerekçe: ${input.reason}` : ""}`,
    });

    return updated;
  }

  /** "Silme" = pasifleştirme. Kalıcı silme yoktur (denetim izi kopmasın). */
  async deactivate(user: PlatformAuthUser, id: string) {
    const target = await this.prisma.client.platformUser.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("Panel kullanıcısı bulunamadı.");
    if (target.id === user.id) {
      throw new ForbiddenException("Kendi hesabınızı pasifleştiremezsiniz.");
    }
    if (!target.isActive) {
      throw new BadRequestException("Bu hesap zaten pasif.");
    }
    /**
     * denetim bulgusu Ö-02: SUPER_ADMIN'i pasifleştirmek TEK İMZAYLA
     * yapılabiliyordu (`approvals.request` çağrısı yoktu). Artık onay talebine
     * dönüşür; bağlayıcı taban sayımı onay anında transaction içinde yapılır.
     */
    if (target.role === "SUPER_ADMIN") {
      await this.assertSuperAdminFloor(target.id);
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.PLATFORM_USER_SUPER_ADMIN,
        payload: {
          targetUserId: id,
          mode: "deactivate",
          reason: `${target.email} (SUPER_ADMIN) pasifleştirme talebi.`,
        },
        summary:
          `${target.email} (SUPER_ADMIN) pasifleştirilecek. Sistemde her an en az ` +
          `${MIN_ACTIVE_SUPER_ADMINS} aktif SUPER_ADMIN bulunmalıdır.`,
      });
    }

    await this.prisma.client.platformUser.update({
      where: { id },
      // Oturum sürümü de artırılır: guard `isActive`'i zaten her istekte
      // tazeliyor, ama pasifleştirme bir "erişimi kes" kararıdır ve iki kapının
      // birden kapanması doğrudur.
      data: { isActive: false, tokenVersion: { increment: 1 } },
    });

    await this.audit.log({
      actor: user,
      action: "PLATFORM_USER_DEACTIVATE",
      entity: "PlatformUser",
      entityId: id,
      detail: `${target.email} (${target.role}) pasifleştirildi. Kayıt SİLİNMEDİ.`,
    });

    return {
      id,
      isActive: false,
      message:
        "Hesap pasifleştirildi. Kayıt silinmez; denetim izindeki bağ korunur. " +
        "Kullanıcının mevcut oturumu bir sonraki istekte reddedilir.",
    };
  }

  /**
   * SUPER_ADMIN TABANI — denetim bulgusu Ö-02.
   *
   * Eski kapı `remaining === 0` idi: sistem TEK SUPER_ADMIN'e düşürülebiliyordu
   * ve o noktada "talep eden ≠ onaylayan" kuralı yüzünden hiçbir dört-göz
   * işlemi bir daha tamamlanamıyordu. `MIN_ACTIVE_SUPER_ADMINS` sabiti
   * tanımlıydı ama hiçbir yerde EŞİK değildi — yalnız metinlerde geçiyordu.
   *
   * Karar `super-admin-floor.ts`teki saf fonksiyondadır ve iki yerde çağrılır:
   * burada (erken geri bildirim) ve onay uygulanırken transaction içinde
   * (bağlayıcı sayım — eşzamanlı iki onayın tabanı birlikte delmesini önler).
   */
  private async assertSuperAdminFloor(excludingId: string): Promise<void> {
    const remaining = await this.prisma.client.platformUser.count({
      where: { role: "SUPER_ADMIN", isActive: true, id: { not: excludingId } },
    });
    const violation = superAdminFloorViolation(remaining);
    if (violation) throw new BadRequestException(violation);
  }
}
