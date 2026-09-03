# NomosOS — Dalga 7: Referans Veri Kataloğu Kapanışı (2026-09-03)

İlke: **kullanıcı varlıkları elle girilmez — katalogdan seçilir**; kataloglar
sistem tarafında yönetilir. Envanter (şema + formlar okundu, tahmin yok):

## 0. Mevcut durum (kanıtlı)

| Varlık | Katalog | Yönetim | Kullanım |
|---|---|---|---|
| Mahkeme / icra dairesi | JudicialBody (SEED→SYNC→MANUAL) | platform `/yargi` CRUD + senkron | Dosyalar + icra formları seçici (serbest metin yedeğiyle) |
| Noterlik | NotaryOffice (aynı hiyerarşi) | platform CRUD | vekaletname formu seçici |
| Vekaletname yetki kalemleri | PoaScopeCatalog | kod kataloğu (testli) | seçim |
| Gider kategorisi (İİK) | sabit küme HARC/BILIRKISI/… | kod | seçim |
| Finans hareket türü | enum | kod | seçim |
| Duruşma türü | enum | kod | seçim |
| **Konkordato/iflas mahkemesi** | — | — | **SERBEST METİN** (D4 konkordato formu — katalog vardı, bağlanmadı) |
| **Mahkeme kategorisi TİCARET** | **YOK** | — | konkordato/iflas Asliye TİCARET mahkemesinde görülür; kategoride yok |
| **Vergi dairesi** | — | — | **SERBEST METİN** (müvekkil kartı) |

## 1. Yapılacaklar

### M1. Konkordato/iflas mahkemesi seçime bağlanır
- `MAHKEME_CATEGORIES`'e `TICARET` eklenir (Asliye Ticaret Mahkemeleri —
  konkordato m.285+ ve iflas m.154+ mercii); seed'e örnekler girilir.
- JudicialBodyPicker'a isteğe bağlı `category` süzgeci; konkordato formundaki
  serbest metin mahkeme girişi seçiciyle değişilir (serbest metin yedeği
  korunur — katalog yaklaşıktır, çalışma durmaz).

### M2. Vergi dairesi kataloğu (TaxOffice)
- Model `TaxOffice` (name, il, ilce?, isActive, source SEED|SYNC|MANUAL) +
  migration; JudicialBody deseniyle AYNI hiyerarşi.
- Platform: GET/POST/PATCH `/judicial` modülü altında vergi dairesi CRUD'u.
- Kiracı: `GET /judicial/tax-offices?il=` listesi.
- Web: TaxOfficePicker (aynı desen); müvekkil kartı vergi dairesi alanı
  seçime bağlanır (serbest metin yedeği korunur).
- Seed: temsilî büyük şehir daireleri; TAM LİSTE bilinçli olarak SYNC/MANUAL
  ile büyür (resmî VD listesi dış bağımlılıktır — sahte bütünlük üretme).

### M3. Müvekkil kategorisi (ertelendi — belgeli)
`Client.category` serbest metin. Büroya özgü segmentasyon olduğundan YÖNETİLEN
kiracı listesi olmalıdır (sabit kod listesi değil). Bu dalga dışında tutuldu;
ihtiyaç belgelendi — ayrı çalışmada kiracı bazlı segment kataloğu kurulur.

## 2. Doğrulama
Sözleşme + canlı: katalog uçları, seçiciler, TICARET süzgeci, vergi dairesi
akışı (seçim + elle giriş yedeği + platform CRUD).
