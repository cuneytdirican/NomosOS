/**
 * ÇATIŞMA SONUCU KARARI — birim testleri.
 *
 * KİLİTLENEN ÜRÜN İLKESİ: nihai sonuç YALNIZ KURALDAN gelir. AI'ın ÇAKIŞMA
 * ilan etme yetkisi YOKTUR; çakışma iddiası kayıt üzerinden doğrulanabilir bir
 * eşleşmeye dayanmak zorundadır. AI en fazla TEMIZ → DIKKAT geçişi yaptırabilir.
 */

import { describe, expect, it } from "vitest";
import { resolveOverallResult } from "./conflict.service";

const hit = (over: { similarity?: number; escalate?: boolean } = {}) => ({
  matchType: "MEVCUT_MUVEKKIL" as const,
  entityType: "Client",
  entityId: "c1",
  matchedName: "ABC Holding A.Ş.",
  similarity: 0.5,
  caseId: null,
  note: null,
  ...over,
});

describe("resolveOverallResult", () => {
  it("hiç eşleşme yoksa TEMIZ", () => {
    expect(resolveOverallResult([], false)).toBe("TEMIZ");
  });

  it("0,90 ve üstü benzerlik CAKISMA'dır", () => {
    expect(resolveOverallResult([hit({ similarity: 0.9 })], false)).toBe("CAKISMA");
    expect(resolveOverallResult([hit({ similarity: 1 })], false)).toBe("CAKISMA");
  });

  it("0,75-0,90 arası DIKKAT'tir", () => {
    expect(resolveOverallResult([hit({ similarity: 0.8 })], false)).toBe("DIKKAT");
  });

  it("eşiğin altındaki eşleşme sonucu değiştirmez", () => {
    expect(resolveOverallResult([hit({ similarity: 0.6 })], false)).toBe("TEMIZ");
  });

  it("AÇIK DOSYADA KARŞI TARAF, benzerlik düşük olsa da CAKISMA'ya YÜKSELTİR", () => {
    // Modül 11 iş kuralı 4. Karar `escalate` alanından okunur; `note`
    // cümlesinden değil — cümle düzenlendiği anda kural sessizce ölürdü.
    expect(resolveOverallResult([hit({ similarity: 0.78, escalate: true })], false)).toBe(
      "CAKISMA",
    );
  });

  it("AI TEK BAŞINA CAKISMA İLAN EDEMEZ — en fazla DIKKAT", () => {
    expect(resolveOverallResult([], true)).toBe("DIKKAT");
  });

  it("AI, kuraldan gelen CAKISMA'yı düşüremez", () => {
    expect(resolveOverallResult([hit({ similarity: 0.95 })], true)).toBe("CAKISMA");
  });

  it("AI, kuraldan gelen DIKKAT'i yükseltemez", () => {
    expect(resolveOverallResult([hit({ similarity: 0.8 })], true)).toBe("DIKKAT");
  });

  it("birden çok eşleşmede EN AĞIR sonuç kazanır", () => {
    expect(
      resolveOverallResult([hit({ similarity: 0.6 }), hit({ similarity: 0.95 })], false),
    ).toBe("CAKISMA");
  });
});
