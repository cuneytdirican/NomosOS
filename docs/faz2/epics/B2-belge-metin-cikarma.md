# B2 — Belge Metin Çıkarma: DOCX + UDF (ilk kesit)

> ⬅ [F2 Yol Haritas](../00-yol-haritasi.md) · **Blok B — Belge ve UYAP hattı**
> Modül spec'i: [06-belge-yonetimi](../../moduller/06-belge-yonetimi.md) · Denetim: Ö-24
> İlerleme: **6/6** atomic (%100) · Durum: `✅ BİTTİ` *(bu kesit: DOCX + UDF; OCR ayrı kesittir)*

## Künye

| Alan | Değer |
|---|---|
| Kimlik | `B2` |
| Blok | B — Belge ve UYAP hattı |
| Öncelik | P0 (kritik yol: B4 UYAP bunu bekliyor) |
| T-shirt boyut | M (bu kesit S) |
| Atomic puan toplamı | 14 (kesit) |
| Engelleyen (blocked-by) | `B1` (yumuşak — senkron hat bu kesitte yeterli) |
| Engellediği | `B4` (taranmış evrak okuma) |
| Modül spec'i | `docs/moduller/06-belge-yonetimi.md` — KK2 |
| Ürün fazı borcu | Ö-24 (OCR vaat kısıtı) |
| Denetim bulguları | Ö-24 |
| Dokunulan paketler | `apps/api`, `apps/web`, `packages/db` (bağımlılık: jszip) |
| Şema değişikliği | Yok |

## Neden

### Problem
Yüklenen bir DOCX veya UDF "saklandı ama okunmadı" diyordu; hattın 7 adımından 6'sı çalışmıyordu.

### Bugün ne oluyor
`text-extract.ts` DOCX ve UDF için `GEREKSIZ` + "Faz 3 kapsamındadır" notu döndürüyor.
Yol haritası bunları "ucuz kazanç" sayar: DOCX bir zip + `word/document.xml` içindeki
`<w:t>` düğümleri; UDF `@nomosos/udf` parser'ı (kurulu) ile `content.xml` CDATA metni.

### Kapanınca ne değişer
DOCX ve UDF yükleyen avukat için hat TAM çalışır: metin çıkar, sınıflandırma ve süre
tespiti çalışır, öneriler onay kuyruğuna düşer. Yükleme ekranı kısıt notunu güncel listeyi yansıtır.

## Kapsam

- DOCX çıkarıcı yaz (jszip + `word/document.xml`)
- UDF çıkarıcı yaz (`readUdf` + `rawText` PII sözleşmesi)
- Yükleme ekranı kısıt notunu güncelle
- Regresyon testleri yaz (gerçek arşivlerle)

## Kapsam Dışı

| Yapılmayacak | Neden | Nereye ait |
|---|---|---|
| OCR (taranmış görüntü / metin katmansız PDF) | Ürün-politika kararı (kendi barındırılan OCR) + büyük kesit; vaat kısıtı sürer | `B2` ikinci kesit |
| DOCX üstveri/biçim koruma | Hattın işi belgenin METNİDİR | Hiç yapılmayacak |
| `doc` (eski ikili biçim) | jszip ile açılamaz | Hiç yapılmayacak |

## Veri Modeli Değişikliği

— yok —

## Kırılım

### B2-T01 · DOCX + UDF çıkarıcıları  ✅

| Alan | Değer |
|---|---|
| Engelleyen | `—` |
| Engeldiği | `B4` |
| Puan | 14 (kesit) |

#### B2-T01-S01 · Çıkarıcılar  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `B2-T01-S01-A01` | jszip bağımlılığını ekle | `apps/api/package.json` | `pnpm --filter @nomosos/api exec tsc --noEmit` temiz; jszip ithalatı derlenir | 1 | ✅ |
| `B2-T01-S01-A02` | `extractFromDocx` yaz: paragraf sonu \n ile taşınır, XML kaçışları çözülür | `apps/api/src/pipeline/text-extract.ts` | `<w:t>` içerikleri birleşir; `&amp;` → `&`; görsel içerikli DOCX BASARISIZ döner (metin uydurulmaz) | 3 | ✅ |
| `B2-T01-S01-A03` | `extractFromUdf` yaz: `readUdf` + `rawText` | `apps/api/src/pipeline/text-extract.ts` | CDATA ham metni döner; `parseWarnings` notta taşınır; boş arşiv BASARISIZ | 3 | ✅ |
| `B2-T01-S01-A04` | Yükleme ekranı kısıt notunu güncelle | `apps/web/src/components/documents-tab.tsx` | Not "metin katmanı olan PDF, Word (DOCX), UDF ve düz metin" listesini taşır | 1 | ✅ |

