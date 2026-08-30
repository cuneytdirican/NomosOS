# Modül 04 — Süre / Deadline Motoru

## Amaç

Hukukta AI'ın en değerli işi dilekçe yazmak değil, **"bir şeyi kaçırmama yardım et"** işidir. Kaçırılan bir istinaf süresi telafi edilemez ve doğrudan tazminat/disiplin sorumluluğu doğurur. Benchmark ürün süreleri sohbet cevabı olarak söyleyebilir; NomosOS'ta süre, hesaplanan, onaylanan, izlenen ve eskale edilen birinci sınıf bir kayıttır.

**Kritik mimari ilke (Gereksinim 4):** Kesin hukuki süre hesabı asla LLM'e bırakılmaz. Hesap **deterministik**tir: `tebliğ tarihi + tebliğ yöntemi + mevzuat kuralı + resmi tatil takvimi → son gün`. AI'ın rolü tespittir: belgeyi okur, "bu karar 18 Ağustos'ta tebliğ edilmiş, istinaf süresi işliyor olabilir" der ve **yalnızca ÖNERİ** üretir; hesap kural motorunda yapılır, avukat onaylar. Onaylanmamış öneri hiçbir hatırlatma zincirine "kesin süre" olarak girmez.

Bu hibrit tasarım (kural motoru + AI tespit) modülün tamamıdır: versiyonlanabilir kural tanımları, tatil takvimi, hesap algoritması, öneri-onay akışı ve eskalasyonlu hatırlatma.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, tebliğ tarihi ve kural seçtiğimde son günün otomatik ve doğru hesaplanmasını istiyorum ki elle takvim saymayayım.
2. **Avukat olarak**, gelen karardan AI'ın süre tespiti yapıp bana öneri düşürmesini istiyorum ki gözden kaçan tebligat kalmasın.
3. **Avukat olarak**, AI önerisini tek ekranda kaynak belge görüntüsüyle yan yana doğrulayıp onaylamak istiyorum ki hesabın girdisini bizzat kontrol edeyim.
4. **Avukat olarak**, son günü hafta sonuna denk gelen sürenin ilk iş gününe uzatılmasını (HMK m.93) sistemin otomatik yapmasını istiyorum.
5. **Avukat olarak**, e-tebligatta sürenin, tebligatın muhatabın adresine ulaştığı tarihi izleyen 5. günün sonunda başlamasını (7201 s.K. m.7/a) sistemin bilmesini istiyorum.
6. **Partner olarak**, bürodaki tüm kritik süreleri (≤7 gün) tek listede görmek istiyorum ki "kritik süre: 9" uyarısını sabah göreyim.
7. **Avukat olarak**, süre yaklaştıkça kademeli bildirim (7 gün / 3 gün / 1 gün / bugün) almak istiyorum.
8. **Partner olarak**, son 24 saate girmiş onaysız veya görevlendirilmemiş sürelerde bana eskalasyon gelmesini istiyorum.
9. **Admin olarak**, mevzuat değiştiğinde kural tanımını yeni geçerlilik tarihiyle versiyonlamak istiyorum ki eski dosyalarda eski kural uygulanmaya devam etsin.
10. **Avukat olarak**, adli tatile (20 Temmuz–31 Ağustos) denk gelen sürelerde uygulanacak uzamayı kural bazında görmek istiyorum.

## Ekranlar ve UX

### 1. Süre Listesi — `/app/deadlines`
Renk kodlu liste: 🔴 bugün/geçmiş · ⚠️ ≤7 gün · 🟡 ≤30 gün · 🟢 sonrası. Filtreler: dosya, sorumlu, kural tipi, durum.

