/**
 * BİLİRKİŞİ YÖNETİMİ (Modül 13) — kişi havuzu, raporlar, itirazlar.
 *
 * ÜRÜN İLKELERİ:
 *
 *  1. SÜRE HESABI DETERMİNİSTİKTİR. Tebliğ tarihi (`servedAt`) girildiğinde
 *     HMK m.281 itiraz süresi `ExpertDeadlinesService` üzerinden hesaplanır ve
 *     `Deadline(status = BEKLIYOR)` olarak avukat onayına sunulur. Bu servis
 *     hiçbir yerde gün aritmetiği YAPMAZ.
 *
 *  2. İTİRAZ DURUM MAKİNESİ TEK YÖNLÜDÜR. TASLAK → SUNULDU → KABUL|RED.
 *     Sunulmamış bir itiraz "kabul edildi" olamaz; sunulmuş bir itiraz
 *     taslağa geri dönemez (dosyaya verilmiş bir dilekçe geri alınamaz).
 *
 *  3. DİLEKÇE MODÜLÜNE BAĞIMLILIK KURULMAZ. İtiraz taslağı `Petition` +
 *     `PetitionVersion` kayıtlarını DOĞRUDAN Prisma ile açar; `PetitionsService`
 *     import EDİLMEZ. Böylece iki modül birbirine kenetlenmez ve dilekçe
 *     modülünün iç kuralları (teyit kapısı, sürüm zinciri) kendi uçlarında
 *     normal işleyişine devam eder.
 *
 *  4. TENANT SÜZGECİ HER SORGUDA — `Expert`, `ExpertReport`, `ExpertObjection`
 *     tablolarında `tenantId` skalerdir; şema süzgeci zorlamaz.
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ObjectionStatus } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { formatTrDate } from "../common/dates";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { ExpertDeadlinesService } from "./expert-deadlines.service";
import type {
  CreateExpertInput,
  CreateExpertReportInput,
  CreateObjectionInput,
  DraftPetitionInput,
  ObjectionPointInput,
  UpdateExpertInput,
  UpdateExpertReportInput,
  UpdateObjectionInput,
} from "./expert.dto";

/** Bilirkişi/rapor kaydı girebilen roller — stajyer dâhil (veri girişi). */
const EXPERT_WRITE_ROLES = [...ROLE_SETS.HUKUKI, "STAJYER"] as const;

/**
 * İTİRAZ DURUM MAKİNESİ. Geçersiz geçiş 422 döner.
 * KABUL ve RED nihaidir: mahkemenin itiraz hakkındaki kararı geri alınamaz.
 */
const OBJECTION_TRANSITIONS: Record<ObjectionStatus, ObjectionStatus[]> = {
  TASLAK: ["SUNULDU"],
  SUNULDU: ["KABUL", "RED"],
  KABUL: [],
  RED: [],
};

