# Modül 05 — İcra Modülü + İcra AI Copilot

## Amaç

Türkiye'de hukuk bürolarının işlem hacminin büyük kısmı icra takipleridir; örnek müvekkil senaryosunda 37 davaya karşılık 82 icra dosyası vardır. Benchmark ürün dava/dilekçe odaklıdır; icra, UYAP eklentisiyle belge aktarılan bir yan alan olarak kalır. NomosOS'ta icra **ayrı bir ana modüldür**: kendi yaşam döngüsü, kendi işlem günlüğü, kendi ekranları ve üzerinde çalışan **İcra AI Copilot** ile.

Modül, takip yaşam döngüsünü uçtan uca modeller: **takip talebi → ödeme emri (tebliğ) → itiraz / kesinleşme → haciz → satış → tahsilat → kapanış**. Her aşama İİK süreleriyle (7 gün itiraz vb.) Süre Motoru'na bağlıdır; her işlem (haciz talebi, müzekkere, satış talebi) yapılandırılmış EnforcementAction kaydıdır — böylece "dosyada son 20 işlemi analiz et" komutu serbest metin değil, yapılandırılmış veri üzerinde çalışır.

Copilot'un en ayırt edici çıktısı **tahsilat ihtimali skorudur**: borçlunun malvarlığı sorgu sonuçları, haciz sonuçları, ödeme davranışı ve dosya yaşından üretilen 0–100 skor, hem avukatın önceliklendirmesini hem Partner'ın portföy görünümünü (Gereksinim 18 tahsilat riski) besler.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, ilamlı/ilamsız/kambiyo takip tiplerinden birini seçerek takip dosyası açmak istiyorum ki takip talebi verileri baştan doğru yapılansın.
2. **Avukat olarak**, ödeme emri tebliğ edildiğinde 7 günlük itiraz süresinin otomatik izlenmesini istiyorum ki kesinleşme tarihini kaçırmayayım.
3. **Avukat olarak**, borçlu itiraz ettiğinde dosyanın "itiraz edildi" durumuna düşüp itirazın iptali/kaldırılması için görev önerisi almak istiyorum.
4. **Avukat olarak**, dosyadaki tüm işlemleri (haciz talebi, müzekkere, satış talebi) tarih sıralı işlem günlüğünde görmek istiyorum ki UYAP'a girmeden dosya durumunu bileyim.
5. **Avukat olarak**, "haciz aşamasında yapılabilecek işlemleri sırala" komutuyla dosya durumuna uygun aksiyon listesi almak istiyorum.
6. **Avukat olarak**, "bu dosyada tahsilat ihtimali nedir" sorusuna gerekçeli bir skor almak istiyorum ki müvekkile gerçekçi beklenti vereyim.
7. **Avukat olarak**, borçlunun itiraz dilekçeleri ile bizim cevaplarımızı yan yana karşılaştıran analiz istiyorum ki cevapsız kalan itiraz kalmasın.
8. **Partner olarak**, portföydeki icra dosyalarını tahsilat skoruna göre sıralamak istiyorum ki ekibin mesaisini tahsil edilebilir dosyalara yönlendireyim.
9. **Sekreter olarak**, tahsilat geldiğinde tutarı dosyaya işlemek istiyorum ki müvekkil bakiyesi ve finans kaydı otomatik güncellensin.
10. **Avukat olarak**, "dosyada hangi süreleri kaçırdık" denetimini çalıştırmak istiyorum ki riskleri devralınan dosyalarda hızla göreyim.

## Ekranlar ve UX

### 1. İcra Dosyaları — `/app/enforcement`
Filtreler: takip tipi, aşama, borçlu, tahsilat skoru aralığı. Tablo: dosya no, alacaklı müvekkil, borçlu, takip çıkışı, tahsil edilen, aşama, skor rozeti.

### 2. İcra Dosya Detayı — `/app/enforcement/:id`
Üstte **aşama şeridi**, altta sekmeler: Özet · Taraflar · İşlem Günlüğü · Hacizler · Süreler · Tahsilatlar · Belgeler · Görevler · Copilot.

