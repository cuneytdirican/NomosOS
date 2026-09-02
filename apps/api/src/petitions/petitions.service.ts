/**
 * Dilekçe Stüdyosu servisi (Modül 22).
 *
 * Ürünün farkı burada somutlaşır: dilekçe "AI sohbetinden çıkan metin" değil,
 * dosyanın yapılandırılmış verisinden üretilen, SÜRÜMLENEN ve TEYİT EDİLEN bir
 * varlıktır.
 *
 * Üç değişmez kural:
 *   1. SÜRÜMLER DEĞİŞTİRİLEMEZ. Her düzenleme yeni PetitionVersion doğurur;
 *      eski sürüm güncellenmez, silinmez.
 *   2. TEYİT KAPISI. HAZIR statüsüne geçiş, metindeki her atfın deterministik
 *      doğrulamadan geçmesine bağlıdır (petition-gate.ts). Aksi hâlde HTTP 422.
 *   3. BAYAT TEYİT YASAĞI. Teyit sonuçları dilekçeye değil SÜRÜME yazılır; içerik
 *      değişince yeni sürümün teyidi yoktur ve statü otomatik TEYIT_EDILIYOR'a düşer.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type Petition, type PetitionStatus, type PetitionVersion } from "@nomosos/db";
import { isExternalDestination, scanPii, summarizeFindings } from "@nomosos/ai";
import {
  buildCaseContext,
  buildPetitionDraftMessages,
  detectUnstructuredCitationSignals,
  extractPrecedentPlaceholders,
  PetitionDraftOutputSchema,
  type CaseContextDocument,
  type CaseContextParty,
  type CaseContextTimelineEvent,
} from "@nomosos/legal-ai";
import { createPetitionUdf, type PetitionParty } from "@nomosos/udf";
import type { AiTaskType } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { CaselawService } from "../caselaw/caselaw.service";
import {
  CitationVerifyService,
  type CitationVerificationReport,
} from "../caselaw/citation-verify.service";
import { evaluateReadyGate, type GateCitation, type ReadyGateResult } from "./petition-gate";
import {
  parseTemplateSections,
  parseVersionSections,
  replaceSection,
  safeFileName,
  sectionKey,
  sectionsFromTemplate,
  sectionsToPlainText,
  toUdfPetitionInput,
  type PetitionSectionBody,
} from "./petition-sections";
import { PetitionExportStorage } from "./petition-export.storage";
import {
  buildPetitionSectionRewriteMessages,
  PetitionSectionRewriteOutputSchema,
} from "./prompts/petition-section-rewrite";
import type {
  ChangePetitionStatusInput,
  CreatePetitionInput,
  CreatePetitionVersionInput,
  ExportUdfInput,
  GeneratePetitionInput,
  RewriteSectionInput,
} from "./petitions.dto";

/** Dilekçe tipine göre varsayılan sistem şablonu anahtarı. */
const DEFAULT_TEMPLATE_KEYS: Partial<Record<string, string>> = {
  DAVA_DILEKCESI: "SISTEM_DAVA_DILEKCESI",
  CEVAP: "SISTEM_CEVAP_DILEKCESI",
  ISTINAF: "SISTEM_ISTINAF_DILEKCESI",
  BILIRKISI_ITIRAZ: "SISTEM_BILIRKISI_ITIRAZ",
  ICRA_TAKIP_TALEBI: "SISTEM_ICRA_TAKIP_TALEBI",
  DELIL_LISTESI: "SISTEM_DELIL_LISTESI",
};

const PETITION_TYPE_LABELS: Record<string, string> = {
  DAVA_DILEKCESI: "Dava Dilekçesi",
  CEVAP: "Cevap Dilekçesi",
  CEVABA_CEVAP: "Cevaba Cevap Dilekçesi",
  IKINCI_CEVAP: "İkinci Cevap Dilekçesi",
  ISTINAF: "İstinaf Dilekçesi",
  TEMYIZ: "Temyiz Dilekçesi",
  ITIRAZ: "İtiraz Dilekçesi",
  DELIL_LISTESI: "Delil Listesi",
  ISLAH: "Islah Dilekçesi",
  BILIRKISI_ITIRAZ: "Bilirkişi Raporuna İtiraz Dilekçesi",
  ICRA_TAKIP_TALEBI: "İcra Takip Talebi",
  SIKAYET: "Şikâyet Dilekçesi",
  BEYAN: "Beyan Dilekçesi",
  DIGER: "Dilekçe",
};

/** Metin sürüm değişikliği sonrası statünün düşürüldüğü değer. */
const STALE_STATUS: PetitionStatus = "TEYIT_EDILIYOR";
/** İçerik değiştiğinde teyidi bayatlayan statüler. */
const VERIFIED_STATUSES: PetitionStatus[] = ["TEYIT_EDILDI", "INCELEMEDE", "HAZIR", "DISA_AKTARILDI"];
/** UDF/PDF dışa aktarımına açık statüler (Modül 22, iş kuralı 4). */
const EXPORTABLE_STATUSES: PetitionStatus[] = ["HAZIR", "DISA_AKTARILDI", "GONDERILDI"];
/** Yalnız hukuki roller tarafından verilebilecek statüler. */
const RESTRICTED_STATUSES: PetitionStatus[] = ["HAZIR", "DISA_AKTARILDI", "GONDERILDI"];

/**
 * TEYİT KAPISININ ÇALIŞTIĞI HEDEF STATÜLER.
 *
 * [KRİTİK DÜZELTME] Kapı eskiden YALNIZCA `status === "HAZIR"` isteğinde
 * koşuyordu. `PETITION_STATUSES` enum'u `DISA_AKTARILDI` ve `GONDERILDI`'yi de
 * kabul ettiği ve `EXPORTABLE_STATUSES` bu ikisini içerdiği için:
 *   TASLAK → PATCH { status: "GONDERILDI" } → POST /export/udf
 * zinciriyle uydurma künyeli bir dilekçe hiç doğrulanmadan UYAP'a
 * paketlenebiliyordu. Artık HAZIR ve SONRASINDAKİ HER geçiş kapıdan geçer.
 */
const GATED_STATUSES: PetitionStatus[] = ["HAZIR", "DISA_AKTARILDI", "GONDERILDI"];

