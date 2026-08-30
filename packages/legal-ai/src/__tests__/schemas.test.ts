import { describe, expect, it } from "vitest";

import {
  CitationVerifyOutputSchema,
  DeadlineDetectOutputSchema,
  DocumentClassifyOutputSchema,
  HEARING_PREP_SECTION_KEYS,
  HearingPrepOutputSchema,
  RiskAssessOutputSchema,
  DEADLINE_RULE_KEYS,
  UNKNOWN_DEADLINE_RULE_KEY,
  isKnownDeadlineRuleKey,
} from "../schemas";

describe("çıktı şemaları", () => {
  it("belge sınıflandırma çıktısını doğrular ve taksonomi dışı sınıfı reddeder", () => {
    const valid = DocumentClassifyOutputSchema.safeParse({
      class: "ARA_KARAR",
      confidence: 0.91,
      reasoning: "Başlık ara karar olup taraflara süre yüklemektedir.",
      summary: "Rapora karşı beyan için iki haftalık süre verilmiştir.",
      extractedDates: [
        { label: "Karar tarihi", date: "2026-08-12", sourceQuote: "karar verildi. 12.08.2026" },
      ],
    });
    expect(valid.success).toBe(true);

    const invalid = DocumentClassifyOutputSchema.safeParse({
      class: "MAHKEME_YAZISI",
      confidence: 0.9,
      reasoning: "x",
      summary: "y",
    });
    expect(invalid.success).toBe(false);
  });

  it("güven skorunu 0-1 aralığına ve tarihi YYYY-AA-GG biçimine zorlar", () => {
    const badConfidence = DocumentClassifyOutputSchema.safeParse({
      class: "DILEKCE",
      confidence: 1.4,
      reasoning: "x",
      summary: "y",
    });
    expect(badConfidence.success).toBe(false);

    const badDate = DeadlineDetectOutputSchema.safeParse({
      detections: [
        {
          eventDescription: "Tebliğ",
          eventDate: "12.08.2026",
          suggestedRuleKey: "HMK_BILIRKISI_ITIRAZ",
          confidence: 0.9,
          sourceQuote: "tebliğ edilmiştir",
        },
      ],
    });
    expect(badDate.success).toBe(false);
  });

  it("süre tespiti çıktısı hesaplanmış son gün alanı içermez", () => {
    const parsed = DeadlineDetectOutputSchema.parse({
      detections: [
        {
          eventDescription: "Bilirkişi raporunun tebliği",
          eventDate: "2026-08-12",
          suggestedRuleKey: "HMK_BILIRKISI_ITIRAZ",
          confidence: 0.93,
          sourceQuote: "12.08.2026 tarihinde tebliğ edilmiş olmakla",
        },
      ],
    });
    const detection = parsed.detections[0] as Record<string, unknown>;
    expect(Object.keys(detection)).not.toContain("dueDate");
    expect(Object.keys(detection)).not.toContain("lastDay");
    expect(detection.sourceQuote).toBeTruthy();
  });

  it("duruşma hazırlık paketi 9 sabit bölümün tamamını ister", () => {
    const section = { content: "metin", bullets: [], sourceRefs: [], noData: false };
    const full = Object.fromEntries(HEARING_PREP_SECTION_KEYS.map((k) => [k, section]));
    expect(HearingPrepOutputSchema.safeParse({ sections: full }).success).toBe(true);

    const { previous_minutes: _omitted, ...missingOne } = full;
    expect(HearingPrepOutputSchema.safeParse({ sections: missingOne }).success).toBe(false);
  });

  it("risk düzeltmesini ±25 ile sınırlar", () => {
    const ok = RiskAssessOutputSchema.safeParse({
      adjustments: [{ dimension: "EVIDENCE", adjustment: 15, reason: "Tanık beyanları çelişkili." }],
    });
    expect(ok.success).toBe(true);

    const tooHigh = RiskAssessOutputSchema.safeParse({
      adjustments: [{ dimension: "EVIDENCE", adjustment: 40, reason: "Çok riskli." }],
    });
    expect(tooHigh.success).toBe(false);
  });

  it("teyit çıktısında yalnızca tanımlı statüleri kabul eder", () => {
    const ok = CitationVerifyOutputSchema.safeParse({
      citations: [
        {
          raw: "Yargıtay 9. HD 2023/4512 E. 2023/9981 K.",
          status: "VERIFIED",
          matchedCaseLawId: "cl-7781",
          note: "Uyumlu.",
        },
      ],
      overallStatus: "PASSED",
    });
    expect(ok.success).toBe(true);

    const invented = CitationVerifyOutputSchema.safeParse({
      citations: [{ raw: "X", status: "PROBABLY_EXISTS", note: "Muhtemelen vardır." }],
      overallStatus: "PASSED",
    });
    expect(invented.success).toBe(false);
  });

  it("VERIFIED statüsünü deterministik eşleşme kimliği olmadan kabul etmez", () => {
    const uydurma = CitationVerifyOutputSchema.safeParse({
      citations: [{ raw: "Yargıtay 9. HD 2023/4512 E.", status: "VERIFIED", note: "Muhtemelen vardır." }],
      overallStatus: "PASSED",
    });
    expect(uydurma.success).toBe(false);

    const mevzuat = CitationVerifyOutputSchema.safeParse({
      citations: [
        {
          raw: "HMK m.281",
          status: "VERIFIED",
          matchedStatuteVersionId: "sv-12",
          note: "Mevzuat sürümü ile eşleşti.",
        },
      ],
      overallStatus: "PASSED",
    });
    expect(mevzuat.success).toBe(true);
  });

  it("süre kuralı anahtarını Süre Motoru kataloğuna karşı doğrular", () => {
    const bilinmeyen = DeadlineDetectOutputSchema.safeParse({
      detections: [
        {
          eventDescription: "Tebliğ",
          eventDate: "2026-08-12",
          // Motorda BÖYLE BİR ANAHTAR YOK (eski prompt bunu öğretiyordu).
          suggestedRuleKey: "HMK_281_BILIRKISI_ITIRAZ",
          confidence: 0.9,
          sourceQuote: "tebliğ edilmiştir",
        },
      ],
    });
    expect(bilinmeyen.success).toBe(false);

    for (const key of DEADLINE_RULE_KEYS) {
      expect(isKnownDeadlineRuleKey(key)).toBe(true);
    }

    const belirsiz = DeadlineDetectOutputSchema.safeParse({
      detections: [
        {
          eventDescription: "İİK m.89 haciz ihbarnamesi tebliği",
          eventDate: "2026-08-12",
          suggestedRuleKey: UNKNOWN_DEADLINE_RULE_KEY,
          confidence: 0.4,
          sourceQuote: "birinci haciz ihbarnamesi tebliğ edilmiştir",
        },
      ],
    });
    expect(belirsiz.success).toBe(true);
  });
});
