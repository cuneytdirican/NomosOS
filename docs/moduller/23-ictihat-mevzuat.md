# Modül 23 — İçtihat & Mevzuat Araştırma

## Amaç

Legal Core'un tabanıdır (UYAP · Mevzuat · İçtihat üçlüsünün araştırma ayağı). Avukatın günlük araştırma döngüsü — "bu konuda Yargıtay ne diyor, dayanacağım madde yürürlükte mi, bulduğum kararı dosyama nasıl bağlarım" — bugün dağınık kaynaklarda ve sekmeler arasında yürüyor. Bu modül; Yargıtay, Danıştay, BAM (Bölge Adliye Mahkemeleri), AYM ve AİHM kararlarını tek arama yüzeyinde toplar, madde bazlı ve yürürlük takipli bir mevzuat veritabanı sunar ve bulunan her sonucu dosyaya "emsal" olarak bağlanabilir bir varlığa dönüştürür.

Kritik mimari karar **kaynak adaptör arayüzüdür**: Türkiye'de içtihat kaynakları için resmî, kararlı API'ler sınırlıdır; erişim yöntemleri (resmî servis, lisanslı veri sağlayıcı, toplu veri seti, ileride UYAP servisleri) zamanla değişecektir. Bu yüzden arama/getirme katmanı **sağlayıcı-bağımsız** bir `CaseLawSourceAdapter` sözleşmesi üzerine kurulur; her kaynak bir adaptör olarak takılır, ürün kodu adaptör arkasını bilmez. Sağlayıcı değişimi ürün tarafında kod değişikliği gerektirmez.

Modülün ikinci vaadi **halüsinasyon önlemedir**: CITATION_VERIFY görevi, verilen bir esas/karar numarasının gerçekten var olup olmadığını kaynaklardan doğrular ve Modül 22'nin (Dilekçe Stüdyosu) Teyit Ajanı zorunlu geçişinin arka ucudur. AI destekli doğal dil arama ("işe iade davasında ispat yükü ile ilgili son 3 yıl Yargıtay kararları") ve karar özeti üretimi, tenant'ın BYO-LLM yapılandırması üzerinden çalışır.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, doğal dille "işe iade davasında ispat yükü, son 3 yıl, Yargıtay" diye arayıp isabetli kararlar görmek istiyorum ki anahtar kelime cambazlığı yapmayayım.
2. **Avukat olarak**, arama sonuçlarını daire, yıl, karar türü ve kaynak (Yargıtay/Danıştay/BAM/AYM/AİHM) ile filtrelemek istiyorum ki ilgisiz sonuçları eleyeyim.
3. **Avukat olarak**, uzun bir kararın AI özetini (uyuşmazlık, gerekçe, sonuç, dosyamla ilgisi) görmek istiyorum ki 40 sayfayı okumadan eleme yapayım.
4. **Avukat olarak**, beğendiğim kararı tek tıkla dosyama "emsal" olarak bağlamak ve neden bağladığımı not etmek istiyorum ki duruşma/dilekçe hazırlığında elimin altında olsun.
5. **Avukat olarak**, bir kanun maddesinin belirli bir tarihteki yürürlük halini görmek istiyorum ki dava tarihindeki mevzuata göre argüman kurayım.
6. **Stajyer olarak**, bana atanan "emsal karar taraması" görevinde bulduğum kararları aday listesi olarak avukata sunmak istiyorum ki tarama işim yapılandırılmış teslim edilsin.
7. **Avukat olarak**, dilekçeye yazdığım/AI'ın yazdığı bir esas-karar numarasının gerçekten var olduğunun sistemce doğrulanmasını istiyorum ki uydurma atıfla mahkeme önünde küçük düşmeyeyim.
8. **Partner olarak**, takip ettiğim bir aramanın (kayıtlı arama) yeni sonuç bulduğunda bildirim üretmesini istiyorum ki alanımdaki yeni içtihattan haberdar olayım.
9. **Avukat olarak**, mevzuat maddesinden ona atıf yapan içtihatlara geçmek istiyorum ki madde-karar ağını tek yerden gezeyim.
10. **Admin olarak**, hangi içtihat kaynağı adaptörlerinin aktif/sağlıklı olduğunu görmek istiyorum ki bir kaynak düştüğünde aramanın neden eksik döndüğünü bileyim.

## Ekranlar ve UX

### 1. Araştırma Merkezi — `/app/research`
Bileşenler: doğal dil arama kutusu (AI modu) + gelişmiş filtre paneli (kaynak, daire, tarih aralığı, esas/karar no ile nokta arama), sonuç listesi (başlık, daire, tarih, eşleşme skoru, kaynak rozeti), sağda seçili karar önizleme + "AI Özet" + "Dosyaya Bağla" butonları.

