/**
 * DELİL YÖNETİMİ — İDDİA, DELİL, BAĞ VE HUKUKİ DAYANAK KAYITLARI (Modül 14).
 *
 * Bu servis matrisin AVUKAT ONAYLI verisini yönetir. AI katmanı (evidence-ai)
 * buraya HİÇBİR ŞEY YAZMAZ; öneri üretir, avukat bu uçlardan tek tek ekler.
 *
 * TENANT SÜZGECİ HER SORGUDA. `Claim`, `Evidence`, `ClaimEvidenceLink` ve
 * `ClaimLegalBasis` tablolarında `tenantId` SKALERDİR (ilişki değil); şema
 * süzgeci zorlamaz, her `where` elle yazılmalıdır. Başka kiracının kaydı
 * daima 404 döner — 403 dönmek kaydın varlığını sızdırırdı.
 *
 * ATIF KAYIT ÜZERİNDEN DOĞRULANIR: `ClaimLegalBasis.caseLawId` verildiğinde
 * `CaseLawDocument` havuzunda ARANIR; bulunamazsa 422. LLM'e "bu karar var mı?"
 * sorulmaz (ürün ilkesi).
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { EvidenceMatrixService } from "./evidence-matrix.service";
import {
  DOCUMENT_BACKED_TYPES,
  type AddLegalBasisInput,
  type CreateClaimInput,
  type CreateEvidenceInput,
  type LinkEvidenceInput,
  type UpdateClaimInput,
  type UpdateEvidenceInput,
} from "./evidence.dto";

/** Delil kaydı girebilen roller — stajyer dâhil (veri girişi hukuki tasarruf değildir). */
const EVIDENCE_WRITE_ROLES = [...ROLE_SETS.HUKUKI, "STAJYER"] as const;

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly matrix: EvidenceMatrixService,
  ) {}

  // ================================================================== //
  // İDDİALAR
  // ================================================================== //

  /** GET /cases/:caseId/claims */
  async listClaims(user: AuthUser, caseId: string, side?: string) {
    await this.matrix.assertCase(user.tenantId, caseId);
    const claims = await this.prisma.client.claim.findMany({
      where: {
        tenantId: user.tenantId,
        caseId,
        ...(side === "BIZ" || side === "KARSI_TARAF" ? { side } : {}),
      },
      orderBy: [{ side: "asc" }, { orderIndex: "asc" }, { createdAt: "asc" }],
      include: {
        legalBases: { orderBy: { createdAt: "asc" } },
        evidenceLinks: {
          orderBy: { createdAt: "asc" },
          include: {
            evidence: { select: { id: true, title: true, type: true, status: true } },
          },
        },
      },
    });
    return { items: claims, total: claims.length };
  }

  /** POST /cases/:caseId/claims */
  async createClaim(user: AuthUser, caseId: string, input: CreateClaimInput) {
    assertRole(user, EVIDENCE_WRITE_ROLES, "iddia kaydı oluşturma");
    await this.matrix.assertCase(user.tenantId, caseId);

    const orderIndex = input.orderIndex ?? (await this.nextClaimOrder(user.tenantId, caseId));

    const claim = await this.prisma.client.claim.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        side: input.side,
        text: input.text,
        orderIndex,
        status: input.status ?? "ACIK",
        createdBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_CLAIM_CREATE",
      entity: "Claim",
      entityId: claim.id,
      detail: `dosya=${caseId} taraf=${input.side}`,
    });
    return claim;
  }

  /** PATCH /claims/:id */
  async updateClaim(user: AuthUser, id: string, input: UpdateClaimInput) {
    assertRole(user, EVIDENCE_WRITE_ROLES, "iddia güncelleme");
    const existing = await this.loadClaim(user.tenantId, id);

    const claim = await this.prisma.client.claim.update({
      where: { id: existing.id },
      data: {
        ...(input.side !== undefined ? { side: input.side } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_CLAIM_UPDATE",
      entity: "Claim",
      entityId: claim.id,
      detail: Object.keys(input).join(", "),
    });
    return claim;
  }

  /** DELETE /claims/:id — bağlar ve dayanaklar Cascade ile birlikte silinir. */
  async deleteClaim(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "iddia silme");
    const existing = await this.loadClaim(user.tenantId, id);

    await this.prisma.client.claim.delete({ where: { id: existing.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_CLAIM_DELETE",
      entity: "Claim",
      entityId: id,
      detail: `dosya=${existing.caseId} · metin="${existing.text.slice(0, 120)}"`,
    });
    return { deleted: true, id };
  }

  // ================================================================== //
  // DELİLLER
  // ================================================================== //

  /** GET /cases/:caseId/evidence */
  async listEvidence(
    user: AuthUser,
    caseId: string,
    filters: { type?: string; status?: string },
  ) {
    await this.matrix.assertCase(user.tenantId, caseId);
    const items = await this.prisma.client.evidence.findMany({
      where: {
        tenantId: user.tenantId,
        caseId,
        ...(filters.type ? { type: filters.type as never } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      orderBy: [{ createdAt: "asc" }],
      include: {
        claimLinks: {
          select: { id: true, claimId: true, strength: true },
        },
      },
    });
    return { items, total: items.length };
  }

  /** POST /cases/:caseId/evidence */
  async createEvidence(user: AuthUser, caseId: string, input: CreateEvidenceInput) {
    assertRole(user, EVIDENCE_WRITE_ROLES, "delil kaydı oluşturma");
    await this.matrix.assertCase(user.tenantId, caseId);

    const documentId = await this.resolveDocumentId(user.tenantId, caseId, input.documentId);

    const evidence = await this.prisma.client.evidence.create({
      data: {
        tenantId: user.tenantId,
        caseId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        documentId,
        witnessName: input.witnessName ?? null,
        obtainedAt: input.obtainedAt ?? null,
        status: input.status ?? "PLANLANAN",
        createdBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_CREATE",
      entity: "Evidence",
      entityId: evidence.id,
      detail: `dosya=${caseId} tip=${input.type}`,
    });

    return { ...evidence, warnings: documentWarnings(input.type, documentId) };
  }

  /** PATCH /evidence/:id */
  async updateEvidence(user: AuthUser, id: string, input: UpdateEvidenceInput) {
    assertRole(user, EVIDENCE_WRITE_ROLES, "delil güncelleme");
    const existing = await this.loadEvidence(user.tenantId, id);

    const nextType = input.type ?? existing.type;
    const nextWitness =
      input.witnessName !== undefined ? (input.witnessName ?? null) : existing.witnessName;

    // TANIK delilinde tanık adı zorunluluğu güncellemede de korunur; aksi
    // hâlde tip TANIK'a çevrilerek doğrulama atlatılabilirdi.
    if (nextType === "TANIK" && !String(nextWitness ?? "").trim()) {
      throw new UnprocessableEntityException(
        "TANIK tipindeki delilde tanık adı zorunludur; tanık adı boş bırakılamaz.",
      );
    }

    const documentId =
      input.documentId === undefined
        ? existing.documentId
        : await this.resolveDocumentId(user.tenantId, existing.caseId, input.documentId);

    const evidence = await this.prisma.client.evidence.update({
      where: { id: existing.id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.documentId !== undefined ? { documentId } : {}),
        ...(input.witnessName !== undefined ? { witnessName: input.witnessName ?? null } : {}),
        ...(input.obtainedAt !== undefined ? { obtainedAt: input.obtainedAt ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_UPDATE",
      entity: "Evidence",
      entityId: evidence.id,
      detail: Object.keys(input).join(", "),
    });

    return { ...evidence, warnings: documentWarnings(nextType, documentId) };
  }

  /** DELETE /evidence/:id — bağları Cascade ile birlikte silinir. */
  async deleteEvidence(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "delil silme");
    const existing = await this.loadEvidence(user.tenantId, id);

    const linkCount = await this.prisma.client.claimEvidenceLink.count({
      where: { tenantId: user.tenantId, evidenceId: existing.id },
    });

    await this.prisma.client.evidence.delete({ where: { id: existing.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_DELETE",
      entity: "Evidence",
      entityId: id,
      detail: `dosya=${existing.caseId} · "${existing.title.slice(0, 120)}" · ${linkCount} iddia bağı da silindi`,
    });
    return { deleted: true, id, removedLinks: linkCount };
  }

  // ================================================================== //
  // İDDİA ↔ DELİL BAĞI (matrisin hücresi)
  // ================================================================== //

  /** POST /claims/:id/evidence/:evidenceId */
  async linkEvidence(
    user: AuthUser,
    claimId: string,
    evidenceId: string,
    input: LinkEvidenceInput,
  ) {
    assertRole(user, EVIDENCE_WRITE_ROLES, "delil bağlama");
    const claim = await this.loadClaim(user.tenantId, claimId);
    const evidence = await this.loadEvidence(user.tenantId, evidenceId);

    // Bir iddia ile delil AYNI DOSYAYA ait olmak zorundadır; aksi hâlde
    // matris başka bir dosyanın delilini "ispat" olarak gösterirdi.
    if (claim.caseId !== evidence.caseId) {
      throw new UnprocessableEntityException(
        "İddia ile delil aynı dosyaya ait değil; farklı dosyaların kayıtları bağlanamaz.",
      );
    }

    try {
      const link = await this.prisma.client.claimEvidenceLink.create({
        data: {
          tenantId: user.tenantId,
          claimId: claim.id,
          evidenceId: evidence.id,
          strength: input.strength ?? null,
          note: input.note ?? null,
          createdBy: user.userId,
        },
      });

      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "EVIDENCE_LINK_CREATE",
        entity: "ClaimEvidenceLink",
        entityId: link.id,
        detail: `iddia=${claim.id} delil=${evidence.id} güç=${input.strength ?? "-"}`,
      });
      return link;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new UnprocessableEntityException(
          "Bu delil zaten bu iddiaya bağlı. Destek gücünü değiştirmek için bağı kaldırıp yeniden kurun.",
        );
      }
      throw err;
    }
  }

  /** DELETE /claims/:id/evidence/:evidenceId */
  async unlinkEvidence(user: AuthUser, claimId: string, evidenceId: string) {
    assertRole(user, EVIDENCE_WRITE_ROLES, "delil bağını kaldırma");
    const link = await this.prisma.client.claimEvidenceLink.findFirst({
      where: { tenantId: user.tenantId, claimId, evidenceId },
      select: { id: true },
    });
    if (!link) throw new NotFoundException("İddia–delil bağı bulunamadı.");

    await this.prisma.client.claimEvidenceLink.delete({ where: { id: link.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_LINK_DELETE",
      entity: "ClaimEvidenceLink",
      entityId: link.id,
      detail: `iddia=${claimId} delil=${evidenceId}`,
    });
    return { deleted: true, claimId, evidenceId };
  }

  // ================================================================== //
  // HUKUKİ DAYANAK
  // ================================================================== //

  /** POST /claims/:id/legal-basis */
  async addLegalBasis(user: AuthUser, claimId: string, input: AddLegalBasisInput) {
    // Hukuki dayanak belirlemek hukuki tasarruftur; stajyer giremez.
    assertRole(user, ROLE_SETS.HUKUKI, "hukuki dayanak ekleme");
    const claim = await this.loadClaim(user.tenantId, claimId);

    /**
     * ATIF KAYIT ÜZERİNDEN DOĞRULANIR. İçtihat havuzu kiracıdan bağımsızdır
     * (`CaseLawDocument`'ta tenantId yoktur), bu yüzden süzgeç yalnız id'dir.
     * Bulunamayan künye kabul edilmez: matristen dilekçeye aktarılacak bir
     * dayanağın uydurma olması, ürünün en ağır hatasıdır.
     */
    if (input.caseLawId) {
      const found = await this.prisma.client.caseLawDocument.findUnique({
        where: { id: input.caseLawId },
        select: { id: true },
      });
      if (!found) {
        throw new UnprocessableEntityException(
          "Belirtilen içtihat kaydı bulunamadı. Hukuki dayanak, içtihat havuzundaki bir KAYITLA " +
            "eşleşmelidir; doğrulanmamış künye matrise yazılamaz.",
        );
      }
    }

    const basis = await this.prisma.client.claimLegalBasis.create({
      data: {
        tenantId: user.tenantId,
        claimId: claim.id,
        reference: input.reference,
        caseLawId: input.caseLawId ?? null,
        note: input.note ?? null,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_LEGAL_BASIS_ADD",
      entity: "ClaimLegalBasis",
      entityId: basis.id,
      detail: `iddia=${claim.id} dayanak="${input.reference}"${input.caseLawId ? " (kayıt doğrulandı)" : ""}`,
    });
    return basis;
  }

  /** DELETE /claims/:id/legal-basis/:basisId */
  async removeLegalBasis(user: AuthUser, claimId: string, basisId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "hukuki dayanak kaldırma");
    const basis = await this.prisma.client.claimLegalBasis.findFirst({
      where: { id: basisId, tenantId: user.tenantId, claimId },
      select: { id: true, reference: true },
    });
    if (!basis) throw new NotFoundException("Hukuki dayanak kaydı bulunamadı.");

    await this.prisma.client.claimLegalBasis.delete({ where: { id: basis.id } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "EVIDENCE_LEGAL_BASIS_DELETE",
      entity: "ClaimLegalBasis",
      entityId: basis.id,
      detail: `iddia=${claimId} dayanak="${basis.reference}"`,
    });
    return { deleted: true, id: basis.id };
  }

  // ================================================================== //
  // Yardımcılar
  // ================================================================== //

  private async loadClaim(tenantId: string, id: string) {
    const claim = await this.prisma.client.claim.findFirst({ where: { id, tenantId } });
    if (!claim) throw new NotFoundException("İddia kaydı bulunamadı.");
    return claim;
  }

  private async loadEvidence(tenantId: string, id: string) {
    const evidence = await this.prisma.client.evidence.findFirst({ where: { id, tenantId } });
    if (!evidence) throw new NotFoundException("Delil kaydı bulunamadı.");
    return evidence;
  }

  private async nextClaimOrder(tenantId: string, caseId: string): Promise<number> {
    const last = await this.prisma.client.claim.findFirst({
      where: { tenantId, caseId },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    return (last?.orderIndex ?? -1) + 1;
  }

  /**
   * `Evidence.documentId` FK DEĞİLDİR; bu yüzden belgenin varlığı ve DOSYA
   * BAĞI burada doğrulanır. Başka dosyanın (veya başka kiracının) belgesi
   * delil olarak bağlanamaz.
   */
  private async resolveDocumentId(
    tenantId: string,
    caseId: string,
    documentId: string | null | undefined,
  ): Promise<string | null> {
    if (!documentId) return null;
    const doc = await this.prisma.client.document.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true, caseId: true },
    });
    if (!doc) {
      throw new UnprocessableEntityException("Bağlanmak istenen belge bulunamadı.");
    }
    if (doc.caseId && doc.caseId !== caseId) {
      throw new UnprocessableEntityException(
        "Belge başka bir dosyaya ait; delil ile belge aynı dosyada olmalıdır.",
      );
    }
    return doc.id;
  }
}

/**
 * Belge beklenen tiplerde belge bağı yoksa UYARI üretilir — kayıt ENGELLENMEZ.
 *
 * Gerekçe: avukat delili önce planlar ("keşif fotoğrafları çekilecek"),
 * belgeyi sonra yükler. Zorunluluk konsaydı planlama aşaması kayıt dışı
 * kalırdı ve delil boşluğu analizi bu kalemleri hiç göremezdi.
 */
function documentWarnings(type: string, documentId: string | null): string[] {
  if (!DOCUMENT_BACKED_TYPES.includes(type as (typeof DOCUMENT_BACKED_TYPES)[number])) return [];
  if (documentId) return [];
  return [
    `${type} tipindeki delil bir belgeye bağlanmamış. Delil listesi dilekçesinde bu kalem ` +
      "ek numarası alamaz; belge yüklendiğinde delili belgeye bağlayın.",
  ];
}