/**
 * İZİNLİ STATÜ GEÇİŞLERİ.
 *
 * Kapıyı statüye değil GEÇİŞE bağlamak yetmez; ileri statüye "ATLAMAK" da
 * yasaklanmalıdır: `DISA_AKTARILDI` yalnızca HAZIR'dan, `GONDERILDI` yalnızca
 * HAZIR veya DISA_AKTARILDI'dan verilebilir.
 *
 * HAZIR'a geçiş HER durumdan denenebilir — çünkü kararı GRAFİK değil TEYİT
 * KAPISI verir ve kapının 422'si takılan atıfları tek tek gösterir. Grafiğin
 * burada devreye girmesi, kullanıcıya "geçilemez" deyip NEDENİNİ gizlerdi.
 */
const ALLOWED_TRANSITIONS: Record<PetitionStatus, PetitionStatus[]> = {
  TASLAK: ["TASLAK", "TEYIT_EDILIYOR", "TEYIT_EDILDI", "INCELEMEDE", "HAZIR"],
  TEYIT_EDILIYOR: ["TASLAK", "TEYIT_EDILIYOR", "TEYIT_EDILDI", "INCELEMEDE", "HAZIR"],
  TEYIT_EDILDI: ["TASLAK", "TEYIT_EDILIYOR", "TEYIT_EDILDI", "INCELEMEDE", "HAZIR"],
  INCELEMEDE: ["TASLAK", "TEYIT_EDILIYOR", "TEYIT_EDILDI", "INCELEMEDE", "HAZIR"],
  // Dışa aktarım ve gönderim YALNIZCA HAZIR'dan sonra gelir.
  HAZIR: ["TASLAK", "TEYIT_EDILIYOR", "TEYIT_EDILDI", "INCELEMEDE", "HAZIR", "DISA_AKTARILDI", "GONDERILDI"],
  DISA_AKTARILDI: ["TEYIT_EDILIYOR", "INCELEMEDE", "HAZIR", "DISA_AKTARILDI", "GONDERILDI"],
  GONDERILDI: ["GONDERILDI"],
};

const STATUS_LABELS: Record<PetitionStatus, string> = {
  TASLAK: "Taslak",
  TEYIT_EDILIYOR: "Teyit ediliyor",
  TEYIT_EDILDI: "Teyit edildi",
  INCELEMEDE: "İncelemede",
  HAZIR: "Hazır",
  DISA_AKTARILDI: "Dışa aktarıldı",
  GONDERILDI: "Gönderildi",
};

const CONTEXT_TOKEN_BUDGET = 6000;
const REWRITE_TOKEN_BUDGET = 2500;

