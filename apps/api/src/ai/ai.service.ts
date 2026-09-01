import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { AiProviderConfig } from "@nomosos/db";
import {
  createProvider,
  decryptSecret,
  encryptSecret,
  isExternalDestination,
  maskTerms,
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
import { AgentRunService } from "../agents/agent-run.service";
import { assertAiPolicyAllows, tenantAiPolicy } from "../common/ai-policy";
import { creditRunContext } from "../credits/credit-context";
import { providerUnreachable } from "../common/errors";
import { assertRole, ROLE_SETS } from "../common/roles";
import { readProviderHeaders } from "../common/provider-headers";
import type { AuthUser } from "../common/types";

const SYSTEM_PROMPT =
  "Sen NomosOS hukuk asistanısın. Türk hukuku alanında çalışan avukatlara yardımcı olursun. " +
  "Yanıtlarında mümkün olduğunca kaynak göster (kanun maddesi, içtihat); emin olmadığın konularda bunu açıkça belirt. " +
  "Çıktın yalnızca öneri niteliğindedir; nihai değerlendirme için avukat onayı gerekir.";

/**
 * YANIT BEYAZ LİSTESİ (denetim bulgusu K-08).
 *
 * Eskiden `stripSecret` KARA LİSTE idi: `const { encryptedApiKey, ...rest }` ile
 * yalnız bilinen tek sır alanı çıkarılıyor, geri kalan her şey yayınlanıyordu.
 * `headersJson` ("api-key: sk-…" taşıyabilir) ve `mappingJson` tam da bu yoldan
 * yanıta düştü. Platform tarafı aynı işi ALAN BAZLI `select` beyaz listesiyle
 * yapıyor (`platform-tenants.service.ts:293-304`) ve yorumu şunu söylüyor:
 * "yeni bir sır alanı şemaya eklendiğinde bu yanıta kendiliğinden sızmaz."
 * Kiracı ucu artık aynı deseni kullanır: aşağıdaki `select` YENİ ALAN EKLENDİĞİNDE
 * SESSİZCE GENİŞLEMEZ.
 */
const PROVIDER_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  baseUrl: true,
  defaultModel: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  encryptedApiKey: true, // yalnız `hasApiKey` türetmek için okunur, DÖNDÜRÜLMEZ
  headersJson: true, // yalnız başlık ADLARI türetmek için okunur, DEĞERLER DÖNDÜRÜLMEZ
} as const;

type ProviderPublicRow = {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  baseUrl: string | null;
  defaultModel: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  encryptedApiKey: string | null;
  headersJson: string | null;
};

/**
 * Sağlayıcı kaydının kullanıcıya gösterilebilir hâli.
 *
 * Başlık DEĞERLERİ hiçbir koşulda dönmez; yalnız ADLARI döner — arayüzün
 * "hangi başlıklar tanımlı" bilgisine ihtiyacı var, değerlere yok.
 */
function toPublicProvider(config: ProviderPublicRow) {
  const headers = readProviderHeaders(config.headersJson);
  return {
    id: config.id,
    tenantId: config.tenantId,
    name: config.name,
    type: config.type,
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    isActive: config.isActive,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    hasApiKey: Boolean(config.encryptedApiKey),
    hasHeaders: Boolean(headers && Object.keys(headers).length > 0),
    headerNames: headers ? Object.keys(headers) : [],
  };
}

