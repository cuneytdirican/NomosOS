# A4 — Süre Kuralı Tamamlama + Tebligat→Süre Köprüsü

> ⬅ [F2 Yol Haritası](../00-yol-haritasi.md) · **Blok A — Yasal kapı**
> Modül spec'i: [04-sure-yonetimi](../../moduller/04-sure-yonetimi.md) · Denetim: denetim bulgusu 13
> İlerleme: **8/8** atomic (%100) · Durum: `✅ BİTTİ` *(tebligat→süre köprüsü ayağı zaten hattın tebligat sınıflandırıcısındaydı; bu turdaki iş yeni KURALLAR kümesiydi)*

## Künye

| Alan | Değer |
|---|---|
| Kimlik | `A4` |
| Blok | A — Yasal kapı |
| Öncelik | P1 |
| T-shirt boyut | S (15-30p) |
| Atomic puan toplamı | 17 |
| Engelleyen (blocked-by) | — |
| Engellediği (blocks) | `D3` (madde atıfları, yumuşak) |
| Modül spec'i | `docs/moduller/04-sure-yonetimi.md` — KK1 |
| Ürün fazı borcu | Faz 2 kural seti eksikleri (denetim bulgusu 13) |
| Denetim bulguları | 13 (backlog listesi) |
| Dokunulan paketler | `packages/legal-core` |
| Şema değişikliği | Yok |

## Neden

### Problem
Süre kuralı kataloğu yüksek riskli maddeleri içermiyordu; avukat MANUEL süre hesaplamak zorunda kalıyordu.

### Bugün ne oluyor
`rules.ts`'te 22 kural var; pazarlama "18 hazır süre kuralı" diyor (iki yerde yanlış sayı).
`PLANNED_RULE_KEYS` listesi eksikleri BELGELİYORDU ama hiçbiri yazılmamıştı:
İİK m.89 (tek kural değil ÜÇ kural — 7/7/15 gün), İİK m.33 (7 gün), HMK m.394 (1 hafta),
HMK m.317/2 (2 hafta), İİK m.363 istinaf (10 gün — Modül 04 seed tablosunda vaat edilmişti).

### Kapanınca ne değişer
İcra dosyasında haciz ihbarnamesi tebliğ edilen müvekkil için katalog üç AYRI kural önerir
(borçlu 7 gün / üçüncü kişi 7 gün / alacaklı itirazı 15 gün); `systemRulesForCaseType("ICRA")`
yedi yeni kuralı döndürür; pazarlama metni 29 sayısını taşır.

## Kapsam

- İİK m.89 üç ayrı muhatap için üç kural ekle
- İİK m.33 icranın geri bırakılması şikâyeti kuralı ekle
- İİK m.363 istinaf kuralı ekle
- HMK m.394 ihtiyati tedbire itiraz kuralı ekle
- HMK m.317/2 basit yargılama cevap kuralı ekle
- Altın vaka tablosunu ve kural sayısı eşiğini güncelle
- Pazarlama sayısını (18 → 29) iki dosyada düzelt
- PLANNED_RULE_KEYS'i boşalt, kapanmayan adayları gerekçesiyle belgele

## Kapsam Dışı

| Yapılmayacak | Neden | Nereye ait |
|---|---|---|
| İİK m.169/a ayrı kuralı | İtiraz süresi zaten m.168/5 kuralında (5 gün) | Hiç yapılmayacak |
| Islaha karşı beyan süresi | HMK'da düzenlenmemiş, mahkemece takdiren veriliyor | Hiç yapılmayacak (manuel süre) |
| Tebligat→süre otomatik köprüsü | Belge hattının tebligat sınıflandırıcısı zaten süre öneriyor | Ürün fazı 2 (mevcut) |

## Veri Modeli Değişikliği

— yok — (DeadlineRule tablosu seed'den `SYSTEM_DEADLINE_RULES`'tan beslenir; kural eklemek şema istemez.)

## Kırılım

### A4-T01 · Yedi yeni kural + altın vaka satırları  ✅

| Alan | Değer |
|---|---|
| Engelleyen | `—` |
| Engellediği | `—` |
| Puan | 17 |

Yedi kural `rules.ts`'e eklenir; her birinin `legalBasis` metni süre değeriyle birebir
uyuşur (değişmez test bunu mekanik doğrular).

#### A4-T01-S01 · Yeni kural tanımları  ✅

