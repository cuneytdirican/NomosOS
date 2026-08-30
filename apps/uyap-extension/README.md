# NomosOS UYAP Köprüsü (`@nomosos/uyap-extension`)

UYAP Avukat Portalı ile NomosOS arasında **tek yönlü senkron (UYAP → NomosOS)** ve
**yarı otomatik gönderim hazırlığı** sağlayan Chrome Manifest V3 eklentisi.

Spesifikasyon: `docs/05-uyap-entegrasyonu.md` · Otomatik aksiyon hattı: `docs/moduller/06-belge-yonetimi.md`

---

## 1. Ne yapar, ne yapmaz

**Yapar**

- UYAP dosya listesi, dosya detayı (künye + taraflar), safahat, evrak listesi ve duruşma
  ekranlarını okur; verileri NomosOS'un `/api/v1/uyap/*` uçlarına aktarır.
- Yeni evrakı kullanıcının **kendi UYAP oturumu** üzerinden indirir, ön-imzalı URL ile
  tenant'ın kendi deposuna yükler; NomosOS'ta Modül 06 otomatik aksiyon hattını tetikler.
- UYAP sayfalarına "NomosOS'a aktar" düğmeleri enjekte eder; popup'tan manuel ve
  `chrome.alarms` ile periyodik (varsayılan 30 dk) senkron çalıştırır.

**Yapmaz**

- UYAP'a **hiçbir yazma işlemi yapmaz**. Dilekçe gönderimi yarı otomatiktir: eklenti
  formu ön-doldurabilir, **e-imzayı ve onayı her zaman avukat kendisi verir**.
- UYAP oturum çerezi, e-imza/kart bilgisi veya UYAP parolası **okunmaz, saklanmaz,
  gönderilmez**. Eklentide bilinçli olarak `cookies` izni yoktur.
- Üçüncü taraf hiçbir servise veri göndermez; yalnızca eşleştirildiği NomosOS sunucusuna
  konuşur.
- Sayfa yapısı tanınmıyorsa **tahmin etmez**: okuma durur, kullanıcı uyarılır.

---

## 2. Kurulum (geliştirici)

```bash
# Bağımlılıklar (monorepo kökünden)
pnpm install

# Eklentiyi derle → dist/
pnpm --filter @nomosos/uyap-extension build

# Geliştirirken sürekli derleme
pnpm --filter @nomosos/uyap-extension dev

# Parser testleri
pnpm --filter @nomosos/uyap-extension test
```

Chrome'a yükleme:

1. `chrome://extensions` adresini aç.
2. Sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle** → `apps/uyap-extension/dist` klasörünü seç.
4. Araç çubuğundaki NomosOS simgesini sabitle.

> `dist/` klasörü derleme çıktısıdır; `manifest.json`, `popup/` ve `content/` statikleri
> derleme sırasında oraya kopyalanır. Kaynak değişince Chrome'da eklentiyi **yeniden yükle**
> (dairesel ok) düğmesine basın.

## 3. Eşleştirme

1. NomosOS web uygulamasında **Ayarlar → UYAP Eklentisi** ekranından kısa ömürlü
   **eşleştirme kodu** üretin.
2. Eklenti popup'ında sunucu adresini (varsayılan `https://app.nomosos.com`, self-hosted
   bürolar kendi adresini) ve kodu girin, **Eşleştir**'e basın.
3. Kendi sunucusunu kullanan bürolarda tarayıcı, **yalnızca girilen tek adres için**
   ana bilgisayar izni ister (`chrome.permissions.request({origins:["https://buro.example.com/*"]})`);
   izin verilmeden aktarım yapılmaz. `optional_host_permissions` içindeki geniş kalıp
   (`https://*/*`) yalnızca bu tek adresin çalışma anında istenebilmesi içindir — eklenti
   kendiliğinden hiçbir siteye erişmez; popup bunu kullanıcıya açıkça yazar.
4. Backend, tenant + kullanıcı kapsamlı, iptal edilebilir bir **extension token** döner.
   Token yalnızca `chrome.storage.local`'da tutulur; `chrome.storage.sync` **kullanılmaz**.

## 4. Kullanım

- **Sayfa düğmeleri**: dosya listesi ve evrak listesi satırlarında "NomosOS'a aktar";
  sağ alttaki panelde sayfa geneli aksiyonlar (dosya künyesi, safahat/duruşma, yeni evraklar).
- **Popup**: bağlı büro/kullanıcı, son senkron zamanı, izlenen dosya sayısı, kuyruk ve hata
  listesi, "Şimdi senkronize et", ayarlar (senkron aralığı, otomatik senkron, düğme
  enjeksiyonu, cihaz adı) ve "Bağlantıyı kes".