@Injectable()
export class ExpertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deadlines: ExpertDeadlinesService,
  ) {}

  // ================================================================== //
  // BİLİRKİŞİ HAVUZU (büro içi hafıza)
  // ================================================================== //

  /** GET /experts */
  async listExperts(
    user: AuthUser,
    params: { q?: string; specialty?: string; page?: string; limit?: string },
  ) {
    const page = resolvePage(params);
    const q = normalizeQuery(params.q);

    const where = {
      tenantId: user.tenantId,
      ...(q ? { fullName: { contains: q, mode: "insensitive" as const } } : {}),
      ...(params.specialty
        ? { specialty: { contains: params.specialty, mode: "insensitive" as const } }
        : {}),
    };

    const [experts, total] = await Promise.all([
      this.prisma.client.expert.findMany({
        where,
        orderBy: { fullName: "asc" },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.client.expert.count({ where }),
    ]);

    // Bilirkişi başına dosya geçmişi — DETERMİNİSTİK sayım, tek sorguda.
    const counts = await this.prisma.client.expertReport.groupBy({
      by: ["expertId"],
      where: { tenantId: user.tenantId, expertId: { in: experts.map((e) => e.id) } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.expertId, c._count._all]));

    return paged(
      experts.map((e) => ({ ...e, reportCount: countMap.get(e.id) ?? 0 })),
      total,
      page,
    );
  }

  /** GET /experts/:id — kişi kartı + görev aldığı raporlar. */
  async expertDetail(user: AuthUser, id: string) {
    const expert = await this.prisma.client.expert.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!expert) throw new NotFoundException("Bilirkişi kaydı bulunamadı.");

    // `ExpertReport.expertId` FK DEĞİLDİR (bilirkişi silinse de rapor yaşar);
    // ilişki bu yüzden elle kurulur.
    const reports = await this.prisma.client.expertReport.findMany({
      where: { tenantId: user.tenantId, expertId: id },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true,
        caseId: true,
        reportType: true,
        receivedAt: true,
        servedAt: true,
        case: { select: { title: true, fileNumber: true, status: true } },
      },
    });

    return {
      ...expert,
      reports,
      stats: {
        reportCount: reports.length,
        caseCount: new Set(reports.map((r) => r.caseId)).size,
        byType: reports.reduce<Record<string, number>>((acc, r) => {
          acc[r.reportType] = (acc[r.reportType] ?? 0) + 1;
          return acc;
        }, {}),
        computedBy: "deterministik sayım (AI kullanılmaz)",
      },
    };
  }

  /** POST /experts */
  async createExpert(user: AuthUser, input: CreateExpertInput) {
    assertRole(user, EXPERT_WRITE_ROLES, "bilirkişi kaydı oluşturma");
    const expert = await this.prisma.client.expert.create({
      data: {
        tenantId: user.tenantId,
        fullName: input.fullName,
        specialty: input.specialty ?? null,
        institution: input.institution ?? null,
        note: input.note ?? null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_CREATE",
      entity: "Expert",
      entityId: expert.id,
      detail: expert.fullName,
    });
    return expert;
  }

  /** PATCH /experts/:id */
  async updateExpert(user: AuthUser, id: string, input: UpdateExpertInput) {
    assertRole(user, EXPERT_WRITE_ROLES, "bilirkişi kaydı güncelleme");
    const existing = await this.prisma.client.expert.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Bilirkişi kaydı bulunamadı.");

    const expert = await this.prisma.client.expert.update({
      where: { id: existing.id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.specialty !== undefined ? { specialty: input.specialty ?? null } : {}),
        ...(input.institution !== undefined ? { institution: input.institution ?? null } : {}),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_UPDATE",
      entity: "Expert",
      entityId: expert.id,
      detail: Object.keys(input).join(", "),
    });
    return expert;
  }

  // ================================================================== //
  // RAPORLAR
  // ================================================================== //

  /** GET /cases/:caseId/expert-reports */
  async listReports(user: AuthUser, caseId: string) {
    await this.assertCase(user.tenantId, caseId);
    const reports = await this.prisma.client.expertReport.findMany({
      where: { tenantId: user.tenantId, caseId },
      orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
      include: { objections: { orderBy: { createdAt: "asc" } } },
    });

    const items = [];
    for (const report of reports) {
      items.push(await this.present(user.tenantId, report));
    }
    return { items, total: items.length };
  }

  /** GET /expert-reports/:id */
  async reportDetail(user: AuthUser, id: string) {
    const report = await this.loadReport(user.tenantId, id, true);
    return this.present(user.tenantId, report);
  }

  /**
   * POST /cases/:caseId/expert-reports
   *
   * `servedAt` verilmişse itiraz süresi ANINDA ve DETERMİNİSTİK hesaplanır;
   * kayıt BEKLIYOR durumunda açılır ve yanıtta `deadline` alanında döner.
   */
  async createReport(user: AuthUser, caseId: string, input: CreateExpertReportInput) {
    assertRole(user, EXPERT_WRITE_ROLES, "bilirkişi raporu kaydı oluşturma");
    await this.assertCase(user.tenantId, caseId);
    await this.assertExpert(user.tenantId, input.expertId);
    await this.assertDocument(user.tenantId, caseId, input.documentId);

    const report = await this.prisma.client.expertReport.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        expertId: input.expertId ?? null,
        reportType: input.reportType ?? "ASIL",
        documentId: input.documentId ?? null,
        receivedAt: input.receivedAt,
        servedAt: input.servedAt ?? null,
        summary: input.summary ?? null,
        conclusionText: input.conclusionText ?? null,
        createdBy: user.userId,
      },
    });

    await this.prisma.client.timelineEvent.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        userId: user.userId,
        title: `Bilirkişi raporu kaydedildi (${report.reportType})`,
        detail:
          `Rapor tarihi: ${formatTrDate(report.receivedAt)}` +
          (report.servedAt ? ` · Tebliğ: ${formatTrDate(report.servedAt)}` : " · Tebliğ tarihi yok"),
        source: "SISTEM",
      },
    });

    const deadline = await this.deadlines.suggestObjectionDeadline(user, report);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_REPORT_CREATE",
      entity: "ExpertReport",
      entityId: report.id,
      detail: `dosya=${caseId} tip=${report.reportType} tebliğ=${report.servedAt ? "var" : "yok"}`,
    });

    return { ...(await this.present(user.tenantId, report)), deadline };
  }

  /**
   * PATCH /expert-reports/:id
   *
   * TEBLİĞ TARİHİ BURADA DA SÜRE TETİKLER: rapor önce tebliğsiz kaydedilip
   * sonra tebliğ tarihi girildiğinde (en yaygın akış) süre yine hesaplanır.
   */
  async updateReport(user: AuthUser, id: string, input: UpdateExpertReportInput) {
    assertRole(user, EXPERT_WRITE_ROLES, "bilirkişi raporu güncelleme");
    const existing = await this.loadReport(user.tenantId, id);
    await this.assertExpert(user.tenantId, input.expertId);
    await this.assertDocument(user.tenantId, existing.caseId, input.documentId);

    const report = await this.prisma.client.expertReport.update({
      where: { id: existing.id },
      data: {
        ...(input.expertId !== undefined ? { expertId: input.expertId ?? null } : {}),
        ...(input.reportType !== undefined ? { reportType: input.reportType } : {}),
        ...(input.documentId !== undefined ? { documentId: input.documentId ?? null } : {}),
        ...(input.receivedAt !== undefined ? { receivedAt: input.receivedAt } : {}),
        ...(input.servedAt !== undefined ? { servedAt: input.servedAt ?? null } : {}),
        ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
        ...(input.conclusionText !== undefined
          ? { conclusionText: input.conclusionText ?? null }
          : {}),
      },
    });

    // Tebliğ tarihi YENİ girildi veya DEĞİŞTİ ise süre önerisi tetiklenir.
    const servedChanged =
      input.servedAt !== undefined &&
      normalizeTime(existing.servedAt) !== normalizeTime(report.servedAt);

    let deadline = null;
    if (servedChanged && report.servedAt) {
      deadline = await this.deadlines.suggestObjectionDeadline(user, report);
      await this.prisma.client.timelineEvent.create({
        data: {
          tenantId: user.tenantId,
          caseId: report.caseId,
          userId: user.userId,
          title: "Bilirkişi raporu tebliğ tarihi girildi",
          detail: `Tebliğ: ${formatTrDate(report.servedAt)} · itiraz süresi onayınıza sunuldu.`,
          source: "SISTEM",
        },
      });
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_REPORT_UPDATE",
      entity: "ExpertReport",
      entityId: report.id,
      detail: Object.keys(input).join(", ") + (servedChanged ? " · tebliğ tarihi değişti" : ""),
    });

    return {
      ...(await this.present(user.tenantId, report)),
      deadline,
      ...(servedChanged && existing.servedAt
        ? {
            warnings: [
              `Tebliğ tarihi ${formatTrDate(existing.servedAt)} → ` +
                `${report.servedAt ? formatTrDate(report.servedAt) : "boş"} olarak değişti. ` +
                "ÖNCEKİ TARİHE GÖRE HESAPLANMIŞ SÜRE KAYDI OTOMATİK İPTAL EDİLMEDİ; hangi " +
                "tarihin geçerli olduğu hukuki bir tespittir. Süreler ekranından eskisini " +
                "gözden geçirin.",
            ],
          }
        : {}),
    };
  }

  /** DELETE /expert-reports/:id — itirazlar Cascade ile birlikte silinir. */
  async deleteReport(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "bilirkişi raporu silme");
    const existing = await this.loadReport(user.tenantId, id, true);

    const submitted = existing.objections.filter((o) => o.status !== "TASLAK");
    if (submitted.length > 0) {
      throw new UnprocessableEntityException(
        `Bu rapora bağlı ${submitted.length} adet SUNULMUŞ itiraz var; rapor kaydı silinemez. ` +
          "Dosyaya verilmiş bir itirazın dayanağı sistemden kaldırılamaz.",
      );
    }

    await this.prisma.client.expertReport.delete({ where: { id: existing.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_REPORT_DELETE",
      entity: "ExpertReport",
      entityId: id,
      detail: `dosya=${existing.caseId} tip=${existing.reportType}`,
    });
    return { deleted: true, id };
  }

  // ================================================================== //
  // İTİRAZLAR
  // ================================================================== //

  /** POST /expert-reports/:id/objection */
  async createObjection(user: AuthUser, reportId: string, input: CreateObjectionInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "bilirkişi raporuna itiraz kaydı oluşturma");
    const report = await this.loadReport(user.tenantId, reportId);

    // İtiraz, tebliğ tarihinden doğan süre kaydına bağlanır — böylece ekranda
    // "bu itirazın son günü ne?" sorusu tek kayıttan cevaplanır.
    const deadline = await this.deadlines.findObjectionDeadline(
      user.tenantId,
      report.caseId,
      report.servedAt,
    );

    const objection = await this.prisma.client.expertObjection.create({
      data: {
        tenantId: user.tenantId,
        expertReportId: report.id,
        points: JSON.stringify(numberPoints(input.points)),
        status: input.status ?? "TASLAK",
        deadlineId: deadline?.id ?? null,
        createdBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_OBJECTION_CREATE",
      entity: "ExpertObjection",
      entityId: objection.id,
      detail: `rapor=${report.id} madde=${input.points.length} durum=${objection.status}`,
    });

    return {
      ...objection,
      points: numberPoints(input.points),
      deadline,
      warnings: report.servedAt
        ? deadline
          ? []
          : [
              "Bu rapor için hesaplanmış bir itiraz süresi kaydı bulunamadı; itiraz süresini " +
                "elle takip edin.",
            ]
        : [
            "Raporun tebliğ tarihi girilmemiş; itiraz süresi HESAPLANMAMIŞTIR. Tebliğ tarihini " +
              "girerek süreyi deterministik olarak hesaplatın.",
          ],
    };
  }

  /** PATCH /expert-objections/:id — durum makinesi burada uygulanır. */
  async updateObjection(user: AuthUser, id: string, input: UpdateObjectionInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "bilirkişi itirazı güncelleme");
    const existing = await this.prisma.client.expertObjection.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("İtiraz kaydı bulunamadı.");

    if (input.status !== undefined && input.status !== existing.status) {
      const allowed = OBJECTION_TRANSITIONS[existing.status];
      if (!allowed.includes(input.status)) {
        throw new UnprocessableEntityException(
          `İtiraz durumu ${existing.status} → ${input.status} olarak değiştirilemez. ` +
            (allowed.length
              ? `İzin verilen geçişler: ${allowed.join(", ")}.`
              : "Bu durum nihaidir ve değiştirilemez."),
        );
      }
    }

    // SUNULMUŞ itirazın maddeleri değiştirilemez: dosyaya verilen dilekçenin
    // içeriği sistemde geriye dönük düzenlenirse kayıt delil değerini yitirir.
    if (input.points !== undefined && existing.status !== "TASLAK") {
      throw new UnprocessableEntityException(
        `Durumu ${existing.status} olan itirazın maddeleri değiştirilemez; yalnızca TASLAK ` +
          "durumundaki itiraz düzenlenebilir.",
      );
    }

    const objection = await this.prisma.client.expertObjection.update({
      where: { id: existing.id },
      data: {
        ...(input.points !== undefined ? { points: JSON.stringify(numberPoints(input.points)) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.petitionId !== undefined ? { petitionId: input.petitionId ?? null } : {}),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_OBJECTION_UPDATE",
      entity: "ExpertObjection",
      entityId: objection.id,
      detail:
        (input.status ? `durum ${existing.status} → ${input.status}` : "içerik güncellendi") +
        ` · ${Object.keys(input).join(", ")}`,
    });

    return { ...objection, points: parsePoints(objection.points) };
  }

  /**
   * POST /expert-reports/:id/objection/draft-petition
   *
   * İtiraz maddelerinden bir dilekçe TASLAĞI açar (`PetitionType.BILIRKISI_ITIRAZ`).
   * `PetitionsService` İMPORT EDİLMEZ — kayıtlar doğrudan Prisma ile yazılır ve
   * dilekçe modülünün kendi yaşam döngüsü (teyit kapısı, sürümler, UDF çıktısı)
   * kendi uçlarından devam eder.
   *
   * TASLAK OLARAK AÇILIR: statü `TASLAK`, metin avukatın düzenlemesine açıktır.
   * Hiçbir metin doğrudan gönderime uygun sayılmaz.
   */
  async draftObjectionPetition(
    user: AuthUser,
    objectionId: string,
    input: DraftPetitionInput,
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "itiraz dilekçesi taslağı oluşturma");
    const objection = await this.prisma.client.expertObjection.findFirst({
      where: { id: objectionId, tenantId: user.tenantId },
      include: { expertReport: { select: { id: true, caseId: true, receivedAt: true, reportType: true } } },
    });
    if (!objection) throw new NotFoundException("İtiraz kaydı bulunamadı.");

    if (objection.petitionId) {
      const existingPetition = await this.prisma.client.petition.findFirst({
        where: { id: objection.petitionId, tenantId: user.tenantId },
        select: { id: true, title: true, status: true },
      });
      if (existingPetition) {
        throw new UnprocessableEntityException(
          `Bu itiraz için zaten bir dilekçe taslağı var (${existingPetition.title}). ` +
            "Aynı itirazdan ikinci taslak açmak yerine mevcut dilekçeyi düzenleyin.",
        );
      }
    }

    const points = parsePoints(objection.points);
    const report = objection.expertReport;
    const title =
      input.title?.trim() ||
      `Bilirkişi Raporuna İtiraz — ${formatTrDate(report.receivedAt)} tarihli ${
        report.reportType === "EK" ? "ek rapor" : "rapor"
      }`;

    const sections = buildObjectionSections(points, report);
    const plainText = sections.map((s) => `${s.title}\n${s.body}`).join("\n\n");

    const result = await this.prisma.client.$transaction(async (tx) => {
      const petition = await tx.petition.create({
        data: {
          tenantId: user.tenantId,
          caseId: report.caseId,
          type: "BILIRKISI_ITIRAZ",
          title,
          status: "TASLAK",
          createdBy: user.userId,
        },
      });
      const version = await tx.petitionVersion.create({
        data: {
          petitionId: petition.id,
          versionNo: 1,
          sectionsJson: JSON.stringify(sections),
          plainText,
          createdBy: user.userId,
          note: "Bilirkişi itirazı maddelerinden üretilen ilk taslak (avukat düzenlemesi gerekir).",
        },
      });
      await tx.petition.update({
        where: { id: petition.id },
        data: { currentVersionId: version.id },
      });
      await tx.expertObjection.update({
        where: { id: objection.id },
        data: { petitionId: petition.id },
      });
      return { petition, version };
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EXPERT_OBJECTION_PETITION_DRAFT",
      entity: "Petition",
      entityId: result.petition.id,
      detail: `itiraz=${objection.id} rapor=${report.id} madde=${points.length}`,
    });

    return {
      petitionId: result.petition.id,
      versionId: result.version.id,
      title,
      status: result.petition.status,
      sections,
      approval: {
        required: true,
        note:
          "Dilekçe TASLAK olarak açıldı. Metin, itiraz maddelerinden DOĞRUDAN üretilmiş bir " +
          "iskelettir; hukuki gerekçelendirme, atıf ve talep bölümü avukat tarafından " +
          "tamamlanmalıdır. Dilekçe, teyit kapısından geçmeden HAZIR statüsüne alınamaz.",
      },
    };
  }

  /**
   * POST /expert-reports/:id/objection/draft-petition
   *
   * Rapor ekranından çağrılan kısayol: raporun TASLAK itirazını bulur ve
   * `draftObjectionPetition`e devreder. Birden çok taslak itiraz varsa EN SON
   * oluşturulan seçilir; hangisinin kullanılacağı yanıtta AÇIKÇA döner ki
   * avukat yanlış itirazdan dilekçe üretildiğini fark edebilsin.
   */
  async draftPetitionForReport(user: AuthUser, reportId: string, input: DraftPetitionInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "itiraz dilekçesi taslağı oluşturma");
    const report = await this.loadReport(user.tenantId, reportId, true);

    const drafts = report.objections.filter((o) => o.status === "TASLAK");
    if (drafts.length === 0) {
      throw new UnprocessableEntityException(
        "Bu rapor için TASLAK durumunda itiraz kaydı yok. Önce " +
          "POST /expert-reports/:id/objection ile itiraz maddelerini kaydedin.",
      );
    }
    const selected = drafts[drafts.length - 1];

    const result = await this.draftObjectionPetition(user, selected.id, input);
    return {
      ...result,
      objectionId: selected.id,
      ...(drafts.length > 1
        ? {
            warnings: [
              `Bu raporda ${drafts.length} adet TASLAK itiraz var; en son oluşturulan ` +
                `(${selected.id}) kullanıldı. Farklı bir itirazdan taslak üretmek için ` +
                "/expert-objections/:id/draft-petition ucunu kullanın.",
            ],
          }
        : {}),
    };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  async assertCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true, status: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");
    return found;
  }

  async loadReport(tenantId: string, id: string, withObjections = false) {
    const report = await this.prisma.client.expertReport.findFirst({
      where: { id, tenantId },
      ...(withObjections
        ? { include: { objections: { orderBy: { createdAt: "asc" as const } } } }
        : {}),
    });
    if (!report) throw new NotFoundException("Bilirkişi raporu bulunamadı.");
    return report as typeof report & {
      objections: { id: string; status: ObjectionStatus; points: string; petitionId: string | null; deadlineId: string | null; createdAt: Date }[];
    };
  }

  /** `Expert.id` FK değildir; varlık kontrolü uygulama katmanında yapılır. */
  private async assertExpert(tenantId: string, expertId: string | null | undefined) {
    if (!expertId) return;
    const found = await this.prisma.client.expert.findFirst({
      where: { id: expertId, tenantId },
      select: { id: true },
    });
    if (!found) throw new UnprocessableEntityException("Belirtilen bilirkişi kaydı bulunamadı.");
  }

  /** `ExpertReport.documentId` FK değildir; belge dosyaya ait olmalıdır. */
  private async assertDocument(
    tenantId: string,
    caseId: string,
    documentId: string | null | undefined,
  ) {
    if (!documentId) return;
    const doc = await this.prisma.client.document.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, caseId: true },
    });
    if (!doc) throw new UnprocessableEntityException("Rapor belgesi bulunamadı.");
    if (doc.caseId && doc.caseId !== caseId) {
      throw new UnprocessableEntityException(
        "Belge başka bir dosyaya ait; bilirkişi raporu belgesi aynı dosyada olmalıdır.",
      );
    }
  }

  /** Rapor yanıt zarfı: itiraz maddeleri çözülür, süre kaydı iliştirilir. */
  private async present(
    tenantId: string,
    report: {
      id: string;
      caseId: string;
      expertId: string | null;
      reportType: string;
      documentId: string | null;
      receivedAt: Date;
      servedAt: Date | null;
      summary: string | null;
      conclusionText: string | null;
      createdBy: string;
      createdAt: Date;
      objections?: { id: string; status: ObjectionStatus; points: string; petitionId: string | null; deadlineId: string | null; createdAt: Date }[];
    },
  ) {
    const deadline = await this.deadlines.findObjectionDeadline(
      tenantId,
      report.caseId,
      report.servedAt,
    );
    const expert = report.expertId
      ? await this.prisma.client.expert.findFirst({
          where: { id: report.expertId, tenantId },
          select: { id: true, fullName: true, specialty: true },
        })
      : null;

    return {
      ...report,
      expert,
      /** `expertId` dolu ama kayıt yok (bilirkişi silinmiş) — görünür kılınır. */
      expertMissing: Boolean(report.expertId) && !expert,
      objections: (report.objections ?? []).map((o) => ({
        ...o,
        points: parsePoints(o.points),
      })),
      objectionDeadline: deadline,
      /** Tebliğ yoksa süre üretilmez — ekranda kalıcı uyarı. */
      servedAtMissing: report.servedAt === null,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Saf yardımcılar
 * ------------------------------------------------------------------ */

/** Madde numaralarını 1..n olarak yeniden dizer (dilekçe sırası). */
function numberPoints(points: readonly ObjectionPointInput[]) {
  return points.map((p, i) => ({
    no: p.no ?? i + 1,
    topic: p.topic,
    summary: p.summary,
    sourceRef: p.sourceRef ?? null,
  }));
}

/** `points` JSON sütunu — bozuk veri koşuyu düşürmemelidir. */
function parsePoints(raw: string): { no: number; topic: string; summary: string; sourceRef: string | null }[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ReturnType<typeof numberPoints>) : [];
  } catch {
    return [];
  }
}

