import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { AiProviderConfig } from "@nomosos/db";
import {
  createProvider,
  decryptSecret,
  encryptSecret,
  isExternalDestination,
  scanPii,
  summarizeFindings,
  validateProviderBaseUrl,
  type CustomMapping,
  type LlmMessage,
  type ResolvedProviderConfig,
} from "@nomosos/ai";
import type {
  AiProviderConfigInput,
  AiProviderType,
  AiTaskRouteInput,
  CaseChatInput,
} from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertAiPolicyAllows, tenantAiPolicy } from "../common/ai-policy";
import { providerUnreachable } from "../common/errors";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

const SYSTEM_PROMPT =
  "Sen NomosOS hukuk asistanısın. Türk hukuku alanında çalışan avukatlara yardımcı olursun. " +
  "Yanıtlarında mümkün olduğunca kaynak göster (kanun maddesi, içtihat); emin olmadığın konularda bunu açıkça belirt. " +
  "Çıktın yalnızca öneri niteliğindedir; nihai değerlendirme için avukat onayı gerekir.";

function stripSecret(config: AiProviderConfig) {
  const { encryptedApiKey, ...rest } = config;
  return { ...rest, hasApiKey: Boolean(encryptedApiKey) };
}

function safeJsonParse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listProviders(tenantId: string) {
    const configs = await this.prisma.client.aiProviderConfig.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return configs.map(stripSecret);
  }

  async createProvider(user: AuthUser, input: AiProviderConfigInput) {
    assertRole(user, ROLE_SETS.ONAY, "AI sağlayıcı tanımlama");

    // SSRF KAPISI: sunucu bu adrese KENDİ AĞINDAN istek atar. Bulut metadata
    // uçları (169.254.169.254) ve http/https dışı şemalar reddedilir.
    const urlCheck = validateProviderBaseUrl(input.baseUrl);
    if (!urlCheck.ok) {
      throw new UnprocessableEntityException(urlCheck.message);
    }

    // KVKK ŞEFFAFLIĞI: "büro içi" sanılan CUSTOM/OLLAMA tipleri de bulut
    // adresine bakabilir; kaydın gerçekten dış olup olmadığı yanıtta bildirilir
    // ve SADECE_YEREL politikasında kayıt hiç açılmaz.
    const external = isExternalDestination(input.type, input.baseUrl);
    const { aiPolicy } = await tenantAiPolicy(this.prisma, user.tenantId);
    if (aiPolicy === "SADECE_YEREL" && external) {
      throw new UnprocessableEntityException(
        "Büronuzun AI politikası SADECE_YEREL. Bu sağlayıcının adresi büro ağının dışında " +
          "olduğu için kayıt açılmadı. Yerel bir adres girin ya da politikayı değiştirin.",
      );
    }

    const created = await this.prisma.client.aiProviderConfig.create({
      data: {
        tenantId: user.tenantId,
        name: input.name,
        type: input.type,
        encryptedApiKey: input.apiKey ? encryptSecret(input.apiKey) : null,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
        headersJson: input.headers ? JSON.stringify(input.headers) : null,
        mappingJson: input.mapping ? JSON.stringify(input.mapping) : null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_PROVIDER_CREATE",
      entity: "AiProviderConfig",
      entityId: created.id,
      detail: `${created.name} (${created.type}) · hedef=${external ? "DIŞ" : "BÜRO İÇİ"}`,
    });
    return { ...stripSecret(created), externalDestination: external };
  }

  async deleteProvider(user: AuthUser, id: string) {
    const result = await this.prisma.client.aiProviderConfig.deleteMany({
      where: { id, tenantId: user.tenantId },
    });
    if (result.count === 0) {
      throw new NotFoundException("AI sağlayıcı yapılandırması bulunamadı.");
    }
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_PROVIDER_DELETE",
      entity: "AiProviderConfig",
      entityId: id,
    });
    return { deleted: true };
  }

  async testProvider(tenantId: string, id: string) {
    const config = await this.prisma.client.aiProviderConfig.findFirst({
      where: { id, tenantId },
    });
    if (!config) {
      throw new NotFoundException("AI sağlayıcı yapılandırması bulunamadı.");
    }
    await assertAiPolicyAllows(this.prisma, tenantId, config);
    try {
      const provider = createProvider(this.resolveConfig(config));
      const result = await provider.testConnection();
      return { ...result, externalDestination: isExternalDestination(config.type, config.baseUrl) };
    } catch (err) {
      // Ham hata gövdesi vekil adresi / anahtar ipucu taşıyabilir.
      this.logger.warn(`Sağlayıcı bağlantı testi başarısız (${id}): ${(err as Error).message}`);
      return {
        ok: false,
        message:
          "Bağlantı testi başarısız. Adres, model adı ve API anahtarını kontrol edin; " +
          "ayrıntılı hata sunucu günlüğündedir.",
      };
    }
  }

  /* ---------------- Büro AI politikası (KVKK) ---------------- */

  /** Büronun AI veri politikası ve otomatik maskeleme rızası. */
  async getPolicy(tenantId: string) {
    const policy = await tenantAiPolicy(this.prisma, tenantId);
    return {
      ...policy,
      explanation: 
        "SADECE_YEREL seçildiğinde büro ağı dışındaki hiçbir AI adresine istek yapılmaz " +
        "(sağlayıcı tipi ne olursa olsun, karar ADRESE bakılarak verilir). " +
        "autoMaskConsent, otomatik belge hattının dış sağlayıcıya MASKELİ metin göndermesine " +
        "verilen kayıtlı rızadır; kapalıysa hattın AI adımları atlanır ve belge triyaja düşer.",
    };
  }

  /** Politikayı günceller — büro düzeyinde bir karardır, yalnız ADMIN/PARTNER. */
  async updatePolicy(
    user: AuthUser,
    input: { aiPolicy?: "SERBEST" | "SADECE_YEREL"; autoMaskConsent?: boolean },
  ) {
    assertRole(user, ROLE_SETS.ONAY, "büro AI veri politikasını değiştirme");
    const before = await tenantAiPolicy(this.prisma, user.tenantId);
    const updated = await this.prisma.client.tenant.update({
      where: { id: user.tenantId },
      data: {
        ...(input.aiPolicy !== undefined ? { aiPolicy: input.aiPolicy } : {}),
        ...(input.autoMaskConsent !== undefined ? { autoMaskConsent: input.autoMaskConsent } : {}),
      },
      select: { aiPolicy: true, autoMaskConsent: true },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_POLICY_UPDATE",
      entity: "Tenant",
      entityId: user.tenantId,
      detail:
        `aiPolicy: ${before.aiPolicy} -> ${updated.aiPolicy} - ` +
        `autoMaskConsent: ${before.autoMaskConsent} -> ${updated.autoMaskConsent}`,
    });
    return updated;
  }

  async listTaskRoutes(tenantId: string) {
    return this.prisma.client.aiTaskRoute.findMany({
      where: { tenantId },
      include: { providerConfig: { select: { id: true, name: true, type: true, defaultModel: true } } },
      orderBy: { taskType: "asc" },
    });
  }

  async upsertTaskRoute(user: AuthUser, input: AiTaskRouteInput) {
    const config = await this.prisma.client.aiProviderConfig.findFirst({
      where: { id: input.providerConfigId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!config) {
      throw new BadRequestException("Seçilen AI sağlayıcı yapılandırması bulunamadı.");
    }

    const route = await this.prisma.client.aiTaskRoute.upsert({
      where: { tenantId_taskType: { tenantId: user.tenantId, taskType: input.taskType } },
      create: {
        tenantId: user.tenantId,
        taskType: input.taskType,
        providerConfigId: input.providerConfigId,
        model: input.model,
      },
      update: { providerConfigId: input.providerConfigId, model: input.model },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_TASK_ROUTE_UPSERT",
      entity: "AiTaskRoute",
      entityId: route.id,
      detail: `${input.taskType} → ${input.model}`,
    });
    return route;
  }

  async chat(user: AuthUser, input: CaseChatInput) {
    const { config, model } = await this.resolveRoute(user.tenantId, "CASE_CHAT");

    let systemPrompt = SYSTEM_PROMPT;
    if (input.caseId) {
      systemPrompt += `\n\n${await this.buildCaseContext(user.tenantId, input.caseId)}`;
    }

    const scan = scanPii(input.message);
    const external = isExternalDestination(config.type, config.baseUrl);
    if (external && scan.hasPii && !input.piiApproved) {
      throw new ConflictException({
        requiresPiiApproval: true,
        findings: summarizeFindings(scan.findings),
        maskedText: scan.maskedText,
        message:
          "Mesajda kişisel veri tespit edildi. Dış sağlayıcıya göndermeden önce maskeli metni onaylayın.",
      });
    }

    const piiMasked = external && scan.hasPii && input.piiApproved;
    const outboundMessage = piiMasked ? scan.maskedText : input.message;

    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: outboundMessage },
    ];

    const startedAt = Date.now();
    let result;
    try {
      const provider = createProvider(this.resolveConfig(config));
      result = await provider.chat({ model, messages, maxTokens: 2048 });
    } catch (err) {
      throw providerUnreachable(this.logger, err);
    }
    const durationMs = Date.now() - startedAt;

    await this.prisma.client.aiUsageLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        providerConfigId: config.id,
        taskType: "CASE_CHAT",
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
        piiMasked,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_CHAT",
      entity: input.caseId ? "Case" : undefined,
      entityId: input.caseId,
      detail: `model=${model} piiMasked=${piiMasked}`,
    });

    return {
      content: result.content,
      model,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs,
      },
    };
  }

  /** Görev tipi için rota; yoksa tenant'ın ilk aktif sağlayıcısı + defaultModel. */
  private async resolveRoute(
    tenantId: string,
    taskType: string
  ): Promise<{ config: AiProviderConfig; model: string }> {
    const route = await this.prisma.client.aiTaskRoute.findUnique({
      where: { tenantId_taskType: { tenantId, taskType } },
      include: { providerConfig: true },
    });
    if (route && route.providerConfig.isActive) {
      await assertAiPolicyAllows(this.prisma, tenantId, route.providerConfig);
      return { config: route.providerConfig, model: route.model };
    }

    const fallback = await this.prisma.client.aiProviderConfig.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) {
      throw new BadRequestException("Önce Ayarlar → AI Sağlayıcı'dan bir sağlayıcı ekleyin.");
    }
    await assertAiPolicyAllows(this.prisma, tenantId, fallback);
    return { config: fallback, model: fallback.defaultModel };
  }

  /** Dosya özeti bağlamı: başlık, taraflar, son 5 safahat, yaklaşan süreler. */
  private async buildCaseContext(tenantId: string, caseId: string): Promise<string> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      include: {
        client: { select: { name: true } },
        parties: { select: { role: true, name: true, isClient: true } },
        timelineEvents: { orderBy: { date: "desc" }, take: 5 },
        deadlines: {
          where: { dueDate: { gte: new Date() }, status: { in: ["BEKLIYOR", "ONAYLANDI"] } },
          orderBy: { dueDate: "asc" },
          take: 5,
        },
      },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }

    const lines: string[] = [
      "--- DOSYA BAĞLAMI ---",
      `Dosya: ${found.title} (${found.type} / ${found.status})`,
    ];
    if (found.courtName) lines.push(`Mahkeme/Daire: ${found.courtName}${found.fileNumber ? ` — E. ${found.fileNumber}` : ""}`);
    if (found.subject) lines.push(`Konu: ${found.subject}`);
    lines.push(`Müvekkil: ${found.client.name}`);

    if (found.parties.length > 0) {
      lines.push("Taraflar:");
      for (const party of found.parties) {
        lines.push(`- ${party.role}: ${party.name}${party.isClient ? " (müvekkil)" : ""}`);
      }
    }
    if (found.timelineEvents.length > 0) {
      lines.push("Son safahat:");
      for (const event of found.timelineEvents) {
        lines.push(`- ${event.date.toISOString().slice(0, 10)}: ${event.title}`);
      }
    }
    if (found.deadlines.length > 0) {
      lines.push("Yaklaşan süreler:");
      for (const deadline of found.deadlines) {
        lines.push(`- ${deadline.dueDate.toISOString().slice(0, 10)}: ${deadline.title}`);
      }
    }
    return lines.join("\n");
  }

  /** DB kaydını @nomosos/ai için çözülmüş yapılandırmaya çevirir (API anahtarı şifresi açılır). */
  private resolveConfig(config: AiProviderConfig): ResolvedProviderConfig {
    return {
      type: config.type as AiProviderType,
      apiKey: config.encryptedApiKey ? decryptSecret(config.encryptedApiKey) : undefined,
      baseUrl: config.baseUrl ?? undefined,
      defaultModel: config.defaultModel,
      headers: safeJsonParse<Record<string, string>>(config.headersJson),
      mapping: safeJsonParse<CustomMapping>(config.mappingJson),
    };
  }
}