```
┌────────────────────────────────────────────────────────────────────┐
│ SÜRELER          [Tümü|Benim] [⚠ Kritik: 4]  [Onay Bekleyen: 2]   │
├────────────────────────────────────────────────────────────────────┤
│ 🔴 BUGÜN  Ara karar gereği belge sunma      2026/145 İst.12.İş    │
│ ⚠️ 3 gün  Cevap dilekçesi (HMK m.127)       2026/201 Ank.4.Asliye │
│ ⚠️ 5 gün  İstinaf (HMK m.345)               2025/341 İst.12.İş    │
│ ⚠️ 8 gün  Bilirkişi raporuna itiraz         2024/91  Bursa 2.Tük. │
│ 🟢 12 gün Duruşma                           2026/72  Ank.4.Asliye │
├────────────────────────────────────────────────────────────────────┤
│ 💡 ONAY BEKLEYEN ÖNERİ: "Gerekçeli karar 18.08'de tebliğ edilmiş. │
│    HMK_ISTINAF → son gün 01.09.2026"       [İncele ve Onayla ▸]   │
└────────────────────────────────────────────────────────────────────┘
```

### 2. Öneri Onay Kuyruğu — `/app/deadlines/suggestions`
Sol: kaynak belge görüntüleyici (tespit edilen tebliğ tarihi vurgulu). Sağ: öneri kartı — kural, tebliğ tarihi/yöntemi (düzenlenebilir), hesap dökümü satır satır, [Onayla] / [Düzelt ve Onayla] / [Reddet].

### 3. Kural Yönetimi — `/app/settings/deadline-rules` (ADMIN)
Kural listesi, versiyon geçmişi, geçerlilik aralıkları, test aracı ("şu tebliğ tarihi + yöntem için son gün?").

## Veri Modeli

### DeadlineRule (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| code | text | HMK_CEVAP, HMK_ISTINAF... (tenant'lar arası ortak, sistem tablosu) |
| name | text | "Cevap dilekçesi süresi" |
| legal_basis | text | "HMK m.127" |
| duration_value | int | 2 |
| duration_unit | enum(DAY, WEEK, MONTH) | Hafta/ay hesabı HMK m.92'ye göre (son hafta/ayın karşılık günü) |
| start_trigger | enum(NOTIFICATION, PRONOUNCEMENT, HEARING_DATE, CUSTOM) | Tebliğ / tefhim / duruşma günü |
| extend_if_holiday | bool | Son gün tatilse ilk iş günü (varsayılan true) |
| judicial_recess_applies | bool | Adli tatilde uzama uygulanır mı (HMK m.104) |
| valid_from / valid_to | date | Mevzuat versiyonlama |

Örnek çekirdek kural seti (seed):

| code | Süre | Dayanak | Başlangıç |
|------|------|---------|-----------|
| HMK_CEVAP | 2 hafta | HMK m.127 | Dava dilekçesinin tebliği |
| HMK_ISTINAF | 2 hafta | HMK m.345 | Kararın tebliği |
| HMK_TEMYIZ | 2 hafta | HMK m.361 | Kararın tebliği |
| HMK_BILIRKISI_ITIRAZ | 2 hafta | HMK m.281 | Raporun tebliği |
| IIK_ODEME_EMRI_ITIRAZ | 7 gün | İİK m.62 | Ödeme emrinin tebliği |
| IIK_ISTINAF | 10 gün | İİK m.363 | Kararın tebliği/tefhimi |
| CMK_ISTINAF | 2 hafta | CMK m.273 (7445 sonrası) | Hükmün tebliği/tefhimi |
| IDARE_DAVA_ACMA | 60 gün | İYUK m.7 | Yazılı bildirim |

### Holiday (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| date | date | Resmi tatil günü (yarım günler tam sayılır — hesap notu) |
| name | text | "Kurban Bayramı 1. gün" |
| kind | enum(OFFICIAL, JUDICIAL_RECESS) | Resmi tatil / adli tatil aralığı işaretlemesi |

### Deadline (çekirdek, genişletilmiş)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id | uuid | |
| case_id | uuid FK→Case | |
| rule_id | uuid FK→DeadlineRule nullable | MANUAL kayıtta null |
| title | text | |
| source | enum(MANUAL, RULE, AI_SUGGESTED) | |
| status | enum(SUGGESTED, CONFIRMED, DONE, MISSED, REJECTED, CANCELLED) | |
| notification_date | date nullable | Tebliğ tarihi (hesap girdisi) |
| notification_method | enum(NORMAL, E_TEBLIGAT, TEFHIM, ILANEN) | |
| effective_start_date | date | Hesaplanan süre başlangıcı |
| due_date | date | Hesaplanan/onaylanan son gün |
| calculation_log | jsonb | Hesap dökümü (adım adım, denetlenebilir) |
| source_document_id | uuid FK→Document nullable | AI tespitinin kaynağı |
| assignee_user_id | uuid FK→User | Sorumlu |
| confirmed_by / confirmed_at | uuid / timestamptz | Onaylayan avukat |
| ai_confidence | numeric nullable | AI tespiti güven skoru |

