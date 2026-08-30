# Modül 13 — Bilirkişi Yönetimi

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 14 `[P1, 9/10]`

## Amaç

Dava dosyalarındaki bilirkişi sürecini uçtan uca takip etmek: bilirkişi
görevlendirmesi → dosyanın bilirkişiye tevdii → kök rapor → rapora itiraz / beyan →
ek rapor → ek rapora itiraz → gerekirse yeni bilirkişi heyeti. Her adım tarihli bir
süreç kaydıdır; rapor tebliğ tarihi girildiğinde itiraz süresi (kural olarak iki hafta,
HMK m. 281) Süre Motoru üzerinden deterministik hesaplanır ve avukat onayına sunulur.

Modülün asıl değeri AI karşılaştırma katmanıdır. "İlk bilirkişi raporu ile ek rapor
arasındaki farkları madde madde çıkar" talebi, genel bir sohbet botunun değil,
yapılandırılmış çıktı üreten özel bir AI görevinin işidir: hangi tespit değişti, hangi
hesap güncellendi, hangi itirazımız karşılandı, hangisi karşılanmadı — kanıt
alıntılarıyla, madde madde. Aynı katman itiraz dilekçesi taslağını da üretir: raporun
aleyhe tespitleri, dosyadaki delillerle çelişen noktaları ve usulî eksiklikleri
itiraz maddelerine dönüştürülür; taslak her zaman avukat düzenlemesinden geçer.

Üçüncü hedef bilirkişi istihbaratıdır: büronun dosyalarında görev almış bilirkişiler
kişi kaydı olarak tutulur (`Expert`); uzmanlık alanı, görev aldığı dosyalar, rapor
süreleri ve sonuç istatistikleri birikir. "Bu bilirkişi daha önce 3 dosyamızda görev
aldı, ortalama rapor süresi 74 gün, ikisinde aleyhe rapor verdi" bilgisi itiraz ve
reddi bilirkişi stratejisinde somut girdidir.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, dosyada bilirkişi görevlendirmesini (heyet, uzmanlıklar, tevdi
   tarihi) kaydetmek istiyorum ki süreç en baştan takipte olsun.
2. **Avukat olarak**, rapor tebliğ tarihini girdiğimde itiraz süresinin otomatik
   hesaplanıp onayıma sunulmasını istiyorum ki iki haftalık süre asla kaçmasın.
3. **Avukat olarak**, kök rapor ile ek rapor arasındaki farkları madde madde görmek
   istiyorum ki 80 sayfalık iki raporu satır satır karşılaştırmak zorunda kalmayayım.
4. **Avukat olarak**, itirazlarımızın ek raporda karşılanıp karşılanmadığını tablo
   halinde görmek istiyorum ki ikinci itirazı karşılanmayanlara odaklayayım.
5. **Avukat olarak**, rapora itiraz dilekçesi taslağını AI'dan alıp düzenlemek
   istiyorum ki dilekçeye sıfırdan değil %70'ten başlayayım.
6. **Stajyer olarak**, raporun teknik tespitlerinin özetini çıkarmak istiyorum ki
   avukata sunacağım notu hızla hazırlayayım.
7. **Partner olarak**, büro genelinde bekleyen bilirkişi süreçlerini (rapor bekleyen,
   itiraz süresi işleyen) görmek istiyorum ki darboğazları yöneteyim.
8. **Avukat olarak**, bir bilirkişinin geçmiş dosyalarımızdaki performansını
   (süre, sonuç, itiraz oranı) görmek istiyorum ki strateji kurarken kullanayım.
9. **Avukat olarak**, süreç adımlarının dosya safahatına (TimelineEvent) otomatik
   düşmesini istiyorum ki dosya özeti bilirkişi aşamasını doğru göstersin.
10. **Sekreter olarak**, UYAP'tan gelen rapor belgesini sürece bağlamak istiyorum ki
    belge ile süreç kaydı kopuk kalmasın.

## Ekranlar ve UX

### 1. Dosya Bilirkişi Sekmesi — `/app/cases/:caseId/experts`

