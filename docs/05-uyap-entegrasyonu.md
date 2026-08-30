# NomosOS — UYAP Entegrasyon Hub Spec'i

> İlgili gereksinim: `docs/99-kaynak-gereksinimler.md` → Gereksinim 6 `[P0, 10/10]`.
> İlgili modüller: Belge → Otomatik Aksiyon (`docs/moduller/06`), Dava Yaşam Döngüsü (02),
> Süre Motoru (04), İcra (05).

## 1. Hedef ve Konumlandırma

Hedef **UYAP'ın yerine geçmek değil, UYAP'ın üzerine AI operasyon katmanı koymaktır**.
UYAP resmi kayıt ortamı olarak kalır; NomosOS büronun çalışma merkezi olur:

```
UYAP → Dosya Senkronizasyonu → NomosOS → AI → Yeni Evrak
     → Otomatik sınıflandır → Dosyaya bağla → Süre tespit et
     → Görev oluştur → Avukata bildir
```

Uzun vadeli hedef mümkün olduğu ölçüde **iki yönlü** akıştır: UYAP → NomosOS → UYAP.

## 2. Mimari: Chrome Extension (Manifest V3)

UYAP'ın resmi/açık bir API'si bulunmadığından entegrasyon, avukatın kendi oturumu
üzerinden çalışan bir tarayıcı eklentisiyle yapılır. Konum: `apps/uyap-extension`.

Bileşenler:

- **Content script** (UYAP Avukat Portalı sayfalarında çalışır): dosya listesi, dosya
  detayı, safahat, evrak listesi ve duruşma bilgilerini DOM'dan okur; sayfa yapısını
  soyutlayan bir "selector/parser katmanı" üzerinden veri çıkarır (DOM değişimine karşı
  tek noktadan bakım).
- **Service worker (background)**: kuyruk yönetimi, NomosOS API iletişimi, oturum durumu,
  periyodik senkron zamanlayıcısı (`chrome.alarms`).
- **Popup / side panel UI**: bağlı tenant/kullanıcı, son senkron zamanı, "Şimdi
  senkronize et" düğmesi, aktarım kuyruğu ve hata listesi.
- **NomosOS API istemcisi**: yalnızca NomosOS backend'inin `/api/uyap/*` uçlarına konuşur.

### Kimlik doğrulama — extension token

- Kullanıcı NomosOS web uygulamasında **Ayarlar → UYAP Eklentisi** ekranından kısa ömürlü
  bir eşleştirme kodu üretir; eklentiye girer.
- Backend, eklentiye tenant + kullanıcı kapsamlı, iptal edilebilir bir **extension token**
  (rotasyonlu refresh dahil) verir. Token yalnızca `chrome.storage.local`'da tutulur.
- Tüm aktarımlar TLS üzerinden, token ile imzalı; backend tarafında token'ın rol/tenant
  kapsamı dışına yazması engellenir. UYAP oturum bilgisi (e-imza/kart) **hiçbir zaman**
  NomosOS'a aktarılmaz; eklenti UYAP'a kullanıcının mevcut oturumuyla erişir.

### Evrak indirme → yükleme akışı

1. Content script evrak listesini çıkarır, NomosOS'taki mevcut kayıtla fark (diff) alınır.
2. Yeni/eksik evrak, kullanıcının UYAP oturumu üzerinden indirilir (UDF/PDF/Tebligat).
3. Service worker dosyayı, ön-imzalı (pre-signed) yükleme URL'i ile NomosOS deposuna
   (DMS) yükler; meta veri (`uyapDosyaNo`, evrak türü, tarih, hash) API'ye yazılır.
4. Aynı evrakın tekrar yüklenmesi içerik hash'i ile engellenir (idempotent aktarım).

## 3. Senkronizasyon Stratejisi

- **Manuel tetikleme** (birincil): kullanıcı popup'tan veya UYAP sayfasına enjekte edilen
  "NomosOS'a aktar" düğmesinden tek dosya ya da toplu senkron başlatır.
