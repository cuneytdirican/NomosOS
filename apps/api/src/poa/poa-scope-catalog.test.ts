/**
 * VEKALETNAME KAPSAM KATALOĞU — deterministik katman testleri.
 *
 * Buradaki hesap AI'ya SORULMAZ; kapsam analizinin modele hazır verdiği
 * "[VAR] / [EKSİK]" satırları bu fonksiyonlardan çıkar.
 */

import { describe, expect, it } from "vitest";
import {
  CASE_TYPE_SCOPE_EXPECTATIONS,
  POA_SCOPE_CATALOG,
  computeMissingScopes,
  isKnownScopeCode,
  parseScopeItems,
  presentScopeCodes,
  scanScopeTextForCodes,
  scopeLabel,
} from "./poa-scope-catalog";

const GENEL_DAVA = JSON.stringify([
  { code: "DAVA_ACMA", label: "Dava açma", present: true },
  { code: "DAVAYI_TAKIP", label: "Davayı takip", present: true },
  { code: "AHZU_KABZ", label: "Ahzu kabz", present: true },
  { code: "SULH", label: "Sulh olma", present: false },
]);

describe("katalog bütünlüğü", () => {
  it("kod kümesi tekrarsızdır ve her maddenin etiketi vardır", () => {
    const codes = POA_SCOPE_CATALOG.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const d of POA_SCOPE_CATALOG) {
      expect(d.label.trim().length).toBeGreaterThan(2);
      expect(d.description.trim().length).toBeGreaterThan(5);
    }
  });

  it("HMK m.74 kapsamındaki tasarruflar özel yetki olarak işaretlidir", () => {
    for (const code of ["SULH", "IBRA", "FERAGAT", "KABUL", "HAKIM_RET", "TAHKIM"]) {
      const def = POA_SCOPE_CATALOG.find((d) => d.code === code);
      expect(def?.requiresSpecialAuthority).toBe(true);
    }
  });

  it("kanun yollarına BAŞVURMA özel yetki değildir, FERAGAT özel yetkidir", () => {
    expect(
      POA_SCOPE_CATALOG.find((d) => d.code === "TEMYIZ_ISTINAF")?.requiresSpecialAuthority,
    ).toBe(false);
    expect(
      POA_SCOPE_CATALOG.find((d) => d.code === "KANUN_YOLU_FERAGAT")?.requiresSpecialAuthority,
    ).toBe(true);
  });

  it("uydurma mevzuat atfı yoktur: legalBasis ya null ya HMK/TBK maddesidir", () => {
    for (const d of POA_SCOPE_CATALOG) {
      if (d.legalBasis === null) continue;
      expect(d.legalBasis).toMatch(/HMK m\.74|TBK m\.504\/3/);
    }
  });

  it("scopeLabel bilinmeyen kodu olduğu gibi döndürür", () => {
    expect(scopeLabel("SULH")).toBe("Sulh olma");
    expect(scopeLabel("BILINMEYEN")).toBe("BILINMEYEN");
    expect(isKnownScopeCode("SULH")).toBe(true);
    expect(isKnownScopeCode("BILINMEYEN")).toBe(false);
  });
});

describe("parseScopeItems — bozuk kayıt sessizce 'yetki yok' sayılmaz", () => {
  it("boş/undefined kayıtta boş liste döner ve parsed=true kalır", () => {
    expect(parseScopeItems(null)).toEqual({ items: [], parsed: true });
    expect(parseScopeItems("")).toEqual({ items: [], parsed: true });
  });

  it("bozuk JSON'da parsed=false döner", () => {
    expect(parseScopeItems("{bozuk").parsed).toBe(false);
    expect(parseScopeItems('{"a":1}').parsed).toBe(false);
  });

  it("geçerli kaydı okur ve present=false maddeleri ayırır", () => {
    const { items, parsed } = parseScopeItems(GENEL_DAVA);
    expect(parsed).toBe(true);
    expect(items).toHaveLength(4);
    expect(presentScopeCodes(GENEL_DAVA)).toEqual(
      new Set(["DAVA_ACMA", "DAVAYI_TAKIP", "AHZU_KABZ"]),
    );
  });

  it("kodu olmayan maddeleri atar", () => {
    const { items } = parseScopeItems(JSON.stringify([{ label: "kodsuz" }, { code: "SULH" }]));
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe("SULH");
  });
});

