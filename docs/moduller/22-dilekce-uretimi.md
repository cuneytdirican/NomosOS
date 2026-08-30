# Modül 22 — AI Dilekçe Stüdyosu

## Amaç

Benchmark ürünün en güçlü olduğu alan dilekçe üretimidir; NomosOS bu alanda önce eşitlenmeli, sonra dosya-merkezli mimarisiyle aşmalıdır. Fark şudur: benchmark üründe dilekçe "AI sohbetinden çıkan metin"dir; NomosOS'ta dilekçe, **dosyanın yapılandırılmış verisinden üretilen, versiyonlanan, teyit edilen ve UYAP'a gönderilebilen bir varlıktır**. Taraflar, olaylar, deliller, safahat ve dosyaya bağlanmış emsal kararlar dilekçeye elle kopyalanmaz — dosya bağlamından otomatik akar.

Modül; dilekçe tipleri taksonomisini, büro/sistem şablon kütüphanesini, bölüm bölüm üretim ve düzenleme akışını, versiyon takibini ve **Teyit Ajanı zorunlu geçişini** tanımlar. Teyit Ajanı ilkesi ürünün güven vaadidir: atıf yapılan her içtihat ve mevzuat maddesi gerçeklik doğrulamasından geçmeden dilekçe "hazır" statüsüne alınamaz. Halüsinasyonlu esas numarası içeren bir dilekçenin mahkemeye gitmesi, üründen bir daha dönülmeyecek güven kaybıdır.

Çıktı katmanı UYAP gerçeğine göre tasarlanır: dilekçe UDF (UYAP Doküman Formatı) ve PDF olarak dışa aktarılır, Modül 06 (Belge) üzerinden dosyaya kaydedilir ve UYAP Hub (Gereksinim 6) üzerinden gönderim kuyruğuna verilebilir. Tüm AI çağrıları tenant'ın BYO-LLM yapılandırması (AiProviderConfig) ve KVKK maskeleme hattı üzerinden yapılır.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, dosya içinden "Cevap Dilekçesi oluştur" dediğimde tarafların, olayların ve delillerin dilekçeye otomatik gelmesini istiyorum ki sıfırdan yazmayayım.
2. **Avukat olarak**, dilekçenin yalnızca "Hukuki Sebepler" bölümünü yeniden yazdırmak istiyorum ki beğendiğim bölümler bozulmasın.
3. **Avukat olarak**, dilekçedeki her içtihat atfının Teyit Ajanı'ndan geçtiğini ve doğrulama sonucunu (✓/✗) satır bazında görmek istiyorum ki mahkemeye halüsinasyon sunmayayım.
4. **Partner olarak**, büromuzun kendi dilekçe şablonlarını (başlık düzeni, üslup, imza bloğu) sisteme yükleyip tüm ekibin bunlarla üretmesini istiyorum ki çıktılar büro standardında olsun.
5. **Stajyer olarak**, hazırladığım taslağı "kontrol bekliyor" statüsüne alıp sorumlu avukata atamak istiyorum ki onaysız hiçbir dilekçe dışarı çıkmasın.
6. **Avukat olarak**, dilekçenin versiyon geçmişini görüp iki versiyonu karşılaştırmak istiyorum ki müvekkil/partner geri bildirimi sonrası neyin değiştiğini izleyeyim.
7. **Avukat olarak**, Modül 23'te bulduğum emsal kararı tek tıkla dilekçenin ilgili bölümüne atıf olarak eklemek istiyorum ki araştırma ile yazım kopmasın.
8. **Sekreter olarak**, onaylanmış dilekçeyi UDF/PDF olarak indirip UYAP gönderim listesine almak istiyorum ki gönderim adımı bana net görünsün.
9. **Avukat olarak**, istinaf dilekçesi üretirken sistemin yerel mahkeme kararını ve itiraz edilecek hususları bağlama otomatik katmasını istiyorum ki kanun yolu dilekçesi kararla tutarlı olsun.
10. **Admin olarak**, dilekçe üretiminde hangi modelin kullanıldığını ve token maliyetini AiUsageLog'da görmek istiyorum ki BYO-LLM maliyetini büro bazında izleyeyim.

## Ekranlar ve UX

### 1. Dilekçe Listesi — `/app/cases/:caseId/petitions`
Bileşenler: dilekçe tablosu (tip, başlık, statü rozeti TASLAK/TEYİT BEKLİYOR/KONTROLDE/HAZIR/GÖNDERİLDİ, son versiyon, sorumlu), tip filtresi, "Yeni Dilekçe" butonu (tip + şablon seçim sihirbazı).