- **Periyodik senkron** yalnızca **üstveriyi** (dosya, safahat, duruşma) aktarır. Evrak
  indirme her zaman kullanıcı isteğine bağlıdır — arka planda sessizce megabaytlarca evrak
  indirilmez.
- Senkron yalnızca tarayıcı açık ve UYAP oturumu aktifken çalışır; popup bunu dürüstçe
  gösterir ("Son senkron: 2 saat önce").

## 5. Mimari

```
src/
├── background/
│   ├── service-worker.ts   # mesaj yönlendirme, chrome.alarms, token yenileme, kuyruk sürücüsü
│   └── sync-queue.ts       # idempotent kuyruk: SHA-256 hash + üstel geri çekilme + kalıcılık
├── content/
│   ├── inject.ts           # sayfa tespiti, "NomosOS'a aktar" düğmeleri, aktarım akışı
│   └── parsers/            # SÜRÜMLÜ selector katmanı (base + 5 parser)
├── lib/                    # api, auth, http, hash, storage, settings, logger, permissions, udf, text
├── popup/                  # durum ekranı (bağımlılıksız HTML + TS)
└── types/                  # UYAP DOM modelleri, aktarım DTO'ları, mesaj/kuyruk tipleri
e2e/fixtures/               # sahte UYAP HTML sayfaları (parser testleri)
```

### Backend sözleşmesi (docs/05)

| Metod | Yol | Açıklama |
|-------|-----|----------|
| POST | `/api/v1/uyap/pair` | eşleştirme kodu → extension token (+ `storageHosts`) |
| POST | `/api/v1/uyap/pair/refresh` | rotasyonlu jeton yenileme |
| POST | `/api/v1/uyap/sync/files` | dosya listesi/fark bildirimi |
| POST | `/api/v1/uyap/sync/events` | safahat (+ duruşma) kayıtları |
| POST | `/api/v1/uyap/documents/presign` | evrak için ön-imzalı yükleme adresi |
| POST | `/api/v1/uyap/documents/commit` | meta + hash kaydı → `uyap.document.received` olayı |
| GET | `/api/v1/uyap/status` | izlenen dosyalar, son senkron, kuyruk durumu |

> **Önek düzeltmesi (denetim bulgusu):** `apps/api` global öneki `api/v1`'dir
> (`setGlobalPrefix("api/v1")`), yani `@Controller("uyap")` gerçekte `/api/v1/uyap/*` altında
> yayınlanır. Eklenti eskiden `/api/uyap/*` çağırıyor ve her istekte 404 alıyordu.
> `docs/05-uyap-entegrasyonu.md` § "Backend API sözleşmesi" de bu önekle güncellenmelidir.

**Sunucudan beklenen iki ek sözleşme:**

1. `POST /api/v1/uyap/pair` yanıtı `storageHosts: string[]` döndürmelidir (ön-imzalı yüklemenin
   yapılabileceği depo ana bilgisayarları). Eklenti `presign.uploadUrl` adresini **https** ve
   **bu liste + API hostu** kuralına karşı doğrular; listede olmayan bir hosta evrak baytı
   göndermez (fail-closed). Liste gelmezse yalnız API hostuna yükleme yapılabilir.
2. `SyncHearingDto.uyapDosyaNo` alanı zorunludur ve sunucu bunu gövdedeki `uyapDosyaNo` ile
   **çapraz doğrulamalıdır**; uyuşmayan duruşma kaydı reddedilmelidir (ajandaya yanlış duruşma
   yazmak meslek riskidir).

## 6. Parser dayanıklılık stratejisi

UYAP'ın açık API'si olmadığından veri DOM'dan okunur. Kırılganlığa karşı beş katman:

1. **Sürümlü selector seti** — her parser selector'larını tek bir `SELECTORS_V1` sabitinde
   toplar. Arayüz değişirse `SELECTORS_V2` eklenir, V1 silinmez; kullanılan sürüm
   (`selectorVersion`) her aktarımla backend'e gider.
2. **Sayfa imzası doğrulaması** — `parse()` çalışmadan önce beklenen kök düğümler kontrol
   edilir. İmza tutmuyorsa **veri okunmaz**, `PAGE_SIGNATURE_MISMATCH` döner.
3. **Başlık tabanlı sütun çözümü** — sütunlar sabit indeksle değil, Türkçe duyarsız
   normalize edilmiş **başlık metniyle** (eşanlamlı listesiyle) bulunur. UYAP sütun ekler
   veya sırasını değiştirirse parser çalışmaya devam eder. Kısa/genel etiketler tolerans
   eşleşmesine sokulmaz ki "Dosya Türü" ile "Dosya Durumu" karışmasın.
