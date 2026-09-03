# Modül 01 — Müvekkil CRM

## Amaç

Benchmark ürün dava dosyası, taraflar ve "müvekkil işareti" seviyesinde kalıyor; ana yapı dava/belge/dilekçe etrafında kurulu ve **müvekkil merkezli görünüm yok**. Oysa bir hukuk bürosunun ticari gerçeği müvekkildir: sözleşme müvekkille yapılır, fatura müvekkile kesilir, vekaletname müvekkilden alınır, çıkar çatışması müvekkil üzerinden kontrol edilir.

Bu modül NomosOS'un CRM çekirdeğidir. Temel ilke: **Müvekkil ≠ tek dosya.** Bir şirket müvekkilin aynı anda 37 dava, 82 icra, 14 arabuluculuk dosyası, 6 sözleşmesi, 11 karşı tarafı, 4 sorumlu avukatı ve 2 devam eden tahsilat süreci olabilir. Tüm bu operasyon, müvekkil kartından tek bakışta görülmelidir.

Modül; gerçek/tüzel kişi ayrımını, müvekkil kartı ağacını (genel bilgiler → iletişim → vergi/banka → yetkililer → sözleşme/vekalet → dosyalar → belgeler → finans → iletişim geçmişi) ve tüm diğer modüllerin müvekkile bağlanacağı ilişki omurgasını tanımlar. Faz 1'in ilk teslim edilecek modülüdür; Case, Document, FinancialEntry gibi tüm kayıtlar `client_id` üzerinden buraya bağlanır.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, yeni bir müvekkili gerçek ya da tüzel kişi olarak tek formdan kaydetmek istiyorum ki kimlik/vergi bilgileri baştan doğru yapılansın.
2. **Avukat olarak**, müvekkil kartını açtığımda tüm dava, icra, arabuluculuk ve ceza dosyalarını tür bazında sayaçlarla görmek istiyorum ki dosya dosya aramayayım.
3. **Partner olarak**, "ABC Holding" kartında toplam tahakkuk, tahsilat ve bekleyen bakiyeyi görmek istiyorum ki müşteri görüşmesine hazır gireyim.
4. **Sekreter olarak**, müvekkilin birden fazla adresini ve yetkili kişisini (ad, unvan, telefon, e-posta) kaydetmek istiyorum ki tebligat ve iletişim karışmasın.
5. **Avukat olarak**, müvekkille yapılan her telefon/e-posta/toplantı kaydını karta işlemek istiyorum ki "davam ne oldu" aramasında geçmişi anında göreyim.
6. **Avukat olarak**, müvekkilin vekaletnamelerini kart üzerinden görüp süresi dolanları uyarı olarak almak istiyorum ki yetkisiz işlem yapmayayım.
7. **Partner olarak**, yeni müvekkil kaydında sistemin mevcut karşı taraflarla isim benzerliği taramasını (conflict check ön kontrolü) yapmasını istiyorum ki çıkar çatışmasına girmeyeyim.
8. **Admin olarak**, müvekkil verilerinin yalnızca kendi tenant'ımız içinde görünmesini istiyorum ki KVKK ve müvekkil sırrı korunsun.
9. **Stajyer olarak**, bana atanmış dosyaların müvekkillerini salt-okunur görmek istiyorum ki yetkim dışındaki finansal veriyi görmeyeyim.
10. **Avukat olarak**, tüzel müvekkilin bağlı şirketlerini karta bağlamak istiyorum ki holding yapısını tek yerden izleyeyim.

## Ekranlar ve UX

### 1. Müvekkil Listesi — `/app/clients`
Bileşenler: arama (ad/VKN/TCKN), tip filtresi (gerçek/tüzel), etiket filtresi, sorumlu avukat filtresi, tablo (ad, tip, açık dosya sayısı, bekleyen bakiye, son aktivite), "Yeni Müvekkil" butonu.

### 2. Müvekkil Kartı — `/app/clients/:id`
Sol dikey sekme ağacı + sağ içerik alanı. Sekmeler: Özet · Bilgiler · İletişim & Adresler · Yetkililer · Vekaletnameler · Sözleşmeler · Dosyalar · Belgeler · Finans · İletişim Geçmişi · Notlar.

