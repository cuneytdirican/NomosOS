# Modül 03 — Duruşma Yönetimi

## Amaç

Avukatın sabah açacağı ilk ekran "Bugün hangi duruşmalarım var?" ekranıdır. Benchmark üründe duruşma, dosya içindeki bir bilgi parçası; NomosOS'ta ise **merkezi bir modüldür**: büronun tüm duruşmaları tek takvimde, günlük operasyon ekranında ve avukat bazlı dağılımda görünür.

Modülün ikinci ayağı **"Bugünkü duruşmalarımı hazırla"** AI paketidir. Tek komutla, günün her duruşması için: dosya özeti, son gelişmeler, karşı tarafın son beyanı, son mahkeme kararı, eksik deliller, duruşmada sorulabilecek sorular, ileri sürülmesi gereken hususlar, ilgili süreler ve önceki duruşma tutanağı derlenir. Benchmark üründe bu, kullanıcının dosya dosya sorması gereken bir sohbet işidir; NomosOS'ta tek tıklık, yapılandırılmış ve yazdırılabilir bir pakettir.

Üçüncü ayak duruşma sonrası disiplindir: sonuç girilmeden dosya "güncel" sayılmaz; girilen yeni celse tarihi otomatik olarak takvime ve safahata işlenir, ara karar gereği süreler Süre Motoru'na aktarılır.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, sabah `/app/hearings/today` ekranında günün duruşmalarını saat sırasıyla görmek istiyorum ki güne plansız başlamayayım.
2. **Avukat olarak**, "Bugünkü duruşmalarımı hazırla" komutuyla tüm duruşmalarım için hazırlık paketi almak istiyorum ki adliyeye dosyaya hâkim gireyim.
3. **Avukat olarak**, hazırlık paketini telefonda okunur tek sayfa halinde görmek istiyorum ki adliye koridorunda hızlıca bakabileyim.
4. **Partner olarak**, haftalık takvimde büronun tüm duruşmalarını avukat bazlı renklerle görmek istiyorum ki çakışmaları önceden çözeyim.
5. **Sekreter olarak**, aynı gün aynı avukata iki farklı şehirde duruşma düştüğünde uyarı almak istiyorum ki tevkil/mazeret planlansın.
6. **Avukat olarak**, duruşma bitince sonucu (yeni celse, ara karar özeti) 1 dakikada girmek istiyorum ki dosya ve süreler otomatik güncellensin.
7. **Avukat olarak**, duruşmadan önceki akşam hazırlık paketinin otomatik üretilip bana bildirilmesini istiyorum ki sabah beklemeden okuyayım.
8. **Stajyer olarak**, gözlemci atandığım duruşmaları kendi takvimimde görmek istiyorum ki adliyeye avukatla birlikte gideyim.
9. **Avukat olarak**, e-duruşma tipindeki kayıtlarda görüntülü katılım linkini duruşma kartında görmek istiyorum.
10. **Partner olarak**, sonuç girilmemiş geçmiş duruşmaları listede kırmızı görmek istiyorum ki takip disiplinini denetleyeyim.

## Ekranlar ve UX

### 1. Bugünün Duruşmaları — `/app/hearings/today`
Bileşenler: gün seçici, avukat filtresi (varsayılan: ben), duruşma tablosu, her satırda hazırlık durumu rozeti, üstte "Duruşmalarımı Hazırla" butonu.

```
┌────────────────────────────────────────────────────────────────────┐
│ 📅 30 Ağustos 2026 · 3 duruşma          [⚡ Duruşmalarımı Hazırla] │
├──────┬─────────┬──────────────────────┬──────────┬────────────────┤
│ Saat │ Dosya   │ Mahkeme              │ İşlem    │ Hazırlık       │
├──────┼─────────┼──────────────────────┼──────────┼────────────────┤
│09:30 │2025/341 │İstanbul 12. İş       │ Duruşma  │ ✅ Paket hazır │
│11:00 │2026/72  │Ankara 4. Asliye Huk. │ Ara karar│ ⏳ Üretiliyor  │
│14:30 │2024/91  │Bursa 2. Tüketici     │ Tanık    │ ⬜ Hazırlanmadı│
├──────┴─────────┴──────────────────────┴──────────┴────────────────┤
│ ⚠ Sonuç girilmemiş: 28.08 — 2026/145 İstanbul 12. İş  [Sonuç Gir] │
└────────────────────────────────────────────────────────────────────┘
```

