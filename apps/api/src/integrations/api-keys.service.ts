/**
 * API ANAHTARLARI (Enterprise++ entegrasyonlar).
 *
 * Büro; muhasebe, DMS, BI gibi dış sistemlere SALT-OKUNUR, kapsamlı erişim
 * verir. Anahtar `nos_<prefix>_<gizli>` biçimindedir; yalnız SHA-256 özeti
 * saklanır ve düz anahtar BİR KEZ (oluşturma yanıtı) gösterilir.
 *
 * Güvenlik sınırları (JwtAuthGuard'da uygulanır):
 *  - Yalnız GET; yazma yoktur (anahtar sızsa da veri değiştirilemez).
 *  - Yol, anahtarın kapsam kümesinde olmalı (cases:read → /api/v1/cases…).
 *  - Gizli dosyalar API anahtarına görünmez (rol AVUKAT olarak değerlendirilir).
 *  - Süre/iptal: expiresAt / revokedAt; iptal edilen anahtar anında düşer.
 */

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { API_KEY_SCOPES } from "./webhook-events";

export const API_KEY_HEADER = "x-api-key";

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** Düz anahtar üretir: nos_<8 hex prefix>_<40 hex>. */
export function generateApiKey(): { plain: string; prefix: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(20).toString("hex");
  return { plain: `nos_${prefix}_${secret}`, prefix };
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "API anahtarlarını görüntüleme");
    const rows = await this.prisma.client.apiKey.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({ ...r, scopes: r.scopes.split(",").filter(Boolean), masked: `nos_${r.keyPrefix}_••••` })),
      scopes: Object.entries(API_KEY_SCOPES).map(([key, v]) => ({ key, label: v.label })),
    };
  }

  async create(user: AuthUser, input: { name: string; scopes: string[]; expiresAt?: string | null }) {
    assertRole(user, ROLE_SETS.ONAY, "API anahtarı oluşturma");
    const scopes = [...new Set(input.scopes)];
    if (scopes.length === 0) throw new BadRequestException("En az bir kapsam seçin.");
    for (const s of scopes) {
      if (!API_KEY_SCOPES[s]) throw new BadRequestException(`Geçersiz kapsam: ${s}`);
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException("Geçersiz son kullanma tarihi.");
    const { plain, prefix } = generateApiKey();
    const row = await this.prisma.client.apiKey.create({
      data: {
        tenantId: user.tenantId,
        name: input.name.trim(),
        keyPrefix: prefix,
        keyHash: hashApiKey(plain),
        scopes: scopes.join(","),
        expiresAt,
        createdBy: user.userId,
      },
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "API_KEY_CREATE",
      entity: "ApiKey",
      entityId: row.id,
      detail: `${row.name} (nos_${prefix}_…) kapsam: ${scopes.join(", ")}${expiresAt ? `; son kullanma ${expiresAt.toISOString().slice(0, 10)}` : ""}`,
    });
    // DÜZ ANAHTAR YALNIZ BURADA DÖNER.
    return { id: row.id, name: row.name, plainKey: plain, scopes, expiresAt };
  }

  async revoke(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "API anahtarı iptali");
    const row = await this.prisma.client.apiKey.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException("API anahtarı bulunamadı.");
    if (!row.revokedAt) {
      await this.prisma.client.apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "API_KEY_REVOKE",
        entity: "ApiKey",
        entityId: row.id,
        detail: `${row.name} (nos_${row.keyPrefix}_…) iptal edildi.`,
      });
    }
    return { ok: true as const };
  }
}