## Hesap Algoritması (deterministik)

```
hesapla(rule, notification_date, notification_method):
  1. start = notification_date
     - E_TEBLIGAT ise: start = notification_date + 5 gün (7201 s.K. EK m.7/a —
       muhatabın adresine ulaşmayı izleyen 5. günün sonunda tebliğ sayılır)
     - TEFHIM ise: start = tefhim günü
  2. Süre, start'ı izleyen günden işlemeye başlar (HMK m.90-92)
  3. unit=WEEK/MONTH: son gün = son hafta/ayın, başlangıca karşılık gelen günü (HMK m.92)
     unit=DAY: gün sayarak
  4. rule.judicial_recess_applies ve son gün adli tatil içindeyse:
     son gün = adli tatil bitiminden itibaren 1 hafta uzar (HMK m.104)
  5. rule.extend_if_holiday ve son gün resmi tatil/hafta sonu ise:
     ilk iş gününe kaydır (HMK m.93)
  6. Her adım calculation_log'a yazılır.
Örnek: gerekçeli karar tebliği 18.08.2026 (Salı, normal tebligat), HMK_ISTINAF (2 hafta)
→ son gün 01.09.2026 Salı. Adli tatil kuralı uygulanıyorsa m.104 uzaması ayrıca loglanır.
```

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| DEADLINE_DETECT | document_id → {tespit edilen tebliğ tarihi, önerilen rule_code, gerekçe, güven skoru} → SUGGESTED Deadline | Belgenin OCR metni + belge sınıfı + dosya aşaması | Metin PII maskeleme hattından geçer; AI **tarih ve kural tespit eder, gün HESAPLAMAZ** — hesap kural motorunda |
| DEADLINE_AUDIT | case_id → "bu dosyada kaçırılmış/kaçırılma riski olan süreler" raporu (ÖNERİ) | Safahat + kararlar + mevcut Deadline'lar | Rapor bilgilendirmedir, kayıt üretmez; avukat tek tek öneriye çevirir |

## İş Kuralları

1. `source=RULE/AI_SUGGESTED` bir Deadline'ın `due_date`'i yalnızca hesap fonksiyonundan yazılır; API'den doğrudan due_date güncellenemez (MANUAL hariç).
2. SUGGESTED durumundaki süre; ana listede ayrı bölümde görünür, kademeli hatırlatma zincirine girmez, dashboard "kritik süre" sayacına "onaysız" etiketiyle ayrıca yansır.
3. Onay (CONFIRMED) yalnızca AVUKAT ve PARTNER rollerince verilebilir; onayda `confirmed_by` + `calculation_log` snapshot'ı AuditLog'a yazılır.
4. Avukat öneriyi düzeltirse (tarih/yöntem/kural) hesap otomatik yeniden çalışır; AI'ın ilk tespiti ve düzeltme farkı saklanır (model kalite ölçümü için).
5. Bildirim zinciri (CONFIRMED için): D-7, D-3, D-1 ve gün içinde sorumluya; D-1'de sorumlu + Partner'a.
6. `due_date` geçtiği halde DONE işaretlenmemiş süre MISSED olur; MISSED, Partner onayı olmadan kapatılamaz ve dosya risk göstergesini kırmızıya çeker.
7. Kural versiyonlaması: hesap her zaman `notification_date` itibarıyla geçerli (`valid_from/valid_to`) kural sürümüyle yapılır.
8. Holiday tablosu yılda bir Admin tarafından yayınlanır; gelecek yıl takvimi yüklü değilse o yıla taşan hesaplarda uyarı üretilir.
9. Aynı kaynak belge + aynı kural için ikinci öneri açılmaz (tekilleştirme).
10. Bir Deadline'a bağlı Task tamamlanınca süre otomatik DONE olmaz; avukat açıkça kapatır (dilekçe yazıldı ≠ verildi).

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET | /api/v1/deadlines?status=&window=&assignee= | Liste (kritik pencere filtresi) |
| POST | /api/v1/deadlines | MANUAL süre |
| POST | /api/v1/deadlines/calculate | `{rule_code, notification_date, notification_method}` → hesap + log (kayıt açmadan) |
| POST | /api/v1/deadlines/:id/confirm | Öneriyi onayla (rol kontrolü) |
| POST | /api/v1/deadlines/:id/reject · /done | Reddet / tamamlandı |
| PATCH | /api/v1/deadlines/:id/inputs | Tebliğ tarihi/yöntem düzelt → yeniden hesap |
| GET | /api/v1/deadlines/suggestions | Onay kuyruğu |
| GET/POST | /api/v1/deadline-rules | Kural listesi / (ADMIN) yeni versiyon |
| GET | /api/v1/holidays?year= | Tatil takvimi |