Yedi kural tanımı eklenir; adli tatil rejimi maddeye göre atanır.

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `A4-T01-S01-A01` | İİK m.89 üç kuralını (7/7/15 gün) ekle | `packages/legal-core/src/rules.ts` | `getSystemRule("IIK_HACIZ_IHBARNAMESI_BORCLU").durationValue` 7 döner; üç anahtar birbirinden farklı | 3 | ✅ |
| `A4-T01-S01-A02` | İİK m.33 ve m.363 kurallarını ekle | `packages/legal-core/src/rules.ts` | `IIK_ICRANIN_GERI_BIRAKILMASI` 7 gün; `IIK_ISTINAF` 10 gün | 2 | ✅ |
| `A4-T01-S01-A03` | HMK m.394 ve m.317/2 kurallarını ekle | `packages/legal-core/src/rules.ts` | `HMK_IHTIYATI_TEDBIRE_ITIRAZ` 1 hafta; `HMK_BASIT_YARGILAMA_CEVAP` 2 hafta | 2 | ✅ |
| `A4-T01-S01-A04` | PLANNED_RULE_KEYS'i boşalt, gerekçe yorumu yaz | `packages/legal-core/src/rules.ts` | Liste boş; yorum kapanmayan adayları gerekçesiyle sayıyor | 1 | ✅ |
| `A4-T01-S01-A05` | Testleri güncelle: sayı eşiği 29, altın vaka satırları, tatil rejimi | `packages/legal-core/src/__tests__/deadline-engine.test.ts` | `SYSTEM_DEADLINE_RULES` 29; yedi yeni anahtar altın vaka tablosunda; İİK kuralları `judicialRecessApplies: false` | 3 | ✅ |
| `A4-T01-S01-A06` | Pazarlama sayısını düzelt (18 → 29) | `apps/web/src/components/marketing/content.ts`<br>`docs/08-tanitim-sitesi-icerik.md` | İki dosyada da "29 hazır süre kuralı" yazar | 2 | ✅ |

## Kabul Kriterleri

1. `getSystemRule("IIK_HACIZ_IHBARNAMESI_ALACAKLI_ITIRAZ").durationValue` → 15. (`A4-T01`)
2. `SYSTEM_DEADLINE_RULES.length` → 29 ve anahtarlar tekildir. (`A4-T01`)
3. `legalBasis` içindeki süre, `durationValue`/`durationUnit` ile her yeni kuralda aynıdır. (`A4-T01`)
4. İİK kaynaklı yedi yeni kuralın hiçbirinde `judicialRecessApplies` true değildir. (`A4-T01`)
5. Tanıtım sitesi ve pazarlama içeriği "18 hazır süre kuralı" ibaresini içermez. (`A4-T01`)

## Test Yükümlülüğü

| Ne | Nerede | Neyi korur |
|---|---|---|
| `deadline-engine.test.ts` | `packages/legal-core/src/__tests__/` (mevcut, genişletildi) | Kural sayısı eşiği, altın vaka değerleri, süre-dayanak ayrışması, tatil rejimi |

## Riskler ve Açık Sorular

### Riskler
| Risk | Etki | Önlem |
|---|---|---|
| Madde metni güncel değil | Yanlış süre önerisi | Altın vaka değerleri madde metninden elle doğrulandı; her yeni kuralın `legalBasis`'i tam madde numarası taşır |

### Açık sorular
| # | Soru | Kime | Karar verilmezse |
|---|---|---|---|
| S1 | İİK m.89 üçüncü ayağının "son fıkra" numarası 5386 sonrası metinde değişti mi? | Hukuk | `legalBasis` metnindeki "m.89/son" ifadesi kalır; süre doğru olsa da atıf kesinleşmez |

## Vaat Kısıtı

> **Bu epic kapanana kadar arayüzde ve tanıtım sitesinde SÖYLENEMEZ:**
>
> - "X hazır süre kuralı" ifadesi kural sayısını GERÇEK sayıdan farklı verir
>
> **Bunun yerine söylenecek:** "29 hazır süre kuralı" (sayı `SYSTEM_DEADLINE_RULES.length` ile güncellenir)
>
> **Bugün nerede yazıyor (temizlendi):** `apps/web/src/components/marketing/content.ts` (eski "18"), `docs/08-tanitim-sitesi-icerig§i.md` (eski "18")

## Değişiklik Günlüğü

| Tarih | Ne değişti | Kim |
|---|---|---|
| 31.08.2026 | Oluşturuldu ve tamamlandı (8 atomic, 17 puan) | Aeon (F2 turu) |
