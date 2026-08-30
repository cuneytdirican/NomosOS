# Modül 06 — Belge Yönetimi (DMS) + Otomatik Aksiyon Hattı

## Amaç

Mevcut paradigma "belge yükle → AI'a sor" şeklindedir; benchmark ürün bunu iyi yapar ama belge geldikten sonra ne yapılacağını çıkarmak tamamen kullanıcıya kalır. NomosOS paradigması: **"Belge geldi → sistem ne yapılması gerektiğini kendisi çıkardı."** Ürünün asıl farklılaştığı yer burasıdır (Gereksinim 7).

Modülün iki katmanı vardır. Birincisi klasik ama sağlam bir **DMS çekirdeği**: dosya/müvekkil bazlı otomatik klasörleme, versiyonlama, OCR ve tam metin arama. İkincisi **event-driven otomatik aksiyon hattı**: bir belge sisteme girdiğinde (yükleme, UYAP senkronu, e-posta) `DOCUMENT_INGESTED` olayı yayınlanır ve pipeline sırasıyla OCR → AI sınıflandırma → dosyaya bağlama → bilgi çıkarımı → süre tespiti → görev oluşturma → bildirim adımlarını yürütür. Her adım loglanır, tekrar oynatılabilir ve düşük güvenli sonuçlar insan onayına (triage kuyruğu) düşer.

Örnek: mahkeme ara kararı geldi → "Bu belge ara karardır. Bilirkişi raporu talep edilmiş, 2 haftalık süre verilmiş, X belgesinin sunulması istenmiş" → görev + son tarih önerisi + sorumlu avukata bildirim + müvekkil bilgilendirme taslağı — hepsi avukat onay noktaları korunarak otomatik hazırlanır.

## Kullanıcı Hikâyeleri

1. **Sekreter olarak**, taranmış bir tebligatı sürükle-bırak yüklediğimde sistemin belgeyi sınıflandırıp doğru dosyaya bağlamasını istiyorum ki elle klasör aramayayım.
2. **Avukat olarak**, gelen ara karardan sistemin tespitleri (istenen belge, verilen süre) ve önerilen aksiyonları çıkarıp bana onay kartı sunmasını istiyorum.
3. **Avukat olarak**, dosyaya bağlanamayan belgelerin triage kuyruğuna düşmesini istiyorum ki hiçbir evrak sahipsiz kalmasın.
4. **Avukat olarak**, tüm belgelerde tam metin arama yapmak istiyorum ("bilirkişi kök neden" gibi) ki eski dosyalardaki bilgiye saniyeler içinde ulaşayım.
5. **Avukat olarak**, aynı dilekçenin versiyonlarını (taslak v1, v2, mahkemeye sunulan) tek kayıt altında görmek istiyorum ki hangi metnin sunulduğu tartışmasız olsun.
6. **Partner olarak**, pipeline'ın hangi belgede hangi adımda takıldığını görmek istiyorum ki otomasyona körü körüne güvenmek zorunda kalmayayım.
7. **Sekreter olarak**, sınıflandırma güveni düşük belgeleri listeden düzeltmek istiyorum ki sistem zamanla daha isabetli çalışsın.
8. **Avukat olarak**, bir belgenin hangi Deadline ve Task kayıtlarını doğurduğunu belge kartında görmek istiyorum ki izlenebilirlik tam olsun.
9. **Admin olarak**, belge depolamanın tenant bazlı izole olmasını ve her erişimin loglanmasını istiyorum (müvekkil sırrı + KVKK).
10. **Avukat olarak**, duruşma tutanağı geldiğinde ilgili duruşma kaydına otomatik iliştirilmesini istiyorum.

## Ekranlar ve UX

### 1. Belge Havuzu — `/app/documents`
Filtreler: dosya, müvekkil, belge sınıfı, tarih, kaynak (yükleme/UYAP/e-posta). Tam metin arama kutusu (sonuçlarda vurgulu snippet). Tablo: ad, sınıf, dosya, tarih, versiyon, pipeline durumu.

### 2. Gelen Kutusu / Triage — `/app/documents/inbox`

