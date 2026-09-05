/**
 * FAZ 7B — GLOBAL ARAMA (Ctrl+K).
 *
 * Tek sorgu, çok varlık: dosya, müvekkil, belge, görev, süre, duruşma, dilekçe. Her grup
 * kendi görünürlük kuralıyla süzülür (gizli dosya → yalnız üyeler; dosyasız kayıtlar
 * görünür). pg_trgm GIN dizinleri ILIKE aramasını taşır; sonuç grup başına `limit`.
 *
 * Türkçe: sorgu hem olduğu gibi hem de İ/ı katlanmış hâliyle aranır ("Icra" → "İcra").
 * Sonuçlar HREF taşır — istemci yol kuralını bilmek zorunda değildir.
 */

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { caseVisibilityWhere, relatedCaseVisibilityWhere } from "../common/case-visibility";
import type { AuthUser } from "../common/types";

export type SearchKind = "DOSYA" | "MUVEKKIL" | "BELGE" | "GOREV" | "SURE" | "DURUSMA" | "DILEKCE";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  items: SearchHit[];
}

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  DOSYA: "Dosyalar",
  MUVEKKIL: "Müvekkiller",
  BELGE: "Belgeler",
  GOREV: "Görevler",
  SURE: "Süreler",
  DURUSMA: "Duruşmalar",
  DILEKCE: "Dilekçeler",
};

/** Sorgu varyantları: ham + İ/ı katlanmış (büyük İ → i, büyük I → ı, ı → i). */
export function queryVariants(q: string): string[] {
  const raw = q.trim();
  const folded = raw.replace(/İ/g, "i").replace(/I/g, "ı");
  const ascii = raw.replace(/İ/g, "i").replace(/ı/g, "i").replace(/I/g, "i");
  return [...new Set([raw, folded, ascii].filter((v) => v.length > 0))];
}

