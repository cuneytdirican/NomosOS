/**
 * AUDIT DÜZELTMELERİNİN SÖZLEŞME TESTLERİ.
 *
 * A1) llm-normalize guardOutput'a bağlı — üç saha hatasının (içtihat tarih
 *     regex'i, dilekçe atıf source enum'u, tarih biçimleri) normalizasyonla
 *     geçmesi.
 * A2) Simülasyon görüntüleme zinciri — outputJson {result: {...}} sarmalayıcılı
 *     saklanır; faz4 yardımcıları sarmalayıcıyı çözer (arguments, leaning,
 *     overallAssessment).
 * A3) /ai/chat sözleşmesi — asistan sayfası `content` okur.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guardOutput, PetitionDraftOutputSchema } from "@nomosos/legal-ai";
import { CaseLawSearchPlanSchema } from "../caselaw/prompts/caselaw-search";

const read = (root: string, ...parts: string[]) =>
  readFileSync(join(process.cwd(), root, ...parts), "utf-8");

describe("A1: normalizasyon guardOutput'a bağlı ve saha hatalarını onarır", () => {
  it("guardOutput kaynağı normalizeLlmOutput çağırır (ölü kod değil)", () => {
    const guard = read("..", "..", "packages", "legal-ai", "src", "guards", "output-guard.ts");
    expect(guard).toContain("normalizeLlmOutput");
  });

  it("içtihat arama planı: GG.AA.YYYY tarih normalizasyonla geçer", () => {
    // Sahadan gelen hata: model "01.01.2023" yazdı, regex YYYY-AA-GG istedi,
    // TÜM plan reddedildi. Normalizasyon guard'da olduğundan artık geçmeli.
    const raw = JSON.stringify({
      keywords: ["işe iade"],
      concepts: ["geçerli neden"],
      courtHints: ["Yargıtay 9. HD"],
      dateFrom: "01.01.2023",
      dateTo: "31.12.2024T00:00:00.000Z",
      note: "",
    });
    const res = guardOutput(CaseLawSearchPlanSchema, raw, {});
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.dateFrom).toBe("2023-01-01");
      expect(res.data.dateTo).toBe("2024-12-31");
    }
  });

  it("içtihat arama planı: yalnız-yıl değeri DÜŞÜRÜLÜR (tahmin edilmez), plan yine geçer", () => {
    const raw = JSON.stringify({
      keywords: ["kidem tazminatı"],
      concepts: [],
      courtHints: [],
      dateFrom: "2023",
      note: "",
    });
    const res = guardOutput(CaseLawSearchPlanSchema, raw, {});
    expect(res.ok).toBe(true);
    if (res.ok && res.data) expect(res.data.dateFrom).toBeUndefined();
  });

  it("dilekçe atıf kaynağı: kanun kısaltması ('TCK') statuteRef'e taşınır, taslak DÜŞMEZ", () => {
    // Sahadan gelen hata: MEVZUAT atfında model source'a "TCK" yazdı,
    // enum yalnız mahkeme kabul ettiği için TASLAK TAMAMEN REDDEDİLDİ.
    const raw = JSON.stringify({
      sections: [
        {
          key: "hukuki_sebepler",
          title: "HUKUKİ SEBEPLER",
          content: "TCK m. 62 uyarınca taksirle yaralama fiili...",
          origin: "AI",
        },
      ],
      citations: [{ kind: "MEVZUAT", raw: "TCK m. 62", source: "TCK" }],
      precedentSuggestions: [],
      missingContextNotes: [],
    });
    const res = guardOutput(PetitionDraftOutputSchema, raw, { findingPaths: [] });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.citations).toHaveLength(1);
      expect(res.data.citations[0].statuteRef).toBe("TCK");
      expect(res.data.citations[0].source).toBeUndefined();
    }
  });

  it("içtihat atıf kaynağı: 'Yargıtay 9. HD' → source=YARGITAY + chamber", () => {
    const raw = JSON.stringify({
      sections: [
        { key: "gerekce", title: "GEREKÇE", content: "emsal karar...", origin: "AI" },
      ],
      citations: [
        {
          kind: "ICTIHAT",
          raw: "Yargıtay 9. HD 2023/4512 E.",
          source: "Yargıtay 9. HD",
          esasNo: "2023/4512",
        },
      ],
      precedentSuggestions: [],
      missingContextNotes: [],
    });
    const res = guardOutput(PetitionDraftOutputSchema, raw, { findingPaths: [] });
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.citations[0].source).toBe("YARGITAY");
      expect(res.data.citations[0].chamber).toContain("9");
    }
  });
});

describe("A2: simülasyon görüntüleme zinciri sarmalayıcıyı çözer", () => {
  it("sunucu sarmalayıcı hâlâ {result: ...} ile saklıyor — test sabiti", () => {
    const svc = read("src", "simulation", "simulation.service.ts");
    expect(svc).toContain("result: run.data");
  });

  it("faz4: simulationResultData sarmalayıcıyı çözer; assessment ve leaning okunur", () => {
    const faz4 = read("..", "web", "src", "app", "app", "_lib", "faz4.ts");
    expect(faz4).toContain("export function simulationResultData");
    expect(faz4).toContain("out.result");
    expect(faz4).toContain("export function simulationAssessment");
    expect(faz4).toContain("overallAssessment");
    // findings ve leaning artık ÇÖZÜLMÜŞ veriden okunur.
    expect(faz4).toContain("const out = simulationResultData(run);");
  });

  it("simulation-tab: boş koşu modelin değerlendirmesini (assessment) gösterir", () => {
    const tab = read("..", "web", "src", "app", "app", "_components", "simulation-tab.tsx");
    expect(tab).toContain("simulationAssessment");
    expect(tab).toContain("kaynak temelli bulgu üretmedi");
    // Argümanlar artık GÖRÜNÜR olmalı (firstArray iç içe arar).
    expect(read("..", "web", "src", "app", "app", "_lib", "faz4.ts")).toContain(
      "nested = firstArray(",
    );
  });

  it("LİSTE SÖZLEŞMESİ: list() output alanı taşır — liste satırı bulgu gösteremez hatası", () => {
    // Sahadan gelen hata: liste satırlarında çıktı YOKTU; koşu yenilendiğinde
    // (load()) bulgular kayboluyordu. Liste artık output (parse edilmiş) taşır.
    const svc = read("src", "simulation", "simulation.service.ts");
    expect(svc).toContain("outputJson: true");
    expect(svc).toContain("output: safeParse(r.outputJson)");
    // UI önce output nesnesini okur, sonra eski outputJson dizesini.
    const faz4 = read("..", "web", "src", "app", "app", "_lib", "faz4.ts");
    expect(faz4).toContain(".output");
    expect(faz4).toContain("run.outputJson");
  });
});

describe("A3: /ai/chat sözleşmesi — asistan sayfası content okur", () => {
  it("sunucu yanıtı content alanını taşır", () => {
    const svc = read("src", "ai", "ai.service.ts");
    expect(svc).toContain("content: result.content");
  });

  it("asistan sayfası res.content okur — res.answer YOK", () => {
    const page = read("..", "web", "src", "app", "app", "asistan", "page.tsx");
    expect(page).toContain("res.content");
    expect(page).not.toContain("res.answer");
    // Öneri şeridi her yanıtta görünür (F2-Ö-12).
    expect(page).toContain("öneridir");
  });
});