#### B2-T01-S02 · Testler  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `B2-T01-S02-A01` | Gerçek arşivlerle regresyon testleri yaz | `apps/api/src/pipeline/text-extract.test.ts` (yeni) | Dokuz test: DOCX paragraf/kaçış/boş-belge, UDF rawText, TXT ve görsel davranışı, üst sınır | 3 | ✅ |

## Kabul Kriterleri

1. Üç paragraflık gerçek DOCX arşivinden çıkan metin paragrafları `\n` ile taşır. (`B2-T01`)
2. `&amp;` `&` olarak çözülür. (`B2-T01`)
3. Yalnızca görsel içeren DOCX `BASARISIZ` döner ve `text` tanımsızdır. (`B2-T01`)
4. `createUdf` ile üretilmiş arşivden `rawText` okunur ve çıktı `TAMAM`dır. (`B2-T01`)
5. Görsel (JPEG) yüklemesi hâlâ `BASARISIZ` döner — OCR vaadi yok. (`B2-T01`)
6. `MAX_EXTRACTED_TEXT_CHARS` 200.000'dir. (`B2-T01`)

## Test Yükümlülüğü

| Ne | Nerede | Neyi korur |
|---|---|---|
| `text-extract.test.ts` | `apps/api/src/pipeline/` (yeni) | DOCX/UDF çıkarımının geri dönmesi, metin uydurulmaması, üst sınır |

## Riskler ve Açık Sorular

### Riskler
| Risk | Etki | Önlem |
|---|---|---|
| Yabancı üretici DOCX'lerde standart dışı yapı | Metin eksik çıkar | Paragraf başına birleşim; 40 karakter altı metin BASARISIZ sayılır |

### Açık sorular
| # | Soru | Kime | Karar verilmezse |
|---|---|---|---|
| S1 | OCR kendi barındırılan motor mu, kiracı bazlı bulut mu? | Ürün + Hukuk | OCR kesiti açılamaz; Ö-24 vaat kısıtı sürer |

## Ürün Kararı (otonom, 31.08.2026): OCR

**Karar: KENDİ BARINDIRILAN OCR.** Bulut OCR ASLA kullanılmaz — belge içeriği
taranmış evraktır; vekâlet konusu dava içeriğini üçüncü taraf bulut hizmetine
göndermek hem KVKK hem meslek sırrı (Avukatlık K. m.36) açısından savunulamaz.

Teknik seçim (uygulama kesitinin şartnamesı):
1. **Motor:** `tesseract.js` (WASM, süreç içinde — dış ağ çağrısı YOK).
2. **Dil verisi:** Türkçe `traineddata` İMAJA PAKETLENİR; çalışma zamanında
   CDN'den indirilmez (varsayılan `langPath` engellenir — veri yerleşikliği).
3. **Doğruluk kapısı:** doğrulanabilir sayfa başına en az %90 karakter güveni
   altındaki sayfa "okunamadı" sayılır — düşük güvenli metin uydurma metinden
   farksızdır; KURAL DEĞİŞMEZ: metin uydurulmaz.
4. **Maliyet:** OCR işi B1 kuyruğunda koşar (bloklayan CPU işi), krediye
   bağlanmaz (belge hattı ücretsizdir — ürün kararı).
5. **Vaat:** motor canlıya alınana kadar arayüz/pazarlama "taranmış evrak
   yükleyin sistem okur" DEMEZ (Ö-24 kısıtı sürer; yükleme ekranı notu).

Bu karar verildi; uygulama bir sonraki kesittir.

## Vaat Kısıtı

> **Bu epic kapanana kadar arayüzde ve tanıtım sitesinde SÖYLENEMEZ:**
>
> - "Taranmış evrakınızı yükleyin, sistem okur" (OCR yok)
> - "Her belge biçimini okuruz" (doc/eml yok)
>
> **Bunun yerine söylenecek:** "Metin katmanı olan PDF, Word (DOCX), UDF ve düz metin okunur"
>
> **Bugün nerede yazıyor (güncellendi):** `apps/web/src/components/documents-tab.tsx` kısıt notu

## Değişiklik Günlüğü

| Tarih | Ne değişti | Kim |
|---|---|---|
| 31.08.2026 | Oluşturuldu; ilk kesit (DOCX + UDF, 6 atomic, 14 puan) tamamlandı | Aeon (F2 turu) |