4. **Zorunlu alan katılığı** — zorunlu bir alan (dosya no, tarih, işlem türü) okunamazsa
   satır sessizce atlanmaz; parse başarısız olur ve **hangi selector'ın kırıldığı**
   (`SelectorIssue: field + selector + expected + scope`) raporlanır. Zorunlu olmayan
   alanlar `warnings` ile döner; tahmini değer asla üretilmez.
5. **Görünür arıza** — parse hatası service worker'a `PARSER_FAILURE` olarak gider; popup'ta
   uyarı çıkar ve UYAP sayfasının üstünde "aktarım durduruldu" bandı gösterilir.
   `EMPTY_RESULT` (kayıt yok) arıza sayılmaz.

Testler bu davranışı doğrular: bozuk fixture'larda parser'ın **veri döndürmediği** ve
kırılan alanı bildirdiği sınanır (`e2e/parsers.test.ts`).

## 7. İdempotens

- Her kuyruk öğesinin **SHA-256 içerik hash'i** vardır (evrakta ham bayt, safahatta
  dosya no + tarih + işlem + açıklama).
- Aynı hash kuyrukta ya da "gönderilmiş defteri"nde varsa öğe tekrar alınmaz; sunucu da
  `presign`/`commit` sırasında aynı hash'i yinelenen sayar ve yeni pipeline koşumu açmaz.
- Geçici hatalarda üstel geri çekilme (15 sn → 30 dk, jitter'lı), 6 denemeden sonra öğe
  `FAILED` olur ve popup'tan elle yeniden denenebilir. Kuyruk `chrome.storage.local`'da
  kalıcıdır; service worker uykuya dalsa da kayıp olmaz.

## 8. Bakım — UYAP arayüzü değişince

1. Popup'taki parser uyarısında hangi sayfa ve hangi alanın kırıldığı yazar.
2. İlgili `src/content/parsers/*.ts` dosyasında `SELECTORS_V2` tanımlanır ve/veya sütun
   etiketi eşanlamlıları güncellenir.
3. `e2e/fixtures/` altına yeni arayüzün HTML örneği eklenir, test yazılır.
4. Sürüm numarası artırılır, eklenti yeniden yayımlanır (kurumsal dağıtım / Web Store).

## 9. İzin gerekçeleri (Web Store incelemesi / KVKK "gereklilik")

| İzin | Neden gerekli |
|------|----------------|
| `storage` | Eşleştirme jetonu, ayarlar ve idempotent aktarım kuyruğu `chrome.storage.local`'da tutulur. `chrome.storage.sync` bilinçli olarak KULLANILMAZ (Google hesabına veri sızmasın). |
| `unlimitedStorage` | Evrak baytları kuyrukta base64 taşınır; 10 MB'lık varsayılan `storage.local` kotası tek bir evrağa bile yetmez. Gönderimi biten öğenin gövdesi hemen silinir. |
| `alarms` | Periyodik senkron ve kuyruk sürücüsü (MV3 service worker uyuduğu için `setInterval` kullanılamaz). |
| `host_permissions` (UYAP + app.nomosos.com) | Sayfayı OKUMAK ve NomosOS'a aktarmak için. |

**Bilinçli olarak İSTENMEYEN izinler:** `cookies` (UYAP oturum/e-imza verisi hiçbir zaman
okunmaz), `tabs` (`chrome.tabs.query({url})` host izinleri üzerinden çalışır), `scripting`
(kod enjeksiyonu yapılmaz), `downloads` (dilekçe indirme akışı Faz 2.5'te service worker'a
yazılacak; o zamana kadar izin istenmez).

## 10. Bilinen sınırlar

- Tarayıcı kapalıyken senkron çalışmaz (MV3 service worker uyur).
- Eklenti UYAP'a arka planda istek atmaz; senkron için ilgili UYAP sayfasının bir sekmede
  açık olması gerekir.
- Tek evrak için üst sınır 50 MB'dır (base64 şişmesi + mesaj/kota sınırları). Daha büyük
  evrak aktarılmaz; kullanıcıya Türkçe uyarı gösterilir.
- Kalıcı olarak başarısız olan (FAILED) evrak öğesinin baytları, kullanıcı "Yeniden dene"
  diyebilsin diye kuyrukta kalır; "Kuyruğu temizle" ile silinir. Başarılı/yinelenen öğelerin
  gövdesi ise anında silinir.
