/**
 * Kanun metni ayrıştırıcı birim testleri.
 *
 * Girdi biçimi mevzuat.gov.tr konsolide metninden (MevzuatFihristDetayIframe,
 * tarayıcı üzerinden doğrulanmış TCK çıktısı) alınmıştır; madde başlıkları ve
 * künye satırları gerçek biçimle birebir tutarlıdır.
 */

import { describe, expect, it } from "vitest";
import {
  diffStatuteArticles,
  normalizeArticleText,
  parseStatuteText,
} from "../statute-parser";

const TCK_ORNEK = `TÜRK CEZA KANUNU

Kanun Numarası                    : 5237

Kabul Tarihi                      : 26/9/2004

Yayımlandığı Resmî Gazete  : Tarih  : 12/10/2004     Sayı  : 25611

Yayımlandığı Düstur           : Tertip : 5                          Cilt  : 43

BİRİNCİ KİTAP

Genel Hükümler

Ceza Kanununun amacı
Madde 1- (1) Ceza Kanununun amacı; kişi hak ve özgürlüklerini, kamu düzen ve güvenliğini, hukuk devletini, kamu sağlığını ve çevreyi, toplum barışını korumak, suç işlenmesini önlemektir.

Suçta ve cezada kanunîlik ilkesi
Madde 2- (1) Kanunun açıkça suç saymadığı bir fiil için kimseye ceza verilemez ve güvenlik tedbiri uygulanamaz.

Kast
Madde 3- (1) Suçun kanunî tanımındaki unsurların bilerek ve isteyerek gerçekleştirilmesiyle kast vardır.

Ek madde
Ek Madde 1- (1) Bu Kanunun 53 üncü maddesinin birinci fıkrasında yer alan...`;

describe("parseStatuteText — künye başlığı", () => {
  it("kanun numarası, kabul tarihi ve RG künyesi çıkarılır", () => {
    const r = parseStatuteText(TCK_ORNEK);
    expect(r.header.mevzuatNo).toBe("5237");
    expect(r.header.kabulTarihi).toBe("26/9/2004");
    expect(r.header.rgTarihi).toBe("12/10/2004");
    expect(r.header.rgSayisi).toBe("25611");
  });
});

describe("parseStatuteText — madde ayrıştırma", () => {
  it("numaralı maddeler sırayla çıkarılır", () => {
    const r = parseStatuteText(TCK_ORNEK);
    const nos = r.articles.map((a) => a.articleNo);
    expect(nos).toEqual(["1", "2", "3", "EK 1"]);
  });

  it("madde metni başlıkla başlar ve içeriği taşır", () => {
    const r = parseStatuteText(TCK_ORNEK);
    const m1 = r.articles[0];
    expect(m1.text).toContain("Madde 1-");
    expect(m1.text).toContain("suç işlenmesini önlemektir");
  });

  it("fıkra yapısı (çok satırlı madde) korunur", () => {
    const metin = [
      "KANUN",
      "Madde 20- (1) İlk fıkra.",
      "(2) İkinci fıkra.",
      "Madde 21- (1) Sonraki madde.",
    ].join("\n");
    const r = parseStatuteText(metin);
    expect(r.articles[0].text).toContain("(2) İkinci fıkra.");
    expect(r.articles).toHaveLength(2);
  });

  it("hiç madde yoksa dürüst uyarı üretilir (sessiz boş havuz yok)", () => {
    const r = parseStatuteText("Bu bir kanun metni değildir.");
    expect(r.articles).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("aynı madde ikinci kez başlarsa uyarı üretilir", () => {
    const metin = "Madde 5- (1) Birinci.\nMadde 6- (1) Ara.\nMadde 5- (1) Tekrar.";
    const r = parseStatuteText(metin);
    expect(r.articles.map((a) => a.articleNo)).toEqual(["5", "6"]);
    expect(r.warnings.some((w) => w.includes("5"))).toBe(true);
  });
});

describe("diffStatuteArticles — sürüm farkı", () => {
  const v1 = [
    { articleNo: "1", text: "Madde 1- (1) Eski metin." },
    { articleNo: "2", text: "Madde 2- (1) Değişmeyen.[3]" },
  ];

  it("değişen madde changed listesine düşer (dipnot farkı değişiklik DEĞİLDİR)", () => {
    const v2 = [
      { articleNo: "1", text: "Madde 1- (1) Yeni metin." },
      { articleNo: "2", text: "Madde 2- (1) Değişmeyen." },
    ];
    const d = diffStatuteArticles(v1, v2);
    expect(d.changed.map((a) => a.articleNo)).toEqual(["1"]);
    expect(d.unchanged).toBe(1);
  });

  it("yeni madde added, düşen madde removed listesine düşer", () => {
    const v2 = [
      { articleNo: "1", text: "Madde 1- (1) Eski metin." },
      { articleNo: "3", text: "Madde 3- (1) Yeni madde." },
    ];
    const d = diffStatuteArticles(v1, v2);
    expect(d.added.map((a) => a.articleNo)).toEqual(["3"]);
    expect(d.removed).toEqual(["2"]);
  });

  it("normalizeArticleText biçim/dipnot farkını yok sayar", () => {
    expect(normalizeArticleText("Madde 1- (1) Metin.[7]")).toBe(
      normalizeArticleText("madde 1- (1) metin."),
    );
  });
});