```
┌──────────────────────────────────────────────────────────────────┐
│ ABC Holding A.Ş.  [TÜZEL]  VKN: 1234567890   Sorumlu: Av. Yılmaz │
├────────────┬─────────────────────────────────────────────────────┤
│ ▸ Özet     │  DOSYALAR: Dava 37 · İcra 82 · Arabuluculuk 14      │
│   Bilgiler │  FİNANS:  Tahakkuk 1.240.000 ₺ · Tahsil 890.000 ₺   │
│   İletişim │           Bekleyen 350.000 ₺ · Masraf 72.450 ₺      │
│   Yetkili  │  ─────────────────────────────────────────────────  │
│   Vekalet  │  YAKLAŞAN: 02.09 Duruşma (2026/145) · 05.09 İstinaf │
│   Dosyalar │  SON AKTİVİTE: 28.08 Bilirkişi raporu geldi         │
│   Finans   │  AKTİF VEKALETNAME: 3 (1 tanesi 30 gün içinde bitiyor)│
│   Geçmiş   │  [+ Dosya Aç] [+ İletişim Kaydı] [AI Özet Hazırla]  │
└────────────┴─────────────────────────────────────────────────────┘
```

### 3. Yeni Müvekkil Formu — `/app/clients/new`
Adım 1: tip seçimi (gerçek/tüzel) → alan seti değişir. Adım 2: kimlik/vergi. Adım 3: iletişim/adres. Kayıt öncesi otomatik conflict ön taraması sonucu banner olarak gösterilir.

### 4. İletişim Geçmişi — `/app/clients/:id/interactions`
Zaman akışı: tip ikonu (telefon/e-posta/toplantı/WhatsApp), tarih, kaydeden kullanıcı, özet, bağlı dosya.

## Veri Modeli

### Client
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | Zorunlu, tüm sorgular tenant-scoped |
| type | enum(REAL, LEGAL) | Gerçek / tüzel kişi |
| name | text | Tüzel: unvan; gerçek: ad soyad |
| national_id | text nullable | TCKN (gerçek kişi), maskeli gösterim |
| tax_number | text nullable | VKN (tüzel kişi) |
| tax_office | text nullable | Vergi dairesi — D7: katalogdan SEÇİLİR (TaxOffice; `/judicial/tax-offices`), serbest metin yedeğiyle |

> **D7 kataloglar (2026-09-03):** müvekkil kartındaki varlık alanları artık elle
> girilmez: **vergi dairesi** `TaxOffice` kataloğundan seçilir (temsilî seed +
> platform panelli büyüme; SEED→SYNC→MANUAL hiyerarşisi), **segment/kategori**
> kiracıya özgü `ClientSegment` kataloğundan seçilir (`GET/POST/PATCH
> /clients/segments`; liste ADMIN/PARTNER yönetir, okuma OPERASYON; pasifleştirme
> vardır, silme yoktur; adı değişen segment mevcut kayıtları taşımaz).
| mersis_no | text nullable | Tüzel kişi MERSİS |
| parent_client_id | uuid FK→Client nullable | Bağlı şirket / holding ilişkisi |
| responsible_user_id | uuid FK→User | Sorumlu avukat |
| status | enum(ACTIVE, PASSIVE, FORMER) | Eski müvekkil conflict check için saklanır |
| tags | text[] | Serbest etiketler |
| notes | text | |
| created_at / updated_at | timestamptz | |

### ClientContact (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| client_id | uuid FK→Client | |
| kind | enum(PHONE, EMAIL, ADDRESS, IBAN, KEP) | |
| label | text | "Merkez", "Tebligat adresi", "Muhasebe" |
| value | text | KVKK: PII sınıfı alan |
| is_primary | bool | |

### ClientRepresentative (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| client_id | uuid FK→Client | |
| full_name | text | Yetkili / ilgili kişi |
| title | text | Unvan (Genel Müdür, Muhasebe Md.) |
| phone / email | text | |
| is_signatory | bool | İmza yetkilisi mi |

### ClientInteraction (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| client_id | uuid FK→Client | |
| case_id | uuid FK→Case nullable | İlgili dosya |
| user_id | uuid FK→User | Kaydeden |
| channel | enum(PHONE, EMAIL, MEETING, WHATSAPP, SMS, OTHER) | |
| occurred_at | timestamptz | |
| summary | text | |

