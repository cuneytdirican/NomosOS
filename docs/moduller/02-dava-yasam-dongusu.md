# Modül 02 — Dava Dosyası Yaşam Döngüsü

## Amaç

Benchmark ürünün güçlü olduğu zincir "Belgeler → AI → Araştırma → Dilekçe" ile sınırlı; dava, belge yığını olarak modelleniyor. Oysa bir dava dosyası (örn. 2026/145) taraflar, mahkeme, hakim, duruşmalar, safahat, süreler, harçlar, kararlar ve kanun yolu süreçleriyle yaşayan bir operasyon birimidir.

Bu modül, dosyanın **25 sekmelik tam ağacını** ve **açılış → yargılama → istinaf/temyiz → icra → kapanış** yaşam döngüsünü tanımlar. Dosya, NomosOS'un merkez varlığıdır: duruşmalar, süreler, görevler, belgeler ve finans kayıtları hep `case_id` üzerinden buraya bağlanır. Safahat (TimelineEvent akışı) dosyanın hafızasıdır; sistemdeki her anlamlı olay otomatik olarak safahata düşer.

Modülün farkı: benchmark üründe olmayan yaşam döngüsü durum makinesi, kanun yolu (istinaf/temyiz) takibi ve icra bağlantısı. Böylece "dava kazanıldı ama icrada unutuldu" senaryosu yapısal olarak imkânsızlaşır.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, yeni dava dosyasını mahkeme, esas no, taraflar ve müvekkil bilgisiyle açmak istiyorum ki dosya UYAP'taki karşılığıyla birebir eşleşsin.
2. **Avukat olarak**, dosyayı açtığımda özet sekmesinde son gelişme, sıradaki duruşma ve kritik süreleri tek bakışta görmek istiyorum ki 15 dakika dosya incelemeyeyim.
3. **Avukat olarak**, safahat sekmesinde tensipten karara tüm olayları kronolojik görmek istiyorum ki dosyanın hikâyesini takip edeyim.
4. **Avukat olarak**, gerekçeli karar geldiğinde dosyayı tek tıkla istinaf aşamasına taşımak istiyorum ki istinaf süresi ve görev zinciri otomatik kurulsun.
5. **Partner olarak**, büromdaki dosyaları aşama bazında (yargılama/istinaf/icra) filtrelemek istiyorum ki iş yükünü aşamalara göre göreyim.
6. **Sekreter olarak**, harç ve masraf kayıtlarını dosyaya işlemek istiyorum ki masraf yansıtma finans modülüne otomatik aksın.
7. **Avukat olarak**, davadaki tanıkları ve delilleri ilgili iddialarla kaydetmek istiyorum ki duruşma hazırlığında AI bu yapıyı kullansın.
8. **Avukat olarak**, dosyayı kapatırken sistemin açık süre/görev kontrolü yapmasını istiyorum ki içinde unutulmuş iş kalan dosya kapanmasın.
9. **Stajyer olarak**, bana atanan dosyanın belgelerini ve safahatını görmek ama finans sekmesini görmemek istiyorum.
10. **Avukat olarak**, kazanılan dava kesinleştiğinde dosyadan tek tıkla bağlı icra takibi açmak istiyorum ki ilam alacağı takipsiz kalmasın.

## Ekranlar ve UX

### 1. Dosya Listesi — `/app/cases`
Bileşenler: arama (esas no/taraf/müvekkil), filtreler (tür: hukuk/ceza/icra/arabuluculuk, aşama, mahkeme, sorumlu avukat), tablo (esas no, taraf, mahkeme, aşama, sıradaki duruşma, kritik süre rozetleri).

### 2. Dosya Detay — `/app/cases/:id`
Üst şerit (esas no, mahkeme, aşama rozeti, sorumlu) + 25 sekme. Sekme grupları: **Genel** (Dosya Özeti · Taraflar · Müvekkil · Mahkeme · Hakim), **Süreç** (Duruşmalar · Safahat · Süreler · Görevler), **İçerik** (Belgeler · Dilekçeler · Deliller · Tanıklar · Bilirkişi), **Mali** (Harçlar · Masraflar · Finans), **Hukuki** (Vekalet · Kararlar · İstinaf · Temyiz · İcra), **Diğer** (Notlar · İletişim · AI Analiz).

