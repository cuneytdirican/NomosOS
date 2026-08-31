# NomosOS — Test Ortamı ve Giriş Bilgileri

> Bu doküman **geliştirme/demo ortamı** içindir. Buradaki hesaplar `packages/db/src/seed.ts`
> tarafından oluşturulan **demo hesaplardır**; parolaları depoda açıkça durur ve sır değildir.
>
> ⛔ **Bu hesaplar ve parolalar üretimde ASLA kullanılmaz.** Üretim kurulumu için
> [uretim-dagitimi.md](uretim-dagitimi.md) dosyasına bakın: orada sırlar operatör tarafından
> üretilir, `docker-compose.prod.yml` boş/varsayılan sır kabul etmez.

---

## 1. Uygulamalar ve Adresler

| Uygulama | Adres | Ne işe yarar |
|---|---|---|
| **Tanıtım sitesi** | http://localhost:3000 | Halka açık pazarlama sitesi (giriş gerekmez) |
| **Büro paneli** | http://localhost:3000/giris | Avukatların kullandığı ana uygulama |
| **Platform yönetim paneli** | http://localhost:3002/giris | NomosOS'u işleten şirketin paneli |
| **Müvekkil portalı** | http://localhost:3003/giris | Müvekkilin gördüğü dar yüzey |
| **API** | http://localhost:3001/api/v1 | Tenant API · sağlık: `/api/v1/health` |
| **Platform API** | http://localhost:3001/api/admin/v1 | Ayrı kimlik alanı |
| **MinIO konsolu** | http://localhost:9001 | Belge deposu (kullanıcı/parola: `nomosos` / `nomosos-gizli-123`) |

Mobil uygulama (`apps/mobile`) Docker'a girmez; Expo ile cihazda çalışır (bkz. §6).

---

## 2. Giriş Bilgileri

**Tüm demo hesapların parolası: `Demo1234!`**

### 2.1 Büro paneli — http://localhost:3000/giris

| E-posta | Rol | Ne görür / göremez |
|---|---|---|
| `partner@demo.nomosos.local` | **PARTNER** | Her şey: finans, kârlılık, tüm raporlar, dosya kapatma |
| `avukat@demo.nomosos.local` | **AVUKAT** | Dosya ve müvekkil işlemleri; AI kullanım raporunda **yalnız kendi** kullanımı |
| `sekreter@demo.nomosos.local` | **SEKRETER** | Zaman kaydı girebilir, finans özetini görür; **fatura kesemez**, kârlılık ve avukat iş yükü raporlarını **göremez** |
| `stajyer@demo.nomosos.local` | **STAJYER** | En kısıtlı: kârlılık ve tahsilat raporları **403**, rapor kataloğunda 9 yerine **5 rapor** görür, dosya kapatamaz |

> Rol kısıtları **sunucu tarafında** uygulanır — arayüzde gizleme değildir. Doğrudan API
> çağrısıyla da atlanamaz. Denemek için: stajyer token'ıyla
> `GET /api/v1/reports/karlilik` → **403**.

### 2.2 Platform yönetim paneli — http://localhost:3002/giris

| E-posta | Rol | Ne yapabilir |
|---|---|---|
| `superadmin@nomosos.local` | **SUPER_ADMIN** | Tüm platform yönetimi; tehlikeli işlemler dört-göz onayına tabi |
| `superadmin2@nomosos.local` | **SUPER_ADMIN** | **İkinci imza** — dört-göz akışını denemek için |
| `analist@nomosos.local` | **ANALYST_READONLY** | **Yatırımcı/ortak profili**: yalnız toplulaştırılmış iş metrikleri (MRR, plan dağılımı, churn). Hiçbir yazma işlemi yapamaz; tenant'ın müvekkil/dosya verisini **göremez** |

> **Dört-göz ilkesini denemek:** `superadmin` ile bir tenant'ı askıya alın →
> işlem uygulanmaz, onay talebi oluşur. Aynı hesapla onaylamayı deneyin → **403**
> ("kendi talebinizi karara bağlayamazsınız"). Sonra `superadmin2` ile giriş yapıp
> onaylayın → işlem uygulanır. Plan oluşturma, iade ve kredi tahsisi de aynı akıştadır.

### 2.3 Müvekkil portalı — http://localhost:3003/giris

| E-posta | Kim | Ne görür |
|---|---|---|
| `portal@demo.nomosos.local` | ABC Holding A.Ş. müvekkili | **Yalnızca avukatın açıkça yayınladığı** kayıtlar |

