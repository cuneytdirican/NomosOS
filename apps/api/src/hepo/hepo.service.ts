/**
 * HEPO HİZMETİ (Modül 28) — İSG/Çevre/Sağlık uyum hukuku takibi.
 *
 * İKİ KATMAN:
 *  1. Ortak katalog (HepoObligation) — @nomosos/shared HEPO_OBLIGATIONS'dan
 *     slug kimliğiyle idempotent tohumlanır (ensureSeeded). Katalog kaydı
 *     tenantId TAŞIMAZ (kamusal havuz, CaseLawDocument deseni).
 *  2. Müvekkil ataması (HepoClientObligation) — büroya ait; TÜM sorgular
 *     tenantId ile süzülür. Yazma uçları HUKUKI rol kümesi gerektirir;
 *     her işlem denetim günlüğüne düşer.
 *
 * Durumlar serbest güncellenir (şerit yok) ama yalnız tanımlı kümeden
 * seçilebilir: ACIK | UYGUN | UYGUN_DEGIL | IHLAL.
 */

import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import {
  HEPO_OBLIGATIONS,
  HEPO_STATUSES,
  HEPO_TOPICS,
  type HepoStatus,
} from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export interface ClientObligationView {
  id: string;
  clientId: string;
  status: string;
  dueDate: string | null;
  lastDoneAt: string | null;
  note: string | null;
  updatedAt: string;
  obligation: {
    id: string;
    slug: string;
    topic: string;
    title: string;
    legalBasis: string;
    periodicity: string;
    responsible: string;
  };
  /** dueDate geçmiş ve durum UYGUN değil — vurgu için istemciye hazır hesap. */
  overdue: boolean;
}

