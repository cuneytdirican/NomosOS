# @nomosos/udf

UYAP Doküman Formatı (**UDF**) okuma/yazma kütüphanesi — NomosOS Dilekçe Stüdyosu'nun
ürettiği içeriği UYAP'a gönderilebilir belgeye çevirmek için.

> **DENEYSEL.** UDF resmî olarak yayımlanmış bir spesifikasyona sahip değildir.
> Bu paket, formatın kesin olarak bilinen kısımlarını uygular; belirsiz ayrıntılar
> kodda `// TEYİT GEREKİR:` yorumlarıyla ve aşağıdaki
> [Doğrulanması gereken varsayımlar](#doğrulanması-gereken-varsayımlar) listesinde
> işaretlenmiştir. **Üretime almadan önce gerçek bir UDF dosyası ve UYAP Editör ile
> doğrulanmalıdır.**

---

## Format özeti

Bir `.udf` dosyası, içinde `content.xml` bulunan bir **ZIP arşividir**. Gömülü
görsel/ek dosyalar arşive ayrı girdiler olarak eklenebilir.

`content.xml` kabaca şöyledir:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<template format_id="1.8">
  <content><![CDATA[ANKARA 3. ASLİYE HUKUK MAHKEMESİ
SAYIN HÂKİMLİĞİ'NE

KONU: Alacak talebimizdir.]]></content>
  <elements resolution="102">
    <paragraph Alignment="1" startOffset="0" length="32">
      <content startOffset="0" length="32" family="Times New Roman" size="12" bold="true" />
    </paragraph>
    ...
  </elements>
  <styles>
    <style name="default" family="Times New Roman" size="12" />
  </styles>
</template>
```

Yapının çalışma mantığı Java Swing `StyledDocument` ile aynıdır:

- **`<content>`** belgenin **tamamının düz metnini** tek bir CDATA bloğunda taşır.
- **`<elements>`** altındaki düğümler metnin kendisini değil, metin üzerindeki
  **`startOffset` + `length` aralıklarını** tanımlar. Paragraf sınırları ve
  yazı tipi/kalın/italik gibi biçimler bu aralıklarda taşınır.
- Paragraflar `\n` ile ayrılır; satır sonu karakteri **kendinden önceki
  paragrafın uzunluğuna dâhildir** (Swing davranışı).

### Offset birimi — UTF-16, UTF-8 değil

Bu paketteki tüm `startOffset` / `length` değerleri **UTF-16 kod birimi**
cinsindendir; yani JavaScript'te `string.length` ile birebir aynıdır. UDF Java
kökenli olduğundan Java `String` indeksleri de UTF-16 kod birimi sayar ve iki
taraf birebir örtüşür.

**UTF-8 bayt uzunluğu kullanılmaz.** Türkçe karakterler bu yüzden kritik:
`"ÇĞİÖŞÜ"` UTF-8'de **12 bayt**, offset hesabında ise **6 birimdir**. Yanlış
birim seçilirse tüm biçim aralıkları kayar. BMP dışı karakterler (emoji vb.) hem
Java'da hem JavaScript'te 2 kod birimi sayıldığı için tutarlılık bozulmaz.

---

## Kullanım

### Dilekçe şablonundan UDF üretmek

```ts
import { createPetitionUdf } from "@nomosos/udf";
import { writeFile } from "node:fs/promises";

const bytes = await createPetitionUdf({
  courtName: "Ankara 3. Asliye Hukuk Mahkemesi",
  caseNumber: "2026/1234",
  plaintiffs: [{ name: "Ahmet Yılmaz", identityNumber: "12345678901", address: "Çankaya/ANKARA" }],
  defendants: [{ name: "Örnek İnşaat A.Ş." }],
  attorney: { name: "Ayşe Demir", barName: "Ankara Barosu", barNumber: "1234" },
  subject: "Fazlaya ilişkin haklarımız saklı kalmak kaydıyla alacak talebimizdir.",
  explanations: [
    "Müvekkil ile davalı arasında 01.02.2026 tarihli sözleşme imzalanmıştır.",
    "Davalı, edimini süresinde ifa etmemiştir.",
  ],
  request: "Davanın kabulü ile alacağın davalıdan tahsiline karar verilmesini arz ve talep ederiz.",
  signerTitle: "Davacı Vekili",
});

await writeFile("dilekce.udf", bytes);
```

Üretilen bölüm sırası: **KONU → AÇIKLAMALAR → HUKUKİ SEBEPLER → DELİLLER →
SONUÇ VE İSTEM → (EKLER) → tarih + imza bloğu**.

### Dilekçe Stüdyosu HTML çıktısını çevirmek

```ts
import { createUdf, htmlToUdf, markdownToUdf } from "@nomosos/udf";

const doc = htmlToUdf(`
  <h1>ANKARA NÖBETÇİ ASLİYE HUKUK MAHKEMESİ'NE</h1>
  <p>Merhaba <strong>dünya</strong>.</p>
  <ul><li>Birinci delil</li><li>İkinci delil</li></ul>
  <div class="imza"><p>Davacı Vekili</p><p>Av. Ayşe Demir</p></div>
`);

const bytes = await createUdf(doc);
// markdown için: markdownToUdf("# BAŞLIK\n\nNormal **kalın** metin.")
```

### Mevcut bir UDF'i okumak

```ts
import { readUdf, udfToPlainText } from "@nomosos/udf";
import { readFile } from "node:fs/promises";

const doc = await readUdf(await readFile("dilekce.udf"));
console.log(doc.paragraphs.length);
console.log(udfToPlainText(doc)); // ham CDATA metni (rawText) — tam metin arama için
console.log(doc.parseWarnings);   // kapsam/yapı uyarıları (boşsa sorun yok)
```

> **KVKK — PII taraması hangi metin üzerinden yapılır?**
> Ayrıştırılan belgede ham `<content>` CDATA metni `doc.rawText` alanında korunur ve
> `udfToPlainText` öncelikle onu döndürür. Paragraflardan yeniden kurulan metin, bir
> üreticinin `<elements>` bloğu metnin tamamını kapsamıyorsa **eksik kalabilirdi**; bu
> durumda taranmamış TCKN/IBAN dış sağlayıcıya gidebilirdi. Dış LLM'e/indeksleyiciye
> gönderim öncesi `udfTextForPiiScan(doc)` kullanın: kapsam eksikse ve ham metin yoksa
> sessizce devam etmez, Türkçe hata fırlatır (docs/04 kabul kriteri 1-2).

### Belgeyi elle kurmak

```ts
import { createUdf } from "@nomosos/udf";

const bytes = await createUdf({
  metadata: { formatId: "1.8" },
  defaultStyle: { fontFamily: "Times New Roman", fontSize: 12 },
  paragraphs: [
    { text: "SAYIN HÂKİMLİĞİ'NE", style: { bold: true }, layout: { alignment: "center" } },
    { text: "" },
    {
      text: "Kalın ve normal",
      // startOffset PARAGRAF başına göre görecelidir.
      runs: [{ startOffset: 0, length: 5, style: { bold: true } }],
      layout: { alignment: "justify" },
    },
  ],
});
```

---

## API

| Dışa aktarım | Açıklama |
| --- | --- |
| `createUdf(doc, options?)` | `UdfDocument` → UDF (ZIP) baytları (`Uint8Array`) |
| `readUdf(buffer)` | UDF baytları → `UdfDocument` |
| `buildContentXml(doc)` | Yalnızca `content.xml` metnini üretir (hata ayıklama/test) |
| `parseContentXml(xml)` | Ham `content.xml` → `UdfDocument` |
| `readContentXml(buffer)` | Arşivden yalnızca `content.xml` metnini çıkarır |
| `computeLayout(paragraphs)` | Düz metin + paragraf offsetleri |
| `htmlToUdf(html, options?)` | Basit HTML → `UdfDocument` |
| `markdownToUdf(md, options?)` | Basit markdown → `UdfDocument` |
| `buildPetitionDocument(input)` | Türk dilekçe iskeleti → `UdfDocument` |
| `createPetitionUdf(input, options?)` | Dilekçe iskeleti → UDF baytları |
| `udfToPlainText(doc)` | Belgenin düz metni (ayrıştırılmışsa ham CDATA metni) |
| `udfTextForPiiScan(doc)` | PII taraması/indeksleme için metin; güvenilir değilse hata fırlatır |
| `UdfParseError` | Ayrıştırma hataları (Türkçe mesaj) |

Desteklenen HTML alt kümesi: `p, div, section, article, blockquote, pre, h1–h6,
ul/ol/li, br, strong/b, em/i, u/ins, s/del/strike, span[style|class], font, a`.
Hizalama `class="text-center"`, `style="text-align:right"`, `align="center"` ve
imza bloğu için `class="imza"` üzerinden okunur.

---

## Doğrulanması gereken varsayımlar

Aşağıdaki maddeler **gerçek bir UDF dosyası** (tercihen UYAP Editör ile
kaydedilmiş) ve UYAP'a yükleme denemesiyle doğrulanmalıdır. Kodda karşılıkları
`// TEYİT GEREKİR:` ile işaretlidir; düzeltmelerin büyük kısmı yalnızca
`src/spec.ts` içinde yapılabilir.

### Kesin bildiklerimiz

1. `.udf` bir ZIP arşividir ve ana girdi `content.xml`'dir.
2. Kök düğüm `<template>`, belgenin düz metni `<content>` altında CDATA içinde taşınır.
3. Biçim/paragraf bilgisi metnin içine gömülü değildir; `<elements>` altında
   `startOffset` + `length` aralıkları olarak tutulur.
4. Paragraf ayırıcı `\n`'dir (`\r\n` değil) ve Java `StyledDocument` semantiği geçerlidir.
5. Offsetler Java `String` indeksi, yani UTF-16 kod birimidir.

### Teyit gerektirenler

| # | Varsayım | Nerede | Risk |
| --- | --- | --- | --- |
| 1 | `format_id="1.8"` UYAP'ın kabul ettiği güncel sürümdür | `spec.ts: UDF_DEFAULT_FORMAT_ID` | Yanlış sürüm reddedilebilir |
| 2 | `<elements resolution="102">` değeri ve anlamı | `spec.ts: UDF_DEFAULT_RESOLUTION` | Ölçek/DPI hatası |
| 3 | Biçim özniteliklerinin tam adları ve harf yazımı: `family`, `size`, `bold`, `italic`, `underline`, `foreground` | `spec.ts: UDF_ATTR` | Biçimler yok sayılabilir |
| 4 | Paragraf özniteliklerinin adları: `Alignment`, `LeftIndent`, `FirstLineIndent`, `SpaceAbove`, `SpaceBelow`, `LineSpacing` | `spec.ts: UDF_ATTR` | Hizalama/girinti kaybolabilir |
| 5 | `Alignment` değerlerinin Swing sabitleriyle aynı olması (0 sol, 1 orta, 2 sağ, 3 iki yana) | `spec.ts: SWING_ALIGNMENT` | Hizalama karışır |
| 6 | `<paragraph>` üzerine yazdığımız `startOffset`/`length` özniteliklerinin UYAP tarafından sorunsuz yok sayılması | `spec.ts: EMIT_PARAGRAPH_OFFSETS` | Editör dosyayı reddedebilir → `false` yapın |
| 7 | Girinti/aralık birimleri (punto mu, piksel mi, twip mi?) | `types.ts: UdfParagraphLayout` | Yerleşim bozulur |
| 8 | `<properties><pageFormat …/>` öznitelik adları ve birimleri | `builder.ts` | Sayfa kenar boşlukları yanlış olur |
| 9 | `<styles><style …/>` düğümünün gerçek şeması ve zorunlu olup olmadığı | `builder.ts`, `parser.ts` | Varsayılan yazı tipi uygulanmayabilir |
| 10 | `foreground` renk değerinin biçimi (`#RRGGBB` / `r,g,b` / tamsayı) | `parser.ts: readStyle` | Renk yanlış çözülür |
| 11 | Son paragraftan sonra fazladan bir `\n` beklenip beklenmediği | `builder.ts: computeLayout` | Son paragraf kayabilir |
| 12 | Gömülü görsel/ek dosyaların arşiv içindeki yol ve referanslama biçimi | `types.ts: UdfExtraFile` | Ekler görünmez |
| 13 | ZIP sıkıştırma yönteminin (DEFLATE) kabul edilip edilmediği | `builder.ts: createUdf` | Arşiv açılamayabilir → `compress: false` deneyin |
| 14 | UYAP'ın imza/e-imza için ek bir arşiv girdisi bekleyip beklemediği | — | Dilekçe imzasız reddedilebilir |
| 15 | **Gerçek bir `.udf` fixture'ı ile gidiş-dönüş testi yoktur.** Bugünkü testler yalnız paketin KENDİ ürettiği XML'i geri okur; `UDF_ATTR` yazımları, `<styles>` şeması ve `EMIT_PARAGRAPH_OFFSETS` varsayımları sınanmamıştır | `src/__tests__/` | Paket, bu test geçene kadar `apps/api`'de ÜRETİM akışına bağlanmamalıdır |

### Doğrulama yolu

1. UYAP Editör ile küçük bir dilekçe kaydedin (`ornek.udf`).
2. Arşivi açıp `content.xml`'i bu paketin ürettiğiyle karşılaştırın.
3. `parseContentXml(gerçekXml)` çıktısının metni ve paragraf sınırlarını doğru
   verdiğini test edin.
4. Farklılıkları `src/spec.ts` içine taşıyın; `builder.ts`/`parser.ts` genellikle
   değişmeden kalır.

---

## Paketin durumu ve tüketicileri

Bu paket şu an **hiçbir uygulamanın bağımlılığı değildir** (denetim bulgusu: `@nomosos/udf`
tüketen satır yok). Dilekçe üretimi (Modül 22) `apps/api` tarafında yazılırken:

1. `apps/api/package.json` içine `"@nomosos/udf": "workspace:*"` eklenmelidir;
2. Bağlamadan önce yukarıdaki **15 numaralı** madde (gerçek `.udf` fixture'ı ile
   gidiş-dönüş testi) tamamlanmalıdır — paket "deneysel" etiketini bu test geçene
   kadar korur.

---

## Testler

```bash
pnpm --filter @nomosos/udf test
```

Kapsam: build→parse gidiş-dönüşü, Türkçe karakter korunumu, UTF-16 offset
hesabı, `]]>` içeren metin, boş belge, çok paragraflı belge, hizalama ve
kalın/italik aralıkların korunumu, ayrıştırıcı dayanıklılığı (eksik `<elements>`,
harf yazımı farkları, bozuk ZIP), HTML/markdown dönüşümü ve dilekçe şablonunun
bölüm başlıkları.