```
┌────────────────────────────────────────────────────────────────────┐
│ 📥 GELEN KUTUSU (3 onay bekliyor · 1 eşleşemedi)                   │
├────────────────────────────────────────────────────────────────────┤
│ ⚠ ara_karar_2026145.pdf                        UYAP · 09:12       │
│   AI: ARA_KARAR (%96) → 2026/145 İst. 12. İş (%99)                 │
│   TESPİT: Bilirkişi raporu talep edilmiş · 2 hafta süre verilmiş   │
│           X belgesinin sunulması istenmiş                          │
│   ÖNERİLEN: ☑ Görev: "Belgeyi sun" (Av. Yılmaz)  ☑ Süre: 13.09    │
│             ☑ Müvekkil bilgilendirme taslağı                       │
│   [Tümünü Onayla] [Düzenle] [Reddet]                               │
├────────────────────────────────────────────────────────────────────┤
│ ❓ fatura_scan_003.pdf — dosya eşleşmedi (%41) → [Dosya Seç ▾]     │
└────────────────────────────────────────────────────────────────────┘
```

### 3. Belge Detay — `/app/documents/:id`
Sol: PDF/görüntü görüntüleyici (OCR katmanı, arama vurgusu). Sağ panel: meta (sınıf, dosya, versiyonlar), pipeline zaman çizgisi (adım adım), doğurduğu kayıtlar (Deadline/Task/TimelineEvent bağları), AI özeti.

### 4. Pipeline İzleme — `/app/settings/pipeline` (ADMIN/PARTNER)
Son çalıştırmalar, adım bazlı başarı oranları, takılan adımlar, [Yeniden Oynat] aksiyonu.

## Veri Modeli

### Document (çekirdek, genişletilmiş)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id | uuid | |
| case_id | uuid FK→Case nullable | Eşleşme öncesi null |
| client_id | uuid FK→Client nullable | Dosyasız müvekkil belgesi |
| folder_id | uuid FK→Folder | |
| title | text | |
| doc_class | enum — bkz. taksonomi | AI veya insan sınıflandırması |
| class_confidence | numeric nullable | AI güven skoru |
| class_source | enum(AI, HUMAN, RULE) | İnsan düzeltmesi AI'ı ezer |
| source | enum(UPLOAD, UYAP_SYNC, EMAIL, GENERATED) | |
| storage_key | text | Tenant-izole obje deposu anahtarı |
| mime_type / size_bytes | text / bigint | |
| ocr_status | enum(PENDING, DONE, FAILED, NOT_NEEDED) | |
| ocr_text | text | Tam metin arama kaynağı (tsvector indeksli) |
| received_at | timestamptz | Belgenin geliş anı |
| uploaded_by | uuid FK→User nullable | UYAP/e-postada null |

**DocumentClass taksonomisi**: `DILEKCE, CEVAP_DILEKCESI, ARA_KARAR, GEREKCELI_KARAR, ISTINAF_KARARI, TEMYIZ_KARARI, TENSIP_ZAPTI, DURUSMA_TUTANAGI, BILIRKISI_RAPORU, EK_RAPOR, TEBLIGAT, MUZEKKERE, ODEME_EMRI, HACIZ_TUTANAGI, VEKALETNAME, SOZLESME, FATURA, DELIL, YAZISMA, DIGER`

### DocumentVersion (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| document_id | uuid FK→Document | |
| version_no | int | 1'den artan |
| storage_key | text | |
| note | text | "Mahkemeye sunulan nüsha" |
| created_by / created_at | uuid / timestamptz | |

### Folder (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| tenant_id | uuid | |
| case_id / client_id | uuid nullable | Otomatik kök klasörler |
| parent_id | uuid FK→Folder nullable | |
| name | text | |

### PipelineRun / PipelineStep (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| PipelineRun: id, document_id, trigger_event, status(RUNNING, WAITING_REVIEW, COMPLETED, FAILED), started_at, finished_at | | Belge başına bir koşum |
| PipelineStep: run_id, step_no, step_code, status, input_summary, output(jsonb), error, retried_count | | step_code: OCR, CLASSIFY, MATCH_CASE, EXTRACT, DETECT_DEADLINE, CREATE_TASKS, NOTIFY |

