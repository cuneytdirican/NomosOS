/**
 * FAZ 8B — SÖZLEŞME KABULÜ (TermsAcceptance).
 *
 * Metinler `@nomosos/shared` CONTRACT_DOCS'tan gelir (tek kaynak); kabul kaydı sürüm + SHA-256 özeti +
 * IP/tarayıcı ile ekleme-yalnız tutulur. Yalnız ONAY rolü (ADMIN/PARTNER) büro adına kabul edebilir.
 * Zorunlu belgelerden biri güncel sürümde kabul edilmemişse `missingRequired` dolu döner; uygulama
 * şerit gösterir ama İŞİ DURDURMAZ (avukatın dosyasına erişimini kesmek orantısız olurdu).
 */

import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { CONTRACT_DOCS, contractDocCanonicalText, findContractDoc } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";

export const acceptTermsSchema = z.object({
  docKey: z.enum(["HIZMET_SOZLESMESI", "DPA", "SLA", "MESAFELI_SATIS"]),
  version: z.string().trim().min(1).max(20),
});
export type AcceptTermsInput = z.infer<typeof acceptTermsSchema>;

export function contractHash(key: string): string {
  const doc = findContractDoc(key);
  if (!doc) throw new BadRequestException("Bilinmeyen sözleşme.");
  return createHash("sha256").update(contractDocCanonicalText(doc)).digest("hex");
}

@Injectable()
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Kiracının belge başına güncel kabul durumu. */
  async status(tenantId: string) {
    const rows = await this.prisma.client.termsAcceptance.findMany({
      where: { tenantId },
      orderBy: { acceptedAt: "desc" },
      take: 100,
    });
    const users = await this.prisma.client.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.docKey)) latest.set(r.docKey, r);
    const items = CONTRACT_DOCS.map((d) => {
      const cur = latest.get(d.key);
      const accepted = !!cur && cur.version === d.version && cur.textHash === contractHash(d.key);
      return {
        key: d.key,
        slug: d.slug,
        title: d.title,
        version: d.version,
        required: d.required,
        updatedAt: d.updatedAt,
        accepted,
        outdated: !!cur && !accepted,
        acceptedAt: cur?.acceptedAt ?? null,
        acceptedBy: cur ? userMap.get(cur.userId) ?? null : null,
        acceptedVersion: cur?.version ?? null,
      };
    });
    return { items, missingRequired: items.filter((i) => i.required && !i.accepted).map((i) => i.key) };
  }

  async accept(user: AuthUser, input: AcceptTermsInput, meta: { ip: string | null; userAgent: string | null }) {
    assertRole(user, ROLE_SETS.ONAY, "büro adına sözleşme kabulü");
    const doc = findContractDoc(input.docKey);
    if (!doc) throw new BadRequestException("Bilinmeyen sözleşme.");
    if (doc.version !== input.version) throw new BadRequestException("Sözleşme metninin sürümü değişmiş; sayfayı yenileyip güncel metni okuyun.");
    const row = await this.prisma.client.termsAcceptance.create({
      data: { tenantId: user.tenantId, userId: user.userId, docKey: doc.key, version: doc.version, textHash: contractHash(doc.key), ip: meta.ip, userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "TERMS_ACCEPT", entity: "TermsAcceptance", entityId: row.id, detail: `${doc.key} ${doc.version} · ${meta.ip ?? "?"}` });
    return this.status(user.tenantId);
  }

  /** Platform: kiracının kabul geçmişi (denetim). */
  async historyForPlatform(tenantId: string) {
    const rows = await this.prisma.client.termsAcceptance.findMany({ where: { tenantId }, orderBy: { acceptedAt: "desc" }, take: 200 });
    const users = await this.prisma.client.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, fullName: true, email: true } });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const status = await this.status(tenantId);
    return { current: status.items.map((i) => ({ key: i.key, title: i.title, version: i.version, required: i.required, accepted: i.accepted, outdated: i.outdated, acceptedAt: i.acceptedAt })), missingRequired: status.missingRequired, history: rows.map((r) => ({ id: r.id, docKey: r.docKey, version: r.version, at: r.acceptedAt, by: userMap.get(r.userId)?.fullName ?? r.userId, email: userMap.get(r.userId)?.email ?? null, ip: r.ip })) };
  }
}