```
┌────────────────────────────────────────────────────────────────────┐
│ İst. 7. İcra Dairesi 2026/8412 E. · İlamsız · Skor: 68/100 🟡      │
│ [Takip Talebi ✓]→[Ödeme Emri ✓]→[İtiraz ⚠]→[Haciz]→[Satış]→[Tahsil]│
├────────────────────────────────────────────────────────────────────┤
│ Takip çıkışı: 486.250 ₺   Tahsil: 120.000 ₺   Bakiye: 366.250 ₺   │
│ ⚠ İTİRAZ: Borçlu 12.08'de borca itiraz etti → İtirazın iptali      │
│   davası için son gün: 12.08.2027 (1 yıl, İİK m.67)                │
│ ── İŞLEM GÜNLÜĞÜ ────────────────────────────────────────────────  │
│ 25.08  Bankalara haciz müzekkeresi yazıldı (3 banka)               │
│ 18.08  Araç kaydına haciz şerhi işlendi                            │
│ 12.08  Borçlu itiraz dilekçesi sundu                               │
│ [+ İşlem] [🤖 Copilot] [Tahsilat Gir] [Süre Denetimi Çalıştır]     │
└────────────────────────────────────────────────────────────────────┘
```

### 3. Copilot Paneli — `/app/enforcement/:id/copilot`
Hazır komut kartları (6 komut) + serbest soru; her çıktı görev geçmişine kaydedilir, "görev öner" düğmesiyle Modül 07'ye taslak aktarılır.

### 4. Yeni Takip — `/app/enforcement/new`
Adımlar: alacaklı müvekkil → borçlu(lar) → takip tipi → alacak kalemleri (asıl, faiz başlangıcı, faiz oranı) → icra dairesi. İlamlı takipte kaynak dava dosyası (`linked_case_id`) seçilir.

## Veri Modeli

İcra dosyası çekirdekte `Case(type=ENFORCEMENT, stage→EnforcementFile.phase ile detaylanır)` olarak tutulur; icraya özgü alanlar 1:1 uzantıdadır.

### EnforcementFile (yeni, Case'e 1:1)
| Alan | Tip | Açıklama |
|------|-----|----------|
| case_id | uuid PK/FK→Case | |
| office_name | text | "İstanbul 7. İcra Dairesi" |
| enforcement_no | text | "2026/8412" |
| track_type | enum(ILAMSIZ, ILAMLI, KAMBIYO, REHIN, KIRA) | Takip tipi |
| phase | enum(TAKIP_TALEBI, ODEME_EMRI, ITIRAZ, KESINLESME, HACIZ, SATIS, TAHSILAT, KAPANIS) | |
| principal_amount | numeric | Asıl alacak |
| interest_start / interest_rate | date / numeric | Faiz başlangıcı ve oranı |
| total_claim | numeric | Takip çıkışı |
| collected_total | numeric | Tahsil edilen (CollectionRecord toplamından türetilir) |
| payment_order_notified_at | date nullable | Ödeme emri tebliğ tarihi (İİK süre girdisi) |
| objection_at | date nullable | İtiraz tarihi |
| finalized_at | date nullable | Kesinleşme |
| collection_score | int nullable | 0–100, ENF_COLLECTION_SCORE çıktısı |
| score_generated_at | timestamptz nullable | |

### EnforcementAction (yeni — işlem günlüğü)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| case_id | uuid FK→Case | |
| action_type | enum(TAKIP_TALEBI, ODEME_EMRI_TEBLIGI, ITIRAZ, ITIRAZIN_IPTALI_DAVASI, HACIZ_TALEBI, HACIZ_MUZEKKERE, HACIZ_TUTANAGI, KIYMET_TAKDIRI, SATIS_TALEBI, SATIS_ILANI, IHALE, TAHSILAT, MALVARLIGI_SORGU, DIGER) | |
| occurred_at | date | |
| description | text | |
| target | text nullable | Müzekkere muhatabı (banka, tapu, trafik) |
| result | text nullable | Sorgu/haciz sonucu ("3 araç kaydı bulundu") |
| document_id | uuid FK→Document nullable | |
| created_by | uuid FK→User nullable | UYAP senkronunda null |

### CollectionRecord (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| case_id | uuid FK→Case | |
| amount | numeric | |
| collected_at | date | |
| method | enum(ICRA_VEZNE, HARICEN, BANKA) | Haricen tahsilat harç sonucu için işaretli |
| financial_entry_id | uuid FK→FinancialEntry | Finansa otomatik yansıma |

Borçlu, `CaseParty(role=DEBTOR)` kaydıdır; alacaklı `role=CREDITOR` + `client_id`.

## Bakiye ve Faiz Hesabı (deterministik)

Faiz ve güncel bakiye, Süre Motoru ilkesiyle aynı biçimde **AI'sız, deterministik** hesaplanır:

