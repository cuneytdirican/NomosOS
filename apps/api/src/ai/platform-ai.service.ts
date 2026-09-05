/**
 * PLATFORM AI SAĞLAYICI SİSTEMİ (geliştirme planı D1.3).
 *
 * ÜÇ SORUMLULUK:
 *   1. ROTA ÇÖZÜMÜ — kiracının görev tipi için sağlayıcısı yoksa (veya BYO
 *      yetkisi yoksa) AI görevi PLATFORM sağlayıcısından çözülür:
 *        kirayı rotası (yetki VARsa) → plan features.defaultPlatformProviderKey
 *        → isDefault platform sağlayıcısı → ilk aktif.
 *   2. BYO YETKİSİ — plan featuresJson.allowBYOLLM (yoksa İZİNLİ; geriye dönük
 *      uyumluluk). Yetki yoksa kiracı sağlayıcı EKLEYEMEZ/DEĞİŞTİREMEZ
 *      (ai.service createProvider/updateProvider kapıları) ve mevcut kiracı
 *      sağlayıcıları rota çözümünde YOK SAYILIR.
 *   3. YÖNETİM — platform panelinden CRUD + bağlantı testi + model listesi.
 *
 * TÜM sağlayıcı çağrılarında geçerli KVKK kuralları aynen işler: platform
 * sağlayıcısı dış adresliyse kiracı verisi yine scanPii kapısından geçer
 * (resolveRoute zincirinin tüketicileri ai-runner/assistant-llm'dir; kapı
 * sağlayıcıdan bağımsız çalışır).
 */

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { AiProviderConfig } from "@nomosos/db";
import {
  createProvider,
  decryptSecret,
  encryptSecret,
  validateProviderBaseUrl,
  type LlmProvider,
  type CustomMapping,
} from "@nomosos/ai";
import type { AiProviderType } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import { readProviderHeaders } from "../common/provider-headers";
import type { PlatformAuthUser } from "../platform/platform.types";

function safeJsonParse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Plan featuresJson'undan okunan AI alanları. */
interface PlanAiFeatures {
  allowBYOLLM: boolean;
  defaultPlatformProviderKey: string | null;
}