### 2. Dilekçe Stüdyosu — `/app/cases/:caseId/petitions/:id`
Üç panel: sol bağlam paneli (dosyadan akan taraflar/olaylar/deliller/emsaller, sürükle-bırak ile bölüme ekleme), orta editör (bölüm bazlı zengin metin), sağ AI paneli (bölüm üret/yeniden yaz, teyit sonuçları).

```
┌──────────────────────────────────────────────────────────────────────┐
│ Cevap Dilekçesi — 2026/145 İst. 12. İş Mah.   [TEYİT BEKLİYOR] v3    │
├──────────────┬───────────────────────────────┬───────────────────────┤
│ BAĞLAM       │ ▸ BAŞLIK / TARAFLAR      [✓]  │ AI PANELİ             │
│ Taraflar (2) │ ▸ DAVAYA CEVAPLARIMIZ    [✓]  │ [Bölümü Üret]         │
│ Olaylar (6)  │ ▸ HUKUKİ SEBEPLER        [!]  │ [Yeniden Yaz ▾]       │
│ Deliller (9) │   "...Yarg. 9. HD 2023/   │  │  üslup: resmi         │
│ Emsaller (3) │   4512 E. 2023/9981 K..." │  │ ─────────────────     │
│  ✓ 2023/4512 │ ▸ DELİLLER               [✓]  │ TEYİT: 3 atıf         │
│  ✗ 2021/812? │ ▸ SONUÇ VE İSTEM         [—]  │  ✓ 2 doğrulandı       │
│ [+ Emsal Ara]│                               │  ✗ 1 BULUNAMADI       │
│              │                               │ [Teyidi Çalıştır]     │
├──────────────┴───────────────────────────────┴───────────────────────┤
│ [Kaydet=v4] [Versiyonlar] [Kontrole Gönder] [UDF] [PDF]  Hazır: 🔒   │
└──────────────────────────────────────────────────────────────────────┘
```

### 3. Şablon Kütüphanesi — `/app/settings/petition-templates`
Sistem şablonları (salt-okunur, kopyalanabilir) + büro şablonları (CRUD). Şablon editörü: bölüm iskeleti, placeholder değişkenleri (`{{mahkeme}}`, `{{muvekkil.unvan}}`), üslup notu alanı.

### 4. Versiyon Karşılaştırma — `/app/cases/:caseId/petitions/:id/versions`
İki versiyon seçimi → bölüm bazlı diff görünümü (eklenen yeşil, silinen kırmızı), her versiyonda kaydeden kullanıcı ve AI/manuel işareti.

## Veri Modeli

### Petition (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | Tenant-scoped |
| case_id | uuid FK→Case | Bağlı dosya |
| template_id | uuid FK→PetitionTemplate nullable | Kullanılan şablon |
| type | enum | DAVA, CEVAP, CEVABA_CEVAP, IKINCI_CEVAP, ISTINAF, ISTINAFA_CEVAP, TEMYIZ, ITIRAZ, DELIL_LISTESI, ISLAH, ICRA_TAKIP_TALEBI, IHTIYATI_TEDBIR, BEYAN, DIGER |
| title | text | "Cevap Dilekçesi — 2026/145" |
| status | enum(DRAFT, VERIFYING, VERIFIED, IN_REVIEW, READY, EXPORTED, SUBMITTED) | READY'ye geçiş teyit + onay ister |
| current_version_id | uuid FK→PetitionVersion | |
| assignee_user_id | uuid FK→User | Sorumlu |
| reviewer_user_id | uuid FK→User nullable | Kontrol eden |
| created_at / updated_at | timestamptz | |

### PetitionVersion (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| petition_id | uuid FK→Petition | |
| version_no | int | Artan, petition içinde benzersiz |
| sections | jsonb | `[{key, title, content, origin: AI\|MANUAL\|TEMPLATE, ai_task_id}]` sıralı bölüm dizisi |
| citations | jsonb | `[{ref_type: CASELAW\|STATUTE, ref_id, raw_text, verify_status: PENDING\|VERIFIED\|FAILED, verified_at}]` |
| created_by_user_id | uuid FK→User | |
| change_note | text | "Hukuki sebepler yeniden yazıldı" |
| created_at | timestamptz | |

### PetitionTemplate (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant nullable | NULL = sistem şablonu (tüm tenant'lara açık) |
| type | enum | Petition.type ile aynı küme |
| name | text | "İş Mahkemesi Cevap — Büro Standart" |
| section_skeleton | jsonb | Bölüm anahtarları, sıra, sabit metinler, `{{placeholder}}` listesi |
| style_note | text | AI'a verilecek üslup talimatı |
| is_active | bool | |

