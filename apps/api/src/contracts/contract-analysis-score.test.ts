/**
 * SÖZLEŞME GENEL RİSK SKORU — saf mantık testleri.
 *
 * Formül: KRITIK=10 / ORTA=5 / DUSUK=2 ağırlıklı toplam, doyma noktası 50
 * üzerinden 100'e normalize, tavan 100.
 */

import { describe, expect, it } from "vitest";
import {
  computeRiskScore,
  CONTRACT_RISK_BAND_LABELS,
  CONTRACT_RISK_BAND_TONES,
  riskBandOf,
  SCORE_SATURATION_POINT,
  SEVERITY_WEIGHTS,
} from "./contract-analysis-score";

describe("sözleşme risk skoru — ağırlıklar", () => {
  it("şiddet ağırlıkları planla birebir: KRITIK=10, ORTA=5, DUSUK=2", () => {
    expect(SEVERITY_WEIGHTS.KRITIK).toBe(10);
    expect(SEVERITY_WEIGHTS.ORTA).toBe(5);
    expect(SEVERITY_WEIGHTS.DUSUK).toBe(2);
  });

  it("boş şerh listesi skoru 0 üretir", () => {
    expect(computeRiskScore([])).toBe(0);
  });

  it("tek DUSUK şerh orantılı normalize edilir (2/50 → 4)", () => {
    expect(computeRiskScore(["DUSUK"])).toBe(4);
  });

  it("tek KRITIK şerh 10/50 → 20 puan", () => {
    expect(computeRiskScore(["KRITIK"])).toBe(20);
  });

  it("doyma noktasındaki ağırlık toplamı 100 üretir (5 KRITIK)", () => {
    const five = Array.from({ length: SCORE_SATURATION_POINT / SEVERITY_WEIGHTS.KRITIK }, () => "KRITIK" as const);
    expect(computeRiskScore(five)).toBe(100);
  });

  it("doyma noktasını aşan ağırlık 100'de kalır — 'sonsuz risk' yoktur", () => {
    const many = Array.from({ length: 20 }, () => "KRITIK" as const);
    expect(computeRiskScore(many)).toBe(100);
  });

  it("karışık şiddetler toplanır: 2 KRITIK + 1 ORTA + 1 DUSUK = 27 → 54", () => {
    expect(
      computeRiskScore(["KRITIK", "KRITIK", "ORTA", "DUSUK"]),
    ).toBe(54);
  });
});

describe("sözleşme risk skoru — band", () => {
  it("0-29 DUSUK (yeşil), 30-59 ORTA (sarı), 60-100 YUKSEK (kırmızı)", () => {
    expect(riskBandOf(0)).toBe("DUSUK");
    expect(riskBandOf(29)).toBe("DUSUK");
    expect(riskBandOf(30)).toBe("ORTA");
    expect(riskBandOf(59)).toBe("ORTA");
    expect(riskBandOf(60)).toBe("YUKSEK");
    expect(riskBandOf(100)).toBe("YUKSEK");
  });

  it("aralık dışı değerler kırpılır; skor asla negatif/100+ banda taşımaz", () => {
    expect(riskBandOf(-5)).toBe("DUSUK");
    expect(riskBandOf(250)).toBe("YUKSEK");
  });

  it("her bandın etiketi ve tonu tanımlıdır (yeşil/sarı/kırmızı)", () => {
    expect(CONTRACT_RISK_BAND_TONES.DUSUK).toBe("green");
    expect(CONTRACT_RISK_BAND_TONES.ORTA).toBe("yellow");
    expect(CONTRACT_RISK_BAND_TONES.YUKSEK).toBe("red");
    for (const label of Object.values(CONTRACT_RISK_BAND_LABELS)) {
      expect(label.length).toBeGreaterThan(2);
    }
  });
});
