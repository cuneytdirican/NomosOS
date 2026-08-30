# Modül 24 — AI Dosya Asistanı

## Amaç

`[P0, 10/10]` — Kaynak gereksinim 293. satırdaki "AI dosya asistanı"nın spec'idir. NomosOS'un tüm AI yeteneklerinin kullanıcıya açılan **ana yüzüdür**: avukat dosyanın içinde asistan panelini açar ve dosyanın tüm belgeleri, safahatı, tarafları, süreleri, görevleri ve emsalleri bağlam kabul edilerek sohbet eder. Teknik taban RAG'dir (Retrieval-Augmented Generation): belgeler parçalanır (chunking), embedding'lenir, soru anında ilgili parçalar geri getirilip (retrieval) modele bağlam olarak verilir. Böylece 3.000 sayfalık bir icra dosyasında bile cevaplar dosyanın gerçek içeriğine dayanır ve **her cevap kaynak gösterir** — hangi belgeye, hangi safahat kaydına dayandığı tıklanabilir referanslarla sunulur.

İkinci mod **genel büro asistanıdır**: dosyalar arası soru ("bu hafta hangi dosyalarda süre var?", "ABC Holding'in bekleyen görevleri neler?") kullanıcının yetki kapsamındaki yapılandırılmış veriden — Deadline, Task, Case, Client sorgularından — cevaplanır. Üçüncü katman **akıllı notlar**: AI destekli not alma, yaklaşan duruşma öncesi "bu dosyaya şu notu ekle" önerileri. Dördüncüsü **tam dosya analizi raporu**: tek komutla özet, taraflar, talepler, güçlü/zayıf yönler, eksikler ve öneriler içeren yapılandırılmış rapor.

Bu modül kendi başına "chatbot" değildir; NomosOS'un ayırt edici çizgisini taşır: sohbet geçmişi dosyaya kalıcı kaydedilir (büro hafızası), tüm çağrılar KVKK maskeleme hattından geçer ve BYO-LLM üzerinden **görev tipi→model eşlemesiyle** çalışır (örn. CASE_CHAT hızlı/ucuz modele, CASE_FULL_ANALYSIS güçlü modele — tenant AiProviderConfig'inde tanımlı). AI çıktısı her yerde öneridir; hukuki sorumluluk avukattadır ve arayüz bunu sürekli görünür kılar.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, dosya ekranında "karşı tarafın zamanaşımı def'i hangi dilekçede ve ne diyor?" diye sorup belgeye linkli cevap almak istiyorum ki dosyayı elle taramayayım.
2. **Avukat olarak**, her cevabın altında dayandığı belge/parça referanslarını görmek ve tıklayınca belgenin ilgili sayfasına gitmek istiyorum ki cevabı doğrulayabileyim.
3. **Avukat olarak**, tek komutla tam dosya analizi raporu (özet, taraflar, talepler, güçlü/zayıf yönler, eksikler, öneriler) almak istiyorum ki devraldığım dosyaya bir saatte hâkim olayım.
4. **Partner olarak**, genel asistana "bu hafta hangi dosyalarda süre var?" diye sorup dosya linkli bir liste almak istiyorum ki haftaya risk görünümüyle başlayayım.
5. **Avukat olarak**, sohbet sırasında önemli bir tespiti tek tıkla dosya notuna dönüştürmek istiyorum ki içgörü sohbette kaybolmasın.
6. **Avukat olarak**, yarınki duruşma öncesi asistanın "duruşma notu önerisi" üretmesini istiyorum ki hazırlığım dosyadaki son gelişmelerle beslensin.
7. **Stajyer olarak**, yetkim olan dosyalarda asistanla çalışmak ama finansal verilere dair soruların reddedilmesini istiyorum ki rol yetkilerim AI üzerinden delinmesin.
8. **Avukat olarak**, sohbet geçmişinin dosyaya kaydedilmesini ve meslektaşımın kaldığım yerden görebilmesini istiyorum ki dosya devri bilgi kaybetmesin.
9. **Admin olarak**, görev tipi→model eşlemesini (örn. CASE_CHAT→hızlı model, CASE_FULL_ANALYSIS→güçlü model) tenant ayarlarından yönetmek istiyorum ki maliyet/kalite dengesini büro kursun.
10. **Avukat olarak**, asistan cevabında dosyada bulunmayan bir bilgi istendiğinde "dosyada bu bilgi yok" denmesini istiyorum ki uydurma cevapla yanılmayayım.
11. **Avukat olarak**, sohbetten "bu konuda cevap dilekçesi hazırla" diyince asistanın beni Dilekçe Stüdyosu'na taslak başlatarak yönlendirmesini istiyorum ki modüller arasında kopukluk olmasın.