### 2. Takvim — `/app/hearings/calendar`
Ay/hafta/gün görünümü; avukat bazlı renk kodu; duruşma + süre son günleri (Deadline) birlikte gösterilir (katman aç/kapa). Çakışma tespitinde satırda ⚠ rozeti.

### 3. Duruşma Detay — `/app/hearings/:id`
Bileşenler: dosya bağlantı kartı, tip/saat/salon, katılımcılar, hazırlık paketi görüntüleyici (bölüm bölüm açılır), önceki celseler listesi, "Sonuç Gir" formu (sonuç metni, yeni celse tarihi, ara karar var mı?).

### 4. Hazırlık Paketi Görünümü — `/app/hearings/:id/prep`
Tek sayfa, yazdırılabilir; 9 sabit bölüm (aşağıda HEARING_PREP çıktısı). Mobil uyumlu; bölümler daraltılabilir, "PDF indir" ve "pakete not ekle" aksiyonları.

### 5. Haftalık Ajanda — `/app/hearings/agenda`
Avukat bazlı, yazdırılabilir haftalık liste (adliye çantası için): gün gün duruşmalar + aynı gün düşen Deadline'lar. Sekreter tüm büro için, avukat kendisi için üretir. ICS aboneliği bağlantısı bu ekrandadır.

## Çakışma Kontrol Algoritması

```
kontrol(yeni_hearing):
  ayni_gun = Hearing[attendee = yeni.attendee, date = yeni.date, status = SCHEDULED]
  for h in ayni_gun:
    if abs(h.saat - yeni.saat) < 2 saat            → SERT uyarı (aynı saat dilimi)
    elif h.adliye_ili != yeni.adliye_ili           → SERT uyarı (şehirler arası, mesafe)
    else                                           → YUMUŞAK uyarı (yoğun gün)
  SERT uyarı: kayıt yapılır ama Partner'a bildirim + duruşma kartına ⚠ rozeti.
```
Adliye ili, `court_name` içinden il sözlüğüyle çözülür; çözülemezse kontrol atlanır ve loglanır.

## Veri Modeli

### Hearing (çekirdek, genişletilmiş)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id | uuid | |
| case_id | uuid FK→Case | |
| scheduled_at | timestamptz | Tarih + saat |
| type | enum(DURUSMA, KESIF, E_DURUSMA, MURAFAA, TALIMAT) | |
| purpose | text | "Tanık dinleme", "Ara karar" — today ekranındaki İşlem kolonu |
| courtroom | text nullable | Salon |
| e_hearing_url | text nullable | e-Duruşma linki |
| attendee_user_id | uuid FK→User | Katılacak avukat |
| observer_user_ids | uuid[] | Stajyer/gözlemciler |
| status | enum(SCHEDULED, COMPLETED, POSTPONED, CANCELLED) | |
| result_text | text nullable | Duruşma sonucu / ara karar özeti |
| next_hearing_id | uuid FK→Hearing nullable | Girilen yeni celse |
| minutes_document_id | uuid FK→Document nullable | Duruşma tutanağı |
| prep_status | enum(NONE, QUEUED, RUNNING, READY, FAILED) | Paket durumu |

### HearingPrepPack (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| hearing_id | uuid FK→Hearing | |
| generated_at | timestamptz | |
| generated_by | uuid FK→User | Komutu veren |
| model_ref | text | Kullanılan AiProviderConfig + model |
| sections | jsonb | 9 bölüm: {case_summary, recent_events, opponent_last_statement, last_decision, missing_evidence, questions_to_ask, points_to_raise, deadlines, previous_minutes} |
| status | enum(READY, STALE) | Paket sonrası dosyaya belge gelirse STALE |

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| HEARING_PREP | hearing_id → HearingPrepPack (9 bölüm) | Dosya özeti, son 90 gün TimelineEvent, karşı tarafın son dilekçesi (OCR), son CaseDecision, Evidence eksik listesi, açık Deadline'lar, önceki celse tutanağı | Tüm metinler PII maskeleme hattından geçer; tenant BYO-LLM (AiProviderConfig) ile çalışır; yerel LLM seçiliyse veri dışarı çıkmaz |
| HEARING_PREP_BATCH | user_id + date → günün tüm duruşmaları için sıralı HEARING_PREP | Günün Hearing listesi | Her duruşma ayrı görev; kısmi başarısızlıkta diğerleri tamamlanır |
| HEARING_RESULT_PARSE | result_text veya tutanak belgesi → yapılandırılmış öneri: yeni celse tarihi, ara karar maddeleri, süre ÖNERİLERİ | Sonuç metni / tutanak OCR | Çıkan süreler SUGGESTED Deadline olur; avukat onaylar (Modül 04 ilkesi) |

