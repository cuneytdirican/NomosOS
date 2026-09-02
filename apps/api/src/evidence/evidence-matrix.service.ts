/**
 * İSPAT MATRİSİ — TAMAMEN DETERMİNİSTİK. BU DOSYADA LLM YOKTUR.
 *
 * Matris, "bu davada hangi iddiamızı hangi delil destekliyor?" sorusunun tek
 * bakışlık cevabıdır ve dosyanın delil riskinin kaynağıdır. Bu yüzden hesabı
 * AI'ya bırakılamaz: desteksiz iddia tanımı bir SAYMA işlemidir, bir yorum
 * değildir (docs/moduller/14, iş kuralı 6 ve kabul kriteri 3).
 *
 * TANIMLAR (tek kaynak — AI katmanı da bu sonucu HAZIR alır, yeniden hesaplamaz):
 *
 *  • ETKİN BAĞ: delili REDdedilmemiş (`Evidence.status !== RED`) her
 *    `ClaimEvidenceLink`. Reddedilen delil matristen SİLİNMEZ; bağı görünür
 *    kalır ama ispat gücü hesabına KATILMAZ (iş kuralı 7).
 *
 *  • YÖN (F2 · E6 — denetim bulgusu Ö-30 kullanım ayağı): bağın `linkType`'ı
 *    hesaba girer. Yalnızca `SUPPORTS` bağları iddiayı TAŞIR; `CONTRADICTS`
 *    bağı delili bağlar ama destek SAYMAZ, `BELIRSIZ` de saymaz. Yönü yok
 *    sayan eski hesap, yalnızca ÇÜRÜTEN delil bağı olan bir iddiayı
 *    "desteklenmiş" gösteriyordu (Modül 14 KK3 yanlış sonuç).
 *
 *  • DESTEKSİZ İDDİA: `side = BIZ`, `status ≠ CURUTULDU` ve hiç etkin
 *    `SUPPORTS` bağı olmayan iddia. Karşı tarafın iddiaları bu hesaba girmez —
 *    onların ispatsızlığı bizim riskimiz değildir.
 *
 *  • ÇÜRÜTÜLEN İDDİA: etkin `CONTRADICTS` bağı olan BİZ iddiası. "Destekli ama
 *    içinde çürüten delil de var" ile "yalnızca çürüten deli var" ayrık
 *    raporlanır; ikincisi desteksizden de kötüdür.
 *
 *  • ZAYIF DESTEKLENEN İDDİA: desteksiz değil ama ya en güçlü bağı ≤2 ya da
 *    TEK bağı var ve gücü ≤3. Eşikler aşağıdaki sabitlerdedir.
 *
 *  • HENÜZ TOPLANMAMIŞ DESTEK: iddiayı yalnızca `PLANLANAN` durumdaki
 *    deliller taşıyor. Sayı olarak "destekli" görünen ama elde HİÇBİR ŞEY
 *    OLMAYAN en tehlikeli hâl budur; ayrı bayrakla işaretlenir.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  Claim,
  ClaimEvidenceLink,
  ClaimLegalBasis,
  Evidence,
} from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";

/** Bu güç değeri ve altındaki tek destek "zayıf" sayılır. */
export const WEAK_STRENGTH_MAX = 2;
/** Tek bağla desteklenen iddiada zayıflık eşiği (güç belirtilmemişse 3 varsayılır). */
export const SINGLE_LINK_WEAK_MAX = 3;
/** Güç değeri girilmemiş bağlar için varsayılan (ne güçlü ne zayıf). */
export const DEFAULT_STRENGTH = 3;

type LinkWithEvidence = ClaimEvidenceLink & { evidence: Evidence };
type ClaimWithRelations = Claim & {
  evidenceLinks: LinkWithEvidence[];
  legalBases: ClaimLegalBasis[];
};