## Ekranlar ve UX

### 1. Dosya Asistanı Paneli — `/app/cases/:caseId/assistant`
Dosya ekranının sağına açılan kalıcı panel veya tam sayfa. Bileşenler: oturum listesi (geçmiş sohbetler), mesaj akışı (kaynak referans çipleriyle), giriş kutusu + hızlı komutlar (Tam Analiz, Duruşma Hazırlığı, Eksik Belge Taraması), "Nota çevir" butonu her AI mesajında.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 2026/145 — AI Dosya Asistanı        Oturum: "Bilirkişi hazırlık" ▾   │
├──────────────────────────────────────────────────────────────────────┤
│ SİZ: Karşı taraf zamanaşımı def'ini nerede ileri sürdü?              │
│                                                                      │
│ ASİSTAN: Davalı, 14.05.2026 tarihli cevap dilekçesinin "Usule        │
│ İlişkin İtirazlar" bölümünde TBK m.146 uyarınca 10 yıllık genel      │
│ zamanaşımının dolduğunu ileri sürmüştür. Ancak safahatta ıslahla     │
│ artırılan kısım yönünden ayrıca def'i bulunmamaktadır.               │
│ Kaynaklar: [📄 Cevap Dilekçesi s.3] [📄 Islah Dilekçesi] [📋 Safahat] │
│ ⚠ AI çıktısıdır, öneridir — hukuki değerlendirme avukata aittir.     │
│ [Nota Çevir] [Dilekçeye Aktar]                                       │
├──────────────────────────────────────────────────────────────────────┤
│ [Tam Analiz] [Duruşma Hazırlığı] [Eksik Belge]   Sorunuzu yazın… ➤   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. Genel Büro Asistanı — `/app/assistant`
Dosya bağımsız sohbet; yapılandırılmış sorgu cevapları tablo/kart olarak döner (süre listesi, görev listesi), her satır ilgili dosyaya linkli. Kapsam rozeti: "Yetkinizdeki 84 dosya üzerinden".

### 3. Tam Dosya Analizi Raporu — `/app/cases/:caseId/assistant/analysis/:id`
Bölümlü rapor görünümü: Özet · Taraflar ve Talepler · Güçlü Yönler · Zayıf Yönler · Eksikler (belge/delil/süre) · Öneriler; her maddede kaynak çipleri; PDF dışa aktarma; "rapor tarihi + üretildiği model" damgası.

### 4. Akıllı Notlar — `/app/cases/:caseId/notes`
Not listesi (manuel + AI önerili, öneriler "öneri" rozetiyle ve kabul/ret butonlarıyla), not editöründe "AI ile genişlet/özetle" eylemleri.

## Veri Modeli

### ChatSession (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| case_id | uuid FK→Case nullable | NULL = genel büro asistanı oturumu |
| user_id | uuid FK→User | Oturum sahibi |
| title | text | İlk mesajdan otomatik ("Bilirkişi hazırlık") |
| status | enum(ACTIVE, ARCHIVED) | |
| created_at / updated_at | timestamptz | |

### ChatMessage (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| session_id | uuid FK→ChatSession | |
| role | enum(USER, ASSISTANT, SYSTEM) | |
| content | text | Maskesi çözülmüş (görüntülenen) metin |
| citations | jsonb | `[{kind: DOCUMENT\|TIMELINE\|DEADLINE\|CASELAW, ref_id, chunk_id?, page?, quote}]` |
| ai_task_type | text nullable | CASE_CHAT, OFFICE_QUERY… |
| ai_usage_log_id | uuid FK→AiUsageLog nullable | Model, token, maliyet izi |
| created_at | timestamptz | |

