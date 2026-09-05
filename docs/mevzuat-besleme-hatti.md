# Mevzuat Besleme Hattı (Hukuki Veri Kaynağı Besleme Planı — Faz 1)

> Kapsam: platform mevzuat havuzu — mevzuat.gov.tr ve Resmî Gazete'den onaylı besleme,
> madde sürüm zinciri, atıf teyidi mevzuat kolonu. İçtihat tarafı için
> `docs/moduller/23-ictihat-mevzuat.md` ve `plans/ictihat-havuzu-yol-haritasi.md`'na bakınız.

## 1. Mimari

```
mevzuat.gov.tr (MevzuatGovConnector)   Resmî Gazete (ResmiGazeteClient)
        │ tohum (15 çekirdek kanun)            │ resmi-gazete-gunluk işi (her sabah 07:30)
        └──────────────┬───────────────────────┘
                       ▼
        LegislationIngestItem  ← ONAY KUYRUĞU (otomatik havuz yazımı YOKTUR)
                       ▼  platform görevlisi onayı (önizlemeyi okur)
        LegislationPoolService  ← HAVUZA GİRİŞİN TEK KAPISI
          ├─ Statute + StatuteArticleVersion (kanunlar, madde sürüm zinciri)
          └─ Legislation (tenantId=null; yönetmelik/tebliğ/genelge platform kayıtları)
                       ▼
        citation-verify (StatuteLookupService) → "TCK m.86" DOGRULANDI/BULUNAMADI/BELIRSIZ
```

İlkeler (içtihat hattıyla birebir aynı):
- **Onay kuyruğu:** hiçbir dış kaynaktan çekim havuza otomatik yazılmaz; halüsinasyon
  zinciri kuyrukta kesilir. Red gerekçesi zorunlu, denetim izine yazar.
- **SOURCE LINEAGE:** her platform kaydında `sourceKey` + `sourceUrl` + (varsa) RG künyesi
  + `authorityLevel` (mevzuat.gov.tr beslemesi = 10) taşınır.
- **Sürüm zinciri:** değişiklik eski madde metnini EZMEZ — eski sürüm `effectiveTo` ile
  kapanır, yeni sürüm `versionSeq+1` ile açılır; mülga madde kapanır, metni kalır.
