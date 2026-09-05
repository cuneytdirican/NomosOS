/**
 * FAZ 7C — rol matrisi (role ek yetkiler).
 *
 *  1. Ek yetki, karşılık gelen ROLE_SETS kümesini geçer (SEKRETER + FINANS → finans kapısı açık).
 *  2. Ek yetki BAŞKA kümeyi açmaz (FINANS verilen SEKRETER hukuki tasarruf yapamaz).
 *  3. Geçici/özel rol dizileri (`["ADMIN"]`) matristen etkilenmez — yalnız dört sabit küme.
 *  4. assertRole aynı kuralla çalışır; mesaj Türkçe rol etiketi taşır.
 */

import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { PERMISSION_KEYS, ROLE_SETS, assertRole, hasRole } from "./roles";
import { FINANCE_ACCESS, canFinance } from "../finance/finance-access";
import type { AuthUser } from "./types";

const SEKRETER = { userId: "u", tenantId: "t", role: "SEKRETER" } as AuthUser;

describe("Faz 7C: rol matrisi", () => {
  it("dört yetenek anahtarı", () => {
    expect([...PERMISSION_KEYS]).toEqual(["HUKUKI", "ONAY", "OPERASYON", "FINANS"]);
  });

  it("ek yetki karşılık gelen kümeyi açar, başkasını açmaz", () => {
    expect(hasRole(SEKRETER, ROLE_SETS.FINANS)).toBe(false);
    const granted = { ...SEKRETER, permissions: ["FINANS"] };
    expect(hasRole(granted, ROLE_SETS.FINANS)).toBe(true);
    expect(hasRole(granted, ROLE_SETS.HUKUKI)).toBe(false);
    expect(hasRole(granted, ROLE_SETS.ONAY)).toBe(false);
    expect(hasRole(granted, ROLE_SETS.OPERASYON)).toBe(true); // rolünden zaten
  });

  it("özel rol dizileri matristen etkilenmez", () => {
    const granted = { ...SEKRETER, permissions: ["ONAY", "HUKUKI", "FINANS", "OPERASYON"] };
    expect(hasRole(granted, ["ADMIN"])).toBe(false);
    expect(hasRole(granted, ["ADMIN", "PARTNER"])).toBe(false); // ROLE_SETS.ONAY ile aynı içerik ama farklı referans
    expect(hasRole(granted, ROLE_SETS.ONAY)).toBe(true);
  });

  it("assertRole: yetkisiz 403 (Türkçe etiket), ek yetkiyle geçer", () => {
    expect(() => assertRole(SEKRETER, ROLE_SETS.FINANS, "tahsilat görüntüleme")).toThrow(ForbiddenException);
    expect(() => assertRole(SEKRETER, ROLE_SETS.FINANS, "tahsilat görüntüleme")).toThrow(/Sekreter rolü tahsilat görüntüleme/);
    expect(() => assertRole({ ...SEKRETER, permissions: ["FINANS"] }, ROLE_SETS.FINANS, "x")).not.toThrow();
  });

  it("finans matrisi: FINANS ek yetkisi AVUKAT düzeyi kapıları açar, yönetim kapılarını açmaz", () => {
    const granted = { ...SEKRETER, permissions: ["FINANS"] };
    expect(canFinance(SEKRETER, FINANCE_ACCESS.ENTRY_WRITE)).toBe(false);
    expect(canFinance(granted, FINANCE_ACCESS.ENTRY_WRITE)).toBe(true);
    expect(canFinance(granted, FINANCE_ACCESS.AI)).toBe(true);
    expect(canFinance(granted, FINANCE_ACCESS.INVOICE_DRAFT)).toBe(true);
    expect(canFinance(granted, FINANCE_ACCESS.INVOICE_ISSUE)).toBe(false);
    expect(canFinance(granted, FINANCE_ACCESS.AGREEMENT_WRITE)).toBe(false);
  });
});
