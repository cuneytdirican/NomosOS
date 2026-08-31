/**
 * SÖZLEŞME DURUM MAKİNESİ — saf mantık testleri.
 *
 * Kabul kriteri 1'in doğrudan karşılığı: "DRAFT→ACTIVE tam yol tanımlı
 * geçişlerle yürür; DRAFT→SIGNING gibi atlama denemesi reddedilir."
 */

import { describe, expect, it } from "vitest";
import type { ContractStatus } from "@nomosos/db";
import {
  CONTRACT_TRANSITIONS,
  LOCKED_FOR_NEW_VERSION,
  assertContractTransition,
  canTransitionContract,
  isTerminalContractStatus,
} from "./contract-state-machine";

const ALL: ContractStatus[] = [
  "TASLAK",
  "MUZAKERE",
  "IMZAYA_HAZIR",
  "IMZADA",
  "YURURLUKTE",
  "SONA_ERDI",
  "FESIH",
];

describe("sözleşme durum makinesi — tam yol", () => {
  it("TASLAK → MUZAKERE → IMZAYA_HAZIR → IMZADA → YURURLUKTE yolu yürür", () => {
    const path: ContractStatus[] = [
      "TASLAK",
      "MUZAKERE",
      "IMZAYA_HAZIR",
      "IMZADA",
      "YURURLUKTE",
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionContract(path[i], path[i + 1])).toBe(true);
      expect(() => assertContractTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("YURURLUKTE'den SONA_ERDI ve FESIH'e çıkılabilir", () => {
    expect(canTransitionContract("YURURLUKTE", "SONA_ERDI")).toBe(true);
    expect(canTransitionContract("YURURLUKTE", "FESIH")).toBe(true);
  });
});

describe("sözleşme durum makinesi — atlama ve geri dönüş", () => {
  it("TASLAK → IMZADA atlaması reddedilir ve mesaj yol gösterir", () => {
    expect(canTransitionContract("TASLAK", "IMZADA")).toBe(false);
    expect(() => assertContractTransition("TASLAK", "IMZADA")).toThrowError(
      /İzin verilen geçişler/,
    );
    expect(() => assertContractTransition("TASLAK", "IMZADA")).toThrowError(
      /nihai sürümü imzaya hazır işaretleyin/,
    );
  });

  it("TASLAK → YURURLUKTE atlaması reddedilir", () => {
    expect(canTransitionContract("TASLAK", "YURURLUKTE")).toBe(false);
  });

  it("imza süreci iptalinde IMZADA → IMZAYA_HAZIR ve IMZADA → MUZAKERE serbesttir", () => {
    expect(canTransitionContract("IMZADA", "IMZAYA_HAZIR")).toBe(true);
    expect(canTransitionContract("IMZADA", "MUZAKERE")).toBe(true);
  });

  it("yürürlüğe girmiş sözleşme geriye alınamaz", () => {
    expect(canTransitionContract("YURURLUKTE", "IMZADA")).toBe(false);
    expect(canTransitionContract("YURURLUKTE", "MUZAKERE")).toBe(false);
  });

  it("aynı duruma geçiş anlamsızdır ve açıkça reddedilir", () => {
    expect(canTransitionContract("MUZAKERE", "MUZAKERE")).toBe(false);
    expect(() => assertContractTransition("MUZAKERE", "MUZAKERE")).toThrowError(/zaten/);
  });
});

describe("sözleşme durum makinesi — nihai durumlar ve sürüm kilidi", () => {
  it("SONA_ERDI ve FESIH nihaidir, çıkışı yoktur", () => {
    for (const s of ["SONA_ERDI", "FESIH"] as const) {
      expect(isTerminalContractStatus(s)).toBe(true);
      expect(CONTRACT_TRANSITIONS[s]).toEqual([]);
      expect(() => assertContractTransition(s, "YURURLUKTE")).toThrowError(/sonuçlanmıştır/);
    }
  });

  it("her durum geçiş tablosunda tanımlıdır", () => {
    for (const s of ALL) {
      expect(Array.isArray(CONTRACT_TRANSITIONS[s])).toBe(true);
    }
  });

  it("imza ve sonrası durumlarda yeni sürüm eklenemez", () => {
    expect(LOCKED_FOR_NEW_VERSION).toContain("IMZADA");
    expect(LOCKED_FOR_NEW_VERSION).toContain("YURURLUKTE");
    expect(LOCKED_FOR_NEW_VERSION).not.toContain("MUZAKERE");
    expect(LOCKED_FOR_NEW_VERSION).not.toContain("IMZAYA_HAZIR");
  });
});
