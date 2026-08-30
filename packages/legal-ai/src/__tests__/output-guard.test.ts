import { describe, expect, it } from "vitest";

import { AI_ADVISORY_NOTICE } from "../prompts/system-core";
import {
  DeadlineDetectOutputSchema,
  DocumentClassifyOutputSchema,
  OpponentSimulationOutputSchema,
} from "../schemas";
import {
  dropSourcelessFindings,
  enforceCitationLookups,
  guardOutput,
  parseJsonOutput,
} from "../guards/output-guard";
import type { CitationLookupResult } from "../prompts/citation-verify";

describe("output-guard", () => {
  it("kod bloğu ile sarılmış ve önsözlü JSON yanıtını ayrıştırır", () => {
    const fenced = parseJsonOutput('```json\n{"a":1}\n```');
    expect(fenced.value).toEqual({ a: 1 });

    const chatty = parseJsonOutput('Tabii, işte sonuç:\n{"a":2}\nUmarım yardımcı olur.');
    expect(chatty.value).toEqual({ a: 2 });

    const broken = parseJsonOutput("bu bir JSON değil");
    expect(broken.error).toBeTruthy();
  });

  it("kaynaksız bulguyu eler, kaynaklı bulguyu korur", () => {
    const raw = {
      detections: [
        {
          eventDescription: "Bilirkişi raporunun tebliği",
          eventDate: "2026-08-12",
          suggestedRuleKey: "HMK_BILIRKISI_ITIRAZ",
          confidence: 0.93,
          sourceQuote: "12.08.2026 tarihinde tebliğ edilmiş olmakla",
        },
        {
          // Kaynak alıntısı YOK → elenmeli
          eventDescription: "Kanun yoluna başvuru süresi başlamış olabilir",
          eventDate: "2026-08-12",
          suggestedRuleKey: "HMK_ISTINAF",
          confidence: 0.4,
        },
        {
          // Boş string de kaynak sayılmaz
          eventDescription: "Belirsiz süre",
          eventDate: "2026-08-12",
          suggestedRuleKey: "HMK_CEVAP",
          confidence: 0.2,
          sourceQuote: "   ",
        },
      ],
    };

    const result = guardOutput(DeadlineDetectOutputSchema, raw, { findingPaths: ["detections"] });

    expect(result.ok).toBe(true);
    expect(result.data?.detections).toHaveLength(1);
    expect(result.data?.detections[0].suggestedRuleKey).toBe("HMK_BILIRKISI_ITIRAZ");
    expect(result.droppedFindings).toHaveLength(2);
    expect(result.droppedFindings[0].reason).toBe("KAYNAKSIZ");
    expect(result.droppedFindings[0].path).toBe("detections[1]");
  });

  it("sourceRefs veya citations dolu olan bulguyu kaynaklı sayar", () => {
    const { value, dropped } = dropSourcelessFindings(
      {
        arguments: [
          { title: "A", sourceRefs: [{ documentTitle: "Cevap Dilekçesi", page: 3 }] },
          { title: "B", citations: [{ raw: "HMK m.281" }] },
          { title: "C" },
          { title: "D", sourceRefs: [] },
        ],
      },
      ["arguments"],
    );

    const kept = (value as { arguments: Array<{ title: string }> }).arguments;
    expect(kept.map((a) => a.title)).toEqual(["A", "B"]);
    expect(dropped.map((d) => d.label)).toEqual(["C", "D"]);
  });

  it("eleme, şema doğrulamasından önce yapılır: tek kaynaksız bulgu koşuyu çöpe atmaz", () => {
    const raw = {
      arguments: [
        {
          rank: 1,
          title: "Zamanaşımı def'i",
          basis: "Cevap dilekçesinde ileri sürülmüştür.",
          strength: 8,
          ourGap: "Islah tarihi tartışmalı.",
          suggestedReply: "Muacceliyet tarihi belgelenmeli.",
          sourceRefs: [{ documentTitle: "Cevap Dilekçesi", page: 3 }],
        },
        {
          // Şemaya da uymayan (strength yok) VE kaynaksız bulgu: elenince şema geçerli kalır.
          rank: 2,
          title: "Dayanaksız argüman",
        },
      ],
    };

    const result = guardOutput(OpponentSimulationOutputSchema, raw, {
      findingPaths: ["arguments"],
    });

    expect(result.ok).toBe(true);
    expect(result.data?.arguments).toHaveLength(1);
    expect(result.droppedFindings).toHaveLength(1);
  });

  it("şemaya uymayan çıktıyı Türkçe hata listesiyle reddeder", () => {
    const result = guardOutput(DocumentClassifyOutputSchema, { class: "OLMAYAN_SINIF" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "SCHEMA")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("çıktıdaki atıfları Teyit Ajanı için çıkarır", () => {
    const raw = {
      arguments: [
        {
          rank: 1,
          title: "İspat yükü işverendedir",
          basis: "Yargıtay 9. HD 2023/4512 E. 2023/9981 K. bu yöndedir; ayrıca HMK m.190 uygulanır.",
          strength: 7,
          ourGap: "-",
          suggestedReply: "-",
          sourceRefs: [{ documentTitle: "Bilirkişi Raporu", page: 7 }],
        },
      ],
    };

    const result = guardOutput(OpponentSimulationOutputSchema, raw, {
      findingPaths: ["arguments"],
    });

    expect(result.ok).toBe(true);
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].kind).toBe("ICTIHAT");
    expect(result.citations[0].esasNo).toBe("2023/4512");
    expect(result.citations[1].kind).toBe("MEVZUAT");
    expect(result.citations[1].statuteRef).toBe("HMK");
  });

  it("her sonuca 'AI çıktısı öneridir' bayrağını ekler", () => {
    const ok = guardOutput(DeadlineDetectOutputSchema, { detections: [] });
    const fail = guardOutput(DeadlineDetectOutputSchema, "geçersiz");

    expect(ok.advisory.isAdvisory).toBe(true);
    expect(ok.advisory.notice).toBe(AI_ADVISORY_NOTICE);
    expect(fail.advisory.isAdvisory).toBe(true);
    expect(fail.advisory.notice).toContain("ÖNERİDİR");
  });

  it("çağıranın nesnesini değiştirmez (saf eleme)", () => {
    const raw = { detections: [{ eventDescription: "x" }] };
    dropSourcelessFindings(raw, ["detections"]);
    expect(raw.detections).toHaveLength(1);
  });
});

describe("teyit kapısı (fail-closed)", () => {
  const lookups: readonly CitationLookupResult[] = [
    { raw: "Yargıtay 9. HD 2023/4512 E. 2023/9981 K.", outcome: "FOUND", caseLawId: "cl-7781" },
    { raw: "Yargıtay 22. HD 2021/812 E. 2021/9999 K.", outcome: "NOT_FOUND" },
    { raw: "Danıştay 10. D. 2020/154 E.", outcome: "SEARCH_FAILED", adapterNote: "TIMEOUT" },
  ];

  it("deterministik eşleşmesi olan VERIFIED'ı korur", () => {
    const { output, downgraded } = enforceCitationLookups(
      {
        citations: [
          {
            raw: "Yargıtay 9. HD 2023/4512 E. 2023/9981 K.",
            status: "VERIFIED",
            matchedCaseLawId: "cl-7781",
            note: "Künye kayıtla uyuşuyor.",
          },
        ],
        overallStatus: "PASSED",
      },
      lookups,
    );
    expect(downgraded).toEqual([]);
    expect(output.citations[0].status).toBe("VERIFIED");
    expect(output.overallStatus).toBe("PASSED");
  });

  it("arama bulamadıysa ya da yapılamadıysa VERIFIED'ı AMBIGUOUS'a düşürür", () => {
    const { output, downgraded } = enforceCitationLookups(
      {
        citations: [
          {
            raw: "Yargıtay 22. HD 2021/812 E. 2021/9999 K.",
            status: "VERIFIED",
            matchedCaseLawId: "cl-0000",
            note: "Büyük ihtimalle vardır.",
          },
          {
            raw: "Danıştay 10. D. 2020/154 E.",
            status: "VERIFIED",
            matchedCaseLawId: "cl-1111",
            note: "Adaptöre erişilemedi ama doğrudur.",
          },
        ],
        overallStatus: "PASSED",
      },
      lookups,
    );
    expect(downgraded).toHaveLength(2);
    expect(output.citations.every((c) => c.status === "AMBIGUOUS")).toBe(true);
    expect(output.overallStatus).toBe("FAILED");
  });

  it("arama sonucu hiç gelmemiş künyeyi doğrulanmış saymaz", () => {
    const { output, downgraded } = enforceCitationLookups(
      {
        citations: [
          { raw: "Yargıtay 11. HD 2022/1 E.", status: "VERIFIED", matchedCaseLawId: "cl-9", note: "x" },
        ],
        overallStatus: "PASSED",
      },
      lookups,
    );
    expect(downgraded).toHaveLength(1);
    expect(output.citations[0].status).toBe("AMBIGUOUS");
    expect(output.citations[0].matchedCaseLawId).toBeUndefined();
  });
});
