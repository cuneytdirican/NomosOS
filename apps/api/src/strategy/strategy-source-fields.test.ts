/**
 * STRATEJİ DÜĞÜMLERİNİN KAYNAK ALANI — REGRESYON TESTİ.
 *
 * DENETİM BULGUSU: strateji düğüm şemasındaki kaynak alanı `sourceRef`
 * (TEKİL). Output-guard'ın tanıdığı sabit liste ise
 * ["sourceQuote","sourceRefs","citations","refs","sources"] — `sourceRef` bu
 * listede YOKTU. `hasSource` boş diziyi kaynak saymadığı için, kaynağını belge
 * referansıyla gösteren (yani TİPİK) her düğüm "KAYNAKSIZ" gerekçesiyle
 * eleniyor; `fillMissingLinks` dokuz halkayı da "VERİ YETERSİZ" ile dolduruyor
 * ve avukat 30 kredi ödeyip BOŞ AĞAÇ alıyordu. Promptun kendi örneğindeki
 * düğüm bile bu elemeye takılıyordu.
 *
 * Test, sahte model çıktısıyla iki şeyi doğrular:
 *   1. Guard'ın SABİT listesiyle `sourceRef`li düğüm ELENİR (hatanın kendisi).
 *   2. `StrategyBuildService`in geçirdiği genişletilmiş listeyle KORUNUR.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_FIELDS, guardOutput } from "@nomosos/legal-ai";
import { StrategyChainOutputSchema } from "./strategy.chain";

/** `StrategyBuildService.build` içinde guard'a geçirilen liste. */
const STRATEGY_SOURCE_FIELDS = [...DEFAULT_SOURCE_FIELDS, "sourceRef"];

/** Promptun KENDİ örneğindeki düğüm: sourceRef dolu, citations boş. */
const modelOutput = JSON.stringify({
  nodes: [
    {
      key: "kt_zamanasimi",
      link: "KARSI_ARGUMAN",
      content:
        "Davalı, alacağın on yıllık zamanaşımına uğradığını cevap dilekçesinde ileri sürmüştür.",
      strength: 4,
      sourceRef: "Cevap Dilekçesi s.3 ¶2",
      citations: [],
    },
    {
      key: "kaynaksiz_dugum",
      link: "BIZIM_ARGUMAN",
      content: "Kaynağı gösterilmemiş bir iddia.",
      citations: [],
    },
  ],
  summary: "özet",
});

describe("strateji düğümlerinde kaynak elemesi", () => {
  it("HATA: guard'ın sabit listesiyle sourceRef'li düğüm KAYNAKSIZ sayılıp elenir", () => {
    const guarded = guardOutput(StrategyChainOutputSchema, modelOutput, {
      findingPaths: ["nodes"],
      // sourceFields VERİLMEZSE DEFAULT_SOURCE_FIELDS kullanılır.
    });
    expect(guarded.ok).toBe(true);
    // İki düğümün İKİSİ de elenir — ağaç tamamen boşalır.
    expect(guarded.data?.nodes).toHaveLength(0);
    expect(guarded.droppedFindings).toHaveLength(2);
  });

  it("DÜZELTME: sourceRef kaynak sayılınca kaynaklı düğüm KORUNUR", () => {
    const guarded = guardOutput(StrategyChainOutputSchema, modelOutput, {
      findingPaths: ["nodes"],
      sourceFields: STRATEGY_SOURCE_FIELDS,
    });
    expect(guarded.ok).toBe(true);
    expect(guarded.data?.nodes).toHaveLength(1);
    expect(guarded.data?.nodes[0]?.key).toBe("kt_zamanasimi");
  });

  it("DÜZELTME KORUMAYI GEVŞETMEZ: gerçekten kaynaksız düğüm hâlâ elenir", () => {
    const guarded = guardOutput(StrategyChainOutputSchema, modelOutput, {
      findingPaths: ["nodes"],
      sourceFields: STRATEGY_SOURCE_FIELDS,
    });
    expect(guarded.droppedFindings).toHaveLength(1);
    expect(guarded.droppedFindings[0]?.reason).toBe("KAYNAKSIZ");
    expect(guarded.data?.nodes.some((n) => n.key === "kaynaksiz_dugum")).toBe(false);
  });

  it("yalnız citations dolu olan düğüm de kaynaklı sayılır (prompt kuralı d)", () => {
    const output = JSON.stringify({
      nodes: [
        {
          key: "emsal_dayanak",
          link: "HUKUKI_DAYANAK",
          content: "Onaylı emsale dayanan tespit.",
          citations: ["Yargıtay 11. HD 2024/123 E. 2024/456 K."],
        },
      ],
    });
    const guarded = guardOutput(StrategyChainOutputSchema, output, {
      findingPaths: ["nodes"],
      sourceFields: STRATEGY_SOURCE_FIELDS,
    });
    expect(guarded.data?.nodes).toHaveLength(1);
  });
});