@Injectable()
export class PlatformAiService {
  private readonly logger = new Logger(PlatformAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /* --------------------------- Plan yetkileri --------------------------- */

  /** Kiracının planının AI özellikleri (abonelik yoksa tam yetkili). */
  async planFeatures(tenantId: string): Promise<PlanAiFeatures> {
    const sub = await this.prisma.client.subscription.findUnique({
      where: { tenantId },
      select: { planKey: true },
    });
    if (!sub) return { allowBYOLLM: true, defaultPlatformProviderKey: null };
    const plan = await this.prisma.client.planTier.findFirst({
      where: { key: sub.planKey },
      select: { featuresJson: true },
    });
    if (!plan) return { allowBYOLLM: true, defaultPlatformProviderKey: null };
    try {
      const features = JSON.parse(plan.featuresJson) as {
        allowBYOLLM?: boolean;
        defaultPlatformProviderKey?: string;
      };
      return {
        // Alan tanımlı DEĞİLSE izinli — mevcut kiracılar akmaya devam eder.
        allowBYOLLM: features.allowBYOLLM !== false,
        defaultPlatformProviderKey: features.defaultPlatformProviderKey ?? null,
      };
    } catch {
      return { allowBYOLLM: true, defaultPlatformProviderKey: null };
    }
  }

  /** Kiracı kendi LLM tanımlayabilir mi? (ai.service sağlayıcı kapıları bunu çağırır) */
  async byoAllowed(tenantId: string): Promise<boolean> {
    return (await this.planFeatures(tenantId)).allowBYOLLM;
  }

  /** BYO kısıtı var mı? (kiracı sağlayıcıları rota çözümünde yok sayılır) */
  async byoRestricted(tenantId: string): Promise<boolean> {
    return !(await this.planFeatures(tenantId)).allowBYOLLM;
  }

  /* ------------------------- Platform rota çözümü ------------------------- */

  /**
   * Kiracının kullanacağı PLATFORM sağlayıcısı — plan ataması > isDefault > ilk aktif.
   * Kiracıya AiProviderConfig BİÇİMİNDE sentetik kayıt döner (kimlik
   * `platform:<id>` önekli — denetim izlerinde platform kaynağı görünür).
   */
  async resolveForTenant(tenantId: string): Promise<AiProviderConfig | null> {
    const features = await this.planFeatures(tenantId);
    type ProviderRow = Awaited<ReturnType<PrismaService["client"]["platformAiProvider"]["findFirst"]>>;
    let row: ProviderRow | null = null;

    if (features.defaultPlatformProviderKey) {
      row = await this.findActiveByName(features.defaultPlatformProviderKey);
    }
    if (!row) {
      row = await this.prisma.client.platformAiProvider.findFirst({
        where: { isActive: true, isDefault: true },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!row) {
      row = await this.prisma.client.platformAiProvider.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!row) return null;
    return this.toSyntheticConfig(row);
  }

  private async findActiveByName(name: string) {
    return this.prisma.client.platformAiProvider.findFirst({
      where: { name, isActive: true },
    });
  }

  /** Platform satırını yürütücülerin beklediği yapıya çevirir. */
  private toSyntheticConfig(row: {
    id: string;
    name: string;
    type: string;
    encryptedApiKey: string | null;
    baseUrl: string | null;
    defaultModel: string;
    headersJson: string | null;
    mappingJson: string | null;
  }): AiProviderConfig {
    return {
      id: `platform:${row.id}`,
      tenantId: "__platform__",
      name: row.name,
      type: row.type,
      encryptedApiKey: row.encryptedApiKey,
      baseUrl: row.baseUrl,
      defaultModel: row.defaultModel,
      headersJson: row.headersJson,
      mappingJson: row.mappingJson,
      isActive: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as AiProviderConfig;
  }

  /**
   * BÜRO GÖRÜNÜMÜ — GET /ai/platform-status: kiracının BYO yetkisi ve
   * kullanacağı platform sağlayıcı bilgisi (ANAHTARSIZ).
   */
  async tenantStatus(tenantId: string) {
    const features = await this.planFeatures(tenantId);
    if (features.allowBYOLLM) {
      return { byoAllowed: true, platformProvider: null };
    }
    const provider = await this.resolveForTenant(tenantId);
    if (!provider) {
      return {
        byoAllowed: false,
        platformProvider: null,
        note: "Planınız kendi AI sağlayıcı tanımlamayı kapsamıyor; ancak platform sağlayıcısı da tanımlı değil. Lütfen destek ile görüşün.",
      };
    }
    return {
      byoAllowed: false,
      platformProvider: {
        name: provider.name,
        type: provider.type,
        defaultModel: provider.defaultModel,
      },
    };
  }

  /* --------------------------- Platform yönetimi --------------------------- */

  /** Listele — anahtar ASLA döndürülmez; yalnızca "tanımlı" bayrağı. */
  async listProviders() {
    const rows = await this.prisma.client.platformAiProvider.findMany({
      orderBy: [{ isActive: "desc" }, { isDefault: "desc" }, { name: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      baseUrl: r.baseUrl,
      defaultModel: r.defaultModel,
      hasApiKey: r.encryptedApiKey !== null,
      isDefault: r.isDefault,
      isActive: r.isActive,
      origin: r.origin,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createProvider(
    actor: PlatformAuthUser,
    input: {
      name: string;
      type: string;
      apiKey?: string;
      baseUrl?: string;
      defaultModel: string;
      headers?: Record<string, string>;
      mapping?: CustomMapping;
      isDefault?: boolean;
      notes?: string;
      /** IMPORTED = dışarıda eğitilmiş model kaydı (kullanıcı tanımlı model, gereksinim 3). */
      origin?: "TANIMLI" | "IMPORTED";
    },
  ) {
    if (input.baseUrl) {
      const check = validateProviderBaseUrl(input.baseUrl);
      if (!check.ok) throw new BadRequestException(check.message);
    }
    const exists = await this.prisma.client.platformAiProvider.findUnique({ where: { name: input.name } });
    if (exists) throw new ConflictException("Bu adda bir sağlayıcı zaten var.");

    let created;
    try {
      created = await this.prisma.client.platformAiProvider.create({
        data: {
          name: input.name,
          type: input.type,
          ...(input.apiKey ? { encryptedApiKey: encryptSecret(input.apiKey) } : {}),
          baseUrl: input.baseUrl ?? null,
          defaultModel: input.defaultModel,
          // K-08 (platform tarafı): başlıklar SIR TAŞIYABİLİR ("api-key: sk-…");
          // kiracı tarafındaki gibi şifreli yazılır, okuma tek kapıdan
          // (readProviderHeaders) çözülür.
          headersJson: input.headers ? encryptSecret(JSON.stringify(input.headers)) : null,
          mappingJson: input.mapping ? JSON.stringify(input.mapping) : null,
          isDefault: input.isDefault ?? false,
          notes: input.notes ?? null,
          createdBy: actor.id,
          origin: input.origin ?? "TANIMLI",
        },
      });
    } catch (err) {
      // isDefault=true tekil başa düşürme benzeri kısıtlar için ayrım.
      throw new BadRequestException(`Sağlayıcı kaydedilemedi: ${(err as Error).message}`);
    }

    // isDefault=true ise diğerlerinden düşür (tek varsayılan).
    if (input.isDefault) {
      await this.prisma.client.platformAiProvider.updateMany({
        where: { isDefault: true, id: { not: created.id } },
        data: { isDefault: false },
      });
    }

    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: input.origin === "IMPORTED" ? "MODEL_IMPORT" : "PLATFORM_AI_PROVIDER_CREATE",
      entity: "PlatformAiProvider",
      entityId: created.id,
      detail:
        `${created.name} (${created.type}) · model=${created.defaultModel}` +
        (input.origin === "IMPORTED" ? " · dışarıda eğitilmiş model kaydı içe aktarıldı" : ""),
    });
    return { id: created.id, ok: true };
  }

  async updateProvider(
    actor: PlatformAuthUser,
    id: string,
    input: {
      name?: string;
      type?: string;
      apiKey?: string;
      baseUrl?: string | null;
      defaultModel?: string;
      headers?: Record<string, string>;
      mapping?: CustomMapping;
      isDefault?: boolean;
      isActive?: boolean;
      notes?: string | null;
    },
  ) {
    const existing = await this.prisma.client.platformAiProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Sağlayıcı bulunamadı.");
    if (input.baseUrl) {
      const check = validateProviderBaseUrl(input.baseUrl);
      if (!check.ok) throw new BadRequestException(check.message);
    }
    const updated = await this.prisma.client.platformAiProvider.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.apiKey !== undefined && input.apiKey !== ""
          ? { encryptedApiKey: encryptSecret(input.apiKey) }
          : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
        ...(input.headers !== undefined
          ? { headersJson: input.headers ? encryptSecret(JSON.stringify(input.headers)) : null }
          : {}),
        ...(input.mapping !== undefined ? { mappingJson: JSON.stringify(input.mapping) } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    if (updated.isDefault) {
      await this.prisma.client.platformAiProvider.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "PLATFORM_AI_PROVIDER_UPDATE",
      entity: "PlatformAiProvider",
      entityId: id,
      detail: `${updated.name} güncellendi.`,
    });
    return { id, ok: true };
  }

  async deleteProvider(actor: PlatformAuthUser, id: string) {
    const existing = await this.prisma.client.platformAiProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Sağlayıcı bulunamadı.");
    await this.prisma.client.platformAiProvider.delete({ where: { id } });
    await this.audit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "PLATFORM_AI_PROVIDER_DELETE",
      entity: "PlatformAiProvider",
      entityId: id,
      detail: `${existing.name} silindi.`,
    });
    return { ok: true };
  }

  /** Bağlantı testi — anahtar şifresi çözülüp sağlayıcı çağrılır; hata maske yine döner. */
  async testProvider(id: string) {
    const row = await this.prisma.client.platformAiProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Sağlayıcı bulunamadı.");
    const provider = createProvider(this.resolve(row));
    return provider.testConnection();
  }

  /** Model listesi — sağlayıcıdan ÇEKİLER (elle giriş yok, kullanıcı talebi). */
  async listProviderModels(id: string): Promise<string[]> {
    const row = await this.prisma.client.platformAiProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Sağlayıcı bulunamadı.");
    const provider = createProvider(this.resolve(row));
    return provider.listModels();
  }

  private resolve(row: {
    type: string;
    encryptedApiKey: string | null;
    baseUrl: string | null;
    defaultModel: string;
    headersJson: string | null;
    mappingJson: string | null;
  }) {
    return {
      type: row.type as AiProviderType,
      apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey) : undefined,
      baseUrl: row.baseUrl ?? undefined,
      defaultModel: row.defaultModel,
      headers: readProviderHeaders(row.headersJson),
      mapping: safeJsonParse<CustomMapping>(row.mappingJson),
    };
  }

  /** LlmProvider örnekleyici — testler için dışa açılır. */
  buildProvider(row: Parameters<typeof this.resolve>[0]): LlmProvider {
    return createProvider(this.resolve(row));
  }
}