### DocumentActionProposal (yeni — onay kartı)
| Alan | Tip | Açıklama |
|------|-----|----------|
| document_id / run_id | uuid | |
| findings | jsonb | Tespit maddeleri ("2 hafta süre verilmiş") |
| proposed_actions | jsonb | [{type: TASK/DEADLINE/CLIENT_BRIEF/STRATEGY_NOTE, payload}] |
| status | enum(PENDING, APPROVED, PARTIALLY_APPROVED, REJECTED) | |
| decided_by / decided_at | uuid / timestamptz | |

## Otomatik Aksiyon Hattı (event-driven)

```
DOCUMENT_INGESTED (upload/UYAP/e-posta)
  → [1 OCR]            metin çıkar; taranmış görüntüde zorunlu
  → [2 CLASSIFY]       AI: doc_class + güven; eşik altı → triage
  → [3 MATCH_CASE]     esas no + mahkeme + taraf adlarıyla eşleştir;
                       eşik altı → triage (insan dosya seçer)
  → [4 EXTRACT]        tespitler: tebliğ tarihi, verilen süreler,
                       istenen belgeler, talepler → findings
  → [5 DETECT_DEADLINE] Modül 04 DEADLINE_DETECT → SUGGESTED Deadline
  → [6 CREATE_TASKS]   önerilen görevler → DocumentActionProposal
  → [7 NOTIFY]         sorumlu avukata bildirim + onay kartı;
                       TimelineEvent(DOCUMENT) dosya safahatına
```
Her adım kuyruk üzerinde bağımsız işlenir (at-least-once); adımlar idempotent yazılır; FAILED adım Pipeline İzleme'den yeniden oynatılır.

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | Gördüğü veri | KVKK notu |
|-----------|---------------|--------------|-----------|
| DOC_CLASSIFY | ocr_text (ilk N sayfa) → {doc_class, confidence} | Yalnızca belge metni | Sınıflandırma öncesi PII maskeleme; BYO-LLM |
| DOC_MATCH_CASE | ocr_text + tenant'ın aday dosya listesi (esas no/taraf) → {case_id, confidence} | Metin + dosya başlık verisi | Aday liste yalnız tenant içi |
| DOC_EXTRACT | ocr_text + doc_class → findings (süre ifadeleri, istenen belgeler, talepler, tebliğ tarihi) | Belge metni | Çıktı öneridir; Deadline hesabını kural motoru yapar |
| DOC_SUMMARY | document_id → 5 maddelik özet (belge kartı için) | Belge metni | |
| CLIENT_BRIEF_DRAFT | findings → müvekkil diline çevrilmiş bilgilendirme taslağı | Findings + dosya başlığı | Taslak, avukat onayı olmadan gönderilmez (Modül 01 ile ortak görev tipi) |

## İş Kuralları

1. Her belge tenant-izole depoda tutulur; ham dosyaya erişim yalnızca imzalı, süreli URL ile olur ve AuditLog'a yazılır.
2. `class_confidence < 0.85` veya `MATCH_CASE < 0.90` ise ilgili adım otomatik ilerlemez; belge triage kuyruğuna düşer, koşum `WAITING_REVIEW` olur.
3. İnsan sınıf düzeltmesi (`class_source=HUMAN`) sonrası pipeline 4. adımdan devam eder; düzeltme, model kalite raporu için AI tahmini + insan kararı çifti olarak saklanır.
4. DocumentActionProposal onaylanmadan hiçbir Task oluşmaz ve hiçbir müvekkil bilgilendirmesi gönderilmez; Deadline önerileri Modül 04 kuyruğunda ayrıca onay bekler (çift onay değil: kart onayı deadline önerisini kural motoru kuyruğuna taşır).
5. `doc_class=DURUSMA_TUTANAGI` ve dosya eşleşmesi varsa belge, tarihi en yakın geçmiş Hearing'e `minutes_document_id` olarak önerilir.
6. Aynı içerik hash'iyle ikinci belge yüklenirse kopya uyarısı verilir, yeni koşum başlatılmaz.
7. Versiyon eklemek yeni Document açmaz; DocumentVersion artar, arama her zaman son versiyonun metninde yapılır.
8. Belge silinemez; `archived` işaretlenir. Dosyaya bağlı ve kayıt doğurmuş (Deadline/Task) belge arşivlenirken bağlar korunur.
9. Pipeline adımları hiçbir koşulda dış sisteme (UYAP dahil) yazma işlemi yapmaz; hat yalnızca NomosOS içi kayıt üretir.
10. E-posta ile gelen belgede gönderen adresi bilinen müvekkil/karşı vekil adresiyle eşleşirse kaynak etiketi otomatik atanır.

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| POST | /api/v1/documents | Yükleme (multipart) → DOCUMENT_INGESTED yayınlar |
| GET | /api/v1/documents?case_id=&class=&q= | Liste + tam metin arama |
| GET/PATCH | /api/v1/documents/:id | Detay / sınıf-dosya düzeltme (kural 3) |
| GET | /api/v1/documents/:id/download | İmzalı URL |
| GET/POST | /api/v1/documents/:id/versions | Versiyonlar |
| GET | /api/v1/documents/inbox | Triage kuyruğu (WAITING_REVIEW) |
| GET | /api/v1/documents/:id/pipeline | Koşum + adımlar |
| POST | /api/v1/pipeline/runs/:id/replay?from_step= | Yeniden oynat (ADMIN/PARTNER) |
| GET | /api/v1/documents/:id/proposal | Onay kartı |
| POST | /api/v1/documents/:id/proposal/decide | `{approved_action_ids[]}` (kural 4) |
| GET/POST | /api/v1/folders | Klasör ağacı |