```
┌────────────────────────────────────────────────────────────────────┐
│ 2026/145 E. · İstanbul 12. İş Mahkemesi · [YARGILAMA] · Av. Yılmaz │
├────────────────────────────────────────────────────────────────────┤
│ Özet│Taraflar│Duruşmalar│Safahat│Süreler│Görevler│Belgeler│... ▾   │
├────────────────────────────────────────────────────────────────────┤
│ SON GELİŞME  28.08 Bilirkişi raporu tebliğ edildi                  │
│ ⚠ SÜRELER    08.09 Bilirkişi raporuna itiraz (10 gün kaldı)        │
│ 📅 DURUŞMA   17.09 09:30 — Tanık dinleme                           │
│ ── SAFAHAT ─────────────────────────────────────────────────────── │
│ 28.08  📄 Bilirkişi raporu geldi (AI: 27 tespit içeriyor)          │
│ 12.07  ⚖ Duruşma yapıldı — rapor için dosya bilirkişiye verildi    │
│ 03.05  📄 Cevaba cevap dilekçesi sunuldu                           │
│ [+ Görev] [+ Not] [AI Analiz Çalıştır] [Aşamayı İlerlet ▸]         │
└────────────────────────────────────────────────────────────────────┘
```

### 3. Yeni Dosya — `/app/cases/new`
Adımlar: tür seçimi → mahkeme/esas no → müvekkil seçimi (Modül 01'den) → taraflar → sorumlu avukat. Kayıtla birlikte otomatik klasör (Modül 06) ve "tensip bekleniyor" safahat kaydı oluşur.

## Veri Modeli

### Case (çekirdek, genişletilmiş)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id | uuid | |
| client_id | uuid FK→Client | Müvekkil |
| type | enum(LAWSUIT, ENFORCEMENT, MEDIATION, CRIMINAL, CONSULTANCY) | |
| case_no | text | "2026/145" biçimi, mahkeme+yıl+sıra |
| court_name | text | "İstanbul 12. İş Mahkemesi" |
| court_type | enum(IS, ASLIYE_HUKUK, ASLIYE_TICARET, TUKETICI, AGIR_CEZA, ICRA_DAIRESI, ...) | |
| judge_name | text nullable | Hakim |
| stage | enum(OPENING, TRIAL, DECISION, APPEAL, CASSATION, ENFORCEMENT, CLOSED) | Yaşam döngüsü aşaması |
| status | enum(ACTIVE, SUSPENDED, CLOSED) | |
| responsible_user_id | uuid FK→User | Sorumlu avukat |
| subject | text | Dava konusu (işe iade, alacak...) |
| amount | numeric nullable | Dava değeri |
| opened_at / closed_at | date | |
| linked_case_id | uuid FK→Case nullable | Bağlı dosya (ilam→icra) |
| former_case_nos | text[] | Birleştirme/yeni esas sonrası eski numaralar |

### CaseParty (çekirdek)
| Alan | Tip | Açıklama |
|------|-----|----------|
| case_id | uuid FK→Case | |
| role | enum(PLAINTIFF, DEFENDANT, INTERVENER, VICTIM, SUSPECT, CREDITOR, DEBTOR) | Davacı/davalı/müdahil/alacaklı/borçlu |
| name | text | Karşı taraf ise Client kaydı zorunlu değil |
| client_id | uuid FK→Client nullable | Taraf müvekkilimizse bağ |
| attorney_name | text nullable | Karşı vekil |

### CaseDecision (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| case_id | uuid FK→Case | |
| kind | enum(TENSIP, ARA_KARAR, GEREKCELI_KARAR, ISTINAF_KARARI, TEMYIZ_KARARI) | |
| decided_at / notified_at | date | Karar ve **tebliğ** tarihi (Süre Motoru girdisi) |
| summary | text | |
| document_id | uuid FK→Document nullable | |
| outcome | enum(ACCEPTED, REJECTED, PARTIAL, REVERSED, UPHELD) nullable | |

### CaseExpense (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| case_id | uuid FK→Case | |
| kind | enum(HARC, MASRAF, BILIRKISI_UCRETI, TEBLIGAT_GIDERI, DIGER) | |
| amount | numeric | |
| paid_at | date | |
| financial_entry_id | uuid FK→FinancialEntry | Finansa otomatik yansıma |

### Witness / Evidence (yeni, Faz 2'de derinleşir)
Witness: case_id, full_name, subject (hangi vakıa), heard_at. Evidence: case_id, kind(BELGE/FOTO/VIDEO/SES/TANIK/KESIF), claim_text (desteklediği iddia), document_id.

### TimelineEvent (çekirdek — safahat)
| Alan | Tip | Açıklama |
|------|-----|----------|
| case_id | uuid FK→Case | |
| event_type | enum(STAGE_CHANGE, HEARING, DOCUMENT, DECISION, DEADLINE, TASK, NOTE, COMMUNICATION) | |
| occurred_at | timestamptz | |
| title / detail | text | |
| ref_table / ref_id | text/uuid | Kaynak kayda bağ |
| actor_user_id | uuid nullable | Sistem olayında null |

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| CASE_ANALYSIS | case_id → dosya özeti, güçlü/zayıf yönler, eksikler, önerilen sonraki adımlar | Belgelerin OCR metni, safahat, kararlar | PII maskeleme hattından geçer; tenant'ın AiProviderConfig'i (BYO-LLM) kullanılır |
| CASE_TIMELINE_SUMMARY | case_id + dönem → anlaşılır safahat özeti (müvekkil diline çevrilebilir) | TimelineEvent + CaseDecision | Müvekkile gönderim ayrı onay ister |
| NEXT_STEP_SUGGEST | stage değişimi → önerilen görev/süre listesi (ÖNERİ; Modül 07'ye taslak görev) | Aşama, son karar, açık süreler | Öneriler avukat onayı olmadan görev olmaz |

## İş Kuralları

1. `case_no` "YYYY/N" biçiminde doğrulanır; aynı tenant + mahkeme + case_no benzersizdir.
2. Aşama geçişleri yalnızca izinli yönde: OPENING→TRIAL→DECISION→(APPEAL→CASSATION)→CLOSED; DECISION→ENFORCEMENT ancak lehte karar + kesinleşme işaretiyle. Her geçiş `STAGE_CHANGE` TimelineEvent'i üretir.
3. APPEAL aşamasına geçiş için `kind=GEREKCELI_KARAR` ve `notified_at` dolu bir CaseDecision şarttır; geçişte Süre Motoru HMK_ISTINAF kuralını tetikler.
4. Dosya CLOSED yapılırken açık Deadline (CONFIRMED, tarihi geçmemiş) veya açık Task varsa kapanış engellenir; kullanıcıya liste gösterilir.
5. İstinaf/Temyiz/İcra sekmeleri, ilgili aşamaya girilmeden salt bilgilendirme (boş durum) gösterir; veri girişi kapalıdır.
6. CaseExpense kaydı otomatik FinancialEntry üretir; ikisi arasında tutar tutarsızlığı olamaz.
7. `linked_case_id` ile açılan icra dosyası, kaynak davanın İcra sekmesinde canlı özetiyle görünür.
8. Safahata manuel kayıt eklenebilir ama sistem üretimi kayıtlar silinemez/değiştirilemez (AuditLog garantili).
9. STAJYER/SEKRETER, Finans ve Harçlar/Masraflar sekmelerinde tutar alanlarını göremez.
10. Dosya silinemez; yanlış açılan dosya `status=CLOSED` + "sehven açıldı" notu ile kapatılır.
11. Esas no değişiklikleri (birleştirme, gönderme, yeni esasa kayıt) eski numarayı `former_case_nos` listesinde saklar; arama her iki numarada da bulur.
12. Sorumlu avukat değişimi Partner onayı ister; değişim safahata ve AuditLog'a işlenir, açık görev/süre sorumlulukları için devir listesi gösterilir.

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET/POST | /api/v1/cases | Liste (filtre: type, stage, court, q) / yeni dosya |
| GET/PATCH | /api/v1/cases/:id | Detay / güncelleme |
| POST | /api/v1/cases/:id/stage | Aşama geçişi `{to, reason}` — kural 2-3 uygulanır |
| GET | /api/v1/cases/:id/timeline | Safahat (sayfalı, event_type filtresi) |
| GET/POST | /api/v1/cases/:id/parties | Taraflar |
| GET/POST | /api/v1/cases/:id/decisions | Kararlar |
| GET/POST | /api/v1/cases/:id/expenses | Harç/masraf |
| GET/POST | /api/v1/cases/:id/witnesses · /evidence | Tanık / delil |
| POST | /api/v1/cases/:id/link-enforcement | İlamdan icra dosyası oluştur |
| POST | /api/v1/cases/:id/ai/analysis | CASE_ANALYSIS başlat |
| POST | /api/v1/cases/:id/close | Kapanış (kural 4 kontrolü) |
| POST | /api/v1/cases/:id/transfer | Sorumlu avukat devri (kural 12, Partner onaylı) |
| GET | /api/v1/cases/:id/summary | Özet sekmesi verisi (son gelişme + kritik süre + sıradaki duruşma) |

## Diğer Modüllerle İlişkiler

- **01 CRM**: `client_id` zorunlu; kart sayaçları Case'ten beslenir.
- **03 Duruşma**: Hearing kayıtları Duruşmalar sekmesi; duruşma sonuçları safahata düşer.
- **04 Süre**: CaseDecision.notified_at + aşama geçişleri DeadlineRule tetikler; Süreler sekmesi Deadline listesidir.
- **05 İcra**: DECISION→ENFORCEMENT geçişi `linked_case_id` ile icra dosyası açar.
- **06 Belge**: pipeline'ın dosya eşleştirmesi `case_no` + taraf adlarıyla yapılır; belge olayları safahata düşer.
- **07 Görev**: aşama geçişleri WorkflowTemplate tetikleyebilir (örn. istinaf workflow'u).

## Kabul Kriterleri

1. 25 sekmenin tamamı route + boş durum ekranıyla mevcut; sekme grupları tanımdaki sırayla.
2. Aynı mahkeme + esas no ile ikinci dosya açma 409 döndürüyor.
3. TRIAL→CLOSED doğrudan geçiş denemesi 422 + izinli geçiş listesi döndürüyor.
4. Gerekçeli karar (notified_at dolu) kaydedilip APPEAL'a geçildiğinde HMK_ISTINAF kaynaklı SUGGESTED Deadline oluşuyor.
5. Açık görevi olan dosyanın kapanış isteği 422 + engel listesi döndürüyor.
6. CaseExpense kaydı sonrası eşleşen FinancialEntry otomatik oluşuyor ve tutarlar eşit.
7. Safahat 500+ kayıtta sayfalı yükleniyor; sistem kaydı DELETE denemesi 403.
8. `link-enforcement` çağrısı type=ENFORCEMENT yeni Case üretiyor ve iki dosya karşılıklı bağlanıyor.
9. CASE_ANALYSIS çıktısı AI Analiz sekmesinde görev geçmişiyle (tarih, model, süre) listeleniyor.
10. Farklı tenant'ın case id'sine erişim 404.
11. Eski esas no ile arama, yeni esasa kaydedilmiş dosyayı buluyor (`former_case_nos` testi).
12. Sorumlu avukat değişiminde devir listesi açık görev ve süreleri eksiksiz gösteriyor; değişim safahatta görünüyor.

## Faz

**Faz 1**: Case yaşam döngüsü, 25 sekme, safahat, kararlar, harç/masraf, icra bağlantısı. **Faz 2**: Witness/Evidence derinleştirme (delil-iddia matrisi, Gereksinim 15) ve CASE_ANALYSIS'in strateji motoruyla (Gereksinim 16) birleşmesi.
