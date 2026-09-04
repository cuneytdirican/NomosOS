# NomosOS Hukuki Veri Kaynağı Besleme Planı (Legal Data Connector Framework)

> Hedef: Türkiye hukuk bilgi altyapısını resmî kaynaklardan kurmak; her kaynak doğrulanmış,
> soyutlanmış konektörlerle bağlanır. Yeni kaynak = yeni konektör, mimari değişikliği değil.

## 0. Doğrulanmış kaynak envanteri (araştırma sonucu)

| Kaynak | URL | Erişim modeli | Kod durumu |
|---|---|---|---|
| Mevzuat Bilgi Sistemi (TCCB) | mevzuat.gov.tr | Web; kanun/KHK/CBK/yönetmelik/tebliğ/genelge + mülga; doc/pdf çıktı var (`/MevzuatMetin/{id}.pdf/.doc`) | ❌ bağlı değil |
| Resmî Gazete | resmigazete.gov.tr | Web; günlük sayı + arşiv `/eskiler/YYYY/MM/DD`, metin başına `.htm`, sayı PDF `/eskiler/YYYY/MM/YYYYMMDD.pdf` | ❌ bağlı değil |
| Yargıtay Karar Arama | karararama.yargitay.gov.tr | Web (`POST /aramalist`, `GET /getDokuman?id=`) | ✅ `yargitay-live.adapter.ts` |
| Emsal (UYAP karar arama) | emsal.uyap.gov.tr | Aynı sözleşme (arama/getDokuman) | ✅ aynı adaptör (EMSAL_UYAP) |
| AYM Kararlar Bilgi Bankası | kararlarbilgibankasi.anayasa.gov.tr | JS SPA — uç noktalar impl. öncesi keşfedilecek | ❌ |
| Danıştay karar arama | danistay.gov.tr | Web — uç noktalar impl. sırasında doğrulanacak | ❌ |
| Uyuşmazlık Mahkemesi | uyusmazlikmahkemesi.gov.tr | Web — doğrulanacak | ❌ |
| TBMM kanun teklifleri | tbmm.gov.tr | Web — doğrulanacak | ❌ |
| KVKK | kvkk.gov.tr | Web (kurul kararları, rehberler) | ❌ |
| Rekabet Kurumu | rekabet.gov.tr | Web (kurul kararları) | ❌ |
| EUR-Lex | eur-lex.europa.eu | SPARQL + REST (üluslararası faz) | ❌ |
| HUDOC (AİHM) | hudoc.echr.coe.int | REST benzeri arama (üluslararası faz) | ❌ |
| UYAP Avukat Portal | portal.uyap.gov.tr | **RESMÎ API ERİŞİMİ GEREKLİ** — scraping yok | ✅ eklenti köprüsü (işlem katmanı, veri havuzu DEĞİL) |

**Düzeltme (kullanıcı belgesine göre):** "UYAP Mevzuat" değil, yetkili ana mevzuat kaynağı
**mevzuat.gov.tr**'dir (T.C. Cumhurbaşkanlığı Hukuk ve Mevzuat Genel Müdürlüğü). Plan buna göre kurulur.

## 1. Mevcut altyapı (yeniden kullanılacak, sıfırdan framework YOK)

- `CaseLawSourceAdapter` sözleşmesi + `CaseLawAdapterRegistry` (fail-closed birleştirme) — `apps/api/src/caselaw/adapters/`
- `CaselawSourceConfig` (veritabanında tanımlı JSON besleme kaynağı) + `CaseLawIngestItem` onay kuyruğu + `caselaw-ingest-daily` işi — `apps/api/src/platform/caselaw-ingest/`
- `CaselawPoolService.importRecords()` havuza girişin tek kapısı
- `citation-verify.service.ts` — deterministik atıf teyidi (mevzuat atıfları bugün **BELIRSIZ** döner: Statute havuzu yok)
- `Legislation` modeli tenant-scoped (platform havuzu yok, source alanı yok)
- RAG: `DocumentChunk.embedding` (JSON) + JS kosinüs; keyword yedeği; pgvector/hibrit/reranker yok
- UYAP eklenti köprüsü (`apps/api/src/uyap/`) — işlem katmanı, kapsam dışı