### DocumentChunk (yeni entity — RAG altyapısı)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| document_id | uuid FK→Document | |
| chunk_index | int | Belge içi sıra |
| content | text | Parça metni (maskeli saklama: PII placeholder'lı) |
| page_from / page_to | int | Kaynak gösterimi için |
| embedding | vector | pgvector; embedding modeli tenant config'inde |
| embedding_model | text | Model değişiminde yeniden indeksleme tespiti |

### SmartNote (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id / case_id | uuid FK | |
| author_user_id | uuid FK→User | Öneriyi kabul eden veya yazan |
| origin | enum(MANUAL, AI_SUGGESTED, FROM_CHAT) | |
| status | enum(SUGGESTED, ACCEPTED, DISMISSED) | AI önerisi kabul edilmeden ACCEPTED olmaz |
| content | text | |
| related_ref | jsonb nullable | İlgili duruşma/süre/mesaj referansı |
| created_at | timestamptz | |

### CaseAnalysisReport (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id / case_id | uuid | |
| requested_by_user_id | uuid FK→User | |
| sections | jsonb | {summary, parties, claims, strengths, weaknesses, gaps, recommendations} + madde bazlı citations |
| model_used | text | Damga için |
| created_at | timestamptz | Raporlar immutable; güncel istenirse yenisi üretilir |

Bağlar: retrieval `DocumentChunk` + `TimelineEvent` + `Deadline` üzerinden; her AI mesajı `AiUsageLog`'a bağlanır; görev tipi→model eşlemesi `AiProviderConfig.task_model_map` (jsonb) alanında tutulur.

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | KVKK notu |
|-----------|---------------|-----------|
| CASE_CHAT | kullanıcı sorusu + retrieval sonucu parçalar + dosya meta özeti → kaynaklı cevap (content + citations) | Parçalar maskeli saklanır ve maskeli gider; cevap görüntülenirken yerelde maske çözülür |
| CASE_FULL_ANALYSIS | case_id → CaseAnalysisReport.sections (tüm bölümler kaynaklı) | Uzun bağlam; maskeleme hattı zorunlu; güçlü modele eşlenir |
| OFFICE_QUERY | dosyalar arası doğal dil soru → yapılandırılmış sorgu planı (deadline/task/case filtresi) → tablo cevap | LLM'e yalnızca soru + şema gider; veri sorgusu yerelde koşar, satır verisi modele gönderilmez (tool-use deseni) |
| SMART_NOTE | tetikleyici (yaklaşan duruşma / sohbet mesajı) + dosya son gelişmeleri → not önerisi (status=SUGGESTED) | Maskeleme hattı uygulanır |
| HEARING_PREP | duruşma + dosya bağlamı → duruşma hazırlık paketi (Gereksinim 3 formatında) | Maskeleme hattı uygulanır |

CASE_CHAT sistem prompt taslağı (kritik görev):

```
Sen NomosOS'un dosya asistanısın; Türk hukuk terminolojisine hâkim, temkinli bir
yardımcısın. SADECE sana verilen dosya bağlam parçalarına (belge alıntıları,
safahat, süreler, taraflar) dayanarak cevap ver. Kurallar:
1. Her iddianı en az bir kaynağa bağla; cevabın sonunda citations dizisini
   şemaya uygun doldur. Kaynaksız iddia yazma.
2. Bağlamda cevap yoksa açıkça "Dosyadaki belgelerde bu bilgiye rastlamadım"
   de; tahmin yürütme, genel hukuk bilgisiyle dosya olgusu üretme.
3. Hukuki değerlendirme sunduğunda bunun öneri olduğunu, nihai kararın avukata
   ait olduğunu hatırlat.
4. Metindeki [PII_x] maskelerini olduğu gibi koru, çözmeye çalışma.
5. Süre/tarih sorularında deterministik Süre Motoru kayıtlarını esas al; kendi
   süre hesabı yapma, yalnızca kayıtları aktar ve kontrol öner.
```

## İş Kuralları

1. **AI çıktısı öneridir, avukat onaylar**: her asistan cevabında kalıcı sorumluluk şeridi gösterilir; analiz raporları ve not önerileri kullanıcı kabulü olmadan hiçbir kaydı (görev, süre, not) otomatik oluşturmaz/değiştirmez.
2. Her LLM çağrısı KVKK maskeleme hattından (Gereksinim 20) geçer; maskeleme servisi çalışmıyorsa AI çağrısı yapılmaz, kullanıcıya açık hata gösterilir (fail-closed).
3. Her ASSISTANT mesajı en az bir citation taşımalıdır; retrieval boş döndüyse model "dosyada bilgi yok" kalıbıyla cevap verir ve mesaj `citations=[]` + `no_source=true` işaretiyle saklanır.
4. Asistan, kullanıcının RBAC yetkisini miras alır: retrieval ve OFFICE_QUERY yalnızca kullanıcının görebildiği dosya/alanlar üzerinde koşar (örn. STAJYER'e finans verisi retrieval'a bile girmez).
5. OFFICE_QUERY'de satır verisi LLM'e gönderilmez; LLM sorgu planı üretir, sorgu yerelde koşar, sonuç tablosu UI'da render edilir (veri minimizasyonu).
6. Sohbet oturumları dosyaya kalıcı kaydedilir; silinemez, yalnızca ARCHIVED yapılır. Dosyayı görme yetkisi olan herkes dosya oturumlarını okuyabilir; genel asistan oturumları yalnızca sahibine görünürdür.
7. Görev tipi→model eşlemesi AiProviderConfig'ten okunur; eşleme yoksa tenant'ın varsayılan modeli kullanılır; her çağrı AiUsageLog'a görev tipi + model + token + maliyetle yazılır.
8. Belge yüklendiğinde/güncellendiğinde chunk+embedding hattı asenkron çalışır; indekslenmemiş belge varken cevaba "X belgesi henüz indekslenmedi" uyarısı eklenir.
9. Atıf içeren hukuki içerik (emsal önerisi) dilekçeye aktarılırken Modül 22'nin teyit zorunluluğuna tabidir; asistan cevabındaki doğrulanmamış künye "teyitsiz" rozetiyle gösterilir.
10. CASE_FULL_ANALYSIS raporları immutable'dır; dosya değiştikçe eski rapor güncellenmez, tarih damgalı yeni rapor üretilir.
11. SMART_NOTE önerileri 30 gün içinde kabul edilmezse otomatik DISMISSED olur (öneri kirliliği önleme).

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET/POST | /api/v1/cases/:caseId/chat/sessions | Dosya oturumları listele / yeni oturum |
| GET/POST | /api/v1/chat/sessions | Genel asistan oturumları (case_id=null) |
| GET | /api/v1/chat/sessions/:id/messages | Mesaj geçmişi (citations dahil) |
| POST | /api/v1/chat/sessions/:id/messages | Mesaj gönder → SSE/stream cevap (CASE_CHAT/OFFICE_QUERY) |
| POST | /api/v1/chat/sessions/:id/archive | Oturumu arşivle |
| POST | /api/v1/cases/:caseId/ai/full-analysis | CASE_FULL_ANALYSIS başlat (async job) |
| GET | /api/v1/cases/:caseId/analysis-reports | Rapor listesi; `/:id` detay, `/:id/export` PDF |
| GET/POST/PATCH | /api/v1/cases/:caseId/notes | SmartNote CRUD (PATCH: kabul/ret) |
| POST | /api/v1/chat/messages/:id/to-note | AI mesajını FROM_CHAT notuna çevir |
| POST | /api/v1/chat/messages/:id/to-petition | Mesajdan Dilekçe Stüdyosu taslağı başlat |
| GET | /api/v1/documents/:id/index-status | Chunk/embedding durumu |
| GET/PATCH | /api/v1/settings/ai/task-model-map | Görev tipi→model eşlemesi (ADMIN) |

## Diğer Modüllerle İlişkiler

- **02 Dava**: dosya sekmelerinden (safahat, taraflar, süreler, deliller) bağlam paketi bu modülce üretilir ve Modül 22 ile paylaşılan ortak servistir; "AI Analiz" sekmesi bu modüldür.
- **22 Dilekçe Stüdyosu**: `to-petition` akışıyla sohbetten dilekçe taslağı başlar; asistan emsal önerileri teyit zorunluluğuna tabi olarak aktarılır.
- **23 İçtihat & Mevzuat**: "emsal bul" niyeti CASELAW_SEARCH'e delege edilir; cevaplardaki künyeler CITATION_VERIFY ile rozetlenir.
- **04 Süre Motoru**: süre soruları deterministik Deadline kayıtlarından cevaplanır; asistan süre hesaplamaz, tespit önerisini Süre Motoru onay akışına bırakır.
- **03 Duruşma**: HEARING_PREP, Gereksinim 3'teki "bugünkü duruşmalarımı hazırla" paketinin dosya-içi ucudur.
- **06 Belge**: chunk/embedding hattı belge yükleme pipeline'ına (Gereksinim 7) bağlanır.
- **BYO-LLM (Ger. 20)**: AiProviderConfig görev-model eşlemesi; yerel LLM seçiliyse tüm asistan trafiği tenant altyapısında kalır.

## Kabul Kriterleri

1. Dosya sohbetinde belge içeriğine dayalı soru, doğru belgeye ve sayfa aralığına linkli citation ile cevaplanıyor; çipe tıklama belge görüntüleyicisini ilgili sayfada açıyor.
2. Dosyada bulunmayan bilgi sorulduğunda cevap "dosyada rastlamadım" kalıbını içeriyor ve `no_source=true` işaretleniyor (halüsinasyon testi: tuzak soru seti).
3. CASE_FULL_ANALYSIS, yedi bölümü de dolu ve her bölümde en az bir kaynak çipi olan rapor üretiyor; rapor PDF olarak dışa aktarılabiliyor.
4. Genel asistanda "bu hafta hangi dosyalarda süre var?" sorusu, kullanıcının yetkisindeki dosyalarla sınırlı, dosya linkli ve Deadline kayıtlarıyla birebir tutarlı tablo döndürüyor.
5. OFFICE_QUERY çağrısında LLM'e giden payload'da müvekkil/dosya satır verisi bulunmadığı test ediliyor (yalnızca soru + şema).
6. STAJYER, finans alanı içeren soru sorduğunda cevapta finansal veri yer almıyor ve retrieval loglarında finans kaynağı görünmüyor (RBAC delme testi).
7. Maskeleme servisi kapatıldığında mesaj gönderimi 503 + açıklayıcı hata dönüyor; hiçbir LLM çağrısı yapılmıyor (fail-closed testi).
8. Sohbet oturumu, dosyayı görme yetkisi olan ikinci kullanıcıda mesaj geçmişiyle açılıyor; genel asistan oturumu ise sahibi dışında 404.
9. Görev tipi→model eşlemesi değiştirildiğinde sonraki CASE_CHAT çağrısı AiUsageLog'da yeni modelle görünüyor.
10. Yaklaşan duruşma için üretilen SMART_NOTE önerisi SUGGESTED statüsünde listeleniyor; kabul edilmeden dosya not listesinin "kesin" bölümünde görünmüyor; 30 gün sonra otomatik DISMISSED oluyor.
11. AI mesajı "Nota Çevir" ile FROM_CHAT kaynaklı nota dönüşüyor ve ilgili mesaj referansını taşıyor.

## Faz

**Faz 2.** Öncelik P0 olsa da Faz 1'in çekirdeklerine (Case, Document, Deadline, BYO-LLM AiProviderConfig, KVKK maskeleme hattı) bağımlıdır. Faz 2 içi sıra: chunk+embedding hattı + CASE_CHAT (kaynak gösterimli) → sohbet kalıcılığı ve RBAC kapsamı → CASE_FULL_ANALYSIS → OFFICE_QUERY (genel asistan) → SMART_NOTE ve HEARING_PREP.