@Injectable()
export class HepoService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Katalog tohumlama — slug kimliğiyle idempotent; açılışta ve katalog
   *  listesi istendiğinde çalışır (yeni sürümde eklenen yükümlülük kendiliğinden düşer). */
  async ensureSeeded() {
    for (const def of HEPO_OBLIGATIONS) {
      await this.prisma.client.hepoObligation.upsert({
        where: { slug: def.id },
        create: {
          slug: def.id,
          topic: def.topic,
          title: def.title,
          legalBasis: def.legalBasis,
          periodicity: def.periodicity,
          responsible: def.responsible,
          summary: def.summary,
          penaltyNote: def.penaltyNote,
        },
        update: {
          topic: def.topic,
          title: def.title,
          legalBasis: def.legalBasis,
          periodicity: def.periodicity,
          responsible: def.responsible,
          summary: def.summary,
          penaltyNote: def.penaltyNote,
        },
      });
    }
  }

  async onModuleInit() {
    await this.ensureSeeded();
  }

  /** Ortak katalog — konu süzgeçli. */
  async catalog(filters: { topic?: string } = {}) {
    await this.ensureSeeded();
    const topic = filters.topic?.trim();
    if (topic && !(HEPO_TOPICS as readonly string[]).includes(topic)) {
      throw new BadRequestException("Geçersiz konu (ISG | CEVRE | SAGLIK).");
    }
    return this.prisma.client.hepoObligation.findMany({
      where: { isActive: true, ...(topic ? { topic } : {}) },
      orderBy: [{ topic: "asc" }, { title: "asc" }],
    });
  }

  /** Müvekkilin yükümlülükleri — kiracı izolasyonu + vadesi geçmiş işareti. */
  async clientObligations(
    user: AuthUser,
    clientId: string,
    filters: { status?: string } = {},
  ): Promise<ClientObligationView[]> {
    await this.assertClientOfTenant(user, clientId);
    const status = filters.status?.trim();
    if (status && !(HEPO_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException("Geçersiz durum (ACIK | UYGUN | UYGUN_DEGIL | IHLAL).");
    }
    const rows = await this.prisma.client.hepoClientObligation.findMany({
      where: { tenantId: user.tenantId, clientId, ...(status ? { status } : {}) },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      include: {
        obligation: {
          select: {
            id: true,
            slug: true,
            topic: true,
            title: true,
            legalBasis: true,
            periodicity: true,
            responsible: true,
          },
        },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      status: r.status,
      dueDate: r.dueDate?.toISOString() ?? null,
      lastDoneAt: r.lastDoneAt?.toISOString() ?? null,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
      obligation: r.obligation,
      overdue: r.dueDate !== null && r.dueDate.getTime() < now && r.status !== "UYGUN",
    }));
  }

  /** Durum kırılımı + vadesi geçmiş sayısı — tek sorgu, JS agregasyonu. */
  async summary(user: AuthUser, clientId: string) {
    const rows = await this.clientObligations(user, clientId);
    const counts: Record<string, number> = { ACIK: 0, UYGUN: 0, UYGUN_DEGIL: 0, IHLAL: 0 };
    let overdue = 0;
    for (const r of rows) {
      if (r.status in counts) counts[r.status] += 1;
      if (r.overdue) overdue += 1;
    }
    return { total: rows.length, counts, overdue };
  }

  /** Müvekkile yükümlülük ata (HUKUKI). Aynı yükümlülük ikinci kez atanamaz. */
  async assign(
    user: AuthUser,
    clientId: string,
    input: { obligationId: string; dueDate?: string; note?: string },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "HEPO yükümlülüğü atama");
    await this.assertClientOfTenant(user, clientId);
    const obligation = await this.prisma.client.hepoObligation.findFirst({
      where: { id: input.obligationId, isActive: true },
    });
    if (!obligation) throw new NotFoundException("Yükümlülük katalogda bulunamadı.");
    const existing = await this.prisma.client.hepoClientObligation.findFirst({
      where: { clientId, obligationId: input.obligationId },
    });
    if (existing) {
      throw new BadRequestException("Bu yükümlülük müvekkile zaten atanmış.");
    }
    const created = await this.prisma.client.hepoClientObligation.create({
      data: {
        tenantId: user.tenantId,
        clientId,
        obligationId: input.obligationId,
        ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
        note: input.note?.trim() || null,
        createdBy: user.userId,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEPO_ASSIGN",
      entity: "HepoClientObligation",
      entityId: created.id,
      detail: `${obligation.title} müvekkile atandı (${obligation.legalBasis}).`,
    });
    return created;
  }

  /** Durum/vade/güncelleme (HUKUKI) — kiracıya ait olmayan kayda 404. */
  async update(
    user: AuthUser,
    id: string,
    input: { status?: string; dueDate?: string | null; lastDoneAt?: string | null; note?: string | null },
  ) {
    assertRole(user, ROLE_SETS.HUKUKI, "HEPO yükümlülüğü güncelleme");
    const row = await this.prisma.client.hepoClientObligation.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!row) throw new NotFoundException("Müvekkil yükümlülüğü bulunamadı.");
    if (input.status !== undefined && !(HEPO_STATUSES as readonly string[]).includes(input.status)) {
      throw new BadRequestException("Geçersiz durum (ACIK | UYGUN | UYGUN_DEGIL | IHLAL).");
    }
    const updated = await this.prisma.client.hepoClientObligation.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status as HepoStatus } : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
          : {}),
        ...(input.lastDoneAt !== undefined
          ? { lastDoneAt: input.lastDoneAt ? new Date(input.lastDoneAt) : null }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "HEPO_UPDATE",
      entity: "HepoClientObligation",
      entityId: id,
      detail:
        `Durum: ${row.status} → ${updated.status}` +
        (updated.lastDoneAt && !row.lastDoneAt ? "; son yerine getirme kaydedildi" : "") +
        ".",
    });
    return updated;
  }

  /** Müvekkil bu kiracıya mı ait — değilse 404 (varlık sızmaz). */
  private async assertClientOfTenant(user: AuthUser, clientId: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException("Müvekkil bulunamadı.");
  }
}