export interface MatrixRow {
  claimId: string;
  ref: string;
  side: string;
  status: string;
  text: string;
  orderIndex: number;
  evidence: {
    linkId: string;
    evidenceId: string;
    title: string;
    type: string;
    evidenceStatus: string;
    /** Bağın YÖNÜ: SUPPORTS · CONTRADICTS · BELIRSIZ (F2 · E6). */
    linkType: string;
    strength: number | null;
    note: string | null;
    /** REDdedilen delil: bağ görünür, ispat gücüne katılmaz. */
    counted: boolean;
    document: { id: string; name: string; class: string } | null;
    /** documentId dolu ama belge bulunamadı (silinmiş/başka kiracı). */
    documentMissing: boolean;
    witnessName: string | null;
  }[];
  legalBases: { id: string; reference: string; caseLawId: string | null; note: string | null }[];
  /** Yalnızca etkin SUPPORTS bağları (destek gücü hesabına giren). */
  supportingCount: number;
  /** Etkin CONTRADICTS bağı sayısı. */
  contradictingCount: number;
  strongestStrength: number | null;
  strongestEvidenceId: string | null;
  unsupported: boolean;
  /** BİZ iddiasında etkin CONTRADICTS bağı var (F2 · E6). */
  contradicted: boolean;
  weaklySupported: boolean;
  onlyPlannedSupport: boolean;
}