### ClientMergeLog (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| surviving_client_id | uuid FK→Client | Kalan kart |
| merged_client_id | uuid FK→Client | Birleştirilen (pasifleşen) kart |
| moved_refs | jsonb | Taşınan kayıt sayıları {cases, documents, entries...} |
| merged_by / merged_at | uuid / timestamptz | PARTNER onayı zorunlu |

Mevcut şemayla bağlar: `Case.client_id`, `PowerOfAttorney.client_id`, `FinancialEntry.client_id`, `Document.client_id` (dosyasız müvekkil belgesi için).

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| CLIENT_SUMMARY | client_id → anlaşılır Türkçe müvekkil durum özeti (dosyalar, son gelişmeler, finans) | Client + Case başlıkları + son TimelineEvent'ler + finans toplamları | TCKN/IBAN maskelenerek gönderilir; tenant'ın AiProviderConfig'i kullanılır |
| CONFLICT_PRESCAN | yeni müvekkil adı/VKN → isim benzerliği + karşı taraf eşleşme listesi (skorlu ÖNERİ) | Client (FORMER dahil) + CaseParty adları | Yalnızca ad/unvan gönderilir, kimlik numarası gönderilmez |
| CLIENT_BRIEF_DRAFT | client_id + dönem → müvekkile gönderilecek bilgilendirme taslağı | Seçili dosyaların safahatı | Taslak avukat onayı olmadan gönderilmez |

## İş Kuralları