describe("computeMissingScopes — dosya türüne göre eksik yetki", () => {
  it("present=false işaretli yetki 'olası eksik' listesine düşer", () => {
    const result = computeMissingScopes("DAVA", GENEL_DAVA);
    const commonly = result.missingCommonlyNeeded.map((d) => d.code);
    expect(result.present).toContain("DAVA_ACMA");
    expect(commonly).toContain("SULH");
    expect(result.missingBaseline).toEqual([]);
  });

  it("'açıkça yok' ile 'kayıt yok' AYRILIR — yanlış alarm üretilmez", () => {
    const result = computeMissingScopes("DAVA", GENEL_DAVA);
    // SULH listede var ve present:false → güvenilir "yok".
    const sulh = result.missingExpected.find((e) => e.definition.code === "SULH");
    expect(sulh?.explicitlyAbsent).toBe(true);
    expect(result.explicitlyAbsent).toContain("SULH");

    // FERAGAT/KABUL de present:false; TEMYIZ_ISTINAF hiç listelenmemiş.
    const temyiz = result.missingExpected.find((e) => e.definition.code === "TEMYIZ_ISTINAF");
    expect(temyiz?.explicitlyAbsent).toBe(false);
    expect(result.explicitlyAbsent).not.toContain("TEMYIZ_ISTINAF");
  });

  it("hiç madde kaydı olmayan vekaletnamede TEK BİR 'açıkça yok' bile bulunmaz", () => {
    const result = computeMissingScopes("DAVA", JSON.stringify([]));
    expect(result.explicitlyAbsent).toEqual([]);
    expect(result.missingExpected.every((e) => e.explicitlyAbsent === false)).toBe(true);
  });

  it("çekirdek ve olası beklentiler tier ile ayrılır", () => {
    const result = computeMissingScopes("ICRA", JSON.stringify([]));
    const icra = result.missingExpected.find((e) => e.definition.code === "ICRA_TAKIBI");
    const tahsil = result.missingExpected.find((e) => e.definition.code === "TAHSIL");
    expect(icra?.tier).toBe("CEKIRDEK");
    expect(tahsil?.tier).toBe("OLASI");
  });

  it("icra dosyasında icra takibi yetkisi yoksa KRİTİK eksik olur", () => {
    const result = computeMissingScopes("ICRA", GENEL_DAVA);
    expect(result.missingBaseline.map((d) => d.code)).toContain("ICRA_TAKIBI");
  });

  it("danışmanlıkta dava/takip yetkisi ARANMAZ", () => {
    const result = computeMissingScopes("DANISMANLIK", JSON.stringify([]));
    expect(result.missingBaseline).toEqual([]);
    expect(result.missingCommonlyNeeded).toEqual([]);
  });

  it("kapsam kaydı bozuksa parsed bayrağı taşınır", () => {
    expect(computeMissingScopes("DAVA", "{bozuk").scopeParsed).toBe(false);
  });

  it("her dosya türü için beklenti tanımlıdır", () => {
    for (const type of ["DAVA", "ICRA", "ARABULUCULUK", "CEZA", "DANISMANLIK"] as const) {
      expect(CASE_TYPE_SCOPE_EXPECTATIONS[type]).toBeDefined();
    }
  });
});

describe("scanScopeTextForCodes — yalnız ÖNERİ üretir", () => {
  it("klasik genel dava vekaletnamesi metninden yetkileri çıkarır", () => {
    const text =
      "dava açmaya ve davayı takibe, icra takibi yapmaya, ahzu kabza, sulh ve ibraya, " +
      "temyiz ve istinaf yoluna başvurmaya yetkili olmak üzere";
    const hits = scanScopeTextForCodes(text);
    expect(hits).toContain("DAVA_ACMA");
    expect(hits).toContain("AHZU_KABZ");
    expect(hits).toContain("SULH");
    expect(hits).toContain("ICRA_TAKIBI");
  });

  it("boş metinde boş liste döner", () => {
    expect(scanScopeTextForCodes(null)).toEqual([]);
    expect(scanScopeTextForCodes("   ")).toEqual([]);
  });

  it("OLUMSUZ ifadeyi ayırt EDEMEZ — bu yüzden sonucu hiçbir yere yazılmaz", () => {
    // Bu test bir kusuru değil, BİLİNÇLİ SINIRI belgeler: tarama yalnızca
    // avukata "şu kelimeler geçiyor" der; kaydı avukat işaretler.
    const hits = scanScopeTextForCodes("sulh olmaya yetkili değildir");
    expect(hits).toContain("SULH");
  });
});