```
┌──────────────────────────────────────────────────────────────┐
│ 2026/145 — Bilirkişi Süreci                 [+ Görevlendirme]│
├──────────────────────────────────────────────────────────────┤
│ Heyet #1: İnşaat Müh. A.B. · Mali Müşavir C.D.               │
│ ─ Tevdi: 02.03.2026                                          │
│ ─ Kök Rapor: 18.05.2026 (tebliğ 26.05) → İtiraz: 09.06 ✅    │
│ ─ Ek Rapor: 11.08.2026 (tebliğ 14.08)                        │
│   ⏰ İtiraz son günü: 28.08.2026 — SÜRE GEÇTİ Mİ KONTROL ET  │
├──────────────────────────────────────────────────────────────┤
│ [Raporları Karşılaştır (AI)] [İtiraz Taslağı Üret (AI)]      │
│ [Teknik Özet] [Süreç Zaman Çizelgesi]                        │
└──────────────────────────────────────────────────────────────┘
```

Bileşenler: süreç zaman çizelgesi (dikey stepper), rapor kartları (belge bağı, tebliğ
tarihi, itiraz durumu), AI aksiyon butonları, itiraz süresi geri sayımı.

### 2. Rapor Karşılaştırma — `/app/cases/:caseId/experts/compare`
Bileşenler: rapor seçici (kök vs ek), madde madde fark tablosu (konu | kök rapor
tespiti | ek rapor tespiti | değişim yönü | bizim itirazımızla ilişkisi), kanıt
alıntısı açılır satırları, PDF dışa aktarım.

### 3. Bilirkişi Kişi Kartı — `/app/experts/:expertId`
Bileşenler: kimlik/uzmanlık bilgisi, görev aldığı dosyalar tablosu, istatistik
kartları (ortalama rapor süresi, dosya sayısı, lehe/aleyhe/karma sonuç dağılımı),
notlar.

### 4. Büro Bilirkişi Panosu — `/app/experts`
Bileşenler: aktif süreçler listesi (aşama, bekleyen gün, itiraz son günü), bilirkişi
dizini, filtreler (uzmanlık, mahkeme, aşama).

## Veri Modeli

### Expert (yeni — bilirkişi kişi kaydı)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| full_name | VARCHAR | |
| title | VARCHAR NULL | Örn. "İnşaat Yüksek Mühendisi" |
| specialties | VARCHAR[] | Uzmanlık alanları |
| city | VARCHAR NULL | |
| registry_info | VARCHAR NULL | Bilirkişilik bölge kurulu sicil bilgisi |
| notes | TEXT NULL | Büro içi değerlendirme notları |

### ExpertAssignment (yeni — dosyadaki görevlendirme/heyet)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| case_id | UUID FK→Case | |
| assignment_no | INT | Dosyadaki kaçıncı heyet (1, 2, ...) |
| assigned_date | DATE NULL | Görevlendirme ara kararı tarihi |
| delivery_date | DATE NULL | Dosyanın tevdi tarihi |
| scope_summary | TEXT NULL | İnceleme konusu (ara karardan) |
| status | ENUM | ASSIGNED, FILE_DELIVERED, REPORT_ISSUED, SUPPLEMENTARY_PENDING, COMPLETED, REPLACED |

### ExpertAssignmentMember (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / assignment_id | UUID | |
| expert_id | UUID FK→Expert | |
| role_in_panel | VARCHAR NULL | Heyet içindeki uzmanlık rolü |