```
┌───────────────────────────────────────────────────────────────────────┐
│ 🔍 işe iade davasında ispat yükü son 3 yıl        [AI Arama] [Klasik] │
│ Kaynak: [Yargıtay ✓][Danıştay][BAM][AYM][AİHM]  Tarih: 2023—2026      │
├──────────────────────────────────┬────────────────────────────────────┤
│ SONUÇLAR (23)                    │ Yargıtay 9. HD                     │
│ ▸ Yarg. 9. HD 2024/1183 E. …·%94 │ 2024/1183 E., 2024/6621 K.         │
│   Yarg. 9. HD 2023/8812 E. …·%91 │ Tarih: 12.03.2024   [✓ Doğrulandı] │
│   BAM İst. 27. HD 2024/412 …·%88 │ ─────────────────────────────────  │
│   Yarg. 22. HD 2023/455 E. …·%84 │ AI ÖZET: Uyuşmazlık: feshin        │
│                                  │ geçerliliğinde ispat yükü işverene │
│ [Aramayı Kaydet 🔔]              │ aittir… Sonuç: BOZMA               │
│                                  │ [Tam Metin] [Dosyaya Emsal Bağla]  │
└──────────────────────────────────┴────────────────────────────────────┘
```

### 2. Karar Detayı — `/app/research/caselaw/:id`
Tam metin, künye bloğu (kaynak, daire, esas/karar no, tarihler, doğrulama durumu), AI özet sekmesi, atıf yapılan mevzuat maddeleri (linkli), "hangi dosyalarıma emsal bağlı" listesi.

### 3. Mevzuat Tarayıcı — `/app/research/statutes` ve `/app/research/statutes/:id`
Kanun/yönetmelik listesi + madde ağacı; madde görünümünde versiyon zaman çizelgesi ("bu maddenin 01.01.2024'teki hali"), maddeye atıf yapan içtihat listesi.

### 4. Dosya Emsal Sekmesi — `/app/cases/:caseId/references`
Dosyaya bağlanmış emsaller: karar künyesi, bağlayan kullanıcı, ilgi notu, kullanıldığı dilekçeler; "bu dosya için emsal ara" kısayolu (dosya bağlamı aramaya ön-dolu gider).

## Veri Modeli

### CaseLawDocument (yeni entity — tenant-bağımsız ortak havuz)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| source | enum(YARGITAY, DANISTAY, BAM, AYM, AIHM) | |
| adapter_key | text | Kaydı getiren adaptör (örn. `yargitay-v1`) |
| chamber | text | Daire (örn. "9. Hukuk Dairesi") |
| esas_no | text | "2024/1183" normalize |
| karar_no | text | "2024/6621" normalize |
| decision_date | date | |
| title / headnote | text | Başlık ve özet başlığı |
| full_text | text | Tam metin (arama indeksi + embedding buradan) |
| verify_status | enum(UNVERIFIED, VERIFIED, NOT_FOUND) | Kaynaktan varlık doğrulaması |
| source_ref | jsonb | Adaptöre özgü kimlik/URL |
| fetched_at | timestamptz | |

### CaseLawReference (yeni entity — dosya-emsal bağı)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| case_id | uuid FK→Case | |
| caselaw_id | uuid FK→CaseLawDocument | |
| added_by_user_id | uuid FK→User | |
| relevance_note | text | "İspat yükü argümanımızı destekliyor" |
| status | enum(CANDIDATE, ACCEPTED, REJECTED) | Stajyer taraması → avukat kabulü |
| created_at | timestamptz | |

### Statute (yeni entity) ve StatuteArticle / StatuteArticleVersion (yeni)
| Alan | Tip | Açıklama |
|------|-----|----------|
| Statute.id | uuid PK | |
| Statute.kind | enum(KANUN, KHK, YONETMELIK, TEBLIG, DIGER) | |
| Statute.number / name | text | "4857" / "İş Kanunu" |
| StatuteArticle.statute_id | uuid FK→Statute | |
| StatuteArticle.article_no | text | "Madde 20" |
| StatuteArticleVersion.article_id | uuid FK→StatuteArticle | |
| StatuteArticleVersion.text | text | Madde metni |
| StatuteArticleVersion.effective_from / effective_to | date / date nullable | Yürürlük aralığı; NULL=halen yürürlükte |

### SavedSearch (yeni entity)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id / tenant_id / user_id | uuid | |
| query | jsonb | Doğal dil + filtreler |
| notify | bool | Yeni sonuçta bildirim |
| last_run_at | timestamptz | |