function safeJsonParse<T>(value: string | null | undefined): T | undefined {
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
    private readonly audit: AuditService,
    // F2-Ö-11: /ai/chat de ajan izine bağlanır — "her LLM çağrısı izlenir"
    // sözleşmesi bu yürütücüde eksikti.
    private readonly agentRuns: AgentRunService
  ) {}

  /**
   * Sağlayıcı listesi — ADMIN/PARTNER'a kapalıdır (denetim bulgusu K-09).
   *
   * Kayıtta sağlayıcı kimlik bilgisi (anahtar adı, vekil adresi) durur; bu bir
   * BÜRO YÖNETİM verisidir, stajyerin/sekreterin iş akışında yeri yoktur.
   */
  async listProviders(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "AI sağlayıcı listesini görüntüleme");
    const configs = await this.prisma.client.aiProviderConfig.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "asc" },
      select: PROVIDER_PUBLIC_SELECT,
    });
    return configs.map(toPublicProvider);
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
        // KVKK/sır: özel başlıklar bir API anahtarı TAŞIYABİLİR (Azure OpenAI
        // "api-key", LiteLLM/OpenRouter "Authorization"). `encryptedApiKey` ile
        // aynı korumayı alır — düz metin saklama denetim bulgusu K-08'di.
        headersJson: input.headers ? encryptSecret(JSON.stringify(input.headers)) : null,
        mappingJson: input.mapping ? JSON.stringify(input.mapping) : null,
      },
      select: PROVIDER_PUBLIC_SELECT,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "AI_PROVIDER_CREATE",
      entity: "AiProviderConfig",
      entityId: created.id,
      detail: `${created.name} (${created.type}) · hedef=${external ? "DIŞ" : "BÜRO İÇİ"}`,
    });
    return { ...toPublicProvider(created), externalDestination: external };
  }

  async deleteProvider(user: AuthUser, id: string) {
    // K-09: silme, TANIMLAMADAN daha yıkıcıdır — tek istekle büronun tüm AI
    // katmanı durur (rota kayıtları FK ile düşer). Aynı kapı uygulanır.
    assertRole(user, ROLE_SETS.ONAY, "AI sağlayıcı silme");
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

  async testProvider(user: AuthUser, id: string) {
    // K-09: sunucudan giden bir ağ çağrısı tetikler; yapılandırma yetkisiyle
    // aynı kapıya tabidir.
    assertRole(user, ROLE_SETS.ONAY, "AI sağlayıcı bağlantı testi");
    const tenantId = user.tenantId;
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
    // K-09 SENARYO 2: rota değişikliği SESSİZDİR — dilekçe taslakları o andan
    // sonra başka bir modelden üretilir, hiçbir ekran uyarmaz. Büro düzeyinde
    // bir karardır.
    assertRole(user, ROLE_SETS.ONAY, "AI görev rotası tanımlama");
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

    // DOSYA BAĞLAMI ARTIK SÖZLÜK MASKELİ ÜRETİLİR (denetim bulgusu K-07/Ö-22).
    //
    // Eskiden bağlam ham yazılıyordu ve `scanPii` YALNIZ `input.message` üzerinde
    // koşuyordu: müvekkil adı, taraf adları, karşı vekil, safahat metni ve
    // içindeki TCKN/IBAN dış sağlayıcıya MASKESİZ gidiyordu — üstelik
    // `AiUsageLog.piiMasked` yanlış olarak `false` yazılıyordu. Onay verilen
    // durumda bile bağlam maskesizdi. Doğru desen `assistant-llm.service.ts`te
    // yazılıydı: TÜM mesajları tara, tümünü maskele.
    let systemPrompt = SYSTEM_PROMPT;
    let contextTerms = 0;
    let userMessage = input.message;
    if (input.caseId) {
      const ctx = await this.buildCaseContext(user.tenantId, input.caseId);
      contextTerms = ctx.maskedTerms;
      systemPrompt += `\n\n${ctx.text}`;

      // SÖZLÜK, AVUKATIN KENDİ YAZDIĞI METNE DE UYGULANIR (canlı doğrulamada
      // bulundu). Bağlam özenle "[MÜVEKKİL]" olarak maskelenirken, avukatın
      // soru kutusuna yazdığı "ABC Holding A.Ş." dış sağlayıcıya AÇIK
      // gidiyordu: `scanPii` yalnız TCKN/IBAN/telefon/e-posta KALIPLARINI
      // tanır, ad ve unvan hiçbir kalıba girmez. Aynı dosyanın bilinen
      // adlarını iki farklı mesajda farklı işlemek, maskelemeyi anlamsız
      // kılıyordu — model iki satırı yan yana görüp eşleştirebiliyordu.
      const maskedUser = maskTerms(input.message, ctx.terms);
      userMessage = maskedUser.maskedText;
      contextTerms += maskedUser.replaced;
    }

    const external = isExternalDestination(config.type, config.baseUrl);

    // FAIL-CLOSED: tarama hata verirse çağrı YAPILMAZ.
    let scans: ReturnType<typeof scanPii>[];
    const draft: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];
    try {
      scans = draft.map((m) => scanPii(m.content));
    } catch (err) {
      this.logger.error(`KVKK maskeleme hattı çalışmadı: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        "KVKK maskeleme hattı çalışmadığı için AI çağrısı yapılmadı. " +
          "Sistem yöneticinizle görüşün (fail-closed güvenlik kuralı).",
      );
    }

    const findings = scans.flatMap((s) => s.findings);
    if (external && findings.length > 0 && !input.piiApproved) {
      // Onay gövdesine yalnız kişisel veri TAŞIYAN parçaların maskeli hâli konur.
      throw new ConflictException({
        requiresPiiApproval: true,
        findings: summarizeFindings(findings),
        maskedText: scans
          .filter((s) => s.hasPii)
          .map((s) => s.maskedText)
          .join("\n---\n"),
        message:
          "Gönderilecek metinde kişisel veri tespit edildi (dosya bağlamı dâhil). " +
          "Dış sağlayıcıya göndermeden önce maskeli metni onaylayın.",
      });
    }

    // `piiMasked` denetim izidir: sözlük maskesi de (ad/unvan) buna dâhildir,
    // çünkü dış sağlayıcıya giden metin gerçekten maskelenmiştir.
    const patternMasked = external && findings.length > 0;
    const piiMasked = external && (findings.length > 0 || contextTerms > 0);
    const messages: LlmMessage[] = patternMasked
      ? draft.map((m, i) => ({ role: m.role, content: scans[i].maskedText }))
      : draft;

    const startedAt = Date.now();
    let result;
    try {
      const provider = createProvider(this.resolveConfig(config));
      result = await provider.chat({ model, messages, maxTokens: 2048 });
    } catch (err) {
      // F2-Ö-11: sağlayıcı arızası da iz bırakır (üç-durum sözleşmesi).
      await this.agentRuns.record({
        tenantId: user.tenantId,
        userId: user.userId,
        taskType: "CASE_CHAT",
        status: "BASARISIZ",
        model,
        providerType: config.type,
        durationMs: Date.now() - startedAt,
        piiMasked,
        entity: "Case",
        entityId: input.caseId ?? null,
        outboundTexts: messages.map((m) => m.content),
        errorMessage: (err as Error).message,
      });
      throw providerUnreachable(this.logger, err);
    }
    const durationMs = Date.now() - startedAt;

    // F2-Ö-12: Yanıt ÖNERİDİR — advisory bayrağı sözleşmenin parçasıdır.
    // Serbest metin döndüğü için şema guard'ı uygulanmaz; içerik öneri olarak
    // işaretlenir ve istemci bunu her yanıtta görüntüler.
    await this.agentRuns.record({
      tenantId: user.tenantId,
      userId: user.userId,
      taskType: "CASE_CHAT",
      status: "BASARILI",
      model,
      providerType: config.type,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs,
      piiMasked,
      entity: "Case",
      entityId: input.caseId ?? null,
      outboundTexts: messages.map((m) => m.content),
    });

    const usageLog = await this.prisma.client.aiUsageLog.create({
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

    // MODÜL 26 KANCASI — gerçek token'ı kredi kapısına bildirir.
    creditRunContext.record({
      aiUsageLogId: usageLog.id,
      taskType: "CASE_CHAT",
      model,
      providerType: config.type,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
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
      // F2-Ö-12: her AI yanıtı ÖNERİDİR; bayta istemci tarafında her yanıtta
      // görünür biçimde belirtilir.
      advisory: true as const,
      disclaimer:
        "Bu yanıt yapay zekâ tarafından üretilen bir BİLGİLENDİRMEDİR; hukuki danışmanlık " +
        "değildir. Dayandığı belgeleri ve mevzuatı kendiniz doğrulayın.",
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

  /**
   * Dosya özeti bağlamı: başlık, taraflar, son 5 safahat, yaklaşan süreler.
   *
   * TARAF ADLARI SÖZLÜKLE MASKELENİR (Ö-22). `scanPii` yalnız TCKN/IBAN/telefon/
   * e-posta kalıplarını tanır; ad-soyad ve şirket unvanı hiçbir kalıba girmez ve
   * bu yüzden 409 onay akışını hiç tetiklemezdi. Ama bağlamı KURAN taraf adları
   * zaten elinde tutar — regex NER tahmini yerine BİLİNEN terimler değiştirilir:
   * müvekkil `[MÜVEKKİL]`, her taraf `[TARAF-n]`, karşı vekil `[VEKİL-n]` olur.
   * Serbest metin (safahat başlığı, dosya konusu) de aynı sözlükten geçer, çünkü
   * ad orada da geçer.
   *
   * Dönen `maskedTerms`, denetim izine (`AiUsageLog.piiMasked`) yazılır.
   */
  private async buildCaseContext(
    tenantId: string,
    caseId: string,
  ): Promise<{ text: string; maskedTerms: number; terms: Array<{ value: string; label: string }> }> {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      include: {
        client: { select: { name: true } },
        parties: { select: { role: true, name: true, isClient: true, lawyerName: true } },
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

    // 1) Sözlüğü kur. Etiketler kararlıdır ki model taraflar arasında ilişki
    //    kurabilsin ("[TARAF-1] ... [TARAF-1]" aynı kişidir).
    const terms: Array<{ value: string; label: string }> = [
      { value: found.client.name, label: "[MÜVEKKİL]" },
    ];
    found.parties.forEach((party, index) => {
      terms.push({ value: party.name, label: party.isClient ? "[MÜVEKKİL]" : `[TARAF-${index + 1}]` });
      if (party.lawyerName) {
        terms.push({ value: party.lawyerName, label: `[VEKİL-${index + 1}]` });
      }
    });

    const lines: string[] = [
      "--- DOSYA BAĞLAMI ---",
      `Dosya: ${found.title} (${found.type} / ${found.status})`,
    ];
    if (found.courtName)
      lines.push(`Mahkeme/Daire: ${found.courtName}${found.fileNumber ? ` — E. ${found.fileNumber}` : ""}`);
    if (found.subject) lines.push(`Konu: ${found.subject}`);
    lines.push("Müvekkil: [MÜVEKKİL]");

    if (found.parties.length > 0) {
      lines.push("Taraflar:");
      found.parties.forEach((party, index) => {
        const label = party.isClient ? "[MÜVEKKİL]" : `[TARAF-${index + 1}]`;
        lines.push(`- ${party.role}: ${label}${party.isClient ? " (müvekkil)" : ""}`);
      });
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

    // 2) Serbest metinlerde kalan ad geçişlerini de temizle.
    const masked = maskTerms(lines.join("\n"), terms);
    // Sözlük DIŞARI da verilir: aynı adlar avukatın kendi mesajında da
    // maskelenmek zorundadır (bkz. `chat`).
    return { text: masked.maskedText, maskedTerms: masked.replaced, terms };
  }

  /** DB kaydını @nomosos/ai için çözülmüş yapılandırmaya çevirir (API anahtarı şifresi açılır). */
  private resolveConfig(config: AiProviderConfig): ResolvedProviderConfig {
    return {
      type: config.type as AiProviderType,
      apiKey: config.encryptedApiKey ? decryptSecret(config.encryptedApiKey) : undefined,
      baseUrl: config.baseUrl ?? undefined,
      defaultModel: config.defaultModel,
      headers: readProviderHeaders(config.headersJson),
      mapping: safeJsonParse<CustomMapping>(config.mappingJson),
    };
  }
}