@Injectable()
export class EvidenceMatrixService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dosyanın tenant'a ait olduğunu doğrular; değilse 404 (bilgi sızdırmaz). */
  async assertCase(tenantId: string, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: { id: true, title: true, fileNumber: true, status: true, type: true },
    });
    if (!found) throw new NotFoundException("Dosya bulunamadı.");
    return found;
  }

  /** GET /cases/:caseId/evidence-matrix */
  async matrix(tenantId: string, caseId: string) {
    const found = await this.assertCase(tenantId, caseId);
    const computed = await this.compute(tenantId, caseId);

    return {
      case: found,
      /** HESAP DETERMİNİSTİKTİR — bu alan yanıtta açıkça durur. */
      computedBy: "deterministik matris hesabı (AI kullanılmaz)",
      definitions: {
        unsupported:
          "side=BIZ, status≠CURUTULDU ve REDdedilmemiş hiçbir SUPPORTS bağı olmayan iddia.",
        contradicted:
          "BİZ iddiasında en az bir REDdedilmemiş CONTRADICTS bağı olan iddia (F2 · E6).",
        weaklySupported:
          `En güçlü destek ≤${WEAK_STRENGTH_MAX}, ya da tek destek var ve gücü ≤${SINGLE_LINK_WEAK_MAX}.`,
        onlyPlannedSupport:
          "İddiayı yalnızca PLANLANAN (henüz toplanmamış) deliller taşıyor.",
        rejectedEvidence:
          "RED durumundaki delilin bağı görünür kalır ama ispat gücü hesabına katılmaz.",
        linkTypes:
          "SUPPORTS bağı iddiayı taşır; CONTRADICTS bağı taşımaz ve iddiayı çürütülmüş işaretler; BELIRSIZ bağı taşımaz.",
      },
      summary: computed.summary,
      rows: computed.rows,
      /** Hiçbir iddiaya bağlanmamış deliller — matrisin "artıkları". */
      unlinkedEvidence: computed.unlinkedEvidence,
    };
  }

  /**
   * Matrisin çekirdek hesabı. AI katmanı da bu fonksiyonun çıktısını HAZIR
   * alır; "desteksiz iddia" listesini modelin üretmesine asla izin verilmez.
   */
  async compute(tenantId: string, caseId: string) {
    const claims = (await this.prisma.client.claim.findMany({
      where: { tenantId, caseId },
      orderBy: [{ side: "asc" }, { orderIndex: "asc" }, { createdAt: "asc" }],
      include: {
        evidenceLinks: { include: { evidence: true }, orderBy: { createdAt: "asc" } },
        legalBases: { orderBy: { createdAt: "asc" } },
      },
    })) as ClaimWithRelations[];

    const allEvidence = await this.prisma.client.evidence.findMany({
      where: { tenantId, caseId },
      orderBy: [{ createdAt: "asc" }],
    });

    const documents = await this.resolveDocuments(tenantId, allEvidence);

    const rows: MatrixRow[] = claims.map((claim, index) => {
      const ref = `[İDDİA-${index + 1}]`;
      // ETKİN bağlar: delili RED edilmemiş tüm bağlar (yön farkı gözetmeksizin).
      const counted = claim.evidenceLinks.filter((l) => l.evidence.status !== "RED");
      // DESTEK yalnızca SUPPORTS yönünden gelir (F2 · E6 — Ö-30 kullanım ayağı).
      const supporting = counted.filter((l) => l.linkType === "SUPPORTS");
      const contradicting = counted.filter((l) => l.linkType === "CONTRADICTS");

      const strengths = supporting.map((l) => l.strength ?? DEFAULT_STRENGTH);
      const strongestStrength = strengths.length ? Math.max(...strengths) : null;
      const strongestLink =
        strongestStrength === null
          ? null
          : (supporting.find((l) => (l.strength ?? DEFAULT_STRENGTH) === strongestStrength) ?? null);

      const unsupported =
        claim.side === "BIZ" && claim.status !== "CURUTULDU" && supporting.length === 0;

      const contradicted = claim.side === "BIZ" && contradicting.length > 0;

      const weaklySupported =
        !unsupported &&
        supporting.length > 0 &&
        ((strongestStrength ?? 0) <= WEAK_STRENGTH_MAX ||
          (supporting.length === 1 && (strongestStrength ?? 0) <= SINGLE_LINK_WEAK_MAX));

      const onlyPlannedSupport =
        supporting.length > 0 && supporting.every((l) => l.evidence.status === "PLANLANAN");

      return {
        claimId: claim.id,
        ref,
        side: claim.side,
        status: claim.status,
        text: claim.text,
        orderIndex: claim.orderIndex,
        evidence: claim.evidenceLinks.map((link) => {
          const doc = link.evidence.documentId ? documents.get(link.evidence.documentId) : undefined;
          return {
            linkId: link.id,
            evidenceId: link.evidenceId,
            title: link.evidence.title,
            type: link.evidence.type,
            evidenceStatus: link.evidence.status,
            linkType: link.linkType,
            strength: link.strength,
            note: link.note,
            counted: link.evidence.status !== "RED",
            document: doc ?? null,
            documentMissing: Boolean(link.evidence.documentId) && !doc,
            witnessName: link.evidence.witnessName,
          };
        }),
        legalBases: claim.legalBases.map((b) => ({
          id: b.id,
          reference: b.reference,
          caseLawId: b.caseLawId,
          note: b.note,
        })),
        supportingCount: supporting.length,
        contradictingCount: contradicting.length,
        strongestStrength,
        strongestEvidenceId: strongestLink?.evidenceId ?? null,
        unsupported,
        contradicted,
        weaklySupported,
        onlyPlannedSupport,
      };
    });

    const linkedEvidenceIds = new Set(
      claims.flatMap((c) => c.evidenceLinks.map((l) => l.evidenceId)),
    );
    const unlinkedEvidence = allEvidence
      .filter((e) => !linkedEvidenceIds.has(e.id))
      .map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        status: e.status,
        document: e.documentId ? (documents.get(e.documentId) ?? null) : null,
      }));

    const ourRows = rows.filter((r) => r.side === "BIZ");

    return {
      rows,
      unlinkedEvidence,
      summary: {
        totalClaims: rows.length,
        ourClaims: ourRows.length,
        opposingClaims: rows.length - ourRows.length,
        unsupportedCount: rows.filter((r) => r.unsupported).length,
        contradictedCount: rows.filter((r) => r.contradicted).length,
        weaklySupportedCount: rows.filter((r) => r.weaklySupported).length,
        onlyPlannedSupportCount: rows.filter((r) => r.onlyPlannedSupport).length,
        totalEvidence: allEvidence.length,
        unlinkedEvidenceCount: unlinkedEvidence.length,
        evidenceByStatus: countBy(allEvidence.map((e) => e.status)),
        evidenceByType: countBy(allEvidence.map((e) => e.type)),
        /** İspat oranı: destekli "bizim" iddialarımızın payı (0-1). */
        provenRatio:
          ourRows.length === 0
            ? null
            : Math.round(
                ((ourRows.length - ourRows.filter((r) => r.unsupported).length) / ourRows.length) *
                  100,
              ) / 100,
      },
    };
  }

  /**
   * Delillerin `documentId` alanları FK DEĞİLDİR (belge silinse de delil
   * kaydı yaşamalıdır). Bu yüzden varlık kontrolü UYGULAMA KATMANINDA yapılır
   * ve kayıp belge matriste `documentMissing` ile görünür kılınır.
   */
  private async resolveDocuments(tenantId: string, evidence: readonly Evidence[]) {
    const ids = [...new Set(evidence.map((e) => e.documentId).filter((v): v is string => !!v))];
    if (ids.length === 0) return new Map<string, { id: string; name: string; class: string }>();

    const docs = await this.prisma.client.document.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
      select: { id: true, name: true, class: true },
    });
    return new Map(docs.map((d) => [d.id, d]));
  }
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