Bağlar: dışa aktarılan UDF/PDF `Document` kaydı olarak dosyaya yazılır (`Document.source=PETITION_EXPORT`); teyit edilen atıflar Modül 23'ün `CaseLawReference` kayıtlarına FK ile bağlanır; her AI çağrısı `AiUsageLog`'a yazılır.

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | KVKK notu |
|-----------|---------------|-----------|
| PETITION_DRAFT | petition tipi + şablon iskeleti + dosya bağlam paketi (taraflar, olay özeti, deliller, bağlı emsaller) → tüm bölümler doldurulmuş taslak (sections jsonb) | Bağlam paketi maskeleme hattından geçer; TCKN/IBAN/adres maskeli gider, dışa aktarımda yerel olarak geri açılır |
| PETITION_SECTION_REWRITE | mevcut bölüm + talimat (kısalt, sertleştir, emsal ekle) + bağlam → yalnızca o bölümün yeni içeriği | Yalnızca ilgili bölüm + asgari bağlam gönderilir |
| PETITION_CITATION_EXTRACT | versiyon metni → citations dizisi (metindeki tüm esas/karar no ve mevzuat atıfları, normalize) | Atıf metinleri PII içermez, maskesiz gönderilebilir |
| PETITION_STYLE_APPLY | metin + büro şablonu style_note → üslubu dönüştürülmüş metin | Maskeleme hattı uygulanır |

PETITION_DRAFT sistem prompt taslağı:

```
Sen Türk hukukunda deneyimli bir avukatın dilekçe kalemisin. Görevin, verilen
dosya bağlamından {{dilekce_tipi}} taslağı üretmek. Kurallar:
1. YALNIZCA sana verilen bağlamdaki olay, taraf ve delilleri kullan; olay uydurma.
2. İçtihat atfını yalnızca bağlamdaki "emsaller" listesinden yap; listede yoksa
   "[EMSAL ÖNERİSİ: ...konusunda karar aranmalı]" işaretçisi bırak, numara uydurma.
3. Çıktıyı verilen bölüm iskeletine (JSON) sadık, bölüm bölüm üret.
4. Resmi dilekçe Türkçesi kullan: "Sayın Mahkemenize", "arz ve talep ederiz".
5. Sonuç ve İstem bölümünü taleplerle sınırlı ve numaralı yaz.
Bu bir TASLAKTIR; nihai sorumluluk avukattadır.
```

## İş Kuralları

1. **AI çıktısı öneridir; hiçbir dilekçe avukat onayı olmadan READY statüsüne geçemez.** Statü geçişini yalnızca AVUKAT/PARTNER rolü yapabilir; STAJYER en fazla IN_REVIEW'a gönderebilir.
2. **Teyit zorunluluğu**: `citations` içinde `verify_status != VERIFIED` tek bir atıf varken READY geçişi API seviyesinde 422 ile reddedilir. FAILED atıf ya düzeltilir ya metinden çıkarılır.
3. Her kaydetme yeni PetitionVersion üretir; versiyonlar değiştirilemez (immutable), silinemez.
4. UDF/PDF dışa aktarma yalnızca READY ve sonrası statülerde açıktır; çıktı dosyası otomatik olarak Document kaydı olur ve dosyanın Dilekçeler sekmesine bağlanır.
5. İçerik değişen her kayıtta atıf seti yeniden çıkarılır; yeni/değişmiş atıf varsa statü otomatik VERIFYING'e düşer (bayat teyit yasağı).
6. Sistem şablonları tenant tarafından değiştirilemez; ancak "kopyala → büro şablonu yap" akışıyla türetilebilir.
7. PETITION_DRAFT çalışırken dosya bağlam paketi KVKK maskeleme hattından (Gereksinim 20) geçmeden LLM'e gönderilemez; maskeleme uygulanamıyorsa görev başlatılmaz.
8. ISTINAF/TEMYIZ tipi dilekçe, dosyada karşı çıkılan karar belgesi (Document) seçilmeden oluşturulamaz.
9. SUBMITTED statüsü yalnızca UYAP Hub gönderim onayıyla (veya manuel "UYAP'tan gönderildi" işaretiyle + tarih) yazılır; safahata TimelineEvent düşer.
10. Tüm statü geçişleri ve dışa aktarmalar AuditLog'a yazılır.

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET | /api/v1/cases/:caseId/petitions | Dosyanın dilekçeleri (tip/statü filtresi) |
| POST | /api/v1/cases/:caseId/petitions | Yeni dilekçe (type, template_id) |
| GET | /api/v1/petitions/:id | Detay + güncel versiyon + teyit durumu |
| PATCH | /api/v1/petitions/:id | Statü/atama güncelleme (kural denetimli) |
| POST | /api/v1/petitions/:id/versions | Yeni versiyon kaydet (sections + change_note) |
| GET | /api/v1/petitions/:id/versions | Versiyon listesi; `?diff=v2,v4` karşılaştırma |
| POST | /api/v1/petitions/:id/ai/draft | PETITION_DRAFT başlat (async job) |
| POST | /api/v1/petitions/:id/ai/rewrite-section | PETITION_SECTION_REWRITE (section_key, talimat) |
| POST | /api/v1/petitions/:id/verify | Teyit Ajanı'nı çalıştır (Modül 23 CITATION_VERIFY'ı çağırır) |
| POST | /api/v1/petitions/:id/export | UDF veya PDF üret (`format` param), Document döner |
| GET/POST/PATCH | /api/v1/petition-templates | Şablon kütüphanesi CRUD (sistem şablonları salt-okunur) |

