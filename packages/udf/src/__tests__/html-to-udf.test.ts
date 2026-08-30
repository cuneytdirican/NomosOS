import { describe, expect, it } from "vitest";

import { createUdf } from "../builder";
import { htmlToUdf, markdownToUdf, parseInlineMarkdown } from "../html-to-udf";
import { readUdf } from "../parser";

describe("htmlToUdf", () => {
  it("başlık ve paragrafı ayrı UDF paragraflarına çevirir", () => {
    const doc = htmlToUdf("<h1>DİLEKÇE</h1><p>Merhaba dünya.</p>");
    expect(doc.paragraphs).toHaveLength(2);
    expect(doc.paragraphs[0].text).toBe("DİLEKÇE");
    expect(doc.paragraphs[0].style?.bold).toBe(true);
    expect(doc.paragraphs[0].layout?.alignment).toBe("center");
    expect(doc.paragraphs[1].text).toBe("Merhaba dünya.");
  });

  it("kalın ve italik satır içi biçimleri doğru offsetlerle run'a çevirir", () => {
    const doc = htmlToUdf("<p>Merhaba <strong>dünya</strong> ve <em>hoşça kal</em>.</p>");
    const paragraph = doc.paragraphs[0];
    expect(paragraph.text).toBe("Merhaba dünya ve hoşça kal.");
    expect(paragraph.runs?.[0]).toEqual({ startOffset: 8, length: 5, style: { bold: true } });
    expect(paragraph.runs?.[1]).toEqual({ startOffset: 17, length: 9, style: { italic: true } });
    // Offsetler metin içindeki gerçek konumu göstermeli.
    expect(paragraph.text.slice(8, 13)).toBe("dünya");
    expect(paragraph.text.slice(17, 26)).toBe("hoşça kal");
  });

  it("Türkçe karakterli HTML varlıklarını çözer", () => {
    const doc = htmlToUdf("<p>&Ccedil;a&gbreve;r&inodot; &amp; &uuml;cret</p>");
    expect(doc.paragraphs[0].text).toBe("Çağrı & ücret");
  });

  it("listeleri madde imli paragraflara çevirir", () => {
    const doc = htmlToUdf("<ul><li>Bir</li><li>İki</li></ul><ol><li>Üç</li><li>Dört</li></ol>");
    expect(doc.paragraphs.map((p) => p.text)).toEqual(["• Bir", "• İki", "1. Üç", "2. Dört"]);
    expect(doc.paragraphs[0].layout?.leftIndent).toBeGreaterThan(0);
  });

  it("imza bloğunu sağa yaslar", () => {
    const doc = htmlToUdf('<div class="imza"><p>Davacı Vekili</p><p>Av. Ayşe Yılmaz</p></div>');
    expect(doc.paragraphs).toHaveLength(2);
    expect(doc.paragraphs.every((p) => p.layout?.alignment === "right")).toBe(true);
  });

  it("hizalama sınıflarını ve stil özniteliğini okur", () => {
    const doc = htmlToUdf(
      '<p class="text-center">Ortalı</p><p style="text-align: justify">İki yana</p>',
    );
    expect(doc.paragraphs[0].layout?.alignment).toBe("center");
    expect(doc.paragraphs[1].layout?.alignment).toBe("justify");
  });

  it("<br> etiketini paragraf sonu olarak işler ve script/style içeriğini atar", () => {
    const doc = htmlToUdf("<style>p{color:red}</style><p>A<br>B</p><script>var x=1;</script>");
    expect(doc.paragraphs.map((p) => p.text)).toEqual(["A", "B"]);
  });

  it("HTML → UDF → geri okuma zincirinde metni korur", async () => {
    const doc = htmlToUdf("<h2>KONU</h2><p>Şüpheli hakkında <b>takipsizlik</b> kararı.</p>");
    const parsed = await readUdf(await createUdf(doc));
    expect(parsed.paragraphs.map((p) => p.text)).toEqual([
      "KONU",
      "Şüpheli hakkında takipsizlik kararı.",
    ]);
  });
});

describe("markdownToUdf", () => {
  it("başlık, paragraf ve madde imlerini çevirir", () => {
    const doc = markdownToUdf("# BAŞLIK\n\nNormal **kalın** metin.\n- madde");
    expect(doc.paragraphs[0].text).toBe("BAŞLIK");
    expect(doc.paragraphs[0].style?.bold).toBe(true);
    expect(doc.paragraphs[1].text).toBe("");
    expect(doc.paragraphs[2].text).toBe("Normal kalın metin.");
    expect(doc.paragraphs[2].runs?.[0]).toEqual({
      startOffset: 7,
      length: 5,
      style: { bold: true },
    });
    expect(doc.paragraphs[3].text).toBe("• madde");
  });

  it("numaralı listede run offsetlerini madde imi kadar kaydırır", () => {
    const doc = markdownToUdf("1. **Önemli** madde");
    expect(doc.paragraphs[0].text).toBe("1. Önemli madde");
    expect(doc.paragraphs[0].runs?.[0]).toEqual({
      startOffset: 3,
      length: 6,
      style: { bold: true },
    });
    expect(doc.paragraphs[0].text.slice(3, 9)).toBe("Önemli");
  });

  it("parseInlineMarkdown kalın/italik işaretlerini ayıklar", () => {
    const result = parseInlineMarkdown("a **b** c *d*");
    expect(result.text).toBe("a b c d");
    expect(result.runs).toEqual([
      { startOffset: 2, length: 1, style: { bold: true } },
      { startOffset: 6, length: 1, style: { italic: true } },
    ]);
  });
});
