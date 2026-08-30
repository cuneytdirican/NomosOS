import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import { PlatformApprovalsService } from "../approvals/platform-approvals.service";
import { APPROVAL_ACTIONS } from "../approvals/approval-actions";
import { MAINTENANCE_SETTING_KEY } from "../platform.constants";
import { parseJson } from "../platform-serialize";
import type { PlatformAuthUser } from "../platform.types";
import {
  maintenanceValueSchema,
  type AnnouncementCreateInput,
  type AnnouncementPatchInput,
  type FlagCreateInput,
  type FlagPatchInput,
  type MaintenanceLockInput,
  type SettingPutInput,
} from "./platform-system.schemas";

/**
 * SİSTEM AYARLARI, ÖZELLİK BAYRAKLARI VE DUYURULAR.
 *
 * DÖRT-GÖZ SINIRI BURADA İNCEDİR ve bilinçli olarak öyledir:
 *   - Bakım BANNER'ı (yalnız uyarı) → olağan yazma.
 *   - Bakım TAM KİLİDİ (erişim kesme) → dört-göz.
 *   - Bayrağın TENANT ALLOWLIST'i (pilot açma) → olağan yazma.
 *   - Bayrağın PLATFORM GENELİ açılması → dört-göz.
 * Ayrım "kaç kullanıcıyı etkiler" sorusuna göredir: tek bir yanlış tıklamayla
 * tüm büroların erişimini kesebilecek işlemler tek kişiye bırakılmaz.
 */