- **Periyodik senkron** (ikincil): eklenti açık ve UYAP oturumu aktifken belirli aralıkla
  (varsayılan 30 dk, ayarlanabilir) izlenen dosyaların safahat/evrak farkı taranır.
  Tarayıcı kapalıyken senkron olmaz; UI bunu dürüstçe gösterir ("Son senkron: 2 saat önce").
- Çakışma kuralı: UYAP verisi **kaynak-doğrudur** (source of truth) — safahat/evrak
  NomosOS'ta elle düzenlenmez, üzerine NomosOS katmanı (görev, süre, not) eklenir.

## 4. Gelen Evrak → Otomatik Aksiyon Hattı (Modül 06 teslimi)

Eklentiden gelen her yeni evrak, backend'de bir **`uyap.document.received` olayı** üretir
ve Modül 06'nın (Belge → Otomatik Aksiyon) event-driven pipeline'ına teslim edilir:

1. Sınıflandırma: ara karar / gerekçeli karar / bilirkişi raporu / tebligat / dilekçe…
2. Dosya eşleme: `uyapDosyaNo` → NomosOS dosyası (eşleşmezse "eşleştirme kuyruğu").
3. Tespitler: verilen süreler, istenen belgeler, duruşma tarihi değişiklikleri.
4. Önerilen aksiyonlar (onay kuyruğuna düşer, **avukat onaylar**):
   görev oluştur · son tarih oluştur (süre motoru, deterministik hesap) ·
   sorumlu avukata ata · müvekkil bilgilendirme taslağı · duruşma hazırlığını güncelle.

## 5. İki Yönlü Hedef: NomosOS → UYAP

- NomosOS'ta hazırlanan dilekçe **UDF formatında dışa aktarılır**
  (`packages/udf` — UDF üretici; şablon + içerik + ek listesi).
- **İlk aşama yarı-otomatiktir**: eklenti, UYAP'ın evrak gönderme ekranını açar, dosya
  ve evrak alanlarını mümkün olduğunca ön-doldurur; **kullanıcı UYAP ekranında kontrol
  eder, e-imzasını kendisi atar ve gönderimi kendisi onaylar**. NomosOS hiçbir zaman
  kullanıcı adına imzasız/onaysız gönderim yapmaz.
- Gönderim sonrası eklenti sonucu (gönderildi/başarısız + UYAP evrak kaydı) NomosOS'a
  geri yazar; ilgili görev otomatik "UYAP'a gönderildi" durumuna geçer.

## 6. UYAP Operasyonları × NomosOS Değer Katmanı

| UYAP operasyonu | UYAP'ın sağladığı | NomosOS değer katmanı |
|---|---|---|
| Dosya sorgulama/inceleme | Dosya listesi, taraflar, evrak | Müvekkil-merkezli birleştirme, AI dosya özeti, risk skoru |
| Safahat | Kronolojik işlem listesi | Safahat → olay akışı; her safahat kaydından süre/görev önerisi |
| Duruşma | Duruşma tarihi/salonu | Merkezi duruşma ajandası + "duruşma hazırlık paketi" (özet, son beyanlar, sorular) |
| Belge gönderimi | Dilekçe/evrak gönderme | Dilekçe üretimi (AI) → UDF dışa aktarım → yarı-otomatik gönderim + görev kapanışı |
| e-Takip (icra) | Takip açma, dosya işlemleri | İcra modülü + İcra Copilot (malvarlığı analizi, aşama önerisi, tahsilat ihtimali) |
| Harç / masraf | Harç hesap ve ödeme kaydı | Masrafın dosya finansına ve müvekkil tahakkukuna otomatik yansıması |
| e-Duruşma | Uzaktan duruşma erişimi | Ajandaya tek tık katılım linki + duruşma öncesi hazırlık paketi |

## 7. Kısıtlar ve Riskler

