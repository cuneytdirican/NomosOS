/**
 * Kuyruk yardımcıları ve içerik hash'i için saf (DOM/chrome gerektirmeyen) testler.
 */

import { describe, expect, it } from "vitest";

import { QUEUE_CONFIG, backoffDelayMs } from "../src/background/sync-queue";
import { canonicalJson } from "../src/lib/hash";
import { normalizeBaseUrl, normalizeSettings, DEFAULT_SETTINGS } from "../src/lib/settings";

describe("üstel geri çekilme", () => {
  it("deneme sayısıyla büyür ve üst sınırı aşmaz", () => {
    const ilk = backoffDelayMs(1);
    const ikinci = backoffDelayMs(2);
    const cok = backoffDelayMs(20);

    expect(ilk).toBeGreaterThanOrEqual(QUEUE_CONFIG.baseDelayMs * 0.8);
    expect(ilk).toBeLessThanOrEqual(QUEUE_CONFIG.baseDelayMs * 1.2);
    expect(ikinci).toBeGreaterThan(QUEUE_CONFIG.baseDelayMs);
    expect(cok).toBeLessThanOrEqual(QUEUE_CONFIG.maxDelayMs * 1.2);
  });
});

describe("içerik hash'i için kanonik JSON", () => {
  it("anahtar sırasından bağımsız aynı metni üretir", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("undefined alanları atar, null'a çevirir", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe("ayar doğrulama", () => {
  it("yalnız https (veya localhost) kabul eder", () => {
    expect(normalizeBaseUrl("https://app.nomosos.com/")).toBe("https://app.nomosos.com");
    expect(normalizeBaseUrl("http://buro.example.com")).toBeNull();
    expect(normalizeBaseUrl("http://localhost:3001")).toBe("http://localhost:3001");
    expect(normalizeBaseUrl("saçma")).toBeNull();
  });

  it("senkron aralığını güvenli aralığa sıkıştırır", () => {
    expect(normalizeSettings({ syncIntervalMinutes: 1 }, DEFAULT_SETTINGS).syncIntervalMinutes).toBe(5);
    expect(normalizeSettings({ syncIntervalMinutes: 99999 }, DEFAULT_SETTINGS).syncIntervalMinutes).toBe(1440);
    expect(normalizeSettings({ syncIntervalMinutes: 45 }, DEFAULT_SETTINGS).syncIntervalMinutes).toBe(45);
  });
});