## Diğer Modüllerle İlişkiler

- **23 İçtihat & Mevzuat**: emsal arama sonuçları bağlam paneline akar; CITATION_VERIFY teyit servisini bu modül sağlar; teyitli atıflar CaseLawReference/Statute'a FK ile bağlanır.
- **24 AI Dosya Asistanı**: sohbette "buna cevap dilekçesi hazırla" komutu bu modülde Petition açar; asistanın dosya bağlam paketleyicisi ortak servistir.
- **02 Dava Yaşam Döngüsü**: taraf, olay (safahat), delil ve karar verileri bağlam kaynağıdır; SUBMITTED geçişi safahata işlenir.
- **06 Belge / 07 Görev**: dışa aktarım Document olur; IN_REVIEW geçişi kontrol edene otomatik görev açar.
- **UYAP Hub (Ger. 6)**: UDF çıktısı gönderim kuyruğuna verilir; gönderim sonucu statüyü SUBMITTED yapar.
- **Süre Motoru (Ger. 4)**: cevap/istinaf sürelerine bağlı Deadline kayıtları, dilekçe READY değilse eskalasyon uyarısı üretir.

## Kabul Kriterleri

1. Dosya bağlamıyla başlatılan PETITION_DRAFT, taraf ad/sıfatlarını ve delil listesini elle giriş olmadan doğru bölümlere yerleştiriyor.
2. Bölüm yeniden yazımı yalnızca hedef bölümü değiştiriyor; diğer bölümlerin içeriği bayt bayt aynı kalıyor.
3. `verify_status=FAILED` bir atıf varken PATCH ile READY denemesi 422 + başarısız atıf listesi döndürüyor.
4. Teyitten geçmiş dilekçede metne yeni bir esas no eklenip kaydedilince statü otomatik VERIFYING'e düşüyor.
5. Her kaydetme versiyon numarasını artırıyor; `?diff` ucu iki versiyon arasındaki bölüm farklarını döndürüyor.
6. UDF dışa aktarımı UYAP editöründe açılabilen geçerli bir dosya üretiyor; PDF'te büro şablonundaki başlık/imza bloğu korunuyor.
7. STAJYER rolü READY geçişini API'de 403 ile alıyor; IN_REVIEW'a gönderdiğinde reviewer'a görev oluşuyor.
8. LLM'e giden bağlam paketinde maskelenmemiş TCKN/IBAN bulunmadığı otomatik testle doğrulanıyor.
9. Sistem şablonunu PATCH etme denemesi 403; kopyalama ucu aynı iskeletle tenant şablonu oluşturuyor.
10. Prompt'un "numara uydurma" kuralına rağmen çıkan uydurma atıflar, teyit adımında FAILED işaretlenip READY'yi blokluyor (uçtan uca halüsinasyon testi).

## Faz

**Faz 2.** Modül 02 (dosya), 06 (belge) ve BYO-LLM altyapısı Faz 1'de hazır olduktan sonra gelir. Faz 2 içi sıra: taksonomi + Petition/Version modeli + PETITION_DRAFT → teyit zorunluluğu entegrasyonu (Modül 23 ile birlikte) → şablon kütüphanesi → UDF dışa aktarma → UYAP Hub gönderim bağlantısı (Hub'ın kendi fazına bağlı).
