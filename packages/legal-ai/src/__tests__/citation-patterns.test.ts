import { describe, expect, it } from "vitest";

import {
  dedupeCitations,
  extractCaseLawCitations,
  extractCitations,
  extractStatuteCitations,
} from "../guards/citation-patterns";

describe("atıf biçimi tanıma", () => {
  it("Yargıtay künyesini kaynak, daire, esas ve karar numarasıyla yakalar", () => {
    const found = extractCaseLawCitations(
      "Nitekim Yargıtay 9. HD 2023/1234 E. 2024/5678 K. sayılı ilamında da bu husus vurgulanmıştır.",
    );
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe("YARGITAY");
    expect(found[0].chamber).toBe("9. HD");
    expect(found[0].esasNo).toBe("2023/1234");
    expect(found[0].kararNo).toBe("2024/5678");
    expect(found[0].raw).toContain("Yargıtay 9. HD");
  });

  it("kısaltmalı ve ters sıralı (E. .../K. ...) kalıpları yakalar", () => {
    const short = extractCaseLawCitations("Yarg. 9. HD 2023/4512 E. 2023/9981 K.");
    expect(short[0].source).toBe("YARGITAY");
    expect(short[0].esasNo).toBe("2023/4512");

    const reversed = extractCaseLawCitations("Danıştay 10. Daire E. 2021/456, K. 2022/789");
    expect(reversed).toHaveLength(1);
    expect(reversed[0].source).toBe("DANISTAY");
    expect(reversed[0].chamber).toBe("10. Daire");
    expect(reversed[0].kararNo).toBe("2022/789");
  });

  it("BAM ve AYM künyelerini ayırt eder", () => {
    const bam = extractCaseLawCitations("BAM İst. 27. HD 2024/412 E. 2024/900 K.");
    expect(bam[0].source).toBe("BAM");
    expect(bam[0].chamber).toBe("27. HD");

    const aym = extractCaseLawCitations("Anayasa Mahkemesi 2019/1234 E. 2021/5678 K.");
    expect(aym[0].source).toBe("AYM");
  });

  it("aynı metindeki birden çok künyeyi ayrı ayrı, mükerrer üretmeden çıkarır", () => {
    const text =
      "Yargıtay 9. HD 2023/1234 E. 2024/5678 K. ve Yargıtay 22. HD 2021/812 E. 2021/9999 K. kararları.";
    const found = extractCaseLawCitations(text);
    expect(found).toHaveLength(2);
    expect(found[1].chamber).toBe("22. HD");
    expect(dedupeCitations([...found, ...found])).toHaveLength(2);
  });

  it("künye olmayan dosya/esas numarasını atıf saymaz (yanlış pozitif koruması)", () => {
    expect(
      extractCaseLawCitations("Dosyamız İstanbul 12. İş Mahkemesi 2026/145 esas sayılı dosyadır."),
    ).toHaveLength(0);
    expect(extractCaseLawCitations("Duruşma 14.10.2026 tarihine bırakıldı.")).toHaveLength(0);
  });

  it("mevzuat atıflarını kanun ve madde/fıkra olarak çıkarır", () => {
    const found = extractStatuteCitations(
      "HMK m.281 uyarınca, İK m.20/2 hükmü ve 4857 sayılı Kanun m.25 dikkate alınmalıdır. Ayrıca TBK m. 146 tartışılmıştır.",
    );
    const refs = found.map((c) => `${c.statuteRef}|${c.articleNo}`);
    expect(refs).toContain("HMK|281");
    expect(refs).toContain("İK|20/2");
    expect(refs).toContain("4857 sayılı|25");
    expect(refs).toContain("TBK|146");
    expect(found.every((c) => c.kind === "MEVZUAT")).toBe(true);
  });

  it("içtihat ve mevzuat atıflarını tek listede, konum sırasına göre döndürür", () => {
    const found = extractCitations(
      "HMK m.281 gereği süre verilmiştir; Yargıtay 9. HD 2023/1234 E. 2024/5678 K. de bu yöndedir.",
    );
    expect(found).toHaveLength(2);
    expect(found[0].kind).toBe("MEVZUAT");
    expect(found[1].kind).toBe("ICTIHAT");
  });
});
