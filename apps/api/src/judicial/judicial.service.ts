/**
 * YARGI ORGANLARI + NOTERLER — referans katalog servisi.
 *
 * İKİ DÜNYA:
 *   1. BÜRO (tenant) tarafı: okuma — formlarda seçim listesi (mahkeme, icra
 *      dairesi, noter). Her rol okuyabilir; bu bir kataluktur, büro verisi değildir.
 *   2. PLATFORM tarafı: katalog yönetimi — ekleme/düzeltme/pasifleştirme,
 *      senkron ayarı ve periyodik/elle senkron.
 *
 * SENKRON (kullanıcı talebi: "sistem tarafında da listesini belli aralıklarla
 * güncelleyelim"): `judicial.sync.url` ayarlanmışsa zamanlayıcı her
 * `judicial.sync.intervalHours` saatte kaynağı çeker ve kataloğu UPSERT eder
 * (yeni kayıt ekler, varsa ad/ili günceller). Kaynak yoksa sessizce atlanır;
 * elle tetiklemede ATLANDI günlüğe yazılır. Kaynak biçimi:
 *   { "bodies": [{ "type": "MAHKEME", "category": "ASLIYE_HUKUK", "name": "...", "il": "...", "ilce": null }],
 *     "notaries": [{ "name": "...", "il": "..." }] }
 */

import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import type { PlatformAuthUser } from "../platform/platform.types";
const SYNC_URL_KEY = "judicial.sync.url";
const SYNC_INTERVAL_KEY = "judicial.sync.intervalHours";
const DEFAULT_INTERVAL_HOURS = 168; // haftalık
const MIN_INTERVAL_HOURS = 1;

export const JUDICIAL_BODY_TYPES = ["MAHKEME", "ICRA_DAIRESI"] as const;
export const MAHKEME_CATEGORIES = [
  "ASLIYE_HUKUK",
  "ASLIYE_CEZA",
  "ASLIYE_TICARET",
  "SULH_HUKUK",
  "SULH_CEZA",
  "IS",
  "AILE",
  "TUKETICI",
  "KADASTRO",
  "ICRA_HUKUK",
  "FIKRI_SINAI",
  "ISTINAF",
] as const;

interface SyncSettings {
  url: string | null;
  intervalHours: number;
}

interface SyncPayloadBody {
  type: string;
  category: string;
  name: string;
  il: string;
  ilce?: string | null;
}

interface SyncPayloadNotary {
  name: string;
  il: string;
  ilce?: string | null;
}

@Injectable()
export class JudicialService implements OnModuleInit {
  private readonly logger = new Logger(JudicialService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    @Inject("JUDICIAL_SYNC_FETCH")
    private readonly fetchJson: (url: string) => Promise<unknown>,
  ) {}

  /* --------------------------- Zamanlayıcı --------------------------- */

  async onModuleInit(): Promise<void> {
    void this.scheduleNext();
  }