function normalizeTime(date: Date | null): number | null {
  return date ? date.getTime() : null;
}

/**
 * İtiraz maddelerinden dilekçe iskeleti.
 *
 * TASLAK BİLEREK SADEDİR: her madde AYNEN aktarılır, hukuki gerekçe
 * EKLENMEZ. Metni "hazır dilekçe" gibi göstermek, avukatı okumadan
 * göndermeye teşvik ederdi.
 */
function buildObjectionSections(
  points: readonly { no: number; topic: string; summary: string; sourceRef: string | null }[],
  report: { receivedAt: Date; reportType: string },
) {
  const body = points
    .map((p) => {
      const source = p.sourceRef ? `\n   Rapordan: "${p.sourceRef}"` : "";
      return `${p.no}. ${p.topic}\n   ${p.summary}${source}`;
    })
    .join("\n\n");

  return [
    {
      title: "KONU",
      body:
        `${formatTrDate(report.receivedAt)} tarihli ${
          report.reportType === "EK" ? "ek bilirkişi raporuna" : "bilirkişi raporuna"
        } karşı itirazlarımızın sunulmasıdır.`,
    },
    {
      title: "AÇIKLAMALAR",
      body:
        body ||
        "[İtiraz maddeleri girilmemiş — bu bölüm avukat tarafından doldurulmalıdır.]",
    },
    {
      title: "HUKUKİ SEBEPLER",
      body:
        "HMK m.281 ve ilgili mevzuat.\n" +
        "[Dosyaya özgü hukuki sebepler avukat tarafından tamamlanmalıdır; bu bölüm otomatik " +
        "üretilmemiştir ve atıf içermez.]",
    },
    {
      title: "DELİLLER",
      body: "[Dosya kapsamı, bilirkişi raporu ve ekleri; delil listesi avukat tarafından tamamlanacaktır.]",
    },
    {
      title: "SONUÇ VE İSTEM",
      body:
        "Yukarıda arz ve izah edilen nedenlerle; bilirkişi raporuna itirazlarımızın kabulü ile " +
        "[ek rapor alınmasına / yeni bilirkişi heyeti teşkiline] karar verilmesini saygılarımızla " +
        "arz ve talep ederiz.\n[Talep, dosyanın durumuna göre avukat tarafından netleştirilmelidir.]",
    },
  ];
}