> Portal **allow-list** çalışır: varsayılan olarak hiçbir şey görünmez. Seed'de ABC Holding'in
> **1 dosyası ve 2 belgesi** yayınlanmıştır; ikinci dosyası (icra takibi) **bilerek
> yayınlanmamıştır** ki "yayınlanmamış kayıt görünmez" davranışı sınanabilsin.
>
> Portal yanıtlarında dosya notu, strateji, risk skoru, iç görev ve AI analizi **alanları
> yoktur** — bunlar müvekkile hiçbir koşulda açılmaz.

### 2.4 Altyapı servisleri (yalnız geliştirme)

| Servis | Bağlantı |
|---|---|
| PostgreSQL | `postgresql://nomosos:nomosos@localhost:5432/nomosos` |
| Redis | `redis://localhost:6379` |
| MinIO (S3) | `http://localhost:9000` — erişim: `nomosos` / `nomosos-gizli-123`, bucket: `nomosos-belgeler` |

---

## 3. Docker ile Çalıştırma (önerilen)

Tek komut — migration ve seed **otomatik** çalışır, elle adım yoktur:

```bash
docker compose -f docker-compose.test.yml up -d --build
```

İlk açılış imaj derlemesi nedeniyle 5–15 dakika sürebilir. Sonrasında:

```bash
# Durum
docker compose -f docker-compose.test.yml ps

# API günlükleri
docker compose -f docker-compose.test.yml logs -f api

# Durdur (veri korunur)
docker compose -f docker-compose.test.yml down

# Durdur ve VERİYİ SİL (sıfırdan başlamak için)
docker compose -f docker-compose.test.yml down -v
```

Yığın hazır olduğunda `http://localhost:3001/api/v1/health` → `{"status":"ok"}` döner.

### Test yığınının üretimden farkları (bilinçli)

| | Test | Üretim (`docker-compose.prod.yml`) |
|---|---|---|
| Sırlar | Dosyada sabit, hazır | Operatör üretir; varsayılan YOK, boş sır kabul edilmez |
| Migration + seed | Otomatik (`migrate` servisi) | Elle, kontrollü (`scripts/prod-migrate.sh`) |
| MinIO konsolu | Açık (`:9001`) | Kapalı, port yayınlanmaz |
| Portlar | Hepsi dışarı açık | Yalnız `127.0.0.1`, dışarıya ters vekil bakar |
| Platform 2FA | Kapalı (hızlı giriş için) | Zorunlu |
| `NODE_ENV` | `development` | `production` |

> **2FA neden kapatılabiliyor?** API'de bir koruma var: `NODE_ENV=production` iken
> `PLATFORM_REQUIRE_2FA=false` ile **açılmayı reddeder** — platform paneli tüm
> büroların üstverisine ve faturalama kayıtlarına baktığı için tek faktörle
> korunamaz. Bu koruma devre dışı bırakılmamıştır; test yığını `NODE_ENV`'i
> gerçekte ne ise o olarak (`development`) etiketler. Üretimde ikisi de zorunludur.

### Yayımlama (registry)

Test için kayıt defterine **gerek yoktur** — yukarıdaki `--build` yeterlidir.
Başka makinede çalıştırmak isterseniz imajlar GitHub Container Registry'ye
gönderilebilir; bunun için depo token'ında `write:packages` yetkisi gerekir
(`gh auth refresh -h github.com -s write:packages`). Docker Hub ayrı bir hesap
gerektirdiği ve test için ek fayda sağlamadığı için tercih edilmemiştir.

## 4. Yerel Çalıştırma (Docker'sız, geliştirme için)

```bash
cp .env.example .env
# .env içinde MASTER_ENCRYPTION_KEY doldurun:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d          # yalnız postgres + redis + minio
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                      # web 3000, api 3001, admin 3002, portal 3003
```

`JWT_SECRET` **en az 32 karakter** olmalıdır; kısa anahtarla uygulama bilinçli olarak açılmaz.

---

## 5. Demo Veri Ne İçeriyor?

| Kayıt | Adet | Not |
|---|---|---|
| Müvekkil | 3 | ABC Holding A.Ş. (tüzel), Deniz Tekstil A.Ş. (tüzel), Mehmet Demir (gerçek) |
| Dosya | 5 | Dava, icra, işe iade, ceza, istinaf aşamasında ayıplı mal |
| Süre kuralı | 25 | HMK, İİK, CMK, İYUK, TKHK, İş Kanunu — madde referanslı |
| Tatil | 60 | 2026 resmî tatilleri + adli tatil (20 Temmuz–31 Ağustos) |
| Dilekçe şablonu | 6 | Dava, cevap, istinaf, bilirkişi itirazı, icra takip talebi, delil listesi |
| İçtihat | 3 | `[DEMO VERİ]` ön ekli — gerçek karar değildir |
| AI görev fiyatı | 31 | 6'sı ücretsiz (belge sınıflandırma, süre tespiti, atıf doğrulama, gömme) |
| Kredi cüzdanı | 1 | 500 kredi, 200 belge kotası |
| Zamanlanmış iş | 5 | Süre/duruşma hatırlatma, kullanım anlık görüntüsü, abonelik ve kredi dönemi |

