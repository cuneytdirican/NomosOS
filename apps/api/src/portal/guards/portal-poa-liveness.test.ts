/**
 * K-12 KALINTISI REGRESYON TESTİ — portal erişiminde okuma-anı vekaletname
 * canlılık kontrolü.
 *
 * Denetimde CANLI olarak kanıtlandı: `expiresAt` sekiz ay geriye alındığında
 * portal erişimi açık kaldı, oysa büro tarafı aynı vekaletnameyi YETERSİZ
 * sayıyordu. Bu test geri düşerse (guard'daki canlılık sorgusu kaldırılırsa
 * ya da canlılık tanımı büro tarafından ayrışırsa) kırmızıya dönmelidir.
 */

import { describe, expect, it } from "vitest";
import type { Prisma } from "@nomosos/db";
import { startOfDay } from "../../common/dates";
import { allPoaWhere, livePoaWhere, poaLivenessBlocked } from "./portal-poa-liveness";

const TENANT = "b7a10c1e-0000-0000-0000-000000000001";
const CLIENT = "c9b21d2f-0000-0000-0000-000000000002";

describe("poaLivenessBlocked — erişim kesme kararı (saf fonksiyon)", () => {
  it("hiç vekaletname kaydı yoksa erişim AÇIK kalır", () => {
    expect(poaLivenessBlocked(0, 0)).toBe(false);
  });

  it("canlı vekaletname varsa erişim AÇIK kalır", () => {
    expect(poaLivenessBlocked(3, 1)).toBe(false);
    expect(poaLivenessBlocked(1, 1)).toBe(false);
  });

  it("kayıt VAR ama hiçbiri canlı değilse erişim KAPALI", () => {
    // Denetimdeki canlı senaryo: tek vekaletnamenin expiresAt'ı geçmiş.
    expect(poaLivenessBlocked(1, 0)).toBe(true);
    // Azil + süre dolumu karışımı: üçü de ölü.
    expect(poaLivenessBlocked(3, 0)).toBe(true);
  });
});

describe("livePoaWhere — canlılık tanımı büro tarafıyla birebir aynı", () => {
  const today = startOfDay(new Date());

  it("süzgeç isActive, revokedAt ve expiresAt üçlüsünü birlikte uygular", () => {
    const where = livePoaWhere(TENANT, CLIENT, today) as Prisma.PowerOfAttorneyWhereInput;
    expect(where.tenantId).toBe(TENANT);
    expect(where.clientId).toBe(CLIENT);
    expect(where.isActive).toBe(true);
    expect(where.revokedAt).toBeNull();
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gte: today } },
    ]);
  });

  it("süre dolumu GÜNÜN BAŞINA göre hesaplanır (ara gün kayması yok)", () => {
    // 10:00'da kurulan süzgeç, aynı gün 23:59'da kurulanla aynı eşiği taşır.
    const morning = new Date(2026, 7, 31, 10, 0, 0);
    const night = new Date(2026, 7, 31, 23, 59, 0);
    const wA = livePoaWhere(TENANT, CLIENT, morning) as { OR: { expiresAt?: unknown }[] };
    const wB = livePoaWhere(TENANT, CLIENT, night) as { OR: { expiresAt?: unknown }[] };
    expect(wA.OR[1].expiresAt).toEqual(wB.OR[1].expiresAt);
    // Eşik UTC gün başıdır: 00:00:00.000Z (startOfDay tanımıyla birebir).
    const threshold = (wA.OR[1].expiresAt as { gte: Date }).gte;
    expect(threshold.toISOString()).toMatch(/T00:00:00.000Z$/);
  });

  it("tüm kayıtları sayan süzgeç canlılık uygulamaz (yalnız kapsam)", () => {
    const where = allPoaWhere(TENANT, CLIENT) as Prisma.PowerOfAttorneyWhereInput;
    expect(where).toEqual({ tenantId: TENANT, clientId: CLIENT });
    expect(where).not.toHaveProperty("isActive");
    expect(where).not.toHaveProperty("revokedAt");
    expect(where).not.toHaveProperty("OR");
  });
});

describe("guard'a entegrasyon — KAPI 8 sorgusu gerçekten guard'da çağrılıyor", () => {
  it("portal-jwt.guard.ts canlılık modülünü içe aktarır ve çağırır", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(`${process.cwd()}/src/portal/guards/portal-jwt.guard.ts`, "utf-8"),
    );
    // İçe aktarma kalkarsa test kırmızıya döner.
    expect(source).toContain("portal-poa-liveness");
    // Sayım çağrıları guard gövdesinde yapılmalıdır — yalnız içe aktarmak yetmez.
    expect(source).toMatch(/powerOfAttorney\.count\([\s\S]*allPoaWhere/);
    expect(source).toMatch(/powerOfAttorney\.count\([\s\S]*livePoaWhere/);
    // Karar poaLivenessBlocked üzerinden alınmalıdır (özel mantık değil).
    expect(source).toContain("poaLivenessBlocked(");
  });
});
