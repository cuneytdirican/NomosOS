import { describe, expect, it } from "vitest";
import {
  PORTAL_CASE_SELECT,
  PORTAL_DOCUMENT_SELECT,
  PORTAL_FORBIDDEN_FIELDS,
  PORTAL_HEARING_SELECT,
  PORTAL_INBOUND_SELECT,
  PORTAL_INVOICE_SELECT,
  PORTAL_OUTBOUND_SELECT,
  PORTAL_PAYMENT_SELECT,
  PORTAL_TIMELINE_SELECT,
} from "./portal-selects";

/**
 * PORTAL ALAN SIZINTISI TESTİ.
 *
 * Portal, sistemin en dar yetkili yüzeyidir; buradaki bir hata "müvekkil
 * verisi başka müvekkile ya da müvekkile hiç gitmemesi gereken iç kayıt"
 * demektir. Bu test, gözden kaçan bir `select` alanını DERLEME DEĞİL TEST
 * aşamasında yakalar: biri `PORTAL_DOCUMENT_SELECT`'e `ocrText: true`
 * eklerse test kırılır ve gerekçesini yazmak zorunda kalır.
 */

const ALL_SELECTS: Record<string, object> = {
  PORTAL_CASE_SELECT,
  PORTAL_DOCUMENT_SELECT,
  PORTAL_HEARING_SELECT,
  PORTAL_TIMELINE_SELECT,
  PORTAL_INVOICE_SELECT,
  PORTAL_PAYMENT_SELECT,
  PORTAL_OUTBOUND_SELECT,
  PORTAL_INBOUND_SELECT,
};

/** İç içe `select` bloklarını da tarayarak seçilen tüm alan adlarını toplar. */
function collectSelectedFields(select: object, found: string[] = []): string[] {
  for (const [key, value] of Object.entries(select)) {
    if (key === "select" && value && typeof value === "object") {
      collectSelectedFields(value as object, found);
      continue;
    }
    if (value === true) {
      found.push(key);
      continue;
    }
    if (value && typeof value === "object") {
      collectSelectedFields(value as object, found);
    }
  }
  return found;
}

describe("portal alan seçimleri", () => {
  it("hiçbir seçim yasaklı bir iç alanı içermez", () => {
    const violations: string[] = [];
    for (const [name, select] of Object.entries(ALL_SELECTS)) {
      for (const field of collectSelectedFields(select)) {
        if (PORTAL_FORBIDDEN_FIELDS.includes(field)) {
          violations.push(`${name}.${field}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("belge seçimi depo anahtarını ve ham OCR metnini içermez", () => {
    const fields = collectSelectedFields(PORTAL_DOCUMENT_SELECT);
    expect(fields).not.toContain("storageKey");
    expect(fields).not.toContain("ocrText");
    expect(fields).not.toContain("aiSummary");
  });

  it("giden mesaj seçimi AI taslağını (draftBody) içermez, yalnız finalBody döner", () => {
    const fields = collectSelectedFields(PORTAL_OUTBOUND_SELECT);
    expect(fields).not.toContain("draftBody");
    expect(fields).not.toContain("piiScanJson");
    expect(fields).toContain("finalBody");
  });

  it("duruşma seçimi ara karar notunu ve hazırlık brifingini içermez", () => {
    const fields = collectSelectedFields(PORTAL_HEARING_SELECT);
    expect(fields).not.toContain("note");
    expect(fields).not.toContain("prepSummary");
  });

  it("safahat seçimi teknik ayrıntıyı (detail) içermez", () => {
    expect(collectSelectedFields(PORTAL_TIMELINE_SELECT)).not.toContain("detail");
  });

  it("dosya seçimi dava değerini ve hâkim adını içermez", () => {
    const fields = collectSelectedFields(PORTAL_CASE_SELECT);
    expect(fields).not.toContain("amount");
    expect(fields).not.toContain("judgeName");
    // Denormalize duruşma tarihi yayınlanmamış duruşmaları da yansıtır.
    expect(fields).not.toContain("nextHearingAt");
    expect(fields).not.toContain("lastActivityAt");
  });

  it("fatura satırları büro içi kaynak bağını (sourceType/sourceId) içermez", () => {
    const fields = collectSelectedFields(PORTAL_INVOICE_SELECT);
    expect(fields).not.toContain("sourceType");
    expect(fields).not.toContain("sourceId");
    expect(fields).toContain("lineTotal");
  });

  it("hiçbir seçim tenantId döndürmez", () => {
    for (const [name, select] of Object.entries(ALL_SELECTS)) {
      expect(collectSelectedFields(select), name).not.toContain("tenantId");
    }
  });
});