---

## 6. Mobil Uygulama

```bash
cd apps/mobile
npx expo start
```
Telefonda **Expo Go** ile QR kodu okutun. API adresi olarak makinenizin yerel IP'sini
kullanın (`localhost` telefondan çözülmez).

Mobil bilinçli olarak **salt-okur ağırlıklıdır**: bugünün duruşmaları, kritik süreler,
görevler, dosya arama. Dosya oluşturma, finans ve dilekçe üretimi mobilde **yoktur** —
bunlar masaüstüne aittir.

---

## 7. AI Özelliklerini Denemek

AI özellikleri **kendi sağlayıcınızı bağlamadan çalışmaz** (BYO-LLM mimarisi). Sistem bu
durumda çökmez, anlamlı bir hata döner.

1. **Ayarlar → AI Sağlayıcı** sayfasına gidin.
2. Sağlayıcı ekleyin:
   - **En hızlısı (anahtar gerektirmez):** makinenizde [Ollama](https://ollama.com) varsa
     tip `OLLAMA`, model `llama3.2` (önce `ollama pull llama3.2`). Bu seçenekte veriler
     makinenizden çıkmaz.
   - Ya da `ANTHROPIC` / `OPENAI_COMPAT` / `GEMINI` ile kendi API anahtarınız.
   - Ya da `CUSTOM` ile tamamen özel bir endpoint (URL + header + alan eşlemesi).
3. **Bağlantıyı Test Et** ile doğrulayın.
4. Bir dosya açıp **AI Asistan** sekmesinden soru sorun.

> **KVKK akışı:** Dış sağlayıcı seçtiyseniz ve metinde TC kimlik no, IBAN, telefon veya
> e-posta varsa sistem göndermeden önce durur, maskeli önizleme gösterir ve onayınızı ister.
> Yerel sağlayıcıda (Ollama) bu adım atlanır — veri zaten dışarı çıkmıyor.

---

## 8. Denemeye Değer Davranışlar

Sistemin ayırt edici kararlarını görmek için:

1. **Süre hesabının izi** — Dosya detayı → Süreler → "Kuraldan süre oluştur". Tebliğ tarihi
   girin; sistem son günü **adım adım** gösterir (HMK m.92 başlangıç, m.93 tatil kaydırması).
   Hesabı yapay zekâ değil, kural motoru yapar.
2. **Belge → aksiyon hattı** — Bir belge yükleyin. Sistem sınıflandırır, dosyayla eşler,
   süre tespit eder ve **öneri** üretir. Hiçbir kayıt kendiliğinden oluşmaz; **Öneriler**
   ekranından onaylarsınız.
3. **Uydurma içtihat savunması** — Bir dilekçeye olmayan bir Yargıtay kararı yazın. Atıf
   doğrulaması `BULUNAMADI` döner ve dilekçe **"hazır" durumuna geçemez** (422).
4. **Portal sızıntı testi** — Portal hesabıyla girin; yalnız 1 dosya görürsünüz. Diğer
   müvekkilin dosya numarasını URL'e yazsanız bile **404** alırsınız.
5. **Rol kısıtı** — Stajyer hesabıyla girin; kârlılık raporu menüde bile yoktur, doğrudan
   çağrılırsa 403 döner.
6. **Risk motoru** — Dosya detayı → Risk. AI sağlayıcı bağlı olmasa bile skor üretilir;
   bant **daima kural tabanından** gelir, yapay zekâ bandı değiştiremez.

---

## 9. Bilinen Sınırlar (bilinçli kararlar)

Aşağıdakiler gerçek servis kimlik bilgisi gerektirdiği için **bağlanmamıştır**. Sahte
entegrasyon yazmak yerine arayüz hazırlanmış, yapılandırılmamışsa anlamlı hata döner:

| Alan | Durum |
|---|---|
| e-Fatura (GİB entegratörü) | Adaptör hazır, `noop` |
| e-imza sağlayıcısı | Adaptör hazır; **sahte imza üretilmez** |
| WhatsApp / SMS / e-posta gönderimi | Kanal arayüzü hazır; mesaj `ONAYLANDI` durumunda korunur |
| Push bildirim (FCM/APNs) | Arayüz hazır; uygulama içi bildirimler çalışır |
| Taranmış görüntü OCR'ı | PDF metin çıkarma çalışır; görüntü OCR'ı eklenmedi |
| UYAP eklentisi | Kod ve fixture testleri hazır; **canlı UYAP'a karşı denenmedi** |
| Demo belgelerin dosya içeriği | Seed'deki belgelerin MinIO'da gerçek nesnesi yok — indirme için kendiniz yükleyin |
