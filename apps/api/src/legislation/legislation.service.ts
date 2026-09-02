/**
 * MEVZUAT KÜTÜPHANESİ (geliştirme planı D3 / A4) — büronun KENDİ metinleri.
 *
 * HİZMET SINIFI. Tüm sorgular tenantId ile süzülür (kiracı izolasyonu);
 * yazma uçları HUKUKI rol kümesi gerektirir; her işlem denetim günlüğüne
 * yazılır (kim, ne zaman, hangi mevzuat).
 *
 * TAM METİN ARAMA: içerik sütununda `contains, insensitive` — Postgres
 * ILIKE tabanlıdır; indeks gerektirmez ama tüm satırları tarar. Bu yüzden
 * sonuç tavanı 500'dür ve büyüyen kütüphaneler için sınırlar plan dosyasında
 * (D4 / pgvector + tsvector) not edilmiştir.
 *
 * DÜRÜSTLÜK (vaat kısıtı): Resmî Gazete otomatik senkronu YOKTUR — metni
 * büro yükler, güncel tutmak büronun sorumluluğudur (versionNote alanı bunu
 * görünür kılar).
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const LEGISLATION_DOC_TYPES = [
  "KANUN",
  "KHK",
  "YONETMELIK",
  "TEBLIG",
  "GENELGE",
  "DIGER",
] as const;
export type LegislationDocType = (typeof LEGISLATION_DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<LegislationDocType, string> = {
  KANUN: "Kanun",
  KHK: "Kanun Hükmünde Kararname",
  YONETMELIK: "Yönetmelik",
  TEBLIG: "Tebliğ",
  GENELGE: "Genelge",
  DIGER: "Diğer",
};

/** Azami tam metin uzunluğu — 1 MB (aşırı yükleme / kötüye kullanım sınırı). */
const MAX_FULL_TEXT_CHARS = 1_000_000;

@Injectable()
export class LegislationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Liste + arama. q verilirse başlık, metin, kanun numarası ve etiketlerde
   * büyük/küçük harf duyarsız arama yapılır.
   */
  async list(
    user: AuthUser,
    filters: { q?: string; docType?: string; take?: number },
  ) {
    const take = Math.min(Math.max(filters.take ?? 50, 1), 500);
    const q = filters.q?.trim();
    const where = {
      tenantId: user.tenantId,
      isActive: true,
      ...(filters.docType && (LEGISLATION_DOC_TYPES as readonly string[]).includes(filters.docType)
        ? { docType: filters.docType }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { fullText: { contains: q, mode: "insensitive" as const } },
              { number: { contains: q, mode: "insensitive" as const } },
              { tags: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.client.legislation.findMany({
      where,
      orderBy: [{ year: "desc" }, { title: "asc" }],
      take,
      select: {
        id: true,
        docType: true,
        title: true,
        number: true,
        year: true,
        enactedAt: true,
        tags: true,
        versionNote: true,
        createdAt: true,
        updatedAt: true,
        // Liste görünümünde tam metin TAŞINMAZ — yalnız 2 KB'lık önizleme.
        preview: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      preview: row.preview.slice(0, 200),
    }));
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.client.legislation.findFirst({
      where: { id, tenantId: user.tenantId, isActive: true },
    });
    if (!row) throw new NotFoundException("Mevzuat kaydı bulunamadı.");
    return row;
  }

  async create(
    user: AuthUser,
    input: {
      docType: string;
      title: string;
      number?: string;
      year?: number;
      enactedAt?: string | null;
      fullText: string;
      tags?: string;
      versionNote?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "mevzuat yükleme");
    const docType = input.docType as LegislationDocType;
    if (!(LEGISLATION_DOC_TYPES as readonly string[]).includes(docType)) {
      throw new BadRequestException("Geçersiz belge türü.");
    }
    if (input.year !== undefined && (input.year < 1800 || input.year > 2100)) {
      throw new BadRequestException("Geçerli bir yıl girin (1800-2100).");
    }
    const fullText = input.fullText.trim();
    if (fullText.length < 50) {
      throw new BadRequestException("Tam metin en az 50 karakter olmalıdır.");
    }
    if (fullText.length > MAX_FULL_TEXT_CHARS) {
      throw new BadRequestException(
        `Tam metin ${MAX_FULL_TEXT_CHARS.toLocaleString("tr-TR")} karakteri aşamaz — metni bölerek yükleyin.`,
      );
    }

    const created = await this.prisma.client.legislation.create({
      data: {
        tenantId: user.tenantId,
        docType,
        title: input.title.trim(),
        number: input.number?.trim() || null,
        year: input.year ?? null,
        ...(input.enactedAt ? { enactedAt: new Date(input.enactedAt) } : {}),
        fullText,
        preview: fullText.slice(0, 2000),
        tags: input.tags?.trim() || null,
        uploadedBy: user.userId,
        versionNote: input.versionNote?.trim() || null,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "LEGISLATION_CREATE",
      entity: "Legislation",
      entityId: created.id,
      detail: `${DOC_TYPE_LABELS[docType]} · ${created.title}`,
    });
    return created;
  }

  /**
   * Güncelleme — tam metin değişirse sürüm notu verilmeye zorlanır:
   * "hangi hâli yürürlükte" sorusu günlük kullanımda hayati önemdedir.
   */
  async update(
    user: AuthUser,
    id: string,
    input: {
      title?: string;
      number?: string | null;
      year?: number;
      tags?: string | null;
      versionNote?: string | null;
      fullText?: string;
    },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "mevzuat güncelleme");
    const existing = await this.prisma.client.legislation.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException("Mevzuat kaydı bulunamadı.");

    if (input.fullText !== undefined) {
      const fullText = input.fullText.trim();
      if (fullText.length < 50) {
        throw new BadRequestException("Tam metin en az 50 karakter olmalıdır.");
      }
      if (fullText.length > MAX_FULL_TEXT_CHARS) {
        throw new BadRequestException(
          `Tam metin ${MAX_FULL_TEXT_CHARS.toLocaleString("tr-TR")} karakteri aşamaz — metni bölerek yükleyin.`,
        );
      }
      if (fullText !== existing.fullText && !input.versionNote?.trim()) {
        throw new BadRequestException(
          "Tam metin değişiyor — bir SÜRÜM NOTU zorunludur (örn. «2026-08 değişikliği işlendi»).",
        );
      }
    }

    const updated = await this.prisma.client.legislation.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.number !== undefined ? { number: input.number?.trim() || null } : {}),
        ...(input.tags !== undefined ? { tags: input.tags?.trim() || null } : {}),
        ...(input.versionNote !== undefined ? { versionNote: input.versionNote?.trim() || null } : {}),
        ...(input.fullText !== undefined
          ? { fullText: input.fullText.trim(), preview: input.fullText.trim().slice(0, 2000) }
          : {}),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "LEGISLATION_UPDATE",
      entity: "Legislation",
      entityId: id,
      detail: `${updated.title}${input.fullText !== undefined ? " · tam metin güncellendi" : ""}`,
    });
    return updated;
  }

  /** Yumuşak silme — mevzuat geçmişine ulaşmak hukuken gerekli olabilir. */
  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "mevzuat silme");
    const existing = await this.prisma.client.legislation.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, title: true },
    });
    if (!existing) throw new NotFoundException("Mevzuat kaydı bulunamadı.");
    await this.prisma.client.legislation.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "LEGISLATION_DELETE",
      entity: "Legislation",
      entityId: id,
      detail: existing.title,
    });
    return { ok: true };
  }
}