1. `type=REAL` iken `tax_number` boş olabilir, `national_id` girildiyse 11 hane + algoritma doğrulaması yapılır; `type=LEGAL` iken `tax_number` (10 hane) zorunludur.
2. Aynı tenant içinde aynı `national_id` veya `tax_number` ile ikinci müvekkil açılamaz; mevcut kart önerilir.
3. Müvekkil silinemez; yalnızca `status=PASSIVE/FORMER` yapılır (conflict check ve arşiv bütünlüğü için).
4. Açık dosyası (`Case.status != CLOSED`) olan müvekkil FORMER yapılamaz.
5. Her müvekkil kaydında CONFLICT_PRESCAN otomatik tetiklenir; sonuç yalnızca uyarıdır, kaydı engellemez — engelleme kararı avukatındır.
6. STAJYER ve SEKRETER rolleri Finans sekmesini göremez (alan bazlı yetki).
7. `parent_client_id` döngü oluşturamaz (A→B→A yasak).
8. Tüm müvekkil okuma/yazma işlemleri AuditLog'a yazılır (KVKK erişim kaydı).
9. Kartta gösterilen dosya/finans sayaçları gerçek zamanlı sorgudan gelir, denormalize kopya tutulmaz (Faz 1).
10. Mükerrer kayıt birleştirme yalnızca PARTNER/ADMIN yetkisiyle yapılır; tüm bağlı kayıtlar (Case, Document, FinancialEntry, Interaction, PowerOfAttorney) kalan karta taşınır, birleştirilen kart PASSIVE olur ve ClientMergeLog + AuditLog kaydı düşer. Birleştirme geri alınamaz; onay diyaloğunda taşınacak kayıt sayıları gösterilir.
11. `is_primary` işareti kind başına tek kayıtta olabilir (tek birincil telefon/adres); yeni birincil seçimi eskisini otomatik düşürür.

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET | /api/v1/clients | Liste + filtre (type, status, q, responsible_user_id) |
| POST | /api/v1/clients | Yeni müvekkil (conflict ön taraması sonucu response'ta) |
| GET | /api/v1/clients/:id | Kart detay |
| PATCH | /api/v1/clients/:id | Güncelle |
| GET | /api/v1/clients/:id/summary | Özet sekmesi sayaçları (dosya/finans/yaklaşan) |
| GET | /api/v1/clients/:id/cases | Müvekkilin tüm dosyaları (tür filtresiyle) |
| GET/POST | /api/v1/clients/:id/contacts | İletişim/adres kayıtları |
| GET/POST | /api/v1/clients/:id/representatives | Yetkililer |
| GET/POST | /api/v1/clients/:id/interactions | İletişim geçmişi |
| POST | /api/v1/clients/:id/ai/summary | CLIENT_SUMMARY görevi başlat |
| GET | /api/v1/clients/:id/merge-preview?source= | **D6** — taşınacak kayıt sayıları (kural 10: onay diyaloğunda gösterilir) |
| POST | /api/v1/clients/:id/merge | `{sourceClientId}` — **D6** mükerrer birleştirme (kural 10; geri alınamaz) |
| POST | /api/v1/clients/duplicate-check | **D6-B** — canlı mükerrer tespiti (ad benzerliği + kimlik/e-posta/telefon; UYARI, engel değil) |

> **D6 uygulama notu (2026-09-03):** birleştirme KODLANIP canlı doğrulandı — 16
> ilişki tek işlemde taşınır (cases, contacts, vekaletname, finans, ücret
> sözleşmesi, randevu, zaman kaydı, fatura, ödeme, portal hesabı/daveti/yayını,
> iletişim kaydı, giden/gelen mesaj, sözleşme), kaynak kart PASİFLEŞİR
> (silinmez), `ClientMergeLog` + `CLIENT_MERGE` denetim izi yazılır. Tespit
> (D6-B) deterministiktir (AI yoktur): Türkçe normalizasyon + hukuki ek
> ayıklama + Jaro-Winkler; eşik 0.90 ampirik ölçüldü (yanlış pozitifler
> 0.841–0.890 eşiğin altında, yazım hataları 0.94–1.00 üstünde). Tam TCKN/VKN
> eşleşmesi create'te 409 ile kaydı ENGELLEMAYA devam eder.

## Diğer Modüllerle İlişkiler

- **02 Dava**: her Case bir Client'a bağlıdır; kartın Dosyalar sekmesi Case listesinden beslenir.
- **05 İcra**: icra dosyaları da Case (type=ENFORCEMENT) olarak kartta sayılır.
- **06 Belge**: müvekkile ait dosyasız belgeler (`Document.client_id`) kartın Belgeler sekmesinde.
- **07 Görev**: müvekkil bazlı görev filtresi (ör. "ABC Holding'in açık görevleri").
- **Vekaletname (Gereksinim 13)**: PowerOfAttorney kayıtları kartın Vekalet sekmesinde; bitiş uyarıları Süre Motoru'na Deadline olarak yazılır.
- **Finans (Gereksinim 9)**: FinancialEntry toplamları Özet ve Finans sekmesini besler.
- **Conflict Check (Gereksinim 12)**: CONFLICT_PRESCAN bu modülün tam sürümünün ön adımıdır.

## Kabul Kriterleri

1. Gerçek kişi müvekkil TCKN doğrulamasıyla, tüzel kişi VKN zorunluluğuyla kaydedilebiliyor.
2. Aynı VKN ile ikinci kayıt denemesi 409 + mevcut kart referansı döndürüyor.
3. Müvekkil kartı Özet sekmesi; dava/icra/arabuluculuk sayaçlarını ve tahakkuk/tahsilat/bekleyen tutarlarını tek istekte (`/summary`) getiriyor.
4. 100+ dosyalı müvekkil kartı özeti < 1 sn'de yükleniyor (sayaç sorguları indeksli).
5. Yeni müvekkil kaydında karşı taraf listesinde birebir unvan eşleşmesi varsa uyarı banner'ı görünüyor.
6. STAJYER rolüyle girildiğinde Finans sekmesi hem UI'da gizli hem API'de 403.
7. Müvekkil DELETE ucu yok; FORMER yapılan müvekkil listede filtreyle görünür, dosya geçmişi korunur.
8. Farklı tenant'ın müvekkil id'siyle yapılan GET 404 döndürüyor (tenant izolasyon testi).
9. CLIENT_SUMMARY çıktısında maskelenmemiş TCKN/IBAN bulunmadığı test ediliyor.
10. İletişim kaydı dosyaya bağlandığında ilgili Case'in TimelineEvent akışında görünüyor.
11. Merge işlemi sonrası birleştirilen kartın tüm dosyaları kalan kartta listeleniyor, eski kart PASSIVE ve ClientMergeLog'da taşınan kayıt sayıları doğru.
12. AVUKAT rolüyle merge ucu 403 döndürüyor.

## Faz

**Faz 1.** Çekirdek CRM (Client, Contact, Representative, Interaction, kart ekranları) Faz 1'de; CONFLICT_PRESCAN AI görevi ve bağlı şirket grafiği Faz 2'de tamamlanır.