## Diğer Modüllerle İlişkiler

- **02 Dava**: CaseDecision.notified_at girişi ve aşama geçişleri ilgili kuralı tetikler; Süreler sekmesi bu modülden beslenir.
- **03 Duruşma**: duruşma sonucu ayrıştırması (HEARING_RESULT_PARSE) süre önerilerini bu modülün kuyruğuna yazar; takvim Deadline katmanını buradan alır.
- **05 İcra**: İİK kuralları (IIK_*) aynı motorla çalışır; "hangi süreleri kaçırdık" analizi DEADLINE_AUDIT'i kullanır.
- **06 Belge**: pipeline'ın 5. adımı DEADLINE_DETECT'tir; kaynak belge bağı `source_document_id` ile kurulur.
- **07 Görev**: CONFIRMED süre, ilişkili Task üretebilir (`deadline_id` bağı); istinaf workflow'unun toplam takvimi süreden geri hesaplanır.
- **19 Dashboard**: "KRİTİK SÜRE 9" sayacı bu modülden.

## Kabul Kriterleri

1. `calculate` ucu; 18.08.2026 tebliğ + NORMAL + HMK_ISTINAF için 01.09.2026 döndürüyor ve calculation_log'da her adım görünüyor.
2. E_TEBLIGAT yönteminde başlangıç, tebliğ verisinin ulaşma tarihine 5 gün eklenerek hesaplanıyor (birim testi).
3. Son günü cumartesiye düşen hesap pazartesiye kayıyor; resmi tatile düşen hesap ilk iş gününe kayıyor.
4. Adli tatil kapsamındaki kural için son gün tatil içindeyse m.104 uzaması uygulanıyor ve logda gerekçesiyle görünüyor.
5. DEADLINE_DETECT, tebliğ şerhi içeren örnek karar PDF'inden SUGGESTED Deadline üretiyor; due_date'i kural motoru hesaplamış (AI çıktısında gün yok).
6. SUGGESTED süre onaylanmadan D-3 bildirimi gitmiyor; onaylanınca zincir kuruluyor.
7. STAJYER rolü confirm ucundan 403 alıyor.
8. AI önerisindeki tebliğ tarihi düzeltildiğinde due_date otomatik yeniden hesaplanıyor; ilk tespit ve düzeltme farkı kayıtta.
9. RULE kaynaklı Deadline'ın due_date'ini doğrudan PATCH etme denemesi 422 döndürüyor.
10. Aynı belge + aynı kural için ikinci DEADLINE_DETECT çağrısı yeni öneri açmıyor (idempotency testi).
11. MISSED süre Partner onayı olmadan kapatılamıyor.

## Faz

**Faz 1**: Kural motoru, seed kural seti, Holiday takvimi, öneri-onay akışı, bildirim zinciri, DEADLINE_DETECT. **Faz 2**: DEADLINE_AUDIT, kural kapsamının genişletilmesi (idari yargı, tüketici hakem heyeti vb.) ve düzeltme-farkı verisiyle tespit kalitesi raporu.
