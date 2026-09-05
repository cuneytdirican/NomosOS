/**
 * GİZLİ DOSYA — görünürlük kuralı + global kapı testleri (Enterprise++).
 *
 *  1. ADMIN/PARTNER kısıtsız; diğer roller açık + sorumlu + üye dosyaları.
 *  2. Süzgeç `AND` altında (çağıranın OR'unu ezmez); dosyası isteğe bağlı
 *     kayıtlarda dosyasız kayıt serbest.
 *  3. Guard: caseId'yi rota/sorgu/gövde/`/cases/:id`'den çıkarır; görünmeyen
 *     dosya 404; ADMIN/PARTNER ve platform yolu için veritabanına gitmez.
 */

import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { canManageCaseConfidentiality, caseVisibilityWhere, relatedCaseVisibilityWhere } from "./case-visibility";
import { CaseAccessGuard, extractCaseId } from "./guards/case-access.guard";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "./types";

const ADMIN = { userId: "u-admin", tenantId: "t-1", role: "ADMIN" } as AuthUser;
const AVUKAT = { userId: "u-av", tenantId: "t-1", role: "AVUKAT" } as AuthUser;
const CASE_ID = "11111111-2222-4333-8444-555555555555";

describe("caseVisibilityWhere", () => {
  it("ADMIN/PARTNER kısıtsız; AVUKAT açık + sorumlu + üye", () => {
    expect(caseVisibilityWhere(ADMIN)).toEqual({});
    expect(caseVisibilityWhere({ ...AVUKAT, role: "PARTNER" } as AuthUser)).toEqual({});
    expect(caseVisibilityWhere(AVUKAT)).toEqual({
      OR: [{ isConfidential: false }, { responsibleUserId: "u-av" }, { members: { some: { userId: "u-av" } } }],
    });
  });

  it("ilişkili kayıt süzgeci AND altında; isteğe bağlı dosyada caseId=null serbest", () => {
    expect(relatedCaseVisibilityWhere(ADMIN)).toEqual({});
    expect(relatedCaseVisibilityWhere(AVUKAT)).toEqual({ AND: [{ case: caseVisibilityWhere(AVUKAT) }] });
    expect(relatedCaseVisibilityWhere(AVUKAT, { optionalCase: true })).toEqual({
      AND: [{ OR: [{ caseId: null }, { case: caseVisibilityWhere(AVUKAT) }] }],
    });
  });

  it("gizliliği yönetici/ortak ya da sorumlu değiştirir", () => {
    expect(canManageCaseConfidentiality(ADMIN, { responsibleUserId: null })).toBe(true);
    expect(canManageCaseConfidentiality(AVUKAT, { responsibleUserId: "u-av" })).toBe(true);
    expect(canManageCaseConfidentiality(AVUKAT, { responsibleUserId: "u-baska" })).toBe(false);
  });
});

describe("extractCaseId", () => {
  it("rota :caseId, /cases/:id, sorgu ve gövdeden çıkarır; dosyasız istekte null", () => {
    expect(extractCaseId({ params: { caseId: CASE_ID }, path: "/api/v1/hearings" })).toBe(CASE_ID);
    expect(extractCaseId({ params: { id: CASE_ID }, path: `/api/v1/cases/${CASE_ID}/notes` })).toBe(CASE_ID);
    // /notes/:id gibi dosya olmayan :id → null (yanlış pozitif yok).
    expect(extractCaseId({ params: { id: CASE_ID }, path: `/api/v1/notes/${CASE_ID}` })).toBeNull();
    expect(extractCaseId({ query: { caseId: CASE_ID }, path: "/api/v1/documents" })).toBe(CASE_ID);
    expect(extractCaseId({ body: { caseId: CASE_ID }, path: "/api/v1/tasks" })).toBe(CASE_ID);
    expect(extractCaseId({ params: { caseId: "olmayan" }, path: "/x" })).toBeNull();
    expect(extractCaseId({ path: "/api/v1/clients" })).toBeNull();
  });
});

function guardWith(visible: boolean) {
  const findFirst = vi.fn(async () => (visible ? { id: CASE_ID } : null));
  const guard = new CaseAccessGuard({ client: { case: { findFirst } } } as unknown as PrismaService);
  const ctx = (request: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
  return { guard, findFirst, ctx };
}

describe("CaseAccessGuard", () => {
  it("AVUKAT görünmeyen gizli dosyada 404 (403 değil — varlık sızmaz)", async () => {
    const { guard, findFirst, ctx } = guardWith(false);
    await expect(
      guard.canActivate(ctx({ user: AVUKAT, params: { caseId: CASE_ID }, path: "/api/v1/hearings" })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const where = (findFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ id: CASE_ID, tenantId: "t-1" });
    expect(Array.isArray(where.OR)).toBe(true);
  });

  it("görünen dosyada geçer; ADMIN ve platform yolu için veritabanına gitmez; user yoksa geçer", async () => {
    const seen = guardWith(true);
    expect(await seen.guard.canActivate(seen.ctx({ user: AVUKAT, query: { caseId: CASE_ID }, path: "/api/v1/documents" }))).toBe(true);
    const admin = guardWith(false);
    expect(await admin.guard.canActivate(admin.ctx({ user: ADMIN, params: { caseId: CASE_ID }, path: "/api/v1/hearings" }))).toBe(true);
    expect(admin.findFirst).not.toHaveBeenCalled();
    expect(await admin.guard.canActivate(admin.ctx({ user: AVUKAT, params: { caseId: CASE_ID }, path: "/api/admin/v1/x" }))).toBe(true);
    expect(await admin.guard.canActivate(admin.ctx({ params: { caseId: CASE_ID }, path: "/api/v1/hearings" }))).toBe(true);
    expect(admin.findFirst).not.toHaveBeenCalled();
  });
});
