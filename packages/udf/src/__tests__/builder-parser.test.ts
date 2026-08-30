import { describe, expect, it } from "vitest";

import { buildContentXml, computeLayout, createUdf, normalizeDocument } from "../builder";
import { UdfParseError, parseContentXml, readContentXml, readUdf } from "../parser";
import { UDF_CONTENT_ENTRY } from "../spec";
import type { UdfDocument } from "../types";
import { udfTextForPiiScan, udfToPlainText } from "../index";

function doc(paragraphs: UdfDocument["paragraphs"]): UdfDocument {
  return normalizeDocument({ metadata: {}, defaultStyle: {}, paragraphs });
}

describe("computeLayout — offset hesabı", () => {
  it("paragrafları '\\n' ile birleştirir ve ayırıcıyı önceki paragrafın uzunluğuna dâhil eder", () => {
    const layout = computeLayout([{ text: "Ali" }, { text: "Veli" }]);
    expect(layout.text).toBe("Ali\nVeli");
    expect(layout.placements[0]).toMatchObject({ startOffset: 0, length: 4, textLength: 3 });
    expect(layout.placements[1]).toMatchObject({ startOffset: 4, length: 4, textLength: 4 });
  });

  it("son paragraftan sonra ayırıcı eklemez ve toplam uzunluk metin uzunluğuna eşittir", () => {
    const layout = computeLayout([{ text: "Bir" }, { text: "İki" }, { text: "Üç" }]);
    const total = layout.placements.reduce((sum, p) => sum + p.length, 0);
    expect(total).toBe(layout.text.length);
    expect(layout.text).toBe("Bir\nİki\nÜç");
  });

  it("offsetleri UTF-16 kod biriminde hesaplar (UTF-8 bayt uzunluğunu KULLANMAZ)", () => {
    const turkish = "ÇĞİÖŞÜ";
    expect(turkish.length).toBe(6);
    expect(Buffer.byteLength(turkish, "utf8")).toBe(12); // UTF-8'de 12 bayt
    const xml = buildContentXml(doc([{ text: turkish }]));
    expect(xml).toContain('length="6"');
    expect(xml).not.toContain('length="12"');
  });

  it("paragraf metnindeki satır sonlarını boşluğa çevirerek offset bütünlüğünü korur", () => {
    const layout = computeLayout([{ text: "A\nB" }]);
    expect(layout.text).toBe("A B");
    expect(layout.placements[0].length).toBe(3);
  });
});

describe("buildContentXml", () => {
  it("kök düğüm, CDATA metni ve elements bloğunu üretir", () => {
    const xml = buildContentXml(doc([{ text: "Merhaba" }]));
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<template");
    expect(xml).toContain("<![CDATA[Merhaba]]>");
    expect(xml).toContain("<elements");
    expect(xml).toContain("<paragraph");
  });

  it("metindeki ']]>' dizisini bölerek CDATA'yı bozmadan yazar", () => {
    const xml = buildContentXml(doc([{ text: "Dizi ]]> sonu" }]));
    expect(xml).toContain("]]]]><![CDATA[>");
    expect(parseContentXml(xml).paragraphs[0].text).toBe("Dizi ]]> sonu");
  });
});

describe("build → parse gidiş-dönüşü", () => {
  it("tek paragraflı belgeyi aynen geri verir", async () => {
    const source = doc([{ text: "Sayın Hâkimliğe" }]);
    const parsed = await readUdf(await createUdf(source));
    expect(parsed.paragraphs).toHaveLength(1);
    expect(parsed.paragraphs[0].text).toBe("Sayın Hâkimliğe");
  });

  it("çok paragraflı belgeyi sırasıyla geri verir", async () => {
    const texts = ["Birinci paragraf", "İkinci paragraf", "Üçüncü paragraf", ""];
    const parsed = await readUdf(await createUdf(doc(texts.map((text) => ({ text })))));
    expect(parsed.paragraphs.map((p) => p.text)).toEqual(texts);
  });

  it("Türkçe karakterleri (ç ğ ı ö ş ü İ Ğ) bozulmadan korur", async () => {
    const text = "Çağrı: ığdır şöyle üçüncü öğle — ÇĞIİÖŞÜ ve ıspanak";
    const parsed = await readUdf(await createUdf(doc([{ text }])));
    expect(parsed.paragraphs[0].text).toBe(text);
  });

  it("boş belgede paragraf üretmez", async () => {
    const parsed = await readUdf(await createUdf(doc([])));
    expect(parsed.paragraphs).toEqual([]);
  });

  it("paragraf hizalamasını korur", async () => {
    const parsed = await readUdf(
      await createUdf(
        doc([
          { text: "Ortalı", layout: { alignment: "center" } },
          { text: "Sağa", layout: { alignment: "right" } },
          { text: "İki yana", layout: { alignment: "justify" } },
        ]),
      ),
    );
    expect(parsed.paragraphs.map((p) => p.layout?.alignment)).toEqual(["center", "right", "justify"]);
  });

  it("paragraf içi kalın aralığı (run) korur", async () => {
    const source = doc([
      { text: "Kalın ve normal", runs: [{ startOffset: 0, length: 5, style: { bold: true } }] },
    ]);
    const parsed = await readUdf(await createUdf(source));
    const paragraph = parsed.paragraphs[0];
    expect(paragraph.text).toBe("Kalın ve normal");
    // İlk aralık paragrafın baskın biçmi olur, kalanı fark aralığına dönüşür.
    expect(paragraph.style?.bold).toBe(true);
    expect(paragraph.runs?.[0]).toMatchObject({ startOffset: 5, length: 10 });
    expect(paragraph.runs?.[0].style.bold).toBe(false);
  });

  it("ikinci gidiş-dönüş kararlıdır (idempotent)", async () => {
    const source = doc([
      { text: "Kalın ve normal", runs: [{ startOffset: 0, length: 5, style: { bold: true } }] },
      { text: "Düz satır", layout: { alignment: "center" } },
    ]);
    const first = await readUdf(await createUdf(source));
    const second = await readUdf(await createUdf(first));
    expect(second).toEqual(first);
  });

  it("üretilen arşiv content.xml girdisini içerir", async () => {
    const bytes = await createUdf(doc([{ text: "Test" }]));
    const xml = await readContentXml(bytes);
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(UDF_CONTENT_ENTRY).toBe("content.xml");
  });
});

