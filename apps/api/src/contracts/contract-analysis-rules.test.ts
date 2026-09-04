/**
 * SÖZLEŞME ANALİZİ KURAL ÇEKİRDEĞİ — şerh durum geçişleri ve izin matrisi.
 *
 * Kabul ölçütleri:
 *  · ACIK → KAPALI tek geçerli kapanıştır; KAPALI ve SUPERSEDED kapanamaz.
 *  · ILK/REVIZYON analizi + şerh kapatma OPERASYON rolleri (STAJYER hariç);
 *    NIHAI analiz + müvekkil bildirimi HUKUKI; otomatik kip PARTNER+.
 */

import { describe, expect, it } from "vitest";
import type { UserRole } from "@nomosos/shared";
import type { AuthUser } from "../common/types";
import {
  analysisPermissionOf,
  ANNOTATION_TRANSITIONS,
  assertCloseAnnotation,
  canCloseAnnotation,
} from "./contract-analysis-rules";

function userWith(role: UserRole): AuthUser {
  return { userId: `u-${role.toLowerCase()}`, tenantId: "t1", role };
}

const ALL_ROLES: UserRole[] = ["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"];

describe("şerh durum geçişleri", () => {
  it("ACIK → KAPALI geçerli tek geçiştir", () => {
    expect(canCloseAnnotation("ACIK")).toBe(true);
    expect(ANNOTATION_TRANSITIONS.ACIK).toEqual(["KAPALI"]);
  });

  it("KAPALI şerh bir daha kapatılamaz (anlamlı mesajla)", () => {
    expect(canCloseAnnotation("KAPALI")).toBe(false);
    expect(() => assertCloseAnnotation("KAPALI")).toThrowError(/zaten kapalı/);
  });

  it("SUPERSEDED şerh kapatılamaz — revizyonda geçersizleşmiştir", () => {
    expect(canCloseAnnotation("SUPERSEDED")).toBe(false);
    expect(() => assertCloseAnnotation("SUPERSEDED")).toThrowError(/geçersizleşmiş/);
  });

  it("KAPALI ve SUPERSEDED durumlarından çıkış yoktur", () => {
    expect(ANNOTATION_TRANSITIONS.KAPALI).toEqual([]);
    expect(ANNOTATION_TRANSITIONS.SUPERSEDED).toEqual([]);
  });

  it("ACIK şerhte kapatma geçişi hata fırlatmaz", () => {
    expect(() => assertCloseAnnotation("ACIK")).not.toThrow();
  });
});

describe("izin matrisi — analiz koşusu", () => {
  it("ILK/REVIZYON analizi OPERASYON rollerine açıktır; STAJYER alamaz", () => {
    for (const role of ALL_ROLES) {
      const expected = role !== "STAJYER";
      expect(analysisPermissionOf(userWith(role), "analyze")).toBe(expected);
    }
  });

  it("NIHAI analiz yalnız HUKUKI rollerde (ADMIN/PARTNER/AVUKAT)", () => {
    for (const role of ALL_ROLES) {
      const expected = role === "ADMIN" || role === "PARTNER" || role === "AVUKAT";
      expect(analysisPermissionOf(userWith(role), "analyze-final")).toBe(expected);
    }
  });
});

describe("izin matrisi — şerh ve bildirim", () => {
  it("şerh kapatma OPERASYON rolleri (STAJYER hariç)", () => {
    for (const role of ALL_ROLES) {
      const expected = role !== "STAJYER";
      expect(analysisPermissionOf(userWith(role), "close-annotation")).toBe(expected);
    }
  });

  it("müvekkile bildirim yalnız HUKUKI rollerde", () => {
    for (const role of ALL_ROLES) {
      const expected = role === "ADMIN" || role === "PARTNER" || role === "AVUKAT";
      expect(analysisPermissionOf(userWith(role), "notify-client")).toBe(expected);
    }
  });

  it("otomatik bildirim kipi PARTNER+ (ADMIN/PARTNER)", () => {
    for (const role of ALL_ROLES) {
      const expected = role === "ADMIN" || role === "PARTNER";
      expect(analysisPermissionOf(userWith(role), "set-notify-mode")).toBe(expected);
    }
  });
});