`CaseLawSourceAdapter` arayüzü (kod sözleşmesi): `search(query, filters) → hits[]`, `fetchByCitation(source, esas_no, karar_no) → doc|null`, `healthCheck()`. Adaptörler tenant-bağımsızdır; havuz tüm tenant'larca paylaşılır (içtihat kamusal veridir), CaseLawReference tenant-scoped'dur. Aramalar AiUsageLog'a görev tipiyle yazılır.

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı | KVKK notu |
|-----------|---------------|-----------|
| CASELAW_SEARCH | doğal dil sorgu (+ opsiyonel dosya bağlam özeti) → yapılandırılmış arama planı (kaynaklar, anahtar terimler, tarih aralığı) → adaptör sonuçlarının alaka sıralaması | Dosya bağlamı özet olarak ve maskeleme hattından geçerek gönderilir; sorgunun kendisi PII içerirse maskelenir |
| CASELAW_SUMMARIZE | caselaw_id (+ opsiyonel case_id) → {uyuşmazlık, gerekçe, sonuç, dosyayla ilgi} yapılandırılmış özet | Karar metni kamusal veridir, maskesiz gider; dosya bağlamı eklenirse maskeleme uygulanır |
| CITATION_VERIFY | {source, esas_no, karar_no} listesi → her atıf için {VERIFIED, NOT_FOUND, AMBIGUOUS} + eşleşen caselaw_id | Yalnızca künye bilgisi gönderilir/aranır; PII yok. Doğrulama önce deterministik adaptör sorgusudur, LLM yalnızca künye normalizasyonunda kullanılır |
| STATUTE_RESOLVE | serbest metin mevzuat atfı ("İK m.20/2") → {statute_id, article_id, tarihe göre versiyon} | PII yok |