@Injectable()
export class PlatformSystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly approvals: PlatformApprovalsService
  ) {}

  // ------------------------------------------------------------------ ayarlar

  async listSettings() {
    const rows = await this.prisma.client.systemSetting.findMany({ orderBy: { key: "asc" } });
    return {
      items: rows.map((r) => ({
        key: r.key,
        value: parseJson<unknown>(r.valueJson, null),
        description: r.description,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt,
      })),
      note:
        "Sır niteliğindeki değerler (API anahtarı, imza anahtarı, parola) bu tabloda " +
        "TUTULMAZ; ortam değişkenlerinde kalır.",
    };
  }

  async putSetting(user: PlatformAuthUser, key: string, input: SettingPutInput) {
    if (key === MAINTENANCE_SETTING_KEY) {
      // Bakım modu ayrı bir uçtan yönetilir: tam kilit dört-göz gerektirir ve
      // burada serbest JSON ile atlatılabilmemelidir.
      const parsed = maintenanceValueSchema.safeParse(input.value);
      if (!parsed.success) {
        throw new BadRequestException(
          "Bakım modu değeri { enabled, fullLock, message } biçiminde olmalıdır."
        );
      }
      if (parsed.data.fullLock) {
        throw new BadRequestException(
          "Bakım modu TAM KİLİDİ bu uçtan açılamaz; dört-göz onayı gerektirir. " +
            "POST /settings/maintenance-lock ucunu kullanın."
        );
      }
    }

    /**
     * SIR NİTELİĞİNDEKİ AYAR REDDEDİLİR — YORUM DEĞİL, KAPI.
     *
     * `listSettings()` notu "sır niteliğindeki değerler bu tabloda TUTULMAZ"
     * diyordu ama bunu hiçbir kontrol zorlamıyordu (denetim bulgusu 15). Bir
     * webhook secret'ı ya da API anahtarı yazıldığında değer hem tabloya hem de
     * 10 yıl saklanan, `audit.view` yetkisi olan HERKESE açık denetim satırına
     * düşerdi. Sırlar ortam değişkenlerinde ya da şifreli alanlarda durur.
     */
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        `"${key}" anahtarı sır niteliğinde görünüyor (secret/key/token/password/parola). ` +
          "Sistem ayarı tablosu düz metin JSON tutar ve değeri denetim izine yazar; " +
          "sırlar buraya YAZILAMAZ. Ortam değişkeni ya da şifreli sağlayıcı yapılandırması kullanın."
      );
    }

    const valueJson = JSON.stringify(input.value ?? null);
    const previous = await this.prisma.client.systemSetting.findUnique({ where: { key } });

    const saved = await this.prisma.client.systemSetting.upsert({
      where: { key },
      create: {
        key,
        valueJson,
        description: input.description ?? null,
        updatedBy: user.id,
      },
      update: {
        valueJson,
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedBy: user.id,
      },
    });

    await this.audit.log({
      actor: user,
      action: "SETTING_UPDATE",
      entity: "SystemSetting",
      entityId: key,
      // Denetim satırına HAM DEĞER değil, değişimin şekli yazılır: hangi
      // alanlar değişti, uzunluk ne oldu. Değerin kendisi ayar tablosunda
      // zaten duruyor; denetim izine kopyalamak sızıntı yüzeyini ikiye katlar.
      detail: `${key}: ${describeChange(previous?.valueJson ?? null, valueJson)}`,
    });

    return { key: saved.key, value: parseJson<unknown>(saved.valueJson, null) };
  }

  /** BAKIM MODU TAM KİLİDİ — dört-göz (spec dört-göz listesi #6). */
  async requestMaintenanceLock(user: PlatformAuthUser, input: MaintenanceLockInput) {
    return this.approvals.request(user, {
      action: APPROVAL_ACTIONS.SYSTEM_MAINTENANCE_LOCK,
      payload: { enabled: input.enabled, message: input.message, reason: input.reason },
      summary: `Bakım tam kilidi ${input.enabled ? "AÇILACAK" : "KAPATILACAK"}. Gerekçe: ${input.reason}`,
    });
  }

  // ------------------------------------------------------------------ bayraklar

  async listFlags() {
    const rows = await this.prisma.client.featureFlag.findMany({ orderBy: { key: "asc" } });
    return {
      items: rows.map((r) => ({
        id: r.id,
        key: r.key,
        description: r.description,
        isEnabledGlobally: r.isEnabledGlobally,
        enabledTenantIds: parseJson<string[]>(r.enabledTenantIdsJson, []),
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt,
      })),
      note:
        "Global açma/kapama dört-göz onayına tabidir; tenant allowlist değişikliği " +
        "olağan yazma işlemidir.",
    };
  }

  async createFlag(user: PlatformAuthUser, input: FlagCreateInput) {
    const existing = await this.prisma.client.featureFlag.findUnique({ where: { key: input.key } });
    if (existing) throw new BadRequestException(`"${input.key}" bayrağı zaten tanımlı.`);

    const flag = await this.prisma.client.featureFlag.create({
      data: {
        key: input.key,
        description: input.description ?? null,
        // Yeni bayrak DAİMA kapalı doğar; global açılış ayrı ve onaylı bir işlemdir.
        isEnabledGlobally: false,
        enabledTenantIdsJson: JSON.stringify(input.enabledTenantIds),
        updatedBy: user.id,
      },
    });

    await this.audit.log({
      actor: user,
      action: "FLAG_CREATE",
      entity: "FeatureFlag",
      entityId: flag.id,
      detail: `${flag.key} bayrağı oluşturuldu (${input.enabledTenantIds.length} pilot büro).`,
    });
    return { id: flag.id, key: flag.key, isEnabledGlobally: false };
  }

  async patchFlag(user: PlatformAuthUser, id: string, input: FlagPatchInput) {
    const flag = await this.prisma.client.featureFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException("Özellik bayrağı bulunamadı.");

    // Global değişiklik istendiyse: yazma burada DURUR, onay kuyruğuna gider.
    if (
      input.isEnabledGlobally !== undefined &&
      input.isEnabledGlobally !== flag.isEnabledGlobally
    ) {
      if (!input.reason || input.reason.trim().length < 10) {
        throw new BadRequestException(
          "Platform geneli bayrak değişikliği için en az 10 karakterlik gerekçe zorunludur."
        );
      }
      return this.approvals.request(user, {
        action: APPROVAL_ACTIONS.FEATURE_FLAG_GLOBAL,
        payload: {
          flagId: id,
          isEnabledGlobally: input.isEnabledGlobally,
          reason: input.reason,
        },
        summary: `"${flag.key}" bayrağı platform genelinde ${input.isEnabledGlobally ? "açılacak" : "kapatılacak"}.`,
      });
    }

    const data: Prisma.FeatureFlagUpdateInput = { updatedBy: user.id };
    if (input.description !== undefined) data.description = input.description;
    if (input.enabledTenantIds !== undefined) {
      data.enabledTenantIdsJson = JSON.stringify(input.enabledTenantIds);
    }

    const updated = await this.prisma.client.featureFlag.update({ where: { id }, data });
    await this.audit.log({
      actor: user,
      action: "FLAG_TOGGLE",
      entity: "FeatureFlag",
      entityId: id,
      detail:
        `${flag.key} güncellendi. Pilot büro sayısı: ` +
        `${parseJson<string[]>(flag.enabledTenantIdsJson, []).length} → ` +
        `${parseJson<string[]>(updated.enabledTenantIdsJson, []).length}.`,
    });

    return {
      approvalRequired: false,
      id: updated.id,
      key: updated.key,
      isEnabledGlobally: updated.isEnabledGlobally,
      enabledTenantIds: parseJson<string[]>(updated.enabledTenantIdsJson, []),
    };
  }

  // ----------------------------------------------------------------- duyurular

  async listAnnouncements(query: { activeOnly?: string }) {
    const where: Prisma.AnnouncementWhereInput = {};
    if (query.activeOnly === "true") {
      const now = new Date();
      where.publishedAt = { not: null, lte: now };
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
    }
    const rows = await this.prisma.client.announcement.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        severity: r.severity,
        audience: r.audience,
        target: parseJson<unknown>(r.targetJson, null),
        publishedAt: r.publishedAt,
        expiresAt: r.expiresAt,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        isPublished: Boolean(r.publishedAt && r.publishedAt <= new Date()),
      })),
      total: rows.length,
    };
  }

  async createAnnouncement(user: PlatformAuthUser, input: AnnouncementCreateInput) {
    this.assertTargetConsistency(input);
    const created = await this.prisma.client.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        severity: input.severity,
        audience: input.audience,
        targetJson: input.target ? JSON.stringify(input.target) : null,
        publishedAt: input.publishedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        createdBy: user.id,
      },
    });
    await this.audit.log({
      actor: user,
      action: "ANNOUNCEMENT_CREATE",
      entity: "Announcement",
      entityId: created.id,
      detail: `"${created.title}" (${created.severity}, ${created.audience}) oluşturuldu.`,
    });
    return { id: created.id, publishedAt: created.publishedAt };
  }

  async patchAnnouncement(user: PlatformAuthUser, id: string, input: AnnouncementPatchInput) {
    const existing = await this.prisma.client.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Duyuru bulunamadı.");
    this.assertTargetConsistency({
      audience: input.audience ?? existing.audience,
      target: input.target ?? parseJson<AnnouncementCreateInput["target"]>(existing.targetJson, null),
    });

    const data: Prisma.AnnouncementUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.severity !== undefined) data.severity = input.severity;
    if (input.audience !== undefined) data.audience = input.audience;
    if (input.target !== undefined) {
      data.targetJson = input.target ? JSON.stringify(input.target) : null;
    }
    if (input.publishedAt !== undefined) data.publishedAt = input.publishedAt;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;

    const updated = await this.prisma.client.announcement.update({ where: { id }, data });
    await this.audit.log({
      actor: user,
      action: "ANNOUNCEMENT_UPDATE",
      entity: "Announcement",
      entityId: id,
      detail: `"${updated.title}" güncellendi.`,
    });
    return { id: updated.id, publishedAt: updated.publishedAt };
  }

  async deleteAnnouncement(user: PlatformAuthUser, id: string) {
    const existing = await this.prisma.client.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Duyuru bulunamadı.");
    await this.prisma.client.announcement.delete({ where: { id } });
    await this.audit.log({
      actor: user,
      action: "ANNOUNCEMENT_DELETE",
      entity: "Announcement",
      entityId: id,
      detail: `"${existing.title}" silindi.`,
    });
    return { id, deleted: true };
  }

  /** Hedef kitle ile hedef listesi tutarlı mı? */
  private assertTargetConsistency(input: {
    audience?: AnnouncementCreateInput["audience"];
    target?: AnnouncementCreateInput["target"];
  }): void {
    if (input.audience === "PLAN_BAZLI" && !input.target?.planKeys?.length) {
      throw new BadRequestException("Plan bazlı duyuru için en az bir plan anahtarı gerekir.");
    }
    if (input.audience === "TENANT_BAZLI" && !input.target?.tenantIds?.length) {
      throw new BadRequestException("Büro bazlı duyuru için en az bir büro seçilmelidir.");
    }
  }
}