HEARING_PREP bölüm sözleşmesi (sections şeması) sabittir; UI ve yazdırma şablonu bu 9 anahtara göre kodlanır:

| Anahtar | İçerik | Kaynak veri |
|---------|--------|-------------|
| case_summary | Dosyanın 5-8 cümlelik özeti | Case + CaseDecision |
| recent_events | Son 90 günün gelişmeleri (maddeli) | TimelineEvent |
| opponent_last_statement | Karşı tarafın son beyanının özeti | Son karşı taraf dilekçesi (OCR) |
| last_decision | Son mahkeme kararı / ara karar özeti | CaseDecision |
| missing_evidence | Eksik/sunulmamış deliller | Evidence + ara karar tespitleri |
| questions_to_ask | Duruşmada sorulabilecek sorular (tanık/bilirkişi bazlı) | Witness + iddialar |
| points_to_raise | İleri sürülmesi gereken hususlar | Safahat + strateji notları |
| deadlines | Duruşma günü itibarıyla açık süreler | Deadline (CONFIRMED) |
| previous_minutes | Önceki celse tutanağı özeti | Hearing.minutes_document_id (OCR) |

## İş Kuralları

1. Hearing yalnızca bir Case'e bağlı oluşturulabilir; `scheduled_at` geçmiş tarihli oluşturulamaz (geçmiş celse ancak sonuçla birlikte "geçmiş kayıt" olarak girilir).
2. Aynı `attendee_user_id` için çakışan (±2 saat, farklı adliye) duruşmalarda kayıt engellenmez, ⚠ uyarısı üretilir ve Partner'a bildirim gider.
3. `status=COMPLETED` için `result_text` zorunludur; POSTPONED için yeni celse tarihi zorunludur ve sistem `next_hearing_id` ile yeni Hearing üretir.
4. Duruşma tarihi geçtiği halde 24 saat içinde sonuç girilmezse: avukata hatırlatma, 72 saatte Partner'a eskalasyon; dosya "sonuç bekleyen" rozeti alır.
5. Sonuç girildiğinde otomatik TimelineEvent (HEARING) oluşur; HEARING_RESULT_PARSE tetiklenir, çıkan süre önerileri onay kuyruğuna düşer.
6. Duruşmadan önceki gün 18:00'de `prep_status=NONE` olan duruşmalar için otomatik HEARING_PREP tetiklenir (tenant ayarıyla kapatılabilir).
7. Paket üretiminden sonra dosyaya yeni belge/karar eklenirse paket `STALE` işaretlenir; ekranda "güncelle" önerilir, eski paket saklanır.
8. HEARING_PREP çıktıları öneri niteliğindedir; hiçbir bölüm otomatik olarak dilekçe/dosya kaydına dönüşmez.
9. Takvimde başka avukatın duruşma detayını AVUKAT rolü görebilir, ancak paketi yalnızca dosya ekibi + PARTNER açabilir.
10. CANCELLED duruşma takvimden düşer ama kayıt silinmez; iptal gerekçesi zorunludur ve safahata işlenir.
11. Aynı Case + aynı `scheduled_at` ile ikinci Hearing oluşturulamaz (mükerrer celse koruması).
12. ICS beslemesi kullanıcı bazlı imzalı token ile yayınlanır; token yenilendiğinde eski besleme geçersizleşir; beslemede dosya adı yerine yalnızca esas no + mahkeme yazılır (telefon takvimi üçüncü taraf senkronlarına PII sızdırmamak için).

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET | /api/v1/hearings?date=&user_id=&status= | Liste / günlük ekran |
| GET | /api/v1/hearings/calendar?from=&to= | Takvim verisi (duruşma + deadline katmanı) |
| POST | /api/v1/hearings | Yeni duruşma |
| GET/PATCH | /api/v1/hearings/:id | Detay / güncelleme |
| POST | /api/v1/hearings/:id/result | Sonuç girişi (kural 3, 5) |
| POST | /api/v1/hearings/:id/prep | HEARING_PREP başlat |
| POST | /api/v1/hearings/prep-batch | `{date, user_id}` — günün tümü |
| GET | /api/v1/hearings/:id/prep-pack | Son paketi getir (STALE bilgisiyle) |
| GET | /api/v1/hearings/pending-results | Sonuç girilmemiş geçmiş duruşmalar |
| GET | /api/v1/hearings/agenda?week=&user_id= | Haftalık ajanda (yazdırma verisi) |
| GET | /api/v1/hearings/ics/:token | ICS takvim beslemesi (kural 12) |
| POST | /api/v1/hearings/ics/rotate | ICS token yenile |
| GET | /api/v1/hearings/:id/conflicts | Kayıt öncesi çakışma ön kontrolü |