```
guncel_bakiye(tarih):
  faiz = principal_amount × interest_rate × gün(interest_start → tarih) / 365
  toplam = principal_amount + faiz + takip_masraflari + vekalet_ucreti
  tahsilatlar tarih sırasıyla önce masraf+faize, sonra asıl alacağa mahsup edilir
  → {asil_kalan, faiz_kalan, masraf_kalan, toplam_kalan} + hesap dökümü
```
Değişken oranlar (avans faizi dönem tabloları) `InterestRatePeriod` sistem tablosundan okunur; dönem tablosu eksikse hesap uyarıyla sabit orandan yapılır ve dökümde belirtilir.

## AI Yetenekleri (İcra AI Copilot)

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| ENF_ASSET_ANALYSIS | case_id → borçlu malvarlığı ve işlemlerin analizi | MALVARLIGI_SORGU sonuçları, haciz kayıtları, action günlüğü | Borçlu TCKN/IBAN maskeli; BYO-LLM (AiProviderConfig) |
| ENF_NEXT_ACTIONS | case_id → mevcut aşamada yapılabilecek işlemler, öncelik sıralı (ÖNERİ) | phase + action günlüğü + açık süreler | Öneriler görevleşmeden avukat onayı ister |
| ENF_MISSED_DEADLINES | case_id → kaçırılmış/riskli süreler raporu | Deadline kayıtları + İİK kural seti + günlük | Modül 04 DEADLINE_AUDIT'in İİK profili |
| ENF_COLLECTION_SCORE | case_id → skor 0–100 + gerekçe maddeleri + belirsizlik notu | Malvarlığı sonuçları, haciz sonuçları, tahsilat geçmişi, dosya yaşı, borçlunun diğer dosyaları (tenant içi) | Skor ÖNERİ etiketlidir, hukuki garanti değildir; kartta bu ibare sabit |
| ENF_ACTION_LOG_ANALYSIS | case_id + n → son n işlemin özeti ve durdurulmuş süreç tespiti | EnforcementAction son n kayıt | |
| ENF_OBJECTION_COMPARE | case_id → itiraz ↔ cevap eşleştirme tablosu, cevapsız itiraz listesi | İtiraz ve cevap dilekçelerinin OCR metinleri | Metinler maskeleme hattından geçer |

## İş Kuralları