CITATION_VERIFY akış tanımı (kritik — Teyit Ajanı'nın arka ucu):

```
1. Künyeyi normalize et (LLM veya regex): kaynak, daire?, esas_no, karar_no.
2. Yerel havuzda (CaseLawDocument) ara → varsa VERIFIED döndür.
3. Yoksa ilgili adaptör(ler)de fetchByCitation çalıştır.
   - Bulundu → havuza kaydet (verify_status=VERIFIED), VERIFIED döndür.
   - Bulunamadı ve adaptör sağlıklı → NOT_FOUND.
   - Adaptör erişilemez → AMBIGUOUS (asla VERIFIED sayılmaz).
4. Sonucu çağırana (Modül 22 verify ucu) atıf bazında döndür.
```

CASELAW_SUMMARIZE sistem prompt taslağı:

```
Sen Türk içtihadı konusunda uzman bir hukukçusun. Verilen mahkeme kararını şu
şemayla özetle: (1) Uyuşmazlık konusu, (2) İlk derece/BAM süreci, (3) Yüksek
mahkemenin gerekçesi — dayandığı mevzuat maddeleriyle, (4) Sonuç (ONAMA/BOZMA/
İPTAL/RET vb.), (5) [dosya bağlamı verildiyse] Bu dosyayla ilgisi. Kararda
olmayan hiçbir bilgi ekleme; emin olmadığın alana "kararda açık değil" yaz.
```

## İş Kuralları

1. **AI çıktısı öneridir**: arama sıralaması, özetler ve ilgi değerlendirmeleri karar desteğidir; emsal kabulü (CANDIDATE→ACCEPTED) yalnızca AVUKAT/PARTNER rolünce yapılır.
2. CITATION_VERIFY'da VERIFIED sonucu yalnızca deterministik eşleşmeyle (havuz veya adaptör kaydı) verilir; LLM'in "büyük ihtimalle vardır" çıktısı hiçbir koşulda VERIFIED üretemez.
3. Adaptör erişilemezken doğrulanamayan atıf AMBIGUOUS kalır; Modül 22 bu durumda READY geçişine izin vermez (fail-closed).
4. CaseLawDocument havuzu tenant-bağımsızdır ama tenant'a özgü hiçbir veri (not, bağ, arama geçmişi) havuza yazılamaz; bunlar CaseLawReference/SavedSearch'te tenant-scoped tutulur.
5. Mevzuat sorguları tarih parametresi almalıdır; tarih verilmezse bugünkü yürürlük versiyonu döner ve yanıt "yürürlükteki metin" olarak etiketlenir.
6. Yürürlükten kalkmış madde versiyonu UI'da belirgin "mülga/değişik" rozetiyle gösterilir; AI özet ve dilekçe beslemesine giden madde metni her zaman versiyon kimliğiyle taşınır.
7. Aynı kararın mükerrer kaydı engellenir: (source, esas_no, karar_no) benzersiz; adaptörler upsert yapar.
8. Kayıtlı arama bildirimleri en fazla günde bir kez koşturulur (kaynak adaptörlerine saygılı kullanım; adaptör bazlı rate-limit yapılandırılabilir).
9. STAJYER emsal bağlayabilir ancak kayıt CANDIDATE statüsünde açılır; ACCEPTED olmadan Modül 22 bağlam paneline "onaylı emsal" olarak akmaz.
10. Tüm arama ve doğrulama çağrıları AiUsageLog'a (görev tipi, adaptör, süre, maliyet) yazılır.

## API Uçları

| Metod | Yol | Açıklama |
|-------|-----|----------|
| POST | /api/v1/research/caselaw/search | Arama (mode=AI\|CLASSIC, query, filters) |
| GET | /api/v1/research/caselaw/:id | Karar detayı + doğrulama durumu |
| POST | /api/v1/research/caselaw/:id/ai/summarize | CASELAW_SUMMARIZE (opsiyonel case_id) |
| POST | /api/v1/research/citations/verify | CITATION_VERIFY (atıf listesi, toplu) |
| GET | /api/v1/research/statutes | Mevzuat listesi/arama |
| GET | /api/v1/research/statutes/:id/articles/:no | Madde (+ `?date=` versiyon seçimi) |
| POST | /api/v1/research/statutes/resolve | STATUTE_RESOLVE (serbest metin atıf) |
| GET/POST | /api/v1/cases/:caseId/references | Dosyanın emsalleri / emsal bağla |
| PATCH | /api/v1/cases/:caseId/references/:id | Not/statü güncelle (ACCEPTED/REJECTED) |
| GET/POST/DELETE | /api/v1/research/saved-searches | Kayıtlı aramalar |
| GET | /api/v1/admin/research/adapters | Adaptör listesi + healthCheck sonuçları |

## Diğer Modüllerle İlişkiler

- **22 Dilekçe Stüdyosu**: ACCEPTED emsaller bağlam paneline akar; `/petitions/:id/verify` bu modülün CITATION_VERIFY'ını çağırır; dilekçedeki mevzuat atıfları STATUTE_RESOLVE ile versiyonlu maddeye bağlanır.
- **24 AI Dosya Asistanı**: sohbette "bu dosya için emsal bul" niyeti CASELAW_SEARCH'e yönlenir; asistan cevaplarında emsal kaynak gösterimi CaseLawReference üzerinden yapılır.
- **02 Dava**: emsal sekmesi Case'e bağlıdır; dosya bağlam özeti aramaya ön-dolu gider.
- **Süre Motoru (Ger. 4)**: deterministik süre kural setinin mevzuat dayanağı StatuteArticleVersion'a referans verir.
- **Strateji Motoru (Ger. 16)**: argüman-hukuki dayanak zinciri ACCEPTED emsallerden ve madde versiyonlarından beslenir.
- **BYO-LLM / KVKK (Ger. 20)**: tüm LLM çağrıları AiProviderConfig + maskeleme hattı üzerinden.

## Kabul Kriterleri

1. Doğal dil arama, arama planına çevrilip en az bir adaptörden sonuç getiriyor; sonuçlar alaka skoru sıralı dönüyor.
2. Gerçek bir Yargıtay künyesi için CITATION_VERIFY, VERIFIED + caselaw_id döndürüyor; uydurma künye NOT_FOUND dönüyor.
3. Tüm adaptörler kapatılmışken doğrulama AMBIGUOUS dönüyor ve hiçbir koşulda VERIFIED üretilmiyor (fail-closed testi).
4. Aynı kararın iki kez getirilmesi havuzda tek kayıt bırakıyor ((source, esas_no, karar_no) benzersizlik testi).
5. `?date=2023-06-01` ile istenen madde, o tarihte yürürlükteki versiyon metnini ve versiyon kimliğini döndürüyor.
6. Karar dosyaya emsal bağlandığında dosyanın references listesinde görünüyor ve karar detayında "bağlı dosyalar" güncelleniyor.
7. STAJYER'in bağladığı emsal CANDIDATE açılıyor; AVUKAT ACCEPTED yapmadan Modül 22 bağlam panelinde listelenmiyor.
8. CASELAW_SUMMARIZE çıktısı beş bölümlü şemaya uyuyor; kararda olmayan bilgi için "kararda açık değil" davranışı örnek kararla test ediliyor.
9. Farklı tenant, başka tenant'ın CaseLawReference kaydına GET ile 404 alıyor; ortak havuz kaydına ise erişebiliyor (izolasyon sınır testi).
10. Yeni bir kaynak adaptörü, ürün koduna dokunmadan yalnızca adaptör sözleşmesini uygulayarak eklenebiliyor (adaptör entegrasyon testi sahte kaynakla koşuyor).

## Faz

**Faz 2.** Modül 22 ile aynı fazda ve ondan önce/onunla birlikte teslim edilir (Teyit Ajanı bağımlılığı). Faz 2 içi sıra: adaptör arayüzü + havuz modeli + CITATION_VERIFY → klasik arama + karar detayı → AI arama ve özet → mevzuat veritabanı ve versiyonlama → kayıtlı arama bildirimleri.