## Diğer Modüllerle İlişkiler

- **02 Dava**: Hearing dosyanın Duruşmalar sekmesini besler; sonuçlar safahata düşer.
- **04 Süre**: HEARING_RESULT_PARSE'ın süre önerileri SUGGESTED Deadline olarak Süre Motoru onay kuyruğuna gider; takvim Deadline katmanını Süre Motoru'ndan alır.
- **06 Belge**: duruşma tutanağı (DURUSMA_TUTANAGI sınıfı) pipeline'dan gelirse otomatik olarak ilgili Hearing.minutes_document_id'ye bağlanmaya çalışılır.
- **07 Görev**: "Duruşma hazırlığı yap" görevi duruşmadan X gün önce otomatik açılabilir (WorkflowTemplate); sonuç girilince kapanır.
- **19 Dashboard**: "Bu hafta duruşma: 42" sayacı bu modülden.

## Kabul Kriterleri

1. `/app/hearings/today` günün duruşmalarını saat sıralı, avukat filtreli listeliyor; boş günde boş durum ekranı var.
2. "Duruşmalarımı Hazırla" 3 duruşmalı bir günde 3 ayrı HearingPrepPack üretiyor; biri başarısız olursa diğer ikisi READY oluyor.
3. HearingPrepPack.sections 9 anahtarın tamamını içeriyor; veri yoksa bölüm "veri bulunamadı" değeriyle dolu (anahtar eksik olamaz).
4. COMPLETED'a sonuçsuz geçiş denemesi 422 döndürüyor.
5. POSTPONED + yeni celse girişi, yeni Hearing kaydı ve takvim girdisini otomatik oluşturuyor.
6. Sonuç girişinden sonra dosya safahatında HEARING tipli TimelineEvent görünüyor.
7. Aynı avukata çakışan iki duruşma kaydında uyarı üretiliyor ve Partner bildirimi düşüyor.
8. Sonuç girilmemiş 24 saati geçmiş duruşma `pending-results` ucunda listeleniyor.
9. Paket sonrası dosyaya belge eklenince paket STALE görünüyor; yeniden üretim eski paketi silmeden yeni kayıt açıyor.
10. Yerel LLM (Ollama) yapılandırılmış tenant'ta HEARING_PREP hiçbir dış endpoint'e istek atmıyor (ağ testi).
11. Aynı Case + aynı tarih-saat ile ikinci duruşma kaydı 409 döndürüyor.
12. ICS beslemesi geçerli token ile duruşmaları döndürüyor; token rotate sonrası eski URL 401 alıyor ve beslemede müvekkil adı geçmiyor.
13. Şehirler arası çakışmada (aynı gün İstanbul + Bursa) SERT uyarı üretiliyor ve Partner bildirimi düşüyor.
14. Haftalık ajanda çıktısı, gün bazında duruşma + aynı güne düşen CONFIRMED Deadline'ları birlikte listeliyor.
15. İptal edilen duruşmada gerekçe zorunlu; iptal kaydı dosya safahatında görünüyor ve takvimden düşüyor.

## Faz

**Faz 1**: today ekranı, takvim, sonuç disiplini, HEARING_PREP + batch. **Faz 2**: otomatik gece üretimi ince ayarları, HEARING_RESULT_PARSE'ın tutanak OCR'ından tam otomatik çalışması, e-duruşma entegrasyon derinleştirmesi (UYAP Hub ile).