/**
 * Anahtar adı sır çağrıştırıyor mu? Eşleşen anahtarlar hiç yazılmaz.
 * Türkçe karşılıkları da (parola, sifre, gizli, anahtar) kapsanır.
 */
const SECRET_KEY_PATTERN =
  /secret|password|parola|sifre|şifre|token|api[_-]?key|private[_-]?key|credential|gizli|anahtar/i;

/**
 * Denetim izine yazılacak DEĞİŞİM ÖZETİ — ham değer değil.
 *
 * Amaç "ne değişti"yi gösterirken değeri ikinci bir yere kopyalamamaktır:
 * hangi alanların eklendiği/çıkarıldığı/değiştiği ve büyüklük özeti yazılır.
 * Skaler değerlerde yalnızca tür ve uzunluk bildirilir.
 */
function describeChange(previous: string | null, next: string): string {
  if (previous === null) return `yeni ayar yazıldı (${shape(next)})`;
  if (previous === next) return `değer değişmedi (${shape(next)})`;

  const before = safeParse(previous);
  const after = safeParse(next);
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    return changed.length > 0
      ? `değişen alanlar: ${changed.join(", ")} (${shape(previous)} → ${shape(next)})`
      : `alan değişmedi (${shape(previous)} → ${shape(next)})`;
  }
  return `değer güncellendi (${shape(previous)} → ${shape(next)})`;
}

function shape(json: string): string {
  const parsed = safeParse(json);
  const type = parsed === null ? "null" : Array.isArray(parsed) ? "dizi" : typeof parsed;
  return `${type}, ${json.length} karakter`;
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