  /** Ayarı okur; aralık değiştiyse zamanlayıcıyı yeniden kurar. */
  private async scheduleNext(): Promise<void> {
    const settings = await this.syncSettings();
    if (this.timer) clearInterval(this.timer);
    if (!settings.url) return; // kaynak yok → zamanlayıcı yok (sessiz)
    const ms = Math.max(MIN_INTERVAL_HOURS, settings.intervalHours) * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.runSync("zamanlayici").catch((err) =>
        this.logger.warn(`Senkron başarısız: ${(err as Error).message}`),
      );
    }, ms);
    this.timer.unref?.();
    this.logger.log(`Yargı katalog senkronu ${settings.intervalHours} saatte bir çalışacak.`);
  }

  /* ------------------------- Büro tarafı: okuma ------------------------- */

  async listBodies(filters: {
    type?: string;
    category?: string;
    il?: string;
    q?: string;
    limit?: number;
  }) {
    const where: Prisma.JudicialBodyWhereInput = {
      isActive: true,
      ...(filters.type && (JUDICIAL_BODY_TYPES as readonly string[]).includes(filters.type)
        ? { type: filters.type }
        : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.il ? { il: filters.il } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
    };
    return this.prisma.client.judicialBody.findMany({
      where,
      orderBy: [{ il: "asc" }, { name: "asc" }],
      take: Math.min(filters.limit ?? 300, 500),
      select: { id: true, type: true, category: true, name: true, il: true, ilce: true },
    });
  }

  async listNotaries(filters: { il?: string; q?: string; limit?: number }) {
    return this.prisma.client.notaryOffice.findMany({
      where: {
        isActive: true,
        ...(filters.il ? { il: filters.il } : {}),
        ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
      },
      orderBy: [{ il: "asc" }, { name: "asc" }],
      take: Math.min(filters.limit ?? 300, 500),
      select: { id: true, name: true, il: true, ilce: true },
    });
  }

  /** Katalogdaki iller — il seçimi kademeli formlar için. */
  async listIller(): Promise<string[]> {
    const rows = await this.prisma.client.judicialBody.findMany({
      where: { isActive: true },
      distinct: ["il"],
      select: { il: true },
      orderBy: { il: "asc" },
    });
    return rows.map((r) => r.il);
  }

  /** D7 — vergi dairesi kataloğu (müvekkil kartında listeden seçim). */
  async listTaxOffices(filters: { il?: string; q?: string; limit?: number }) {
    return this.prisma.client.taxOffice.findMany({
      where: {
        isActive: true,
        ...(filters.il ? { il: filters.il } : {}),
        ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
      },
      orderBy: [{ il: "asc" }, { name: "asc" }],
      take: Math.min(filters.limit ?? 300, 500),
      select: { id: true, name: true, il: true, ilce: true },
    });
  }

  /** D7 — platform: vergi dairesi ekleme (source: MANUAL). */
  async createTaxOffice(
    actor: PlatformAuthUser,
    input: { name: string; il: string; ilce?: string | null },
  ) {
    const created = await this.prisma.client.taxOffice.create({
      data: {
        name: input.name.trim(),
        il: input.il.trim(),
        ilce: input.ilce?.trim() || null,
        source: "MANUAL",
      },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "TAX_OFFICE_CREATE",
      entity: "TaxOffice",
      entityId: created.id,
      detail: `${created.name} (${created.il}) eklendi.`,
    });
    return created;
  }

  /** D7 — platform: vergi dairesi güncelleme (ad/il/pasifleştirme). */
  async updateTaxOffice(
    actor: PlatformAuthUser,
    id: string,
    input: { name?: string; il?: string; ilce?: string | null; isActive?: boolean },
  ) {
    const existing = await this.prisma.client.taxOffice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Kayıt bulunamadı.");
    const updated = await this.prisma.client.taxOffice.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.il !== undefined ? { il: input.il.trim() } : {}),
        ...(input.ilce !== undefined ? { ilce: input.ilce?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "TAX_OFFICE_UPDATE",
      entity: "TaxOffice",
      entityId: id,
      detail: `${existing.name}${input.name && input.name !== existing.name ? ` → ${input.name}` : ""}${
        input.isActive !== undefined ? ` (${input.isActive ? "aktif" : "pasif"})` : ""
      }`,
    });
    return updated;
  }

  /* ---------------------- Platform tarafı: yönetim ---------------------- */

  async adminListBodies(filters: { q?: string; type?: string; il?: string; limit?: number }) {
    const where: Prisma.JudicialBodyWhereInput = {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.il ? { il: filters.il } : {}),
      ...(filters.q
        ? { name: { contains: filters.q, mode: "insensitive" as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.judicialBody.findMany({
        where,
        orderBy: [{ il: "asc" }, { name: "asc" }],
        take: Math.min(filters.limit ?? 200, 500),
      }),
      this.prisma.client.judicialBody.count({ where }),
    ]);
    return { items, total };
  }

  async createBody(
    actor: PlatformAuthUser,
    input: { type: string; category: string; name: string; il: string; ilce?: string | null },
  ) {
    if (!(JUDICIAL_BODY_TYPES as readonly string[]).includes(input.type)) {
      throw new BadRequestException("Geçersiz organ türü (MAHKEME / ICRA_DAIRESI).");
    }
    if (input.type === "ICRA_DAIRESI" && input.category !== "ICRA") {
      throw new BadRequestException("İcra dairesinin kategorisi ICRA olmalıdır.");
    }
    const created = await this.prisma.client.judicialBody.create({
      data: {
        type: input.type,
        category: input.category,
        name: input.name.trim(),
        il: input.il.trim(),
        ilce: input.ilce?.trim() || null,
        source: "MANUAL",
      },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "JUDICIAL_BODY_CREATE",
      entity: "JudicialBody",
      entityId: created.id,
      detail: `${created.name} (${created.il}) eklendi.`,
    });
    return created;
  }

  async updateBody(
    actor: PlatformAuthUser,
    id: string,
    input: { name?: string; il?: string; ilce?: string | null; isActive?: boolean; category?: string },
  ) {
    const existing = await this.prisma.client.judicialBody.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Kayıt bulunamadı.");
    const updated = await this.prisma.client.judicialBody.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.il !== undefined ? { il: input.il.trim() } : {}),
        ...(input.ilce !== undefined ? { ilce: input.ilce?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        source: "MANUAL",
      },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "JUDICIAL_BODY_UPDATE",
      entity: "JudicialBody",
      entityId: id,
      detail: `${existing.name} güncellendi (elle düzenleme).`,
    });
    return updated;
  }

  async createNotary(actor: PlatformAuthUser, input: { name: string; il: string; ilce?: string | null }) {
    const created = await this.prisma.client.notaryOffice.create({
      data: {
        name: input.name.trim(),
        il: input.il.trim(),
        ilce: input.ilce?.trim() || null,
        source: "MANUAL",
      },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "NOTARY_CREATE",
      entity: "NotaryOffice",
      entityId: created.id,
      detail: `${created.name} (${created.il}) eklendi.`,
    });
    return created;
  }

  async updateNotary(
    actor: PlatformAuthUser,
    id: string,
    input: { name?: string; il?: string; ilce?: string | null; isActive?: boolean },
  ) {
    const existing = await this.prisma.client.notaryOffice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Kayıt bulunamadı.");
    const updated = await this.prisma.client.notaryOffice.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.il !== undefined ? { il: input.il.trim() } : {}),
        ...(input.ilce !== undefined ? { ilce: input.ilce?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        source: "MANUAL",
      },
    });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "NOTARY_UPDATE",
      entity: "NotaryOffice",
      entityId: id,
      detail: `${existing.name} güncellendi.`,
    });
    return updated;
  }

  /* ------------------------------ Senkron ------------------------------ */

  async syncSettings(): Promise<SyncSettings> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { in: [SYNC_URL_KEY, SYNC_INTERVAL_KEY] } },
      select: { key: true, valueJson: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.valueJson]));
    let url: string | null = null;
    let intervalHours = DEFAULT_INTERVAL_HOURS;
    try {
      const parsedUrl = JSON.parse(map.get(SYNC_URL_KEY) ?? "null") as string | null;
      if (parsedUrl && parsedUrl.trim()) url = parsedUrl.trim();
    } catch {
      /* bozuk ayar = ayar yok */
    }
    try {
      const parsedInterval = JSON.parse(map.get(SYNC_INTERVAL_KEY) ?? "null") as number | null;
      if (typeof parsedInterval === "number" && parsedInterval >= MIN_INTERVAL_HOURS) {
        intervalHours = Math.round(parsedInterval);
      }
    } catch {
      /* bozuk ayar = varsayılan */
    }
    return { url, intervalHours };
  }

  async updateSyncSettings(actor: PlatformAuthUser, input: { url?: string | null; intervalHours?: number }) {
    if (input.url !== undefined) {
      if (input.url && !/^https?:\/\//.test(input.url.trim())) {
        throw new BadRequestException("Senkron kaynağı http(s) adresi olmalıdır.");
      }
      await this.prisma.client.systemSetting.upsert({
        where: { key: SYNC_URL_KEY },
        create: {
          key: SYNC_URL_KEY,
          valueJson: JSON.stringify(input.url?.trim() || null),
          description: "Yargı katalog senkron kaynağı (JSON)",
          updatedBy: actor.id,
        },
        update: { valueJson: JSON.stringify(input.url?.trim() || null), updatedBy: actor.id },
      });
    }
    if (input.intervalHours !== undefined) {
      const h = Math.round(input.intervalHours);
      if (h < MIN_INTERVAL_HOURS || h > 24 * 30) {
        throw new BadRequestException(`Senkron aralığı ${MIN_INTERVAL_HOURS}-720 saat arasında olmalıdır.`);
      }
      await this.prisma.client.systemSetting.upsert({
        where: { key: SYNC_INTERVAL_KEY },
        create: {
          key: SYNC_INTERVAL_KEY,
          valueJson: JSON.stringify(h),
          description: "Yargı katalog senkron aralığı (saat)",
          updatedBy: actor.id,
        },
        update: { valueJson: JSON.stringify(h), updatedBy: actor.id },
      });
    }
    // Aralık değişti — zamanlayıcıyı yeniden kur.
    await this.scheduleNext();
    return this.syncSettings();
  }

  /**
   * Senkronu şimdi çalıştırır. Kaynak yoksa ATLANDI yazar (kullanıcıya dürüst
   * durumu); kaynak hata verirse BASARISIZ yazar ve hata mesajını günlüğe alır.
   */
  async runSyncNow(actor: PlatformAuthUser) {
    const result = await this.runSync(actor.id);
    return result;
  }

  private async runSync(triggeredBy: string) {
    const { url } = await this.syncSettings();
    if (!url) {
      const log = await this.prisma.client.judicialSyncLog.create({
        data: {
          kind: "TUMU",
          status: "ATLANDI",
          detail: "Senkron kaynağı yapılandırılmamış (judicial.sync.url boş).",
          triggeredBy,
        },
      });
      return { status: log.status, added: 0, updated: 0, detail: log.detail };
    }

    let payload: { bodies?: SyncPayloadBody[]; notaries?: SyncPayloadNotary[] };
    try {
      const raw = await this.fetchJson(url);
      const parsed = raw as { bodies?: unknown; notaries?: unknown };
      payload = {
        bodies: Array.isArray(parsed.bodies) ? (parsed.bodies as SyncPayloadBody[]) : [],
        notaries: Array.isArray(parsed.notaries) ? (parsed.notaries as SyncPayloadNotary[]) : [],
      };
    } catch (err) {
      const detail = `Kaynak okunamadı: ${(err as Error).message}`;
      await this.prisma.client.judicialSyncLog.create({
        data: { kind: "TUMU", status: "BASARISIZ", detail, triggeredBy },
      });
      throw new BadRequestException(detail);
    }
    const syncBodies = payload.bodies ?? [];
    const syncNotaries = payload.notaries ?? [];

    let added = 0;
    let updated = 0;

    for (const b of syncBodies) {
      if (!b?.name || !b?.il || !b?.type || !b?.category) continue;
      const existing = await this.prisma.client.judicialBody.findUnique({
        where: { type_name: { type: b.type, name: b.name } },
      });
      if (existing) {
        if (existing.il !== b.il || existing.ilce !== (b.ilce ?? null) || !existing.isActive) {
          await this.prisma.client.judicialBody.update({
            where: { id: existing.id },
            data: {
              il: b.il,
              ilce: b.ilce ?? null,
              isActive: true,
              source: "SYNC",
            },
          });
          updated++;
        }
      } else {
        await this.prisma.client.judicialBody.create({
          data: {
            type: b.type,
            category: b.category,
            name: b.name,
            il: b.il,
            ilce: b.ilce ?? null,
            source: "SYNC",
          },
        });
        added++;
      }
    }

    for (const n of syncNotaries) {
      if (!n?.name || !n?.il) continue;
      const existing = await this.prisma.client.notaryOffice.findUnique({ where: { name: n.name } });
      if (existing) {
        if (existing.il !== n.il || existing.ilce !== (n.ilce ?? null) || !existing.isActive) {
          await this.prisma.client.notaryOffice.update({
            where: { id: existing.id },
            data: { il: n.il, ilce: n.ilce ?? null, isActive: true, source: "SYNC" },
          });
          updated++;
        }
      } else {
        await this.prisma.client.notaryOffice.create({
          data: { name: n.name, il: n.il, ilce: n.ilce ?? null, source: "SYNC" },
        });
        added++;
      }
    }

    const detail = `${syncBodies.length} organ + ${syncNotaries.length} noter işlendi: ${added} yeni, ${updated} güncellendi.`;
    await this.prisma.client.judicialSyncLog.create({
      data: { kind: "TUMU", status: "BASARILI", added, updated, detail, triggeredBy },
    });
    this.logger.log(`Yargı katalog senkronu: ${detail}`);
    return { status: "BASARILI", added, updated, detail };
  }

  async syncLogs(limit = 20) {
    return this.prisma.client.judicialSyncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });
  }
}