function orContains<T extends string>(fields: T[], variants: string[]): Array<Record<T, { contains: string; mode: "insensitive" }>> {
  const out: Array<Record<T, { contains: string; mode: "insensitive" }>> = [];
  for (const f of fields) for (const v of variants) out.push({ [f]: { contains: v, mode: "insensitive" } } as Record<T, { contains: string; mode: "insensitive" }>);
  return out;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(user: AuthUser, q: string, limit = 5): Promise<{ query: string; groups: SearchGroup[]; total: number }> {
    const query = q.trim();
    if (query.length < 2) return { query, groups: [], total: 0 };
    const take = Math.min(Math.max(limit, 1), 10);
    const variants = queryVariants(query);
    const tenantId = user.tenantId;
    const caseVis = caseVisibilityWhere(user);
    const relOptional = relatedCaseVisibilityWhere(user, { optionalCase: true });
    const relRequired = relatedCaseVisibilityWhere(user);
    // Görünürlük OR'u ile arama OR'u ASLA aynı nesnede tutulmaz (Prisma çift-OR sızıntısı): AND altında birleşir.
    const db = this.prisma.client;

    const [cases, clients, documents, tasks, deadlines, hearings, petitions] = await Promise.all([
      db.case.findMany({
        where: { tenantId, AND: [caseVis, { OR: orContains(["title", "fileNumber", "courtName", "subject"], variants) }] } as Prisma.CaseWhereInput,
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, fileNumber: true, courtName: true, status: true, client: { select: { name: true } } },
      }),
      db.client.findMany({
        where: { tenantId, OR: orContains(["name", "email", "phone", "referenceCode"], variants) } as Prisma.ClientWhereInput,
        take,
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true, email: true, phone: true },
      }),
      db.document.findMany({
        where: { tenantId, deletedAt: null, supersededAt: null, AND: [relOptional, { OR: orContains(["name", "aiSummary"], variants) }] } as Prisma.DocumentWhereInput,
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, class: true, caseId: true, case: { select: { fileNumber: true, title: true } } },
      }),
      db.task.findMany({
        where: { tenantId, AND: [relOptional, { OR: orContains(["title", "description"], variants) }] } as Prisma.TaskWhereInput,
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, status: true, dueDate: true, caseId: true },
      }),
      db.deadline.findMany({
        where: { tenantId, AND: [relRequired, { OR: orContains(["title", "ruleKey"], variants) }] } as Prisma.DeadlineWhereInput,
        take,
        orderBy: { dueDate: "asc" },
        select: { id: true, title: true, dueDate: true, status: true, caseId: true },
      }),
      db.hearing.findMany({
        where: { tenantId, AND: [relRequired, { OR: [...orContains(["note"], variants), { case: { OR: orContains(["title", "fileNumber", "courtName"], variants) } }] }] } as Prisma.HearingWhereInput,
        take,
        orderBy: { date: "desc" },
        select: { id: true, date: true, type: true, caseId: true, case: { select: { title: true, fileNumber: true, courtName: true } } },
      }),
      db.petition.findMany({
        where: { tenantId, AND: [relRequired, { OR: orContains(["title"], variants) }] } as Prisma.PetitionWhereInput,
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, type: true, caseId: true },
      }),
    ]);

    const groups: SearchGroup[] = [
      { kind: "DOSYA" as const, label: SEARCH_KIND_LABELS.DOSYA, items: cases.map((c) => ({ kind: "DOSYA" as const, id: c.id, title: `${c.fileNumber ? `${c.fileNumber} — ` : ""}${c.title}`, subtitle: [c.client?.name, c.courtName, c.status].filter(Boolean).join(" · ") || null, href: `/app/dosyalar/${c.id}` })) },
      { kind: "MUVEKKIL" as const, label: SEARCH_KIND_LABELS.MUVEKKIL, items: clients.map((c) => ({ kind: "MUVEKKIL" as const, id: c.id, title: c.name, subtitle: [c.type, c.email, c.phone].filter(Boolean).join(" · ") || null, href: `/app/muvekkiller/${c.id}` })) },
      { kind: "BELGE" as const, label: SEARCH_KIND_LABELS.BELGE, items: documents.map((d) => ({ kind: "BELGE" as const, id: d.id, title: d.name, subtitle: [d.class, d.case?.fileNumber ?? d.case?.title].filter(Boolean).join(" · ") || null, href: d.caseId ? `/app/dosyalar/${d.caseId}?sekme=belgeler&belge=${d.id}` : `/app/oneriler` })) },
      { kind: "GOREV" as const, label: SEARCH_KIND_LABELS.GOREV, items: tasks.map((t) => ({ kind: "GOREV" as const, id: t.id, title: t.title, subtitle: [t.status, t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null].filter(Boolean).join(" · ") || null, href: t.caseId ? `/app/dosyalar/${t.caseId}?sekme=gorevler` : `/app/gorevler` })) },
      { kind: "SURE" as const, label: SEARCH_KIND_LABELS.SURE, items: deadlines.map((d) => ({ kind: "SURE" as const, id: d.id, title: d.title, subtitle: `${d.dueDate.toISOString().slice(0, 10)} · ${d.status}`, href: `/app/dosyalar/${d.caseId}?sekme=sureler` })) },
      { kind: "DURUSMA" as const, label: SEARCH_KIND_LABELS.DURUSMA, items: hearings.map((h) => ({ kind: "DURUSMA" as const, id: h.id, title: `${h.case.fileNumber ? `${h.case.fileNumber} — ` : ""}${h.case.title}`, subtitle: [h.date.toISOString().slice(0, 16).replace("T", " "), h.type, h.case.courtName].filter(Boolean).join(" · "), href: `/app/dosyalar/${h.caseId}?sekme=durusmalar` })) },
      { kind: "DILEKCE" as const, label: SEARCH_KIND_LABELS.DILEKCE, items: petitions.map((p) => ({ kind: "DILEKCE" as const, id: p.id, title: p.title, subtitle: p.type, href: `/app/dosyalar/${p.caseId}?sekme=dilekceler` })) },
    ].filter((g) => g.items.length > 0);

    return { query, groups, total: groups.reduce((a, g) => a + g.items.length, 0) };
  }
}