### ExpertReport (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| assignment_id | UUID FK→ExpertAssignment | |
| case_id | UUID FK→Case | Denormalize, sorgu kolaylığı |
| report_type | ENUM | MAIN (kök), SUPPLEMENTARY (ek) |
| sequence_no | INT | Aynı görevlendirmedeki sıra |
| report_date | DATE | Rapor tarihi |
| notified_date | DATE NULL | Tebliğ tarihi — itiraz süresini tetikler |
| document_id | UUID FK→Document | Rapor belgesi (OCR'lı) |
| conclusion | ENUM NULL | FAVORABLE, UNFAVORABLE, MIXED, NEUTRAL — avukat işaretler |
| summary | TEXT NULL | AI teknik özeti (onaylı) |
| objection_deadline_id | UUID FK→Deadline NULL | Hesaplanan itiraz süresi kaydı |

### ExpertObjection (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| report_id | UUID FK→ExpertReport | İtiraz edilen rapor |
| objection_date | DATE | Sunulma tarihi |
| document_id | UUID FK→Document | İtiraz dilekçesi |
| filed_by | ENUM | US (biz), OPPOSING (karşı taraf) |
| items | JSONB | İtiraz maddeleri `[{no, topic, summary, addressed_in_report_id?}]` |
| status | ENUM | DRAFT, FILED, PARTIALLY_ADDRESSED, ADDRESSED, UNADDRESSED |

## AI Yetenekleri

### EXPERT_REPORT_DIFF
- **Girdi:** İki `ExpertReport` belgesinin metinleri (OCR, maskeli) + varsa aradaki itiraz maddeleri (`ExpertObjection.items`).
- **Çıktı:** Yapılandırılmış fark listesi: `[{item_no, topic, main_report_finding, supp_report_finding, change_type: CHANGED|ADDED|REMOVED|UNCHANGED_DESPITE_OBJECTION, related_objection_no?, quote_main, quote_supp}]` + okunur rapor. "27 maddelik fark" çıktısı bu şemadadır.
- **Gördüğü veri:** Yalnızca seçilen iki rapor ve itiraz maddeleri; dosyanın diğer belgeleri gönderilmez.
- **KVKK:** Rapor metinlerindeki TCKN, adres, sağlık verisi maskeleme hattından geçer; alıntılar maskeli haliyle döner. Yerel/BYO-LLM önerilir (raporlar yoğun kişisel veri içerir).

### EXPERT_OBJECTION_DRAFT
- **Girdi:** Hedef rapor metni (maskeli) + dosyanın iddia/delil özeti (Modül 14 matrisinden) + varsa önceki itirazlar + avukatın yönlendirme notu.
- **Çıktı:** İtiraz dilekçesi taslağı: usulî itirazlar, esasa ilişkin madde madde itirazlar (her maddede rapor alıntısı + karşı delil referansı), sonuç ve talep bölümü. DRAFT `ExpertObjection` + Document taslağı olarak kaydedilir; avukat düzenlemeden sunulamaz.
- **KVKK:** Girdi maskeli; taslak "AI üretimidir, avukat kontrolü zorunludur" filigranıyla açılır.

### EXPERT_REPORT_SUMMARY
- **Girdi:** Tek rapor metni (maskeli).
- **Çıktı:** Teknik tespitlerin özeti + lehe/aleyhe işaretli bulgu listesi + `conclusion` önerisi. `conclusion` alanına yalnızca avukat onayıyla yazılır.

## İş Kuralları

1. İtiraz süresi deterministik hesaplanır: `notified_date` girildiğinde Süre Motoru (G4) tebliğ + 2 hafta kuralı, resmi tatil ve adli tatil parametreleriyle `Deadline(type=EXPERT_REPORT_OBJECTION)` üretir; kayıt "avukat onayı bekliyor" durumunda doğar. AI süre hesaplamaz.
2. Aynı görevlendirmede MAIN rapor tektir; ek raporlar `sequence_no` ile sıralanır.
3. `notified_date` olmayan rapor için itiraz süresi üretilmez; ekranda "tebliğ tarihi eksik" uyarısı kalır.
4. Rapor, itiraz ve ek rapor kayıtları oluştuğunda dosyaya otomatik `TimelineEvent` düşer (tip: EXPERT_*).
5. EXPERT_REPORT_DIFF yalnızca aynı dosyanın raporları arasında çalışır; farklı dosya raporları karşılaştırılamaz (422).
6. AI diff çıktısındaki `UNCHANGED_DESPITE_OBJECTION` maddeleri, ilgili `ExpertObjection.items[].addressed_in_report_id` alanını avukat onayıyla günceller; onaysız yazım yoktur.
7. İtiraz taslağı DRAFT durumundayken UYAP gönderim akışına giremez; FILED durumuna geçiş `document_id` ve `objection_date` zorunluluğuna bağlıdır.
8. `Expert` istatistikleri (ortalama rapor süresi = delivery_date→report_date, sonuç dağılımı) deterministik sorgudur; gecelik işle önbelleklenir.
9. Bilirkişi kişi kaydı tenant'a özeldir; tenant'lar arası veri paylaşımı yoktur (KVKK ve rekabet gereği).
10. Rapor belgesi silinemez; süreçten çıkarma yalnızca bağın kaldırılması + AuditLog kaydı ile olur.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET/POST | /api/v1/cases/:caseId/expert-assignments | Görevlendirme listele/oluştur |
| PATCH | /api/v1/expert-assignments/:id | Aşama/tarih güncelle |
| POST | /api/v1/expert-assignments/:id/reports | Rapor kaydet (belge bağıyla) |
| PATCH | /api/v1/expert-reports/:id | Tebliğ tarihi, conclusion güncelle |
| POST | /api/v1/expert-reports/:id/objections | İtiraz kaydet / taslak oluştur |
| POST | /api/v1/cases/:caseId/experts/compare | EXPERT_REPORT_DIFF (report_id_a, report_id_b) |
| POST | /api/v1/expert-reports/:id/objection-draft | EXPERT_OBJECTION_DRAFT tetikle |
| POST | /api/v1/expert-reports/:id/summarize | EXPERT_REPORT_SUMMARY tetikle |
| GET/POST | /api/v1/experts | Bilirkişi dizini listele/oluştur |
| GET | /api/v1/experts/:id/stats | Bilirkişi istatistikleri |
| GET | /api/v1/expert-processes | Büro geneli aktif süreçler (pano) |

## Diğer Modüllerle İlişkiler

- **Modül 02 Dava Dosyası:** Bilirkişi sekmesi bu modüldür; süreç adımları safahata (TimelineEvent) akar.
- **Süre Motoru (G4):** İtiraz süreleri Deadline olarak üretilir ve onaylanır.
- **Belge→Aksiyon Hattı (G7):** UYAP'tan gelen belge "bilirkişi raporu" sınıflandırılırsa bu modülde rapor kaydı + tebliğ tarihi önerisi + itiraz süresi taslağı otomatik oluşur.
- **Modül 14 Delil Yönetimi:** İtiraz taslağı, iddia-delil matrisinden karşı delil referansları alır; bilirkişi raporu aynı zamanda bir delil tipi olarak matriste görünür.
- **Görev Modülü:** İtiraz süresi onaylandığında sorumluya itiraz hazırlama görevi açılır.
- **Modül 17 Simülasyon:** "Bilirkişi bu dosyada hangi noktalara takılabilir?" senaryosu Expert istatistikleriyle zenginleşir.

## Kabul Kriterleri

1. Görevlendirme → tevdi → kök rapor → itiraz → ek rapor zinciri tarihleriyle kaydedilebiliyor ve stepper'da doğru sırayla görünüyor.
2. `notified_date` girilince 2 haftalık itiraz Deadline'ı "onay bekliyor" durumunda oluşuyor; hafta sonuna denk gelen son gün ilk iş gününe kayıyor (süre motoru testi).
3. Tebliğ tarihi olmayan raporda Deadline oluşmuyor ve ekran uyarı gösteriyor.
4. EXPERT_REPORT_DIFF, mock AI ile şemaya uygun madde listesi döndürüyor; farklı dosyaların raporlarıyla çağrı 422 veriyor.
5. Diff çıktısında itiraz maddesiyle eşleşen `UNCHANGED_DESPITE_OBJECTION` kaydı, avukat onayıyla itiraz durumunu PARTIALLY_ADDRESSED/UNADDRESSED'e güncelliyor.
6. İtiraz taslağı DRAFT olarak Document + ExpertObjection üretiyor; FILED'a geçiş tarih ve belge olmadan 422 veriyor.
7. Rapor kaydı dosya safahatına TimelineEvent düşürüyor.
8. Expert istatistik ucu: 3 dosyalık örnek veride ortalama rapor süresi ve sonuç dağılımını doğru hesaplıyor.
9. Büro panosu, itiraz son günü 7 gün içinde olan süreçleri öne sıralıyor.
10. Tüm uçlar tenant-scoped; AI çağrılarında rapor metni maskeleme hattından geçtiği entegrasyon testiyle doğrulanıyor.

## Faz

**Faz 4-5.** Süreç takibi + süre entegrasyonu + Expert dizini **Faz 4**'te;
AI katmanı (EXPERT_REPORT_DIFF, EXPERT_OBJECTION_DRAFT, EXPERT_REPORT_SUMMARY)
**Faz 5**'te devreye alınır. Önkoşullar: OCR/belge hattı, Süre Motoru, TimelineEvent.