- **Büro kütüphanesi izole:** `Legislation` büro kayıtları (tenantId'li) platform
  kayıtlarıyla KARIŞMAZ; platform kayıtları tüm bürolara yalnız OKUNUR açıktır.

## 2. Doğrulanmış uç noktalar (uydurma entegrasyon yasağı)

| Kaynak | Uç | Not |
|---|---|---|
| mevzuat.gov.tr arama | `POST /anasayfa/MevzuatDatatable` | Başlıklar: `x-requested-with: XMLHttpRequest`, `x-kl-ajax-request: Ajax_Request`; `parameters.AranacakIfade` = base64(UTF-8); `AranacakYer`: Baslik/Icerik/Tumu; `MevzuatTur` kodları (1=Kanun, 4=KHK, 9=Tebliğ, 19=CB Kararnamesi, 20=CB Kararı…). Çerez GEREKMEZ. |
| mevzuat.gov.tr konsolide metin | `GET /anasayfa/MevzuatFihristDetayIframe?MevzuatTur=&MevzuatNo=&MevzuatTertip=` | Tam konsolide kanun metni (HTML). |
| Resmî Gazete gün sayfası | `GET /eskiler/YYYY/MM/YYYYMMDD.htm` | Kodlama windows-1254; bölüm başlıkları + `YYYYMMDD-N.htm` belge bağlantıları; ilanlar hariç. |
| Resmî Gazete belge metni | `GET /eskiler/YYYY/MM/YYYYMMDD-N.htm` | PDF kalemler metin olarak ÇEKİLMEZ (künye kuyruğa taşınır). |

**TLS notu (gov-tls.ts):** mevzuat.gov.tr ve resmigazete.gov.tr zincirde ARA sertifika
göndermez; tarayıcılar AIA'dan ortayı indirir, Node edemez. Çözüm: sertifikanın kendi AIA
adresinden indirilmiş GeoTrust TLS RSA CA G1 + DigiCert Global Root G2 sabit CA paketi.
Ara sertifika **02.11.2027**'de dolar; o zaman konektör healthCheck'i TLS hatası verir ve
paket AIA adreslerinden yeniden üretilir. `rejectUnauthorized` ASLA kapatılmaz.

## 3. Zamanlanmış işler

| İş | Cron | Ne yapar |
|---|---|---|
| `resmi-gazete-gunluk` | 07:30 | Son 3 günün RG sayfalarını tarar → onay kuyruğu (idempotent: `@@unique(sourceKey, externalKey)`). |
| `mevzuat-tohumu-haftalik` | Pzt 06:00 | Çekirdek kanun listesini (TCK, TMK, HMK, İİK, İş K., TBK, TTK, CMK, KVKK, AATUHK, İYUK, VUK, GVK, MASAK, Anayasa) künyeyle arar → kuyruk. |

## 4. Yönetim uçları (`/api/admin/v1/legislation-ingest`)

`GET stats` · `GET health` (konektör canlı yoklaması) · `GET items` (kuyruk) ·
`GET items/:id/preview` (onay öncesi metin: kuyruk/mevzuat.gov.tr/RG) ·
`POST run/tohum` · `POST run/rg` · `POST run/kvkk` · `POST run/rekabet` ·
`POST items/:id/approve` · `POST items/:id/reject`.

**Panel:** admin `/yargi/mevzuat` — **Mevzuat Onay Masası** (solda durum/kaynak süzgeçli
kuyruk, sağda okuma bölmesi: kuyruk metni ya da kaynaktan canlı önizleme, A−/A+; tarama
düğmeleri tohum/RG/KVKK/Rekabet; mevzuat.gov.tr sağlık kontrolü; O/R kısayolları; red
gerekçesi zorunlu). Onay sonucu (kanun sürüm farkı +/~/−) bölmede gösterilir.

Onay davranışı:
- **Tohum kaydı:** konsolide metin çekilir, `parseStatuteText` ile maddelere ayrılır,
  Statute havuzuna girer (abbreviations ile: TCK, HMK, İşK…).
- **RG KANUN kaydı:** değişiklik metninden etkilenen kanun numaraları çıkarılır
  (`"4857 sayılı Kanun"` kalıbı), o kanunların KONSOLİDE metni mevzuat.gov.tr'den yeniden
  çekilir ve madde sürüm farkı `changeRgDate/changeRgNo` ile işlenir; belge kendisi de
  Legislation platform kaydı olarak saklanır.
- **RG diğer kayıtları:** belge metniyle Legislation platform kaydı.

## 5. Atıf teyidi (mevzuat kolonu)

`citation-verify.service` → `StatuteLookupService.findArticle(statuteRef, articleNo)`:
kısaltma (TCK) / tam ad (Türk Borçlar Kanunu) / numara (4857 sayılı) eşleşmesi; fıkra eki
("25/2") maddeye indirgenir. Sonuçlar:
- Kanun havuzda değil → **BELIRSIZ** (havuz kısmidir; kapsam dışı ≠ yanlış atıf).
- Kanun var, madde yok → **BULUNAMADI** (mülga/yanlış numara).
- İkisi de var → **DOGRULANDI**; sürüm no + yürürlük tarihi + değişiklik RG künyesi döner.

**Kiracı görünürlüğü:** `GET /legislation` büronun kendi kayıtları + platform kayıtlarını
(tenantId=null, `isPlatform: true`) döner. Görünürlük süzgeci ve arama süzgeci Prisma
`where.AND` altında AYRI `OR` bloklarıdır — aynı nesnede iki `OR` anahtarı ikincinin
birinciyi ezmesine (kiracı sızıntısı) yol açar; `legislation.service.test.ts` bunu kilitler.
Platform kayıtları büro tarafından güncellenemez/silinemez (web'de "Resmî kaynak" rozeti).

**İçtihat kaynak kapısı (Faz 2 adaptörleri):** `AymLiveAdapter` ve `UyusmazlikLiveAdapter`
yalnız `query.source` kendi mahkemesiyse (AYM / UYUSMAZLIK) ağa çıkar; başka künyede
NOT_FOUND döner (ağ isteği yok). `citation-verify` birleştirme sonrası `courtMatchesSource`
ile mahkeme uyumunu YENİDEN denetler — künye Yargıtay derken AYM kaydıyla DOGRULANDI
üretilmez (BELIRSIZ). Registry adaptörleri paralel sorgular; "ilk FOUND kazanır" sırası
(yerel havuz → elle giriş → canlı) değişmez.

## 6. Bilinen sınırlar / sonraki adımlar

- **Danıştay canlı arama captchalı** (`/detayliArama` + reCaptcha): otomatik konektör
  yazılmadı; resmî erişim ya da ayrı çalışma gerekir.
- **AYM canlı künye teyidi AktİF** (`aym-live.adapter.ts`, `AYM_CANLI`): doğrulanmış
  uç `POST /api/core/public/search` — `basvuruNo` (bireysel başvuru, birebir) ve
  `esasNo`+`kararNo` (norm denetimi) filtreleri. AYM bireysel başvuru künyeleri
  ("2019/12345 başvuru numaralı karar") atıf teyidinde artık canlı doğrulanır (kayıt
  havuza YAZILMAZ; `aym:{id}` okuma kaydı döner). Karar TAM METNİ bugün çekilemiyor
  (dosyalar ucu doğru ama döndürdüğü .udf dosya adresi 404 veriyor) — bu yüzden
  `canSearch` kapalıdır; dosya ucu onarılırsa canlı arama + metin açılır.
- **Uyuşmazlık Mahkemesi canlı künye teyidi AktİF** (`uyusmazlik-live.adapter.ts`,
  `UYUSMAZLIK_CANLI`): kararlar.uyusmazlik.gov.tr WebForms akışı (GET gizli alanlar →
  POST `txtSearch`/`rblSearchScope=EsasNo`) canlı doğrulandı. DİKKAT: EsasNo araması
  KISMİ eşleşir ("1999/1" → 11 benzer künye); adaptör birebir filtre uygular, birebir
  eşleşme yoksa NOT_FOUND üretir. Atıf desenleri "Uyuşmazlık Mahkemesi" mahkeme
  kaynağını tanır (`UYUSMAZLIK`). Kararlar yalnızca PDF'tir — `canSearch` kapalı,
  `sourceUrl` PDF bağlantısıdır.
- **KVKK Kurul kararları izleyici AktİF** (`kvkk.client.ts` + `kvkk-kurul-haftalik`
  işi, Faz 3 regülatör kaynak 1): doğrulanmış uçlar — liste
  `GET /Icerik/5419/kurul-kararlari?page=N` (`.members__item` blokları; bazı kalemler
  doğrudan RG PDF), detay `/Icerik/{id}/{slug}` (Karar Tarihi/Karar No/Konu Özeti).
  İzleyici ilk 2 sayfayı tarar → onay kuyruğu; onayda karar metni çekilip künyeden
  karar no/tarihi çıkarılarak Legislation platform kaydı yazılır (`POST run/kvkk` ile
  elle de çalışır). RG PDF kalemleri künyeyle girer (metin önizlemesi yoktur).
- **Rekabet Kurulu kararları izleyici AktİF** (`rekabet.client.ts` +
  `rekabet-kurul-haftalik` işi, Faz 3 regülatör kaynak 2): doğrulanmış uçlar —
  liste `GET /tr/Kararlar?page=N` (`table.yantablo1` blokları: Yayımlanma
  Tarihi/Karar Sayısı/Karar Tarihi/Karar Türü + tam başlık), detay
  `/Karar?kararId={uuid}` **doğrudan PDF** döner. Künye ve başlık listeden alınır;
  onayda künyeyle Legislation platform kaydı yazılır. `POST run/rekabet` ile elle
  de çalışır.
- Regülatör konektörlerinin geri kalanı (SPK, BDDK, KİK…), TBMM teklif takibi ve
  pgvector/hibrit retrieval planın sonraki fazlarındadır
  (`.mindaeon/plans/1788534218873-*.md`).
- Mevzuat `fullText` araması ILIKE tabanlıdır (D4/pgvector notu geçerli).
- **gov-tls sabit CA paketi:** ara sertifika (GeoTrust TLS RSA CA G1) **02.11.2027**'de
  dolar; `healthCheck` 90 gün kala uyarır, TLS zincir hatasını "paket yenilenmeli" diye
  adlandırır. `govFetch` aynı ana makineye en çok 3 HTTPS yönlendirme izler, gövde sınırını
  (32 MB) akış sırasında uygular.
- **Havuz kapısı sürüm sınırı:** RG künyesi yoksa sürüm sınırı TESPİT tarihiyle kurulur
  (null bırakılmaz; denetim izi "yaklaşık" der). Yeniden onayda mevcut künye alanları
  (RG tarihi/sayısı, numara, yıl) boş girdiyle silinmez.
- **RG bölüm başlıkları:** "KANUN" ve "KANUNLAR" ikisi de KANUN'dur; diğer türler önekle
  eşleşir (YÖNETMELİKLER, TEBLİĞLER…); tanınmayan başlık DIGER.