## 2. Mimari kararlar

1. **Üç konektör ailesi** (kullanıcının I* arayüzleri fikri mevcut yapıya indirgenir):
   - İçtihat → mevcut `CaseLawSourceAdapter` (Yargıtay deseni: oturum + aramalist + getDokuman)
   - Mevzuat/RG → yeni `LegislationSourceConnector` sözleşmesi (packages/db'den bağımsız, `apps/api/src/legislation/connectors/`)
   - Kurumsal/regülatör yayın → `LegislationSourceConnector`'ın `REGULATORY` kaynak tipi alt kümesi (aynı sözleşme, farklı docType)
2. **AuthorityLevel** (1–10, retrieval güven metadata'sı — hukuki hiyerarşi gösterimi değil): her konektör ve her havuz kaydında saklanır (RG/kaynak 10, Yargıtay/Danıştay/AYM 9, düzenleyici kurum 8…). Rerank'ta ağırlık olarak kullanılır.
3. **SOURCE LINEAGE zorunlu**: platform havuzundaki her kayıtta `sourceKey` + `sourceUrl` + `rgDate`/`rgNo` (mevzuat için) + `authorityLevel` + `fetchedAt`. AI cevap kaynağı zinciri bu alanlardan üretilir ("Kaynağı Gör").
4. **Kategoriler ve izolasyon** (kullanıcı belgesi A–E): A (resmî) + B (regülatör) platform havuzuna (`tenantId: null`); D (ticari) yalnız `CaselawSourceConfig`/konektör üzerinden onaylı; E (büro bilgisi) mevcut tenant-scoped yapıda KALIR, asla A/B ile karışmaz.
5. **Onay kuyruğu ilkesi değişmez**: hiçbir dış kaynaktan çekim havuza otomatik yazılmaz; RG fark kontrolü ve mevzuat güncellemesi de `LegislationIngestItem` kuyruğundan platform onayıyla geçer.
6. **Sürümleme**: mevzuat değişikliği eski metni EZMEZ — `LegislationVersion` zinciri (yürürlük/değişiklik/mülga tarihi, önceki/sonraki sürüm bağlantısı).
7. **Uydurma entegrasyon yasağı devam eder**: her konektör impl. öncesi gerçek uç noktayla doğrulanır (canlı istek + örnek kayıt), doğrulanamayan konektör `DISABLED` kaydedilir.

## 3. Veri modeli değişiklikleri (packages/db, migration)

1. `Legislation.tenantId` → nullable; `sourceKey`, `authorityLevel`, `rgDate`, `rgNo`, `sourceUrl` alanları; `@@index([tenantId? , docType])` → platform sorguları.
2. Yeni `Statute` + `StatuteArticleVersion` (madde no, fıkra, bend, metin, yürürlük başlangıcı, değişiklik RG künyesi, geçerlilik bitişi/mülga) — atıf teyidinin mevzuat kolonu.
3. Yeni `LegislationIngestItem` (kaynak, dış kimlik, taslak metin, durum BEKLIYOR/ONAYLANDI/REDD EDILDI, red gerekçesi) — `CaseLawIngestItem` deseni.
4. Yeni `RegulatoryPublication` (kurum, yayın türü: KARAR/REHBER/DUYURU, başlık, tarih, url, özet, tam metin) — KVKK/Rekabet vb. için.
5. `CaseLawDocument`'a `authorityLevel` ekle.
6. Yeni `LegalSourceConfig` (genelleştirilmiş kaynak tanımı: tip CONNECTOR/FEED, kapsamı, hız limiti, not) — `CaselawSourceConfig` ile paralel; CaselawSourceConfig korunur.

## 4. Fazlar

### FAZ 1 — Platform mevzuat omurgası (en yüksek değer)
1. Mevzuat model değişiklikleri (yukarıda 3.1–3.3, 3.6).
2. `MevzuatGovConnector`: mevzuat.gov.tr'den tip bazında liste + metin çekimi (arama uçları impl. sırasında doğrulanır; `MevzuatMetin` PDF/doc çıktısı fallback). Hız limiti + User-Agent + robots saygısı.
3. İlk tohum: öncelik listesi (~150 kanun: TCK, TMK, HMK, İİK, İş K., Borçlar, CMK, TTK, KVKK, 6102…) → onay kuyruğu → platform havuzu.
4. `StatuteArticleParser`: kanun metninden madde/fıkra ayrıştırma (deterministik regex, legal-core'a), `StatuteArticleVersion` üretimi.
5. `citation-verify.service`'e mevzuat kolonu: "TCK 86" → havuzdaki madde sürümü → DOGRULANDI (versiyon + RG künyesiyle).
6. RG günlük izleyici `resmi-gazete-gunluk` işi (scheduler'a): her sabah dünün sayfasını tarar → yeni/değişen mevzuat künyeleri → `LegislationIngestItem` + **etkilenen mevzuat eşleşmesi** (künyedeki "…Kanununda Değişiklik" başlığından) → platform onayı → sürüm zinciri + değişiklik kaydı.

### FAZ 2 — Yargı konektörleri
1. `DanistayLiveAdapter` (CaseLawSourceAdapter; uç noktalar canlı doğrulanır — idare/vergi/ihale dosyaları için kritik).
2. `AymLiveAdapter` (kararlarbilgibankasi.anayasa.gov.tr; SPA — ağ trafiğinden arama API'si keşfedilir, keşfedilemezse elle parti içe aktarma `/caselaw-pool/import` ile).
3. `UyusmazlikLiveAdapter` (görev uyuşmazlıkları).
4. Kaynak rozetleri + daire normalizasyon sözlüğü (plans/ictihat-havuzu-yol-haritasi.md madde 2 ve 6 ile uyumlu).

### FAZ 3 — Yasama takibi + regülatörler
1. `TbmmBillsConnector` (kanun teklifleri; teklif → komisyon → genel kurul → RG durum zinciri `BillTracking` modeliyle; "yakında değişecek hukuk" görünümü).
2. `RegulatoryConnector` genelleştirmesi + ilk iki konektör: KVKK (kurul kararları/rehberler), Rekabet Kurumu (kurul kararları) → `RegulatoryPublication` + onay kuyruğu.
3. Yeni regülatör konektörleri tek tek eklenir (SPK, BDDK, KİK, MASAK, EPDK, BTK, GİB…); her biri ~aynı sözleşme, öncelik arama günlüğü/mandalanmaya göre.

### FAZ 4 — Retrieval kalitesi
1. pgvector (DocumentChunk + içtihat havuzu + madde sürümleri) ve tsvector tam metin; gerçek hibrit skor birleştirme; authority-level ağırlıklı rerank (10=RG öncelikli).
2. AI cevaplarında kaynak zinciri ("Kaynağı Gör": mevzuat → madde sürümü → RG künyesi → ilişkili kararlar).
3. Zamansal geçerlilik filtresi: retrieval yalnız sorgu tarihinde yürürlükte olan madde sürümlerini döndürür.

### FAZ 5 (uluslararası, ayrık sürüm)
EUR-Lex + HUDOC konektörleri; AYM↔AİHM çapraz referans. Mimari zaten konektör-tabanlı olduğundan sadece yeni adaptör.

## 5. Kapsam dışı / kararlı sınırlar
- **UYAP operasyonel API'si**: resmî erişim gerekir; mevcut eklenti köprüsü dışında hiçbir UYAP kazıması yapılmaz. UYAP kaynak kaydı `status: OFFICIAL_API_REQUIRED` olarak işaretlenir.
- Ticari sağlayıcılar (LawAPI vb.): yalnız `LegalSourceConfig` üzerinden `EXTERNAL_COMMERCIAL` etiketiyle, sözleşme/onay şartıyla; ana veri kaynağı olamaz.
- e-Devlet/MERSİS/KEP/UETS: işlem katmanı — bu planın dışı.
- Büro bilgisi (E): tenant-scoped kalır; platform RAG dizinine asla girmez.

## 6. Doğrulama planı (her faz için)
- Her konektör için: canlı uç nokta doğrulama testi (kayıtlı örnek künyeyle), sağlık kontrolü (`healthCheck` admin ucu), hız limiti izleme.
- Faz 1 kabul testleri: (a) 150 kanun platform havuzunda, tenant'lar sorguda görüyor; (b) "TCK 86" atfı DOGRULANDI; (c) RG işi simüle günle 3 değişiklik yakalıyor, onay sonrası sürüm zinciri doğru; (d) eski sürüm erişilebilir kalıyor.
- Faz 2 kabul: Danıştay/AYM örnek künye araması canlı kaynakta bulunuyor; citation-verify fail-closed korunuyor.
- Tüm mevcut testler (`pnpm test`, dalga3-contract, vekalet altın değerleri) geçer; migration geri alınabilir.
- KVKK: içtihat/kurul kararları içe aktarımda PII maskesi (mevcut maskeleme altyapısı) — maskelenmeyen parti reddedilir.

## 7. Riskler
- mevzuat.gov.tr/RG resmî programatik API yayınlamıyor: konektörler rate-limit saygılı web istemcisi olarak yazılır; kaynak değişirse tek dosyada (konektör) düzeltilir.
- AYM SPA uç noktası keşfedilemeyebilir → yedek: elle toplu içe aktarma hattı.
- Resmî sitelerde değişiklik/esas no verisi eksik olabilir → ingest şemasında alan zorunluluğu künye tipine göre esnek tanımlanır (mevzuat için RG künyesi zorunlu).
- Hacim: ilk tohum 150 kanun + maddeler; gömme üretimi kota/limit kontrollü toplu iş olarak.

## 8. Uygulama sırası (özet görev listesi)
1. DB migration'ları (Legislation nullable tenant + source alanları, Statute/StatuteArticleVersion, LegislationIngestItem, RegulatoryPublication, authorityLevel, BillTracking)
2. LegislationSourceConnector sözleşmesi + registry + admin uçları (kaynak listesi/health)
3. MevzuatGovConnector + doğrulama testi + ilk 150 kanun tohumu (onaylı)
4. StatuteArticleParser + citation-verify mevzuat kolonu + testler
5. resmi-gazete-gunluk işi + değişiklik eşleştirme + sürüm zinciri + "bugün ne değişti" API'si
6. DanistayLiveAdapter → AymLiveAdapter → UyusmazlikLiveAdapter (her biri: keşif → adaptör → test → rozet)
7. TbmmBillsConnector + teklif takip ekranı
8. KVKK + Rekabet regülatör konektörleri
9. pgvector + hibrit retrieval + authority rerank + kaynak zinciri UI
10. (ayrı sürüm) EUR-Lex + HUDOC

## Açık sorular (implementation agent kararı gerekmez, kullanıcı onayıyla)
- İlk tohum kanun listesi nihai mi (150 kanun önerisi) yoksa büro profilinden mi türesin? Öneri: sabit çekirdek liste + admin'in listeyi genişletmesi.
- RG değişiklik uyarısının avukata hangi kanaldan gitmesi: Öneri — mevcut notification-outbox (in-app) + günlük özet e-postası; acil süre etkisi tespit edilirse anlık.