1. Aşama şeridi tek yönlüdür: TAKIP_TALEBI→ODEME_EMRI→(ITIRAZ→KESINLESME | KESINLESME)→HACIZ→SATIS→TAHSILAT→KAPANIS; ITIRAZ, itirazın iptali/kaldırılması sonucuna göre KESINLESME'ye döner.
2. `payment_order_notified_at` girildiğinde IIK_ODEME_EMRI_ITIRAZ (7 gün) kuralı Süre Motoru'nda otomatik tetiklenir; süre dolup itiraz kaydı yoksa sistem "kesinleşme adayı" uyarısı üretir — kesinleşmeyi avukat işaretler.
3. İtiraz kaydı (`action_type=ITIRAZ`) girildiğinde phase=ITIRAZ olur, takip durur; itirazın iptali davası için 1 yıllık süre (İİK m.67) MANUAL-öneri olarak açılır.
4. Satış aşamasına geçiş için en az bir HACIZ_TUTANAGI kaydı şarttır.
5. CollectionRecord toplamı `total_claim + ferileri` aşamaz; her tahsilat FinancialEntry üretir ve müvekkil kartı bakiyesine yansır.
6. `method=HARICEN` tahsilatta harç uyarısı gösterilir (tahsil harcı yükümlülüğü notu).
7. ENF_COLLECTION_SCORE en fazla 24 saatte bir yeniden hesaplanır; skoru etkileyen yeni işlem (haciz sonucu, tahsilat) girildiğinde "skor güncel değil" rozeti çıkar.
8. Copilot çıktıları hiçbir EnforcementAction/Task kaydını doğrudan oluşturmaz; "görev öner" akışı Modül 07 onayına gider.
9. KAPANIS için: bakiye 0 (tahsilat), aciz vesikası kaydı veya avukat onaylı vazgeçme gerekçesi şarttır.
10. UYAP senkronundan gelen işlemler `created_by=null` + kaynak etiketiyle yazılır ve elle silinemez.
11. Güncel bakiye her tahsilat/masraf girişinde yeniden hesaplanır; mahsup sırası (masraf→faiz→asıl) değiştirilemez ve hesap dökümü kayda eklenir.
12. Birden çok borçlulu (müteselsil) dosyada tahsilat, dosya bakiyesinden düşer; borçlu bazlı kısmi sorumluluk notu serbest metin olarak tutulur (Faz 2'de yapılandırılır).

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET/POST | /api/v1/enforcement | Liste (filtre: track_type, phase, score aralığı) / yeni takip |
| GET/PATCH | /api/v1/enforcement/:id | Detay (Case + EnforcementFile birleşik) |
| POST | /api/v1/enforcement/:id/phase | Aşama geçişi (kural 1, 4, 9) |
| GET/POST | /api/v1/enforcement/:id/actions | İşlem günlüğü |
| GET/POST | /api/v1/enforcement/:id/collections | Tahsilatlar |
| POST | /api/v1/enforcement/:id/copilot | `{command: ENF_*, params}` — copilot görevi başlat |
| GET | /api/v1/enforcement/:id/score | Güncel skor + gerekçe |
| POST | /api/v1/enforcement/:id/score/refresh | Skoru yeniden hesapla (kural 7) |
| GET | /api/v1/enforcement/:id/balance?as_of= | Güncel bakiye + hesap dökümü |
| GET | /api/v1/enforcement/portfolio-summary | Partner portföy özeti (aşama/skor dağılımı) |

## Diğer Modüllerle İlişkiler

- **01 CRM**: alacaklı müvekkil kartında icra dosyaları ve tahsilat toplamları görünür.
- **02 Dava**: ilamlı takip `linked_case_id` ile kaynak davaya bağlanır; davadaki "icra" sekmesi bu dosyayı gösterir.
- **04 Süre**: IIK_* kuralları, itiraz/istinaf süreleri ve ENF_MISSED_DEADLINES bu motor üzerinde çalışır.
- **06 Belge**: ödeme emri, haciz tutanağı vb. belge sınıfları pipeline'dan gelir; action günlüğüne belge bağlanır.
- **07 Görev**: ENF_NEXT_ACTIONS önerileri taslak görev olarak aktarılır.
- **Gereksinim 6 UYAP Hub**: e-takip senkronu işlem günlüğünü besler (Faz 2 kapsamında ayrı spec).
- **Gereksinim 9/18**: tahsilat kayıtları finansal raporları, collection_score portföy risk görünümünü besler.
- **19 Dashboard**: "TAHSİL EDİLECEK 4.2M ₺" sayacı açık dosyaların `balance` toplamından; portfolio-summary Partner ekranını besler.

## Kabul Kriterleri

1. İlamsız takip açılışında zorunlu alan seti (borçlu, asıl alacak, icra dairesi) doğrulanıyor; ilamlı takipte kaynak dava seçimi zorunlu.
2. Ödeme emri tebliğ tarihi girilince 7 günlük itiraz süresi Süre Motoru'nda CONFIRMED-aday olarak oluşuyor ve calculation_log İİK m.62'yi gösteriyor.
3. İtiraz işlemi girilen dosyada HACIZ aşamasına doğrudan geçiş 422 döndürüyor.
4. Haciz tutanağı olmadan SATIS'a geçiş engelleniyor.
5. Tahsilat kaydı; collected_total, FinancialEntry ve müvekkil kartı bakiyesini tek işlemde tutarlı güncelliyor.
6. ENF_OBJECTION_COMPARE, örnek dosyada itiraz-cevap eşleştirme tablosu ve cevapsız itiraz listesi döndürüyor.
7. ENF_COLLECTION_SCORE çıktısı skor + en az 3 gerekçe maddesi + "öneri niteliğindedir" ibaresi içeriyor; 24 saat içinde ikinci refresh çağrısı önbellekten dönüyor.
8. Copilot hiçbir komutta doğrudan Task/EnforcementAction yazmıyor (yetki testi).
9. Bakiyesi sıfır olmayan dosya, aciz vesikası veya vazgeçme gerekçesi olmadan KAPANIS'a alınamıyor.
10. Portföy listesi skor aralığına göre filtrelenip sıralanabiliyor.
11. `balance` ucu; örnek dosyada (asıl 100.000 ₺, %24 faiz, 120 gün, 30.000 ₺ tahsilat) mahsup sıralı doğru kalan bakiyeyi ve satır satır dökümü döndürüyor (birim testi).
12. Tahsilat girişi sonrası bakiye, müvekkil kartı ve FinancialEntry aynı işlemde tutarlı (transaction testi).
13. HARICEN tahsilat girişinde harç uyarısı UI'da ve API cevabında (`warnings[]`) dönüyor.

## Faz

**Faz 1**: takip yaşam döngüsü, işlem günlüğü, tahsilat, İİK süre bağlantısı, ENF_NEXT_ACTIONS + ENF_ACTION_LOG_ANALYSIS. **Faz 2**: ENF_COLLECTION_SCORE, ENF_ASSET_ANALYSIS, ENF_OBJECTION_COMPARE ve UYAP e-takip senkronu.