| Risk | Etki | Önlem |
|---|---|---|
| UYAP'ın resmi API'sinin olmaması | Entegrasyon DOM'a bağımlı, kırılgan | Parser katmanını izole et; sürümlü selector seti; uzaktan güncellenebilir parser konfigürasyonu; kırılınca "senkron durdu" uyarısı, sessiz veri bozulması asla |
| UYAP DOM/arayüz değişiklikleri | Senkron kesintisi | Otomatik smoke-test sayfa imzaları; hızlı eklenti güncelleme süreci (Chrome Web Store + kurumsal dağıtım) |
| KVKK / kişisel veri | Evraklarda yoğun kişisel veri | Aktarım yalnız tenant'ın kendi deposuna; AI'a gitmeden önce maskeleme akışı (Gereksinim 20); eklenti üçüncü tarafa hiçbir veri göndermez |
| Avukat sorumluluğu | Gönderim/süre hataları meslek riski doğurur | Gönderimde daima insan onayı; süreler deterministik motor + avukat onayı; "AI önerisi" etiketiyle şeffaflık |
| Oturum/e-imza kısıtları | Tam otomasyon mümkün değil | Yarı-otomatik akış bilinçli tasarım kararıdır; UI beklentiyi doğru kurar |
| Çoklu kullanıcı/çoklu büro | Yanlış tenant'a yazma | Extension token tenant kapsamlı; her aktarımda tenant doğrulaması |

## 8. `apps/uyap-extension` İskelet Önerisi (Faz 2)

```
apps/uyap-extension/
├── manifest.json            # MV3; host_permissions: UYAP avukat portalı alanları
├── src/
│   ├── background/
│   │   ├── service-worker.ts    # kuyruk, alarms, API istemcisi, token yenileme
│   │   └── sync-queue.ts        # idempotent aktarım kuyruğu (hash tabanlı)
│   ├── content/
│   │   ├── inject.ts            # "NomosOS'a aktar" düğmeleri, sayfa tespiti
│   │   └── parsers/             # dosya-listesi.ts, dosya-detay.ts, safahat.ts,
│   │                            # evrak-listesi.ts, durusma.ts (sürümlü selectorlar)
│   ├── popup/                   # durum, manuel senkron, kuyruk/hata görünümü
│   ├── lib/
│   │   ├── api.ts               # NomosOS /api/uyap/* istemcisi
│   │   ├── auth.ts              # eşleştirme kodu → extension token
│   │   └── udf.ts               # UDF indirme/dışa aktarma yardımcıları
│   └── types/                   # UYAP DOM modelleri, aktarım DTO'ları
├── e2e/                         # sahte UYAP sayfa fixture'ları ile parser testleri
└── package.json
```

Backend karşılığı: `apps/api` içinde `uyap` modülü — eşleştirme, aktarım uçları,
`uyap.document.received` olay yayını, eşleştirme kuyruğu ekranı için uçlar.

### Backend API sözleşmesi (özet)

```
POST /api/uyap/pair            # eşleştirme kodu → extension token
POST /api/uyap/sync/files      # dosya listesi/fark bildirimi (diff)
POST /api/uyap/sync/events     # safahat kayıtları
POST /api/uyap/documents/presign   # evrak için ön-imzalı yükleme URL'i
POST /api/uyap/documents/commit    # yükleme sonrası meta + hash kaydı → olay yayını
GET  /api/uyap/status          # izlenen dosyalar, son senkron, kuyruk durumu
```

## 9. Aşamalandırma

- **Faz 2 (ilk sürüm)**: tek yönlü senkron (UYAP → NomosOS): dosya, safahat, evrak;
  Modül 06 pipeline teslimi; manuel + periyodik tetikleme; UDF dışa aktarım.
- **Faz 2.5**: yarı-otomatik gönderim (ön-doldurma + kullanıcı onayı), gönderim
  sonucunun geri yazılması, e-takip (icra) aktarımının İcra modülüne bağlanması (Faz 3
  ile birlikte).
- **Sürekli**: parser bakım süreci — UYAP arayüz değişikliklerinde selector seti
  güncellemesi ve hızlı yayın; sayfa imzası smoke-testleri CI'da.

Başarı ölçütü: bir büronun günlük UYAP rutini (yeni evrak kontrolü, süre çıkarımı,
görevlendirme) NomosOS'a taşındığında, avukatın UYAP'ta geçirdiği süre yalnızca
imza/onay anlarına iner.
