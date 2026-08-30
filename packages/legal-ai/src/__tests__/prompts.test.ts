import { describe, expect, it } from "vitest";

import {
  AI_ADVISORY_NOTICE,
  buildCitationVerifyMessages,
  buildDeadlineDetectMessages,
  buildMessages,
  buildPetitionDraftMessages,
  composeSystemPrompt,
  extractPrecedentPlaceholders,
  NOMOSOS_SYSTEM_CORE_PROMPT,
  PROMPT_REGISTRY,
  deadlineDetectPrompt,
} from "../prompts";
import { isKnownDeadlineRuleKey } from "../schemas";

describe("prompt katmanı", () => {
  it("çekirdek prompt halüsinasyon savunmasının dört kuralını taşır", () => {
    expect(NOMOSOS_SYSTEM_CORE_PROMPT).toContain("NomosOS hukuk asistanısın");
    expect(NOMOSOS_SYSTEM_CORE_PROMPT).toContain("Türk hukuku");
    expect(NOMOSOS_SYSTEM_CORE_PROMPT).toContain("KAYNAK ZORUNLULUĞU");
    expect(NOMOSOS_SYSTEM_CORE_PROMPT).toContain("UYDURMA YASAĞI");
    expect(NOMOSOS_SYSTEM_CORE_PROMPT).toContain("EMİN OLMAMA HALİ");
    expect(NOMOSOS_SYSTEM_CORE_PROMPT.toLocaleLowerCase("tr")).toContain(
      "nihai karar ve sorumluluk avukattadır"
    );
    expect(AI_ADVISORY_NOTICE).toContain("ÖNERİDİR");
  });

  it("her görev promptu çekirdeğin üzerine eklenir", () => {
    const composed = composeSystemPrompt("Göreve özel talimat.");
    expect(composed.startsWith(NOMOSOS_SYSTEM_CORE_PROMPT)).toBe(true);
    expect(composed).toContain("GÖREVE ÖZEL TALİMAT");
  });

  it("süre tespiti promptu hesaplama yasağını açıkça yazar", () => {
    const system = deadlineDetectPrompt.system;
    expect(system).toContain("HESAPLAMA YAPMA");
    expect(system).toContain("Süre Motoru");
    expect(system).toContain("sourceQuote");
    // Kural anahtarı kataloğu MOTORDAN enjekte edilir; prompt uydurma anahtar öğretmez.
    expect(system).toContain("SÜRE MOTORU KURAL KATALOĞU");
    expect(system).toContain("HMK_BILIRKISI_ITIRAZ");
    expect(system).not.toContain("HMK_281_BILIRKISI_ITIRAZ");
    expect(system).not.toContain("HMK_120_HARC_TAMAMLAMA");
    // Few-shot örneği de hesaplanmış bir son gün içermemelidir.
    const example = deadlineDetectPrompt.fewShot[1].content;
    expect(example).not.toMatch(/son gün ?[:=]/i);
    expect(JSON.parse(example)).toHaveProperty("detections");
  });

  it("süre tespiti few-shot'ı yalnızca motorda TANIMLI anahtar öğretir", () => {
    const example = JSON.parse(deadlineDetectPrompt.fewShot[1].content) as {
      detections: Array<{ suggestedRuleKey: string; eventDate: string }>;
    };
    for (const detection of example.detections) {
      expect(isKnownDeadlineRuleKey(detection.suggestedRuleKey)).toBe(true);
    }
    // Few-shot, tarihi BAŞKA bir olaydan ödünç alan tespiti içermemelidir:
    // örnekteki tek tarih (12.08.2026) yalnız bir kez, kendi olayı için kullanılır.
    const dates = example.detections.map((d) => d.eventDate);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("mesaj zinciri sistem → few-shot → kullanıcı sırasını korur", () => {
    const messages = buildDeadlineDetectMessages({ documentText: "metin", documentClass: "ARA_KARAR" });
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[2].role).toBe("assistant");
    expect(messages[messages.length - 1].content).toContain("metin");

    const withoutFewShot = buildMessages(deadlineDetectPrompt, "soru", { includeFewShot: false });
    expect(withoutFewShot).toHaveLength(2);
  });

  it("dilekçe promptu emsal yoksa uydurma yerine işaretçi bıraktırır", () => {
    const messages = buildPetitionDraftMessages({
      petitionType: "CEVAP",
      sectionSkeleton: ["baslik_taraflar", "sonuc_ve_istem"],
      caseContextText: "[DOSYA] 2026/145",
    });
    expect(messages[0].content).toContain("[EMSAL ÖNERİSİ:");
    expect(messages[0].content).toContain("numara UYDURMA");
    expect(messages[messages.length - 1].content).toContain(
      "(bu dosyaya bağlı onaylı emsal bulunmamaktadır)",
    );
  });

  it("metindeki [EMSAL ÖNERİSİ] işaretçilerini çıkarır", () => {
    const found = extractPrecedentPlaceholders(
      "Hukuki sebepler... [EMSAL ÖNERİSİ: ispat yükü konusunda karar aranmalı] ve devamı [EMSAL ÖNERİSİ: fesih usulü].",
    );
    expect(found).toEqual(["ispat yükü konusunda karar aranmalı", "fesih usulü"]);
  });

  it("teyit promptu arama sonucunu künye ile eşler, indise güvenmez", () => {
    const messages = buildCitationVerifyMessages({
      citations: [
        { raw: "Yargıtay 9. HD 2023/4512 E. 2023/9981 K.", proposition: "İspat yükü işverendedir." },
        { raw: "Danıştay 10. D. 2020/154 E." },
      ],
      // Sıra bilinçli olarak TERS verildi: eşleme indise göre yapılırsa
      // BULUNDU kaydı yanlış künyeye yazılırdı.
      lookups: [
        { raw: "Danıştay 10. D. 2020/154 E.", outcome: "SEARCH_FAILED", adapterNote: "TIMEOUT" },
        { raw: "Yargıtay 9. HD 2023/4512 E. 2023/9981 K.", outcome: "FOUND", caseLawId: "cl-7781" },
      ],
    });
    const user = messages[messages.length - 1].content;
    expect(user).toContain('[1] "Yargıtay 9. HD 2023/4512 E. 2023/9981 K." → BULUNDU · id: cl-7781');
    expect(user).toContain('[2] "Danıştay 10. D. 2020/154 E." → ARAMA YAPILAMADI');
  });

  it("karşılığı olmayan atıf için ARAMA YAPILMADI yazar, fazladan sonuçta hata verir", () => {
    const eksik = buildCitationVerifyMessages({
      citations: [{ raw: "Yargıtay 9. HD 2023/4512 E." }],
      lookups: [],
    });
    expect(eksik[eksik.length - 1].content).toContain("ARAMA YAPILMADI");

    expect(() =>
      buildCitationVerifyMessages({
        citations: [{ raw: "Yargıtay 9. HD 2023/4512 E." }],
        lookups: [{ raw: "Bambaşka bir künye 2020/1 E.", outcome: "FOUND", caseLawId: "cl-1" }],
      }),
    ).toThrow(/eşleşmiyor/i);
  });

  it("prompt kataloğundaki tüm few-shot çıktıları geçerli JSON'dur", () => {
    for (const spec of Object.values(PROMPT_REGISTRY)) {
      if (!spec || !spec.expectsJson) continue;
      const assistantTurns = spec.fewShot.filter((m) => m.role === "assistant");
      expect(assistantTurns.length).toBeGreaterThan(0);
      for (const turn of assistantTurns) {
        expect(() => JSON.parse(turn.content)).not.toThrow();
      }
    }
  });
});