@Injectable()
export class PetitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aiRunner: AiRunnerService,
    private readonly caselaw: CaselawService,
    private readonly citationVerify: CitationVerifyService,
    private readonly storage: PetitionExportStorage,
  ) {}

  // ------------------------------------------------------------------ //
  // Şablon kütüphanesi
  // ------------------------------------------------------------------ //

  /**
   * Sistem (tenantId = null) + büro şablonları.
   *
   * Sistem şablonları salt-okunurdur; kiracı bunları değiştiremez (Modül 22,
   * iş kuralı 6). Bu serviste şablon yazma ucu yoktur — sistem şablonları seed
   * ile gelir, büro şablonları ayrı bir fazda eklenecektir.
   */
  async listTemplates(tenantId: string, type?: string) {
    const templates = await this.prisma.client.petitionTemplate.findMany({
      where: {
        OR: [{ tenantId: null }, { tenantId }],
        ...(type ? { petitionType: type as Petition["type"] } : {}),
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return templates.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      petitionType: t.petitionType,
      isSystem: t.isSystem,
      readOnly: t.tenantId === null,
      sections: parseTemplateSections(t.sectionsJson),
    }));
  }

  // ------------------------------------------------------------------ //
  // CRUD
  // ------------------------------------------------------------------ //

  /**
   * Dilekçe Stüdyosu büro geneli listesi — tüm dosyaların dilekçeleri tek
   * ekranda (avukat geri bildirimi: "avukat nereden dilekçe yazacak?").
   */
  async listStudio(
    tenantId: string,
    filters: { caseId?: string; status?: string; type?: string; q?: string },
  ) {
    const rows = await this.prisma.client.petition.findMany({
      where: {
        tenantId,
        ...(filters.caseId ? { caseId: filters.caseId } : {}),
        ...(filters.status ? { status: filters.status as Petition["status"] } : {}),
        ...(filters.type ? { type: filters.type as Petition["type"] } : {}),
        ...(filters.q
          ? { title: { contains: filters.q, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        case: {
          select: {
            id: true,
            title: true,
            fileNumber: true,
            status: true,
            client: { select: { id: true, name: true } },
          },
        },
        versions: {
          select: { versionNo: true },
          orderBy: { versionNo: "desc" },
          take: 1,
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      caseId: p.caseId,
      case: p.case,
      type: p.type,
      title: p.title,
      status: p.status,
      latestVersionNo: p.versions[0]?.versionNo ?? 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async listForCase(tenantId: string, caseId: string) {
    await this.assertCase(tenantId, caseId);
    const petitions = await this.prisma.client.petition.findMany({
      where: { tenantId, caseId },
      orderBy: { updatedAt: "desc" },
      include: {
        template: { select: { id: true, name: true, key: true } },
        versions: { select: { id: true, versionNo: true, createdAt: true }, orderBy: { versionNo: "desc" }, take: 1 },
      },
    });
    return petitions.map((p) => ({
      id: p.id,
      caseId: p.caseId,
      type: p.type,
      title: p.title,
      status: p.status,
      template: p.template,
      currentVersionId: p.currentVersionId,
      latestVersionNo: p.versions[0]?.versionNo ?? 0,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /** Şablondan boş taslak açar (bölümler iskeletten gelir, gövdeler boştur). */
  async create(user: AuthUser, input: CreatePetitionInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "dilekçe oluşturma");
    const found = await this.assertCase(user.tenantId, input.caseId);

    const template = await this.resolveTemplate(user.tenantId, input.type, input.templateId);
    const sections = template
      ? sectionsFromTemplate(parseTemplateSections(template.sectionsJson))
      : sectionsFromTemplate([
          { title: "KONU", required: true },
          { title: "AÇIKLAMALAR", required: true },
          { title: "HUKUKİ SEBEPLER", required: true },
          { title: "DELİLLER", required: true },
          { title: "SONUÇ VE İSTEM", required: true },
        ]);

    const title =
      input.title?.trim() ||
      `${PETITION_TYPE_LABELS[input.type] ?? "Dilekçe"} — ${found.fileNumber ?? found.title}`;

    const petition = await this.prisma.client.petition.create({
      data: {
        tenantId: user.tenantId,
        caseId: input.caseId,
        templateId: template?.id,
        type: input.type,
        title,
        status: "TASLAK",
        createdBy: user.userId,
      },
    });

    // İlk sürüm kaydedilir; dönüş değeri yalnızca sürüm numarasıdır ve
    // aşağıdaki yanıtta petition.include ile okunur.
    await this.appendVersion(petition.id, sections, user.userId, "İlk taslak (şablon iskeleti).");

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PETITION_CREATE",
      entity: "Petition",
      entityId: petition.id,
      detail: `${input.type} · dosya ${input.caseId}`,
    });

    return this.detail(user, petition.id);
  }

  async detail(user: AuthUser, id: string) {
    const petition = await this.loadPetition(user.tenantId, id);
    const versions = await this.prisma.client.petitionVersion.findMany({
      where: { petitionId: id },
      select: { id: true, versionNo: true, createdBy: true, note: true, createdAt: true },
      orderBy: { versionNo: "desc" },
    });
    const current = await this.currentVersion(petition);
    const sections = current ? parseVersionSections(current.sectionsJson) : [];

    const verification = current
      ? await this.citationVerify.readChecks(user.tenantId, "PETITION", current.id)
      : [];
    const citationsInText = current ? this.citationVerify.extractFromText(current.plainText) : [];
    const verifiedRaws = new Set(verification.map((v) => v.raw.trim()));
    const unverifiedInText = citationsInText
      .map((c) => c.raw)
      .filter((raw) => !verifiedRaws.has(raw.trim()));

    const gate = evaluateReadyGate(verification as GateCitation[], {
      unstructuredSignals: current ? detectUnstructuredCitationSignals(current.plainText) : [],
    });

    return {
      id: petition.id,
      caseId: petition.caseId,
      type: petition.type,
      title: petition.title,
      status: petition.status,
      templateId: petition.templateId,
      createdBy: petition.createdBy,
      createdAt: petition.createdAt,
      updatedAt: petition.updatedAt,
      currentVersion: current
        ? {
            id: current.id,
            versionNo: current.versionNo,
            note: current.note,
            createdBy: current.createdBy,
            createdAt: current.createdAt,
            sections,
            plainText: current.plainText,
          }
        : undefined,
      versions,
      /** Bu SÜRÜM için yazılmış teyit sonuçları (bayat teyit imkânsız). */
      verification,
      /** Metinde geçip henüz teyit çalıştırılmamış atıflar. */
      unverifiedInText,
      readyGate: {
        ...gate,
        /** Teyit hiç çalıştırılmadıysa kapı zaten açılmaz. */
        verificationRun: verification.length > 0 || citationsInText.length === 0,
      },
    };
  }

  /** Yeni (DEĞİŞTİRİLEMEZ) sürüm. İçerik değiştiği için teyit bayatlar. */
  async createVersion(user: AuthUser, id: string, input: CreatePetitionVersionInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "dilekçe sürümü kaydetme");
    const petition = await this.loadPetition(user.tenantId, id);
    this.assertEditable(petition);

    const sections: PetitionSectionBody[] = input.sections.map((s) => ({
      key: s.key?.trim() || sectionKey(s.title),
      title: s.title,
      body: s.body ?? "",
      origin: s.origin ?? "MANUAL",
      hint: s.hint,
      required: s.required,
    }));

    const version = await this.appendVersion(petition.id, sections, user.userId, input.note);
    await this.markStale(petition, "Yeni sürüm kaydedildi");
    const verification = await this.runVerification(user, petition.id, version);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PETITION_VERSION_CREATE",
      entity: "Petition",
      entityId: petition.id,
      detail: `v${version.versionNo}${input.note ? ` · ${input.note}` : ""}`,
    });

    return { ...(await this.detail(user, id)), verification };
  }

  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "dilekçe silme");
    const petition = await this.loadPetition(user.tenantId, id);
    if (petition.status === "GONDERILDI") {
      throw new ConflictException(
        "Gönderilmiş dilekçe silinemez; kayıt dosyanın hukuki geçmişinin parçasıdır.",
      );
    }
    await this.prisma.client.petition.delete({ where: { id: petition.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PETITION_DELETE",
      entity: "Petition",
      entityId: id,
      detail: petition.title,
    });
    return { deleted: true };
  }

  // ------------------------------------------------------------------ //
  // Teyit ve statü
  // ------------------------------------------------------------------ //

  /**
   * Güncel sürümün metnindeki atıfları deterministik olarak doğrular.
   *
   * Atıflar output-guard'ın atıf çıkarıcısıyla (packages/legal-ai
   * citation-patterns) bulunur; doğrulama CitationVerifyService'te YALNIZCA
   * kayıtlı veriye bakılarak yapılır — LLM'e "bu karar var mı?" diye sorulmaz.
   */
  async verify(user: AuthUser, id: string) {
    const petition = await this.loadPetition(user.tenantId, id);
    const current = await this.currentVersion(petition);
    if (!current) {
      throw new BadRequestException("Dilekçenin henüz bir sürümü yok.");
    }
    const report = await this.runVerification(user, petition.id, current);
    const gate = evaluateReadyGate(this.toGateCitations(report), {
      unstructuredSignals: detectUnstructuredCitationSignals(current.plainText),
    });
    return { petitionId: id, versionId: current.id, ...report, readyGate: gate };
  }

  /**
   * Statü değişikliği.
   *
   * HAZIR VE SONRASINDAKİ HER geçişte TEYİT KAPISI çalışır: teyit YENİDEN
   * koşulur (deterministik, LLM yok), sonuç kapıya verilir ve tek bir
   * doğrulanmamış atıf varsa istek HTTP 422 ile reddedilir; hangi atıfların
   * takıldığı tek tek döner. Ayrıca geçiş grafiği zorunludur: HAZIR'a uğramadan
   * DISA_AKTARILDI/GONDERILDI verilemez.
   */
  async changeStatus(user: AuthUser, id: string, input: ChangePetitionStatusInput) {
    const petition = await this.loadPetition(user.tenantId, id);

    if (RESTRICTED_STATUSES.includes(input.status)) {
      assertRole(user, ROLE_SETS.HUKUKI, `dilekçeyi ${input.status} statüsüne alma`);
    }
    if (petition.status === "GONDERILDI" && input.status !== "GONDERILDI") {
      throw new ConflictException("Gönderilmiş dilekçenin statüsü geri alınamaz.");
    }

    // --- (1) GEÇİŞ GRAFİĞİ ------------------------------------------------
    const allowed = ALLOWED_TRANSITIONS[petition.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new UnprocessableEntityException({
        invalidTransition: true,
        from: petition.status,
        to: input.status,
        allowed,
        message:
          `«${STATUS_LABELS[petition.status]}» statüsünden «${STATUS_LABELS[input.status]}» ` +
          "statüsüne doğrudan geçilemez. Dilekçe önce TEYİT KAPISINDAN geçip HAZIR olmalıdır; " +
          "dışa aktarım ve gönderim ancak ondan sonra verilebilir.",
      });
    }

    // --- (2) TEYİT KAPISI --------------------------------------------------
    let gate: ReadyGateResult | undefined;
    if (GATED_STATUSES.includes(input.status)) {
      const current = await this.currentVersion(petition);
      if (!current || !current.plainText.trim()) {
        throw new UnprocessableEntityException({
          message: `Boş dilekçe ${STATUS_LABELS[input.status]} statüsüne alınamaz; önce bölümleri doldurun.`,
        });
      }

      const report = await this.runVerification(user, petition.id, current);
      gate = evaluateReadyGate(this.toGateCitations(report), {
        declaredStatutes: input.confirmedStatuteCitations,
        // K-10: künyesiz mahkeme atfı da bloklar (gerçek fail-closed).
        unstructuredSignals: detectUnstructuredCitationSignals(current.plainText),
      });

      if (!gate.ok) {
        // 422 — teyit kapısı. Halüsinasyonlu künye taşıyan dilekçe mahkemeye gidemez.
        throw new UnprocessableEntityException({
          message:
            `Dilekçe ${STATUS_LABELS[input.status]} statüsüne alınamadı: ` +
            `${gate.blocking.length} atıf teyit kapısını geçemedi. ` +
            "Atıfları düzeltin, kararları sisteme ekleyin ya da metinden çıkarın.",
          readyGate: gate,
          blocking: gate.blocking,
          statuteDeclarationsRequired: gate.statuteDeclarationsRequired,
          hint:
            "İçtihat atıfları için istisna yoktur. Mevzuat atıflarını yürürlükteki metinden " +
            "teyit ettiyseniz `confirmedStatuteCitations` listesinde bildirin.",
        });
      }
    }

    const updated = await this.prisma.client.petition.update({
      where: { id: petition.id },
      data: { status: input.status },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PETITION_STATUS_CHANGE",
      entity: "Petition",
      entityId: petition.id,
      detail:
        `${petition.status} → ${input.status}` +
        (gate ? ` · teyit: ${gate.verified}/${gate.total}` : "") +
        (gate && gate.statuteDeclarationsAccepted.length > 0
          ? ` · avukat beyanıyla kabul edilen mevzuat atıfları: ${gate.statuteDeclarationsAccepted.join("; ")}`
          : "") +
        (input.note ? ` · ${input.note}` : ""),
    });

    return { ...updated, readyGate: gate };
  }

  // ------------------------------------------------------------------ //
  // AI: taslak üretimi ve bölüm yeniden yazımı
  // ------------------------------------------------------------------ //

  /**
   * PETITION_DRAFT — dosya bağlamından bölüm bölüm taslak.
   *
   * Emsal atfı yalnızca dosyaya bağlı ONAYLI (KABUL) emsallerden yapılabilir;
   * liste boşsa model künye uydurmak yerine "[EMSAL ÖNERİSİ: ...]" bırakır.
   * [DEMO VERİ] işaretli emsaller bağlama BİLİNÇLİ OLARAK alınmaz.
   */
  async generate(user: AuthUser, id: string, input: GeneratePetitionInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "AI ile dilekçe taslağı üretme");
    const petition = await this.loadPetition(user.tenantId, id);
    this.assertEditable(petition);

    const current = await this.currentVersion(petition);
    const skeleton = current ? parseVersionSections(current.sectionsJson) : [];
    if (skeleton.length === 0) {
      throw new BadRequestException("Dilekçenin bölüm iskeleti yok; önce şablondan bir sürüm oluşturun.");
    }

    const ctx = await this.buildAiContext(user, petition.caseId, "PETITION_DRAFT", input.piiApproved);

    // KVKK: `styleNote` KULLANICININ SERBEST METNİDİR ve prompta doğrudan girer.
    // `preScanned` verildiği için AiRunnerService'in kapısı atlanır; bu yüzden
    // üslup notu BURADA ayrıca kapıdan geçirilir (rewriteSection'daki desen).
    // Aksi hâlde "müvekkil 12345678901 TCKN'li…" gibi bir not ham olarak dış
    // sağlayıcıya gider ve AiUsageLog.piiMasked yanlış (false) yazılırdı.
    const noteGate = this.aiRunner.applyPiiGate(
      ctx.providerType,
      [input.styleNote ?? "", input.note ?? ""],
      input.piiApproved,
      ctx.providerBaseUrl,
    );

    const run = await this.aiRunner.run({
      user,
      taskType: "PETITION_DRAFT",
      outboundTexts: [ctx.contextText, noteGate.texts[0]],
      preScanned: { piiMasked: ctx.piiMasked || noteGate.piiMasked },
      schema: PetitionDraftOutputSchema,
      // Bölümler "bulgu" değildir; kaynaksız eleme UYGULANMAZ, yoksa iskelet parçalanır.
      findingPaths: [],
      maxTokens: 4096,
      entity: "Petition",
      entityId: petition.id,
      buildMessages: ([contextText, styleNote]) =>
        buildPetitionDraftMessages({
          petitionType: PETITION_TYPE_LABELS[petition.type] ?? petition.type,
          sectionSkeleton: skeleton.map((s) => s.key),
          styleNote: styleNote?.trim() ? styleNote : undefined,
          approvedPrecedents: ctx.precedents,
          caseContextText: contextText,
        }),
    });

    const merged = mergeDraftIntoSkeleton(skeleton, run.data.sections);
    const version = await this.appendVersion(
      petition.id,
      merged.sections,
      user.userId,
      input.note?.trim() || "AI taslağı (PETITION_DRAFT)",
    );
    await this.markStale(petition, "AI taslağı üretildi");
    const verification = await this.runVerification(user, petition.id, version);
    const gate = evaluateReadyGate(this.toGateCitations(verification), {
      unstructuredSignals: detectUnstructuredCitationSignals(version.plainText),
    });

    return {
      petitionId: petition.id,
      versionId: version.id,
      versionNo: version.versionNo,
      sections: merged.sections,
      /** Modelin iskelette olmayan bölüm önerileri (yazılmadı, bilgi amaçlı). */
      unmatchedSections: merged.unmatched,
      /** İskelette olup modelin doldurmadığı bölümler. */
      untouchedSections: merged.untouched,
      precedentSuggestions: dedupeText([
        ...run.data.precedentSuggestions,
        ...extractPrecedentPlaceholders(sectionsToPlainText(merged.sections)),
      ]),
      missingContextNotes: run.data.missingContextNotes,
      excludedDemoPrecedents: ctx.excludedDemo,
      contextInfo: {
        piiMasked: ctx.piiMasked,
        truncated: ctx.truncated,
        droppedItemCount: ctx.droppedItemCount,
        approvedPrecedentCount: ctx.precedents.length,
      },
      verification,
      readyGate: gate,
      advisory: run.advisory,
      model: run.model,
    };
  }

  /**
   * PETITION_SECTION_REWRITE — yalnızca hedef bölüm değişir; diğer bölümlerin
   * gövdesi bayt bayt korunur (Modül 22, kabul kriteri 2).
   */
  async rewriteSection(user: AuthUser, id: string, key: string, input: RewriteSectionInput) {
    assertRole(user, [...ROLE_SETS.HUKUKI, "STAJYER"], "AI ile bölüm yeniden yazdırma");
    const petition = await this.loadPetition(user.tenantId, id);
    this.assertEditable(petition);

    const current = await this.currentVersion(petition);
    if (!current) {
      throw new BadRequestException("Dilekçenin henüz bir sürümü yok.");
    }
    const sections = parseVersionSections(current.sectionsJson);
    const target = sections.find((s) => s.key === key);
    if (!target) {
      throw new NotFoundException(
        `"${key}" anahtarlı bölüm bulunamadı. Mevcut bölümler: ${sections.map((s) => s.key).join(", ")}`,
      );
    }

    const ctx = await this.buildAiContext(
      user,
      petition.caseId,
      "PETITION_SECTION_REWRITE",
      input.piiApproved,
      REWRITE_TOKEN_BUDGET,
    );

    // Bölüm gövdesi de dışa gidecek metindir; KVKK kapısından ayrıca geçer.
    const bodyGate = this.aiRunner.applyPiiGate(
      ctx.providerType,
      [target.body, input.instruction],
      input.piiApproved,
      ctx.providerBaseUrl,
    );

    const run = await this.aiRunner.run({
      user,
      taskType: "PETITION_SECTION_REWRITE",
      outboundTexts: [ctx.contextText, bodyGate.texts[0], bodyGate.texts[1]],
      preScanned: { piiMasked: ctx.piiMasked || bodyGate.piiMasked },
      schema: PetitionSectionRewriteOutputSchema,
      findingPaths: [],
      maxTokens: 2048,
      entity: "Petition",
      entityId: petition.id,
      buildMessages: ([contextText, body, instruction]) =>
        buildPetitionSectionRewriteMessages({
          sectionTitle: target.title,
          sectionHint: target.hint,
          currentBody: body,
          instruction,
          approvedPrecedents: ctx.precedents,
          caseContextText: contextText,
        }),
    });

    const next = replaceSection(sections, key, run.data.content, "AI");
    const version = await this.appendVersion(
      petition.id,
      next,
      user.userId,
      `Bölüm yeniden yazıldı: ${target.title}`,
    );
    await this.markStale(petition, `Bölüm değişti: ${target.title}`);
    const verification = await this.runVerification(user, petition.id, version);

    return {
      petitionId: petition.id,
      versionId: version.id,
      versionNo: version.versionNo,
      sectionKey: key,
      sectionTitle: target.title,
      previousBody: target.body,
      newBody: run.data.content,
      changeSummary: run.data.changeSummary,
      warnings: run.data.warnings,
      unchangedSectionKeys: sections.filter((s) => s.key !== key).map((s) => s.key),
      verification,
      readyGate: evaluateReadyGate(this.toGateCitations(verification), {
        unstructuredSignals: detectUnstructuredCitationSignals(version.plainText),
      }),
      advisory: run.advisory,
      model: run.model,
    };
  }

  // ------------------------------------------------------------------ //
  // UDF dışa aktarımı
  // ------------------------------------------------------------------ //

  /**
   * UDF (UYAP Doküman Formatı) üretir ve ön-imzalı indirme bağlantısı döner.
   *
   * Yalnızca HAZIR ve sonrası statülerde açıktır (Modül 22, iş kuralı 4):
   * teyit kapısını geçmemiş bir metin UYAP'a gidecek biçimde paketlenemez.
   *
   * MASKELEME YOK: dışa aktarım büro içinde kalır ve mahkemeye giden metin
   * gerçek taraf bilgilerini taşımak ZORUNDADIR. Maskeleme yalnızca dış LLM'e
   * giden metne uygulanır.
   */
  async exportUdf(user: AuthUser, id: string, input: ExportUdfInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "dilekçe dışa aktarma");
    const petition = await this.loadPetition(user.tenantId, id);

    if (!EXPORTABLE_STATUSES.includes(petition.status)) {
      throw new ConflictException(
        `Dilekçe "${petition.status}" statüsünde dışa aktarılamaz. Dışa aktarım yalnızca teyit ` +
          "kapısından geçmiş (HAZIR ve sonrası) dilekçelerde açıktır.",
      );
    }

    const current = await this.currentVersion(petition);
    if (!current) {
      throw new BadRequestException("Dilekçenin henüz bir sürümü yok.");
    }

    // SAVUNMA DERİNLİĞİ: statüye GÜVENİLMEZ. Statü doğru olsa bile güncel
    // sürümün teyit satırları yeniden okunur ve kapı burada BİR KEZ DAHA
    // çalıştırılır. Böylece statüyü bir yolla ele geçiren bir istek de
    // uydurma künyeli bir UDF üretemez.
    const exportChecks = await this.citationVerify.readChecks(user.tenantId, "PETITION", current.id);
    const citationsInText = this.citationVerify.extractFromText(current.plainText);
    if (exportChecks.length === 0 && citationsInText.length > 0) {
      throw new UnprocessableEntityException({
        message:
          "Bu sürümün atıfları hiç teyit edilmemiş; dışa aktarılamaz. Önce " +
          "POST /petitions/:id/verify ile teyidi çalıştırın.",
        unverifiedInText: citationsInText.map((c) => c.raw),
      });
    }
    const exportGate = evaluateReadyGate(exportChecks as GateCitation[], {
      // Avukatın HAZIR geçişinde yaptığı mevzuat beyanı denetim kaydındadır;
      // dışa aktarımda beyan yeniden istenir ki "beyansız" bir yol kalmasın.
      declaredStatutes: input.confirmedStatuteCitations,
      // K-10: ikinci kapı da künyesiz mahkeme atfını bloklar. Eskiden
      // `citationsInText.length > 0` koşulu sağlanamadığı için bu kapı hiç
      // tetiklenmiyor ve uydurma künyeli UDF üretilebiliyordu.
      unstructuredSignals: detectUnstructuredCitationSignals(current.plainText),
    });
    if (!exportGate.ok) {
      throw new UnprocessableEntityException({
        message:
          `Dilekçe dışa aktarılamadı: ${exportGate.blocking.length} atıf teyit kapısını geçemiyor. ` +
          "Statü ne olursa olsun, doğrulanmamış atıf taşıyan metin UYAP biçiminde paketlenmez.",
        readyGate: exportGate,
        blocking: exportGate.blocking,
        statuteDeclarationsRequired: exportGate.statuteDeclarationsRequired,
      });
    }

    const sections = parseVersionSections(current.sectionsJson);

    const found = await this.prisma.client.case.findFirst({
      where: { id: petition.caseId, tenantId: user.tenantId },
      include: {
        client: { select: { name: true, tckn: true, taxNumber: true, address: true } },
        parties: true,
        responsibleUser: { select: { fullName: true, barNumber: true } },
      },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }

    const enforcement = found.type === "ICRA" || petition.type === "ICRA_TAKIP_TALEBI";
    const plaintiffRoles = enforcement
      ? ["ALACAKLI"]
      : ["DAVACI", "MUSTEKI", "KATILAN", "MUDAHIL"];
    const defendantRoles = enforcement ? ["BORCLU"] : ["DAVALI", "SANIK"];

    const plaintiffs: PetitionParty[] = found.parties
      .filter((p) => plaintiffRoles.includes(p.role))
      .map((p) => ({ name: p.name }));
    const defendants: PetitionParty[] = found.parties
      .filter((p) => defendantRoles.includes(p.role))
      .map((p) => ({ name: p.name }));

    if (plaintiffs.length === 0) {
      plaintiffs.push({
        name: found.client.name,
        identityNumber: found.client.tckn ?? found.client.taxNumber ?? undefined,
        address: found.client.address ?? undefined,
      });
    }
    if (defendants.length === 0) {
      // Karşı taraf kaydı yoksa dilekçeye görünür bir yer tutucu basılır; sistem isim UYDURMAZ.
      defendants.push({ name: "[KARŞI TARAF — DOSYADA KAYITLI DEĞİL]" });
    }

    const udfInput = toUdfPetitionInput(sections, {
      courtName: found.courtName ?? "SAYIN MAHKEMESİ",
      caseNumber: found.fileNumber ?? undefined,
      plaintiffs,
      defendants,
      plaintiffLabel: enforcement ? "ALACAKLI" : "DAVACI",
      defendantLabel: enforcement ? "BORÇLU" : "DAVALI",
      attorneyName: found.responsibleUser?.fullName,
      attorneyBarNumber: found.responsibleUser?.barNumber ?? undefined,
    });

    const bytes = await createPetitionUdf(udfInput);
    const fileName = `${safeFileName(petition.title)}-v${current.versionNo}.udf`;
    const key = `${user.tenantId}/${petition.caseId}/dilekce/${petition.id}-v${current.versionNo}-${fileName}`;

    const stored = await this.storage.store({
      key,
      fileName,
      bytes,
      expiresInSeconds: input.expiresIn,
    });

    if (petition.status === "HAZIR") {
      await this.prisma.client.petition.update({
        where: { id: petition.id },
        data: { status: "DISA_AKTARILDI" },
      });
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "PETITION_EXPORT_UDF",
      entity: "Petition",
      entityId: petition.id,
      detail:
        `v${current.versionNo} · ${stored.storage} · ${stored.sizeBytes} bayt` +
        ` · bağlantı ömrü ${stored.expiresInSeconds ?? 0} sn` +
        ` · teyit ${exportGate.verified}/${exportGate.total}` +
        (exportGate.statuteDeclarationsAccepted.length > 0
          ? ` · avukat beyanıyla kabul edilen mevzuat atıfları: ${exportGate.statuteDeclarationsAccepted.join("; ")}`
          : ""),
    });

    return {
      petitionId: petition.id,
      versionId: current.id,
      versionNo: current.versionNo,
      format: "UDF",
      ...stored,
      warning:
        "UDF üretimi deneyseldir (@nomosos/udf): resmî bir spesifikasyon yayımlanmadığı için " +
        "dosyayı göndermeden önce UYAP Editör ile açıp doğrulayın.",
    };
  }

  // ------------------------------------------------------------------ //
  // Yardımcılar
  // ------------------------------------------------------------------ //

  private async assertCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }
    return found;
  }

  private async loadPetition(tenantId: string, id: string): Promise<Petition> {
    const petition = await this.prisma.client.petition.findFirst({ where: { id, tenantId } });
    if (!petition) {
      throw new NotFoundException("Dilekçe bulunamadı.");
    }
    return petition;
  }

  private assertEditable(petition: Petition): void {
    if (petition.status === "GONDERILDI") {
      throw new ConflictException(
        "Gönderilmiş dilekçe değiştirilemez. Değişiklik için yeni bir dilekçe oluşturun.",
      );
    }
  }

  private async currentVersion(petition: Petition): Promise<PetitionVersion | null> {
    if (petition.currentVersionId) {
      const version = await this.prisma.client.petitionVersion.findUnique({
        where: { id: petition.currentVersionId },
      });
      if (version) return version;
    }
    return this.prisma.client.petitionVersion.findFirst({
      where: { petitionId: petition.id },
      orderBy: { versionNo: "desc" },
    });
  }

  private async resolveTemplate(tenantId: string, type: string, templateId?: string) {
    if (templateId) {
      const template = await this.prisma.client.petitionTemplate.findFirst({
        where: { id: templateId, OR: [{ tenantId: null }, { tenantId }] },
      });
      if (!template) {
        throw new BadRequestException("Seçilen dilekçe şablonu bulunamadı.");
      }
      return template;
    }
    const key = DEFAULT_TEMPLATE_KEYS[type];
    if (!key) return null;
    // tenantId null olduğu için findUnique/upsert KULLANILAMAZ (Postgres NULL eşitliği).
    return this.prisma.client.petitionTemplate.findFirst({ where: { tenantId: null, key } });
  }

  /**
   * Yeni sürüm ekler.
   *
   * @@unique([petitionId, versionNo]) nedeniyle MAX+1 hesabı yarış koşuludur;
   * P2002 (benzersizlik ihlali) alındığında sınırlı sayıda yeniden denenir.
   */
  private async appendVersion(
    petitionId: string,
    sections: readonly PetitionSectionBody[],
    createdBy: string,
    note?: string,
  ): Promise<PetitionVersion> {
    const sectionsJson = JSON.stringify(sections);
    const plainText = sectionsToPlainText(sections);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const last = await tx.petitionVersion.findFirst({
            where: { petitionId },
            orderBy: { versionNo: "desc" },
            select: { versionNo: true },
          });
          const version = await tx.petitionVersion.create({
            data: {
              petitionId,
              versionNo: (last?.versionNo ?? 0) + 1,
              sectionsJson,
              plainText,
              createdBy,
              note,
            },
          });
          await tx.petition.update({
            where: { id: petitionId },
            data: { currentVersionId: version.id },
          });
          return version;
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException(
      "Dilekçe sürümü kaydedilemedi: eşzamanlı düzenleme çakışması sürdü. Sayfayı yenileyip tekrar deneyin.",
    );
  }

  /** İçerik değiştiğinde teyit edilmiş statüleri TEYIT_EDILIYOR'a düşürür. */
  private async markStale(petition: Petition, reason: string): Promise<void> {
    if (!VERIFIED_STATUSES.includes(petition.status)) return;
    await this.prisma.client.petition.update({
      where: { id: petition.id },
      data: { status: STALE_STATUS },
    });
    await this.audit.log({
      tenantId: petition.tenantId,
      action: "PETITION_VERIFICATION_STALE",
      entity: "Petition",
      entityId: petition.id,
      detail: `${petition.status} → ${STALE_STATUS} · ${reason}`,
    });
  }

  /**
   * Sürüm metnindeki atıfları doğrular ve sonucu SÜRÜM kimliğiyle kaydeder.
   * Statü, sonuca göre TEYIT_EDILDI veya TEYIT_EDILIYOR olur (HAZIR ve sonrası
   * statüler bu yolla YÜKSELTİLMEZ; onlar changeStatus'ün işidir).
   */
  private async runVerification(
    user: AuthUser,
    petitionId: string,
    version: PetitionVersion,
  ): Promise<CitationVerificationReport> {
    const citations = this.citationVerify.extractFromText(version.plainText).map((c) => c.raw);
    const report = await this.citationVerify.verify(user, {
      citations,
      sourceType: "PETITION",
      sourceId: version.id,
    });

    const petition = await this.prisma.client.petition.findUnique({ where: { id: petitionId } });
    if (petition && (petition.status === "TASLAK" || petition.status === "TEYIT_EDILIYOR")) {
      const gate = evaluateReadyGate(this.toGateCitations(report), {
        unstructuredSignals: detectUnstructuredCitationSignals(version.plainText),
      });
      // Mevzuat beyanı olmadan TEYIT_EDILDI verilmez; kapı zaten mevzuatı bloklar.
      const nextStatus: PetitionStatus = gate.ok ? "TEYIT_EDILDI" : "TEYIT_EDILIYOR";
      if (nextStatus !== petition.status) {
        await this.prisma.client.petition.update({
          where: { id: petitionId },
          data: { status: nextStatus },
        });
      }
    }
    return report;
  }

  private toGateCitations(report: CitationVerificationReport): GateCitation[] {
    return report.results.map((r) => ({
      raw: r.raw,
      kind: r.kind,
      status: r.status,
      isDemo: r.isDemo,
      note: r.note,
    }));
  }

  /**
   * Dosya bağlamını kurar ve KVKK kapısını uygular.
   *
   * SIRA ÖNEMLİDİR: önce sağlayıcı tipi çözülür (dış mı?), sonra ham metinlerde
   * PII taranır. Dış sağlayıcı + PII + onay yok → HTTP 409 requiresPiiApproval.
   * Onay varsa her alan tek tek maskelenerek bağlam kurulur; böylece
   * `buildCaseContext`'e verilen `piiScanned: true` bildirimi GERÇEKTEN doğrudur.
   */
  private async buildAiContext(
    user: AuthUser,
    caseId: string,
    taskType: AiTaskType,
    piiApproved?: boolean,
    tokenBudget = CONTEXT_TOKEN_BUDGET,
  ): Promise<{
    contextText: string;
    piiMasked: boolean;
    providerType: string;
    providerBaseUrl?: string | null;
    precedents: string[];
    excludedDemo: string[];
    truncated: boolean;
    droppedItemCount: number;
  }> {
    const { config } = await this.aiRunner.resolveRoute(user.tenantId, taskType);

    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      include: {
        client: { select: { name: true } },
        parties: true,
        timelineEvents: { orderBy: { date: "desc" }, take: 25 },
        decisions: { orderBy: { date: "desc" }, take: 10 },
        documents: {
          orderBy: { createdAt: "desc" },
          take: 15,
          select: { id: true, name: true, class: true, createdAt: true, aiSummary: true },
        },
      },
    });
    if (!found) {
      throw new NotFoundException("Dosya bulunamadı.");
    }

    const precedentInfo = await this.caselaw.approvedPrecedentsForCase(user.tenantId, caseId);

    // --- KVKK kapısı: önce tespit, sonra maskeleme --------------------------
    const rawStrings = [
      found.title,
      found.subject ?? "",
      found.courtName ?? "",
      found.client.name,
      ...found.parties.flatMap((p) => [p.name, p.lawyerName ?? "", p.notes ?? ""]),
      ...found.timelineEvents.flatMap((e) => [e.title, e.detail ?? ""]),
      ...found.decisions.flatMap((d) => [d.summary, d.outcome ?? ""]),
      ...found.documents.flatMap((d) => [d.name, d.aiSummary ?? ""]),
      ...precedentInfo.lines,
    ];
    // DIŞSALLIK TİPE DEĞİL ADRESE BAKAR: `CUSTOM`/`OLLAMA` de bulut adresine
    // yönlendirilmiş olabilir (baseUrl kiracının serbest girdisidir).
    const external = isExternalDestination(config.type, config.baseUrl);
    const scan = scanPii(rawStrings.join("\n"));
    if (external && scan.hasPii && !piiApproved) {
      throw new ConflictException({
        requiresPiiApproval: true,
        // Ham TCKN/IBAN DEĞERİ dönmez; yalnızca tür + kısmi maske + adet.
        findings: summarizeFindings(scan.findings),
        // Sistem promptu ve şablon metinleri gövdeye KONMAZ; yalnızca dosya
        // bağlamının maskeli hâli gösterilir.
        maskedText: scan.maskedText,
        message:
          "Dosya bağlamında kişisel veri (TCKN/IBAN/telefon/e-posta) tespit edildi. Dış AI " +
          "sağlayıcısına göndermeden önce maskeli metni onaylayın (piiApproved: true).",
      });
    }
    const shouldMask = external && scan.hasPii;
    const m = (value: string | null | undefined): string =>
      shouldMask ? scanPii(value ?? "").maskedText : (value ?? "");

    // --- Bağlam kurulumu ----------------------------------------------------
    const parties: CaseContextParty[] = found.parties.map((p) => ({
      role: p.role,
      name: m(p.name),
      isClient: p.isClient,
      counselName: p.lawyerName ? m(p.lawyerName) : undefined,
    }));

    const timeline: CaseContextTimelineEvent[] = [
      ...found.timelineEvents.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        type: e.source ?? undefined,
        description: m(`${e.title}${e.detail ? ` — ${e.detail}` : ""}`),
      })),
      ...found.decisions.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        type: `KARAR/${d.type}`,
        description: m(`${d.summary}${d.outcome ? ` — Sonuç: ${d.outcome}` : ""}`),
      })),
    ];

    const documents: CaseContextDocument[] = found.documents.map((d) => ({
      documentId: d.id,
      title: m(d.name),
      documentClass: d.class,
      date: d.createdAt.toISOString().slice(0, 10),
      summary: d.aiSummary ? m(d.aiSummary) : "(özet üretilmemiş)",
    }));

    const built = buildCaseContext(
      {
        piiScanned: true,
        case: {
          caseNumber: found.fileNumber ?? found.title,
          courtName: m(found.courtName),
          caseType: found.type,
          status: found.status,
          subject: m(found.subject),
          openedAt: found.openedAt.toISOString().slice(0, 10),
          clientLabel: m(found.client.name),
        },
        parties,
        timeline,
        documents,
      },
      {
        // PETITION_SECTION_REWRITE için politika tanımlı değildir; PETITION_DRAFT
        // politikası kullanılır (aynı veri kümesi, daha küçük bütçe).
        taskType: "PETITION_DRAFT",
        tokenBudget,
      },
    );

    return {
      contextText: built.text,
      piiMasked: shouldMask,
      providerType: config.type,
      providerBaseUrl: config.baseUrl,
      precedents: precedentInfo.lines.map((line) => m(line)),
      excludedDemo: precedentInfo.excludedDemo,
      truncated: built.truncated,
      droppedItemCount: built.droppedItemCount,
    };
  }
}