## Diğer Modüllerle İlişkiler

- **02 Dava**: MATCH_CASE dosyaya bağlar; her belge safahata TimelineEvent düşürür; kararlar CaseDecision önerisi üretir.
- **03 Duruşma**: DURUSMA_TUTANAGI otomatik Hearing iliştirmesi; paket STALE işaretleme tetikleyicisi bu modülün olaylarıdır.
- **04 Süre**: 5. adım DEADLINE_DETECT'i çağırır; `source_document_id` izlenebilirliği sağlar.
- **05 İcra**: ODEME_EMRI/HACIZ_TUTANAGI sınıfları icra işlem günlüğüne bağlanır.
- **07 Görev**: onaylanan proposal aksiyonları Task olarak açılır (`source=PIPELINE`).
- **Gereksinim 6 UYAP Hub**: UYAP senkronu bu modülün en büyük belge kaynağıdır (source=UYAP_SYNC).
- **Gereksinim 20 KVKK**: maskeleme hattı tüm AI adımlarının önkoşuludur.

## Kabul Kriterleri

1. PDF yüklemesi tek istekte kabul ediliyor ve 60 sn içinde koşum OCR+CLASSIFY adımlarını tamamlıyor (10 sayfalık örnek).
2. Örnek ara karar belgesi ARA_KARAR sınıfı ve doğru dosya eşleşmesiyle otomatik bağlanıyor; findings'te "2 hafta" süre tespiti var.
3. Onay kartında 3 önerilen aksiyondan 2'si seçilip onaylandığında yalnızca o 2 kayıt oluşuyor; kart PARTIALLY_APPROVED oluyor.
4. Güveni %85 altındaki sınıflandırma triage kuyruğuna düşüyor; insan düzeltmesi sonrası koşum 4. adımdan devam ediyor.
5. Tam metin arama, OCR'lanmış taranmış belgede geçen ifadeyi vurgulu snippet ile buluyor.
6. Aynı dosyanın ikinci kez yüklenmesi kopya uyarısı veriyor, yeni koşum açmıyor.
7. FAILED bir adım replay ucuyla yeniden oynatılıyor ve önceki adım çıktılarları korunuyor.
8. Belge kartında doğurduğu Deadline ve Task kayıtları bağlantı olarak listeleniyor.
9. Farklı tenant'ın storage_key'i ile indirme denemesi 404; her indirme AuditLog'da.
10. Onaysız proposal beklerken hiçbir Task/müvekkil taslağı oluşmadığı doğrulanıyor.

## Faz

**Faz 1**: DMS çekirdeği (klasör, versiyon, OCR, tam metin arama) + pipeline'ın 1-3 ve 7. adımları (sınıflandır, bağla, bildir). **Faz 2**: EXTRACT + DETECT_DEADLINE + CREATE_TASKS adımlarıyla tam otomatik aksiyon hattı ve pipeline kalite raporları.