describe("parser dayanıklılığı", () => {
  it("<elements> yoksa düz metni satırlara bölerek paragraf üretir", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<template format_id="1.8">
  <content><![CDATA[Bir
İki]]></content>
</template>`;
    const parsed = parseContentXml(xml);
    expect(parsed.paragraphs.map((p) => p.text)).toEqual(["Bir", "İki"]);
  });

  it("öznitelik adlarının büyük/küçük harf farkını tolere eder", () => {
    const xml =
      '<template FORMAT_ID="1.9"><content><![CDATA[Test]]></content>' +
      '<elements RESOLUTION="102"><paragraph alignment="1">' +
      '<content startoffset="0" LENGTH="4" BOLD="true"/></paragraph></elements></template>';
    const parsed = parseContentXml(xml);
    expect(parsed.metadata.formatId).toBe("1.9");
    expect(parsed.paragraphs[0].text).toBe("Test");
    expect(parsed.paragraphs[0].layout?.alignment).toBe("center");
    expect(parsed.paragraphs[0].style?.bold).toBe(true);
  });

  it("geçersiz ZIP için Türkçe hata mesajı verir", async () => {
    await expect(readUdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(UdfParseError);
    await expect(readUdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/UDF dosyası açılamadı/);
  });

  it("kök <template> düğümü olmayan XML'i reddeder", () => {
    expect(() => parseContentXml("<html><body>x</body></html>")).toThrow(UdfParseError);
  });
});

describe("KVKK: düz metin kaybı olmaz (denetim bulgusu 6)", () => {
  // `<elements>` yalnız ilk 17 kod birimini kapsıyor; ikinci satır yapı DIŞINDA kalıyor
  // (yabancı bir UDF üreticisinin eksik elements bloğu senaryosu).
  const HIDDEN_LINE = "Gizli kalan satır";
  const RAW_TEXT = `TCKN: 12345678901\n${HIDDEN_LINE}`;
  const PARTIAL_XML =
    `<template format_id="1.8"><content><![CDATA[${RAW_TEXT}]]></content>` +
    '<elements resolution="102"><paragraph startOffset="0" length="17">' +
    '<content startOffset="0" length="17"/></paragraph></elements></template>';

  it("ham CDATA metnini rawText olarak korur", () => {
    const parsed = parseContentXml(PARTIAL_XML);
    expect(parsed.rawText).toBe(RAW_TEXT);
  });

  it("paragraf kapsamı ham metnin tamamını kapsamıyorsa uyarı üretir", () => {
    const parsed = parseContentXml(PARTIAL_XML);
    expect(parsed.parseWarnings?.some((w) => w.includes("kapsamıyor"))).toBe(true);
  });

  it("PII taraması için verilen metin kapsanmayan kısmı DA içerir", () => {
    const parsed = parseContentXml(PARTIAL_XML);
    // Eski davranışta bu satır düz metinden sessizce düşüyordu:
    expect(udfToPlainText(parsed)).toContain(HIDDEN_LINE);
    expect(udfTextForPiiScan(parsed)).toContain(HIDDEN_LINE);
  });

  it("tam kapsanan belgede uyarı üretmez", () => {
    const xml = buildContentXml(doc([{ text: "Bir" }, { text: "İki" }]));
    const parsed = parseContentXml(xml);
    expect(parsed.parseWarnings).toEqual([]);
    expect(udfToPlainText(parsed)).toBe(`Bir\nİki`);
  });
});