/**
 * Model çıktısını iskelete oturtur.
 *
 * İskeletin SIRASI VE BAŞLIKLARI korunur; modelin uydurduğu ek bölümler
 * dilekçeye YAZILMAZ, yalnızca bilgi olarak raporlanır (Modül 22: "iskelete
 * sadık kal, bölüm ekleme/çıkarma").
 */
export function mergeDraftIntoSkeleton(
  skeleton: readonly PetitionSectionBody[],
  drafted: readonly { key: string; title: string; content: string; origin?: string }[],
): { sections: PetitionSectionBody[]; unmatched: string[]; untouched: string[] } {
  const byKey = new Map<string, { content: string }>();
  const unmatched: string[] = [];

  for (const section of drafted) {
    const key = skeleton.find((s) => s.key === section.key)
      ? section.key
      : (skeleton.find((s) => s.key === sectionKey(section.title))?.key ?? "");
    if (!key) {
      unmatched.push(section.title || section.key);
      continue;
    }
    byKey.set(key, { content: section.content });
  }

  const untouched: string[] = [];
  const sections = skeleton.map((s) => {
    const drafted = byKey.get(s.key);
    if (!drafted) {
      untouched.push(s.title);
      return { ...s };
    }
    return { ...s, body: drafted.content, origin: "AI" as const };
  });

  return { sections, unmatched, untouched };
}

/**
 * Metin listesini büyük/küçük harf ve noktalama duyarsız tekilleştirir.
 * (Model aynı emsal önerisini hem `precedentSuggestions` dizisinde hem metindeki
 * "[EMSAL ÖNERİSİ: ...]" işaretçisinde farklı yazımla verebiliyor.)
 */
function dedupeText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("tr-TR").replace(/[\s.,;:]+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
