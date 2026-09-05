# NomosOS — Üretim Dağıtımı

Bu doküman NomosOS'un üretim ortamına alınmasını, işletilmesini ve kurtarılmasını
anlatır. [01-mimari.md](01-mimari.md) §Çalıştırma Topolojileri'nde "Faz 1 sonunda
yazılacak" diye bırakılan belge budur.

**Dürüstlük notu.** Bu doküman *bugünkü kodun* dağıtımını anlatır, hedeflenen
kodun değil. Henüz yazılmamış her şey **⛔ EKSİK** etiketiyle ve hangi fazda
geleceği belirtilerek işaretlenmiştir. Etiketli bir maddeyi "var" sanarak üretime
çıkmak, arıza anında fark edilecek türden bir hatadır.

İlgili belgeler: [01-mimari.md](01-mimari.md) · [03-ai-katmani-byo-llm.md](03-ai-katmani-byo-llm.md)
· [04-kvkk-veri-guvenligi.md](04-kvkk-veri-guvenligi.md) · [06-yol-haritasi.md](06-yol-haritasi.md)

---

## 0. Bugünkü Dağıtım Gerçekliği — Önce Bunu Okuyun

Aşağıdakiler koddan doğrulanmış kısıtlardır. Kapasite planı ve topoloji seçimi
bunlara bağlıdır.

| Kısıt | Gerçek (Eylül 2026, Faz 4 sonrası) | Sonucu |
|---|---|---|
| **API çok örnekli çalışabilir** | Oran sınırı, giriş denemesi ve global sayaçlar `REDIS_URL` tanımlıysa Redis'te paylaşılır (`common/rate-limit/counter-store.ts`, `RATE_LIMIT_BACKEND`); abonelik/plan modülü durumu 30-60 sn süreç-içi önbellek | Yatay ölçeklemede `RATE_LIMIT_BACKEND=redis` zorunlu; önbellek gecikmesi kabul edilebilir (askı en geç 60 sn'de etkili). |
| **Kuyruk vardır (BullMQ)** | Belge → aksiyon hattı ve zamanlanmış işler BullMQ ile Redis'te; Redis kapalıysa hat HTTP dışında senkron koşar (`ARKA_PLAN` durumu) | Kuyruk derinliği `nomosos_queue_jobs{state}` ile ölçülür; `NomosOSQueueBacklog` uyarısı. |
| **Kiracı açma platform panelinden, dört-göz** | `POST /api/admin/v1/tenants` onay talebi → ikinci imza → kiracı + yönetici + abonelik + **kredi cüzdanı** birlikte açılır | Self-signup bilinçli olarak YOK; demo talebi `PLATFORM_NOTIFY_EMAIL`'e düşer. |
| **`pnpm db:seed` üretimde ÇALIŞMAZ** | Seed `NODE_ENV=production` iken `SEED_ALLOW_PROD=true` olmadan hata verir | Sistem verisi (süre kuralları, tatiller, planlar, fiyatlar) §4.4'teki ayrık yolla yüklenir. |
| **Dört uygulama imajı var** | `apps/{api,web,admin,portal}/Dockerfile`; `deploy.yml` etiketle GHCR'ye gönderir (`IMAGE_REGISTRY`, `IMAGE_TAG`) | Sunucu `docker compose pull` ile günceller; geri alma önceki etiket. |
| **Sır kasası entegrasyonu yoktur** | Sırlar `process.env`; şifreli sütunlar `MASTER_ENCRYPTION_KEY` (AES-256-GCM) | Kasa varsa sırlar konteyner başlarken enjekte edilir (§8.4). Rotasyon: `pnpm --filter @nomosos/api key:rotate` (§3.4). |
| **Yedekleme otomatik** | `backup` (pg_dump, `BACKUP_INTERVAL_HOURS`) ve `backup-minio` (mc mirror --watch) servisleri; `scripts/prod-restore.sh` geri yükler | Yedek tazeliği `nomosos_backup_last_success_timestamp_seconds`; `NomosOSBackupStale` uyarısı. Yedek birimi konteyner dışına da kopyalanmalı. |
| **PITR yoktur** | WAL arşivi yapılandırılmadı | RPO = yedek aralığı (varsayılan 24 sa; 6 sa önerilir). |
| **Çevrimiçi ödeme sözleşmeye bağlı** | `ODEME_SAGLAYICI=IYZICO` + anahtarlar; tanımsızsa 503 ve havale/EFT + panelden "ödendi işaretle" | Sözleşme öncesi gelir manuel tahsil edilir; fatura/dönem takibi yine sistemde. |

---

## 1. Dağıtım Topolojileri

Üç seçenek vardır. Seçim teknik değil **ticari ve hukuki** bir karardır: müşteri
hangi veri yerelliği taahhüdünü istiyor ve hangi işletme sorumluluğunu almak
istiyor?

### (a) Yönetilen Bulut — NomosOS işletir

**Kime uygun:** Solo avukat ve küçük bürolar (1–10 kullanıcı). BT personeli
olmayan, "açın çalışsın" bekleyen müşteri.

**Bileşenler**

| Bileşen | Ne | Not |
|---|---|---|
| `apps/api` | NestJS konteyneri, `/api/v1` + `/api/admin/v1` | Tek örnek (bkz. §0) |
| `apps/web` | Next.js konteyneri, port 3000 | Pazarlama sitesi + büro paneli |
| `apps/admin` | Next.js konteyneri, port 3002 | **Yalnız iç ağ/VPN** — `next.config.ts` zaten `X-Robots-Tag: noindex` koyar |
| PostgreSQL 16+ | Yönetilen hizmet | Tüm kiracılar tek veritabanı, satır seviyesi izolasyon |
| Redis 7+ | Yönetilen hizmet | Bugün sağlık yoklaması; Faz 5'te kuyruk + hız sayacı |
| S3 uyumlu depo | Belgeler | **Özel** kova, herkese açık DEĞİL |
| Ters vekil | TLS sonlandırma | `TRUSTED_PROXY_HOPS` buna göre ayarlanır |

**Sorumluluk paylaşımı**

| Konu | NomosOS | Müşteri |
|---|---|---|
| Altyapı, yama, yedek, izleme | ✔ | — |
| Sürüm yükseltme ve geri alma | ✔ | — |
| Yedek geri dönüş tatbikatı | ✔ | — |
| LLM sağlayıcı hesabı ve maliyeti | — | ✔ (BYO-LLM) |
| Kullanıcı/rol yönetimi, veri doğruluğu | — | ✔ |
| KVKK **veri sorumlusu** yükümlülükleri | — | ✔ |
| KVKK **veri işleyen** yükümlülükleri | ✔ | — |

**Dürüst sınır:** Bu topolojide "verileriniz Türkiye'de" iddiası **ancak**
seçilen bölge Türkiye ise doğrudur. Sözleşmede bölge adı açıkça yazılmalıdır;
"bulutta" demek yeterli değildir.

### (b) Türkiye Veri Bölgesi — kurumsal

**Kime uygun:** Kurumsal bürolar, kamu/banka müvekkili olan bürolar, veri
yerelliğini ihale/uyum şartı olarak koyan müşteriler. [04-kvkk-veri-guvenligi.md](04-kvkk-veri-guvenligi.md)
§Private AI kademelendirmesinin 3. basamağı.

**(a)'dan farkı:**
- Uygulama, veritabanı, belge deposu ve **yedekler** Türkiye'deki bir bölgede.
- Yedeklerin de yerellik kapsamında olduğu **açıkça** taahhüt edilir — çoğu
  ihlal buradan doğar: uygulama Türkiye'de, gecelik yedek başka kıtada.
- İsteğe bağlı **ayrık veritabanı** (kiracıya özel PostgreSQL örneği). Şema buna
  engel değildir ([01-mimari.md](01-mimari.md) §Multi-Tenancy), ancak ayrık
  veritabanı için çalışma zamanı yönlendirme kodu ⛔ EKSİK (Faz 6).
- Alt-işleyen listesi bölge bilgisiyle birlikte verilir (§9.5).

**Kritik uyarı:** Veri yerelliği **LLM çağrısını kapsamaz.** Büro bir dış
sağlayıcı (ANTHROPIC / OPENAI_COMPAT / GEMINI) bağladığı anda maskelenmiş metin
yurt dışına çıkar. "Verileriniz Türkiye'de" argümanı bu topolojide ancak
`Tenant.aiPolicy = SADECE_YEREL` ile birlikte tam anlamıyla doğrudur. Satış
malzemesinde bu iki şey ayrı ayrı yazılmalıdır.

### (c) Müşteri Kendi Altyapısında — on-premise

**Kime uygun:** Verinin bina dışına çıkmasını istemeyen büyük bürolar ve hukuk
departmanları. Private AI ile birlikte satılır: [04-kvkk-veri-guvenligi.md](04-kvkk-veri-guvenligi.md)
§Private AI, `OLLAMA`/büro-içi `CUSTOM` sağlayıcı.

**Bileşenler:** (a)'daki her şey + müşterinin ağında:
- **LLM sunucusu** (Ollama veya OpenAI-uyumlu bir iç servis). GPU gerekir;
  boyutlandırma seçilen modele bağlıdır — NomosOS bu konuda taahhüt vermez.
- `AI_INTERNAL_HOSTS` ile iç LLM ana makinesi "büro içi" olarak tanınır.
  Dışsallık kararı sağlayıcı **tipine** değil **adrese** bakılarak verilir
  (`packages/ai/src/pii.ts`): `localhost`, RFC1918 (10.x / 172.16-31.x /
  192.168.x) ve `*.local` zaten içeridir; kendi alan adınızla çalışan iç LLM
  buraya eklenir.
- Kiracı politikası `SADECE_YEREL` yapılır.

**Sorumluluk paylaşımı**

| Konu | NomosOS | Müşteri |
|---|---|---|
| Yazılım, sürüm, güvenlik yaması bildirimi | ✔ | — |
| Kurulum desteği ve çalıştırma kitabı | ✔ | — |
| Sunucu, ağ, TLS sertifikası, işletim sistemi | — | ✔ |
| Yedekleme, geri dönüş tatbikatı, saklama | — | ✔ |
| İzleme ve nöbet | — | ✔ |
| LLM sunucusu ve GPU | — | ✔ |
| KVKK: NomosOS artık veri **işlemez** | — | ✔ (tek sorumlu müşteridir) |

**Dürüst sınır:** On-premise'te NomosOS müşterinin verisine erişmez; bu nedenle
"biz kurtarırız" da diyemez. Yedek ve kurtarma tamamen müşteridedir ve
sözleşmede böyle yazılmalıdır. Destek erişimi gerekirse süreli ve kayıtlı olmalıdır
(platform tarafındaki `SupportAccessGrant` deseni, müşteri onayıyla).

---

## 2. Gereksinimler

### 2.1 Zorunlu bileşen sürümleri

> **Faz 5:** PostgreSQL'de **pgvector** ve **pg_trgm** uzantıları zorunludur (RAG vektör araması + trigram
> indeksleri). Compose imajı `pgvector/pgvector:pg16`; yönetilen PostgreSQL'de (RDS/Cloud SQL/Azure)
> pgvector'ü etkinleştirin. Göç `CREATE EXTENSION IF NOT EXISTS vector` ile başlar; uzantı yoksa durur.

| Bileşen | Asgari | Not |
|---|---|---|
| PostgreSQL | **16+** | `docker-compose.yml` `postgres:16-alpine` kullanır; Prisma 6 şeması buna göre migrate edilmiştir |
| Redis | **7+** | Bugün yalnız sağlık yoklaması; Faz 5'te kuyruk ve hız sayacı için zorunlu hale gelir |
| S3 uyumlu depo | MinIO veya AWS S3 | İstemci `forcePathStyle: true` ile çalışır (`storage.service.ts`), yol-tarzı adresleme destekleyen her uyumlu depo olur |
| Node.js | **22** | Kök `package.json` `engines: >=20` der ama üretim imajları `node:22-alpine`'dır. **22'de kalın**; sürüm karışıklığı test edilmemiş bir kombinasyondur |
| pnpm | 9.15.4 | `packageManager` alanında sabitlenmiştir |

### 2.2 Kaynak boyutları — **başlangıç noktası**, taahhüt değil

Aşağıdaki sayılar **ölçülmemiş tahminlerdir**. Gerçek yük, kiracının belge
hacmine ve AI kullanımına göre değişir; ilk 30 gün izleyip (§7) düzeltin.
Boyutlandırmanın dayandığı varsayımlar açıkça yazılmıştır ki yanlış çıktığında
neyin yanlış çıktığı görülebilsin.

**Varsayımlar:** kullanıcı başına günde ~200 API isteği; belge yükleme ~50 MB
üst sınır (Multer); PDF ayrıştırma ~300 sayfaya kadar (`MAX_PDF_PAGES`) ve
**bellekte** yapılır; AI çağrısı ağ-bağımlıdır (CPU değil), `AI_TIMEOUT_MS`
varsayılan 60 sn.

#### Küçük büro — 1–5 kullanıcı

| Bileşen | Başlangıç | Gerekçe |
|---|---|---|
| API | 1 vCPU / 2 GB RAM | PDF ayrıştırma bellekte; 2 GB altı, büyük bir PDF geldiğinde OOM riski |
| Web + Admin | 1 vCPU / 1 GB RAM (birlikte) | Next.js üretim sunucusu, ağır iş yapmaz |
| PostgreSQL | 1 vCPU / 2 GB RAM / 20 GB disk | Metin ağırlıklı; belgeler DB'de değil S3'te |
| Redis | 256 MB | Bugün neredeyse boş |
| S3 | 50 GB | Büro başına yıllık belge birikimi kabaca 10–30 GB varsayımı |

#### Orta büro — 6–25 kullanıcı

| Bileşen | Başlangıç | Gerekçe |
|---|---|---|
| API | 2 vCPU / 4 GB RAM | Eşzamanlı PDF ayrıştırma + AI çağrısı beklemesi |
| Web + Admin | 1 vCPU / 2 GB RAM | |
| PostgreSQL | 2 vCPU / 8 GB RAM / 100 GB disk | Çalışma kümesi belleğe sığsın; RAG için `DocumentChunk` tablosu en hızlı büyüyendir |
| Redis | 512 MB | |
| S3 | 250 GB | |

#### Kurumsal — 25+ kullanıcı

| Bileşen | Başlangıç | Gerekçe |
|---|---|---|
| API | 4 vCPU / 8 GB RAM | **Yine tek örnek** (§0). Yatay ölçekleme Faz 5 |
| Web + Admin | 2 vCPU / 4 GB RAM, ayrı konteynerler | Panel iç ağa, web dışa bakar; ayrı ölçeklenmeli |
| PostgreSQL | 4+ vCPU / 16+ GB RAM / 500 GB+ | Okuma replikası ve bağlantı havuzu (PgBouncer) bu ölçekte değerlendirilir |
| Redis | 1 GB, yüksek erişilebilir | Faz 5 kuyruğu buraya gelecek |
| S3 | 1 TB+, sürümleme açık | |

**Tek örnek uyarısı:** Kurumsal ölçekte API'nin tek örnek olması bir tekil arıza
noktasıdır. Bu kısıt kaldırılana kadar (Faz 5) kurumsal müşteriye verilecek
erişilebilirlik taahhüdü buna göre yazılmalıdır.

### 2.3 Ağ ve port

| Servis | Port | Kime açık |
|---|---|---|
| `apps/web` | 3000 | İnternet (TLS arkasında) |
| `apps/api` | 3001 (`API_PORT`) | Ters vekil üzerinden internet; doğrudan açılmaz |
| `apps/admin` | 3002 | **Yalnız iç ağ / VPN** |
| PostgreSQL | 5432 | Yalnız API'den |
| Redis | 6379 | Yalnız API'den |
| S3/MinIO | 9000 | Yalnız API'den (istemci ön-imzalı URL kullanır) |

`/api/admin/v1/**` yolu API içindedir; ters vekilde ayrı bir konum kuralıyla
kaynak IP kısıtı koymak güçlü bir ek katmandır (§8.5).

---

## 3. Ortam Değişkenleri

Tablo `.env.example` ve koddan doğrulanmıştır. "Nasıl üretilir" sütunundaki
komutlar birebir çalıştırılabilir.

### 3.1 Zorunlu

| Değişken | Ne işe yarar | Nasıl üretilir | Kaybedilirse / yanlışsa |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL bağlantısı (Prisma) | `postgresql://kullanıcı:parola@host:5432/nomosos` | Uygulama açılır ama her istek başarısız; sağlık ucu `postgresql: down` der |
| `JWT_SECRET` | Kiracı oturum token'ının imza anahtarı. **En az 32 karakter** | `openssl rand -base64 48` | **Uygulama AÇILMAZ** (`app.module.ts`, açık Türkçe hata). Değiştirilirse tüm kiracı oturumları düşer — veri kaybı yok, yeniden giriş gerekir |
| `MASTER_ENCRYPTION_KEY` | AI sağlayıcı API anahtarlarını AES-256-GCM ile şifreler. **64 hane hex** | `openssl rand -hex 32` | **§3.3'e bakın — en ağır kayıp senaryosu** |
| `S3_ENDPOINT` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` · `S3_BUCKET` · `S3_REGION` | Belge deposu | Depo sağlayıcısından | `S3_ENDPOINT` tanımsızsa API yine açılır; belge yükleme hata döner, dilekçe dışa aktarımı base64 gövdeye (INLINE) düşer. MinIO'da `S3_REGION` anlamsızdır; AWS'de gerçek bölge yazılmalıdır |
| `PLATFORM_REQUIRE_2FA` | Platform panelinde TOTP zorunluluğu | `true` | `NODE_ENV=production` iken `true` değilse **uygulama AÇILMAZ** (`assertTwoFactorPolicy`, `main.ts`). Bu yorum değil kod zorlamasıdır |
| `WEB_ORIGIN` | CORS beyaz listesi (virgüllü) | `https://app.buro.com,https://admin.buro.local` | Tanımsızsa varsayılan `http://localhost:3000`'dir → üretimde tarayıcı istekleri CORS'a takılır. `.env.example`'da artık yer alıyor (kısa süre önce eklendi; EKSİK işaretlemesi kalktı) |

### 3.2 Önerilen / duruma bağlı

| Değişken | Varsayılan | Ne işe yarar | Kaybedilirse |
|---|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Sağlık yoklaması; Faz 5'te kuyruk | Sağlık ucu `redis: down` der; bugün başka etki yok |
| `API_PORT` | 3001 | API dinleme portu | — |
| `TRUSTED_PROXY_HOPS` | — | Kaç güvenilen vekil var. **Üretimde zorunlu** — ayrıntı **§3.2.1** | Bozuk ya da üretimde tanımsızsa **açılış durur**; vekil arkasında yanlışsa denetim izindeki IP alanı **yanlış** olur (vekilin IP'si görünür) |
| `API_FORCE_HSTS` | `false` | TLS ters vekilde sonlanıyorsa HSTS başlığını açar | Üretimde `true` olmalı (§8.1) |
| `API_JSON_BODY_LIMIT` | `1mb` | JSON gövde tavanı | Belge yüklemesi multipart'tır, bu sınıra takılmaz (Multer 50 MB) |
| `AI_TIMEOUT_MS` | `60000` (alt 5 sn, üst 600 sn) | AI çağrısı zaman aşımı | Node fetch'inde varsayılan zaman aşımı **yoktur**: sağlayıcı yanıt vermezse istek süresiz asılır ve 50 MB tampon bellekte kalır |
| `AI_RATE_LIMIT_PER_MINUTE` / `_PER_DAY` | 20 / 300 | Kullanıcı+uç başına pahalı AI uçlarında sınır | BYO-LLM maliyeti doğrudan büroya yazıldığı için sınır ürünün parçasıdır. Büro bazlı kovalar için **§3.2.3**; çok örnekli dağıtımda sayacın belleği için **§3.2.2** |
| `AI_INTERNAL_HOSTS` | — | Büro-içi sayılacak EK ana makineler | Yazılmazsa kendi alan adıyla çalışan iç LLM **dış sağlayıcı** sayılır → gereksiz PII onayı ve yanlış KVKK sınıflandırması |
| `AI_EMBEDDING_MODEL` (+ `_<TİP>`) | — | RAG gömme modeli | Boşsa sağlayıcı tipine göre varsayılan seçilir; gömme desteklenmeyen tipte asistan anahtar kelime aramasına düşer |
| `MAX_PDF_PAGES` | 300 | Tek PDF'te ayrıştırılacak azami sayfa | Aşılırsa kısmi metin + açık uyarı |
| `NEXT_PUBLIC_API_URL` | — | `apps/web` → kiracı API adresi | Yanlışsa tarayıcı hiçbir veri çekemez. **Derleme zamanında gömülür** — değişirse web imajı yeniden derlenmeli |
| `NEXT_PUBLIC_ADMIN_API_URL` | — | `apps/admin` → `/api/admin/v1` adresi | Aynı derleme-zamanı uyarısı geçerli |
| `PLATFORM_JWT_SECRET` | JWT_SECRET'ten HMAC-SHA256 ile **türetilir** | Panel token'ını kiracı token'ından ayrı anahtarla imzalar | Zorunlu değil. Tanımlanırsa en az 32 karakter. Değiştirilirse tüm panel oturumları düşer |
| `PLATFORM_2FA_ENCRYPTION_KEY` | MASTER_ENCRYPTION_KEY'den HMAC ile **türetilir** | Panel TOTP gizli anahtarlarını şifreler; master anahtardan bilinçli olarak ayrıdır | Değiştirilirse mevcut 2FA kayıtları **okunamaz** ve tüm panel kullanıcılarının TOTP'si sıfırlanmalıdır |
| `DEFAULT_VAT_RATE` | 20 | Sözleşmesiz kalemlerde KDV oranı | Oran koda gömülü değildir; mevzuat değişirse burada değişir |
| `INVOICE_NUMBER_PREFIX` | `NOM` | Fatura numarası öneki (`<ÖNEK><YIL><9 hane>`) | **Kurulumdan sonra değiştirmeyin**: numara serisi bütünlüğü bozulur |
| `EINVOICE_PROVIDER` | `noop` | e-Fatura entegratörü | `noop` GİB'e **hiçbir** bağlantı kurmaz; gönderim isteğinde 503 döner ve sahte "gönderildi" durumu üretmez |
| `NODE_ENV` | — | `production` olmalı | `production` değilse 2FA zorlaması devreye girmez |
| `TZ` | — | `UTC` önerilir | Tarih hesapları `process.env.TZ`'ye bağlı değildir (`common/dates.ts`), ama günlük zaman damgalarının tekdüze olması için konteynerleri UTC'de çalıştırın |
| `STUN_URLS` | genel Google STUN | WebRTC STUN sunucuları (virgüllü) — `GET /chat/ice-servers` uçtan döner | Boşsa varsayılan genel STUN kullanılır (bugünkü davranış) |
| `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL` | — | TURN relay (örn. coturn; `turn:host:port?transport=udp`) — sıkı NAT arkasında video arama için | Üçü BİRLİKTE tanımlı değilse TURN yok sayılır (yalnız STUN; uyarı yok, davranış bilinçli). Kimlikler statik paylaşımlıdır; kısa ömürlü (HMAC) kimlikler coturn kurulduktan sonra eklenir |

### 3.2.1 `TRUSTED_PROXY_HOPS` — üretimde ZORUNLU (denetim bulgusu Ö-08)

Bu değişken "önerilen" DEĞİLDİR; **üretimde zorunlu alandır**:

| Durum | Sonuç |
|---|---|
| Bozuk değer (`1a`, `99`, `-1`…) | **Her ortamda açılış DURUR** — sessizce 0'a düşmez |
| `NODE_ENV=production` iken **tanımsız** | **Açılış DURUR** (`common/trusted-proxy.ts`). Vekil arkasındaysanız hop sayısını yazın (nginx/ALB/Caddy/Traefik için genellikle `1`, CDN+vekil zincirinde `2`); API doğrudan internete açıksa **açıkça `TRUSTED_PROXY_HOPS=0`** yazın |
| Açık `0` | Tek geçerli "vekilim yok" ifadesi — her ortamda çalışır |
| 10'un üstü | Açılış durur (üst sınır: 10) |

Yanlış ayar üç mekanizmayı birlikte bozar: hesap kilidi, oran sınırlayıcılar ve
10 yıl saklanan denetim izlerindeki IP alanı (hepsi `request.ip`'yi okur).

### 3.2.2 Oran sınırlayıcı sayaçların belleği — `RATE_LIMIT_BACKEND`

Giriş/2FA/portal kilidi ve AI oran kovaları varsayılan olarak (`auto`)
**süreç içindedir**. Bu, tek örnekli dağıtımda doğrudur; **çok örnekli
(yatay ölçeklenen) dağıtımda her örnek kendi kovasını sayar** — sınır
etkin olarak örnek sayısıyla çarpılır.

| Değer | Davranış |
|---|---|
| `auto` (varsayılan) | `REDIS_URL` çözülebilirse Redis'e, çözülemezse süreç içine düşer |
| `redis` | Zorunlu kılar. `REDIS_URL` yoksa/bozuksa **açılış durmaz ama o uç** süreç-içi sayaca düşmez — hata günlüğe yazılır |
| `memory` | Süreç-içi kova istenir. Tek örnek dışında **kullanmayın** |

**Çok örnekli dağıtımda `RATE_LIMIT_BACKEND=redis` yazın** (ve `REDIS_URL`
verin). Yazılmazsa kilit/sayaçlar sessizce süreç içine düşer (denetim bulgusu
Ö-09'un dağıtım yüzü).

### 3.2.3 Büro (tenant) bazlı AI sınırları

Kullanıcı+uç kovalarına ek olarak dört kova vardır (`common/guards/ai-rate-limit.guard.ts`):

| Kova | Değişken | Varsayılan |
|---|---|---|
| Kullanıcı+uç / dakika | `AI_RATE_LIMIT_PER_MINUTE` | 20 |
| Kullanıcı+uç / gün | `AI_RATE_LIMIT_PER_DAY` | 300 |
| **Büro (rotadan bağımsız) / dakika** | `AI_RATE_LIMIT_TENANT_PER_MINUTE` | 60 |
| **Büro (rotadan bağımsız) / gün** | `AI_RATE_LIMIT_TENANT_PER_DAY` | 2000 |

Büro kovaları tek bir kullanıcının parola denemesi yapmasını değil, bir büronun
toplam AI bütçesini korur; reddedilen istekten kredi **düşmez**. Yönetilen AI
(kredi satılan) modda bu kovalar maliyet kontrolünün son hattıdır — kredi
paketlerine göre ayarlayın.

### 3.3 `MASTER_ENCRYPTION_KEY` — özel uyarı

Bu anahtar **veritabanı yedeğinde yoktur.** Veritabanında yalnızca
`base64(iv).base64(tag).base64(ct)` biçiminde şifreli metin durur
(`packages/ai/src/crypto.ts`). Anahtar yalnızca ortamda yaşar.

**Neyi korur:**
1. Tüm kiracıların LLM sağlayıcı API anahtarları (`AiProviderConfig.encryptedApiKey`)
2. Türetim yoluyla platform paneli TOTP gizli anahtarları (`PLATFORM_2FA_ENCRYPTION_KEY` ayrı tanımlı değilse)

**Kaybedilirse:**
- Müvekkil verisi, dosyalar, belgeler **KAYBOLMAZ** — onlar bu anahtarla şifreli değildir.
- Ama **her kiracı** AI sağlayıcı anahtarını yeniden girmek zorunda kalır ve o
  ana kadar tüm AI özellikleri çalışmaz.
- Panel 2FA kayıtları okunamaz; tüm platform yöneticilerinin TOTP'si sıfırlanır.
  Bu, `MIN_ACTIVE_SUPER_ADMINS = 2` kuralı yüzünden **dört-göz onayı gerektiren
  işlemleri de kilitler** — yani kilidi açacak mekanizma da kilitlenir.

**Bu yüzden:** anahtar en az iki bağımsız yerde saklanır (sır kasası + çevrimdışı
mühürlü zarf), erişim kaydı tutulur, ve **anahtarın kendisi asla veritabanı
yedeğiyle aynı yere konmaz.** Aynı yere konursa yedeği ele geçiren tüm kiracıların
LLM anahtarlarını da ele geçirmiş olur.

### 3.4 Rotasyon prosedürü

Komut (Faz 4): `apps/api/src/scripts/rotate-master-key.ts` — tüm şifreli sütunları
(AI sağlayıcı anahtarları/başlıkları, SSO istemci sırrı, kullanıcı TOTP, e-Fatura kimlik
bilgisi, webhook sırrı) eski anahtarla çözüp yeni anahtarla TEK transaction'da yeniden
şifreler; biri çözülemezse hiçbir satır yazılmaz. Önce `--dry-run`.
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod.local exec \
  -e OLD_MASTER_ENCRYPTION_KEY=<eski> -e NEW_MASTER_ENCRYPTION_KEY=<yeni> api \
  node dist/scripts/rotate-master-key.js --dry-run     # sonra --dry-run olmadan
```

1. **Bakım banner'ı** aç (§6.4) — kullanıcıya "AI özellikleri kısa süre
   kullanılamayacak" duyurusu.
2. Yeni anahtar üret: `openssl rand -hex 32`. Eski anahtarı **silme**.
3. Veritabanının anlık tam yedeğini al (geri dönülecek nokta).
4. Yeniden şifreleme komutunu çalıştır (yukarıdaki `rotate-master-key`): tek
   transaction, çözülemeyen satır varsa hiçbir şey yazılmaz ve satır listesi basılır.
5. `PLATFORM_2FA_ENCRYPTION_KEY` **ayrı tanımlı değilse**, master anahtar
   değişimi TOTP kayıtlarını da geçersiz kılar. Rotasyondan önce bu değişkeni
   **açıkça tanımlayın** ki panel 2FA'sı master rotasyonundan etkilenmesin.
   Bu, rotasyon planının en kolay atlanan adımıdır.
6. Ortam değişkenini yeni anahtarla güncelle, API'yi yeniden başlat.
7. Doğrula: bir kiracıda Ayarlar → AI Sağlayıcı → "Bağlantıyı Test Et" başarılı.
8. Bakım banner'ını kapat. Eski anahtarı en az 30 gün sakla, sonra imha et ve
   imhayı kayıt altına al.

---

## 4. İlk Kurulum Adımları

Sırayla. Her adımın çıkış kriteri vardır; sağlanmadan sonrakine geçmeyin.

### 4.1 Veritabanı oluşturma

```sql
CREATE DATABASE nomosos ENCODING 'UTF8' LC_COLLATE 'tr_TR.UTF-8' LC_CTYPE 'tr_TR.UTF-8' TEMPLATE template0;
CREATE USER nomosos_app WITH PASSWORD '<güçlü-parola>';
GRANT ALL PRIVILEGES ON DATABASE nomosos TO nomosos_app;
```

Uygulama kullanıcısı **süper kullanıcı olmamalıdır.** Migration çalıştıran
kullanıcı ile uygulamanın çalışma zamanı kullanıcısı ayrı olabilir; ayrıysa
migration kullanıcısına DDL, uygulama kullanıcısına yalnız DML verin.

*Çıkış kriteri:* `psql "$DATABASE_URL" -c 'SELECT 1'` çalışıyor.

### 4.2 Şema kurulumu

```bash
pnpm db:deploy   # = prisma migrate deploy
```

`migrate deploy` **geliştirme komutu değildir**: mevcut migration'ları sırayla
uygular, şema sürüklemesi (drift) tespit ederse durur, hiçbir şeyi sıfırlamaz.
Üretimde **asla** `migrate dev` (`pnpm db:migrate`) çalıştırmayın — o komut
veritabanını sıfırlamayı teklif edebilir.

Depoda bugün 8 migration vardır (`packages/db/prisma/migrations/`), `init`'ten
`faz4_ai_derinlik_krediler`'e kadar.

*Çıkış kriteri:* `_prisma_migrations` tablosunda 8 satır, hepsi başarılı.

### 4.3 İlk kiracı ve PlatformUser

⛔ **EKSİK:** Kiracı açan bir API ucu ve bootstrap komutu yoktur (§0). Bugün
tek yol elle kayıt eklemektir.

**Platform yöneticileri — İKİ TANE ZORUNLU.** `MIN_ACTIVE_SUPER_ADMINS = 2`.
Tek `SUPER_ADMIN`'li kurulumda dört-göz ilkesi **fiilen çalışmaz**: talep eden
kendi talebini onaylayamadığı için askıya alma, iade, bakım kilidi ve panel
personeli açma işlemlerinin **hiçbiri** tamamlanamaz. Bu, çalışır sanılan bir
kurulumda ilk gerçek olayda fark edilir.

Sıra:
1. İki `SUPER_ADMIN` kaydı oluştur (`PlatformUser`: `email`, `passwordHash`
   (bcrypt), `fullName`, `role`, `isActive: true`). Parolalar **farklı iki
   kişide** olmalıdır; ikinci hesap ayrı bir insanı temsil eder, yedek parola
   değildir.
2. Panele gir (`http://<admin>:3002`), her iki hesapta da **TOTP kur**.
   `PLATFORM_REQUIRE_2FA=true` olduğu için bu adım atlanamaz.
3. İlk kiracıyı (`Tenant`) ve o kiracının `ADMIN` rolündeki ilk kullanıcısını
   oluştur.
4. Kiracının `Subscription` kaydını ve `CreditWallet`'ını aç — yoksa AI kredi
   akışı ilk çağrıda hata verir.

*Çıkış kriteri:* İki platform yöneticisi 2FA ile giriş yapabiliyor; kiracı
kullanıcısı `POST /api/v1/auth/login` ile token alabiliyor.

### 4.4 Sistem verisi (süre kuralları, tatiller, fiyat tabloları)

**Dikkat.** `pnpm db:seed` üretimde çalıştırılmaz: demo müvekkil/dosya üretir ve
sabit parolalı (`Demo1234!`) hesaplar açar.

Ama şu veriler üretimde **gereklidir** ve bugün yalnız o betiğin içindedir:

| Veri | Neden gerekli |
|---|---|
| `DeadlineRule` (`tenantId = null`) | Süre motorunun sistem kuralları. Yoksa süre hesabı yapılamaz — ürünün çekirdek işlevi |
| `Holiday` (resmi tatiller + adli tatil) | Süre hesabı takvimi. Yoksa süreler **yanlış** hesaplanır |
| `PetitionTemplate` (`tenantId = null`) | Sistem dilekçe şablonları |
| `PlanTier` | Abonelik planları |
| `AiTaskCost`, `CreditPackage`, `ModelPrice` | Kredi sistemi fiyatlandırması. Yoksa AI çağrıları ücretlendirilemez |

⛔ **EKSİK:** Yalnız bu sistem verisini yükleyen ayrık bir üretim tohumu
(`seed:system` gibi) yoktur. Bu yazılana kadar sistem verisi elle veya
`seed.ts`'nin ilgili fonksiyonları ayıklanarak yüklenir. **Üretime çıkmadan önce
bu boşluk kapatılmalıdır** — özellikle `Holiday` tablosu, çünkü eksikliği sessizce
yanlış süre üretir.

*Çıkış kriteri:* `SELECT count(*) FROM "Holiday"` > 0 ve
`SELECT count(*) FROM "DeadlineRule" WHERE "tenantId" IS NULL` > 0.

### 4.5 S3 kovası ve erişim politikası

API açılışta kova yoksa **oluşturmayı dener** (`StorageService.onModuleInit` →
`ensureBucket`); başarısız olursa uyarı basar ama **uygulamayı düşürmez** —
belge uçları çalışmaz, gerisi çalışır.

Üretimde kovayı **önceden elle oluşturun** ve uygulama kimliğine `CreateBucket`
yetkisi **vermeyin**. Gereken yetkiler: `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject`, `s3:ListBucket`, `s3:HeadBucket` — yalnız kendi kovası üzerinde.

Kova ayarları:
- **Herkese açık erişim KAPALI.** İstemci belgeye yalnızca API'nin ürettiği
  ön-imzalı URL ile erişir; kova politikası hiçbir anonim okumaya izin vermemeli.
- Sunucu tarafı şifreleme açık (SSE-S3 veya SSE-KMS).
- Sürümleme açık — yanlış silmeye karşı ilk savunma.
- Yaşam döngüsü kuralı: eski sürümler 90 gün sonra silinsin (maliyet).
- TLS zorunlu (`aws:SecureTransport` koşulu).

Nesne anahtarı düzeni: `${tenantId}/${caseId ?? "genel"}/${documentId}-${güvenliAd}`.
Bu düzen, kiracı bazlı politika yazmayı ve kiracı bazlı yedek almayı mümkün kılar.

*Çıkış kriteri:* Uygulamadan bir belge yüklenip ön-imzalı bağlantıyla
indirilebiliyor; aynı nesnenin doğrudan URL'si tarayıcıda **403** dönüyor.

### 4.6 Sağlık kontrolü

| Uç | Kimlik | Ne yapar |
|---|---|---|
| `GET /api/v1/health` / `/health/live` | Açık (`@Public`) | Sabit `{status:"ok", time}` döner. **Konteyner liveness** içindir, bağımlılıkları yoklamaz |
| `GET /api/v1/health/ready` | Açık (`@Public`) | **Readiness (Faz 4):** PostgreSQL `SELECT 1`, Redis `PING` (REDIS_URL varsa), S3 `HeadBucket`; 2 sn zaman aşımı; biri düşükse **503** + bileşen ayrıntısı. Yük dengeleyici / rolling update bu uca bakar |
| `GET /api/admin/v1/health` | Platform token'ı | **Gerçek yoklama**: PostgreSQL `SELECT 1`, Redis ham TCP `PING`→`+PONG`, S3 kova erişimi. Her biri için gecikme (ms) ve durum (`ok`/`degraded`/`down`) döner |

İki ucun farkı bilinçlidir: LB ucu ucuz ve her saniye çağrılabilir olmalı;
tanı ucu pahalıdır ve yetki ister. `ANALYST_READONLY` rolü tanı ucunda yalnız
çalışma süresi satırını görür (bileşen hata mesajları o role kapalıdır).

Ham hata mesajları istemciye **verilmez** (bağlantı dizesi/parola sızabilir);
ayrıntı sunucu günlüğündedir.

*Çıkış kriteri:* `/api/v1/health/ready` `"ready"` ve `/api/admin/v1/health` üç bileşen için de `ok` dönüyor.

---

## 5. Yedekleme ve Geri Dönüş

> **KVKK vurgusu:** Yedekler de kişisel veri içerir. Üretim veritabanının
> yedeği, müvekkil kimlik, sağlık ve mali verisinin tam bir kopyasıdır. Yedek;
> saklama süresi, erişim yetkisi, şifreleme, yer (ülke) ve imha bakımından
> üretim verisiyle **aynı** rejime tabidir. "Yedek sadece yedektir" diye
> gevşetilen erişim kontrolü, KVKK açısından üretim verisini korumasız
> bırakmakla aynı şeydir. Aynı şey **geri dönüş tatbikatı için açılan test
> ortamları** için de geçerlidir.

⛔ **EKSİK:** Depoda yedekleme betiği veya zamanlayıcı yoktur (Faz 5). Aşağıdaki
prosedür platform araçlarıyla (cron, yönetilen yedek, nesne yaşam döngüsü)
kurulacak olan hedeftir.

### 5.1 PostgreSQL

**Otomatik (Faz 4):** `docker-compose.prod.yml` `backup` servisi `BACKUP_INTERVAL_HOURS`
(varsayılan 24; 6 önerilir) aralıkla `pg_dump -Fc` alır, `BACKUP_RETENTION_DAYS` sonra siler ve
`/backups/last-success.json` yazar (metrik + `NomosOSBackupStale` uyarısı). `backup-minio`
belge kovasını `mc mirror --watch` ile aynalar. Elle: `scripts/prod-backup.sh`.

**Geri yükleme:** `scripts/prod-restore.sh --dump <dosya> [--minio <tar.gz>]` — uygulamaları
durdurur, güvenlik yedeği alır, DB'yi yeniden yaratır, `migrate deploy`, readiness bekler ve
RTO süresini basar. Tatbikat için `--target-db nomosos_tatbikat` (üretim DB'sine dokunmaz).

**PITR (point-in-time recovery) — önerilen:** WAL arşivlemesi ile herhangi bir
ana geri dönüş. Yönetilen PostgreSQL kullanıyorsanız çoğunlukla bir ayardır;
kendi kurduysanız `archive_mode`, `archive_command` ve temel yedek zinciri
gerekir. ⛔ **EKSİK:** PITR yapılandırması bu depoda tanımlı değil, Faz 5.

**Neden ikisi birden:** Mantıksal yedek taşınabilir ve şema düzeyinde
seçici geri dönüşe izin verir; PITR ise "yanlış silme 14:35'te oldu, 14:34'e
dönelim" senaryosunun tek çözümüdür. Mantıksal yedek tek başına, iki yedek
arasındaki tüm çalışmayı kaybettirir.

### 5.2 Nesne deposu (MinIO / S3)

- Sürümleme + **çapraz bölge/çapraz hesap** replikasyon.
- MinIO'da: `mc mirror --watch` ile ikinci bir hedefe ya da düzenli `mc mirror`.
- Belge nesneleri değişmez (immutable) kabul edilir; silme işaretleri korunur.
- **Veritabanı ve nesne yedeği birbiriyle tutarlı olmalıdır.** Veritabanı 03:00'e,
  nesne deposu 05:00'e dönerse arada yüklenen belgelerin kayıtları var ama
  dosyaları yok (ya da tersi). Geri dönüşte **her zaman nesne deposunu daha
  yeni** bırakın: fazladan yetim nesne zararsızdır, eksik dosya değildir.

### 5.3 Yedeklerin şifrelenmesi

- Yedek dosyaları **beklemede şifreli** saklanır (depo tarafı SSE veya
  `age`/`gpg` ile dosya düzeyinde).
- Yedek şifreleme anahtarı, üretim ortam değişkenlerinden **ayrı** yerde durur.
- **`MASTER_ENCRYPTION_KEY` yedeklerin yanına konmaz** (§3.3).
- Yedeklere erişim kaydı tutulur; erişim yetkisi en az iki kişiyle sınırlıdır.

### 5.4 Geri dönüş tatbikatı — **zorunlu**

Denenmemiş yedek, yedek değildir. Sadece bir umuttur.

**En az 3 ayda bir**, üretimden yalıtılmış bir ortamda:
1. Son yedeği geri yükle.
2. `prisma migrate deploy` çalıştır — şema sürümü tutuyor mu?
3. Bir kiracı kullanıcısıyla giriş yap, bir dosya aç, bir belge indir.
4. `/api/admin/v1/health` üç bileşende de `ok` mu?
5. **Süreyi ölç:** geri dönüş kaç dakika sürdü? Bu sayı, sözleşmedeki RTO
   taahhüdünün tek dürüst dayanağıdır.
6. Tatbikat ortamını **imha et** ve imhayı kayıt altına al (KVKK).

Tatbikat sonucu (tarih, süre, sorunlar) yazılı tutulur. Başarısız tatbikat bir
olaydır; kayda geçer ve düzeltilir.

### 5.5 Saklama süreleri

| Yedek türü | Önerilen saklama | Gerekçe |
|---|---|---|
| Günlük mantıksal yedek | 30 gün | Yakın geçmiş hatalar |
| Haftalık | 12 hafta | Geç fark edilen bozulma |
| Aylık | 12 ay | Yıl içi denetim |
| WAL / PITR penceresi | 7–14 gün | Ayrıntılı geri dönüş |
| Denetim izi (`AuditLog`, `PlatformAuditLog`) | **asgari 10 yıl** | Append-only; güncellenmez/silinmez. Kod bu süreyi varsayar |

**Çelişki uyarısı:** KVKK'nın veri minimizasyonu ilkesi ile 10 yıllık denetim
izi saklama arasında gerilim vardır. Çözüm: denetim izi **kim-ne-ne zaman**
tutar, veri içeriğini değil. Yedeklerin saklama süresi ise gereğinden uzun
tutulmamalıdır — 12 aydan eski yedeği saklamak için yazılı bir gerekçe olmalıdır.

---

## 6. Güncelleme ve Geri Alma

### 6.1 Sıfıra yakın kesinti sırası

```
1. Yedek al (mantıksal + nesne deposu anlık görüntüsü)
2. Bakım BANNER'ını aç (tam kilit değil — §6.4)
3. prisma migrate deploy          ← şema ÖNCE, geriye uyumlu olduğu için güvenli
4. Yeni API imajını başlat, sağlık ucunu bekle
5. Yeni web/admin imajlarını başlat
6. Duman testi (§6.6)
7. Banner'ı kapat
```

### 6.2 Geriye uyumlu şema ilkesi

Migration **önce**, kod **sonra** gider. Bu ancak şema değişikliği eski kodla da
çalışıyorsa güvenlidir. Kural:

- **Ekle:** yeni kolon her zaman `NULL` kabul eder veya varsayılanı vardır.
- **Yeniden adlandırma yok:** eski kolon kalır, yeni kolon eklenir, veri
  kopyalanır, kod yeni kolona geçer, eski kolon **bir sonraki** sürümde silinir.
  Tek adımda yeniden adlandırma, dağıtımın 10 saniyesinde eski kodla yeni şemayı
  karşı karşıya getirir.
- **Sil:** yalnız hiçbir çalışan sürümün o kolonu okumadığı kanıtlandıktan sonra.
- **Zorunlu kolon:** önce `NULL` olarak ekle, doldur, sonraki sürümde `NOT NULL` yap.

### 6.3 Geri alınamayan migration'lar — uyarı

`prisma migrate deploy` **geri alma yapmaz.** `DROP COLUMN`, `DROP TABLE` ve
daraltıcı tip değişiklikleri **geri alınamaz**: uygulandıktan sonra tek dönüş
yolu yedekten geri yüklemektir, o da o andan sonraki tüm veriyi kaybettirir.

Bu nedenle:
- Yıkıcı migration içeren her sürüm, dağıtım notunda **"geri alınamaz"** diye
  işaretlenir.
- Yıkıcı migration çalıştırılmadan **hemen önce** ayrı bir tam yedek alınır ve
  o yedeğin geri yüklenebildiği doğrulanır.
- Yıkıcı adım mümkünse ayrı bir sürüme bırakılır: önce kodu dağıt (kolonu artık
  okumuyor), bir hafta çalıştır, sonra kolonu düşür.

### 6.4 Bakım modu

`SystemSetting` tablosunda `maintenance_mode` anahtarı; değer
`{ enabled, fullLock, message }`.

**İki farklı şey:**

| Mod | Ne yapar | Nasıl açılır |
|---|---|---|
| **Banner** (`fullLock: false`) | Yalnız uyarı gösterir, hiçbir isteği kesmez | Olağan ayar yazımı — `PATCH` ayar ucu |
| **Tam kilit** (`fullLock: true`) | **Tüm** `/api/v1/**` uçları 503 döner | `POST /api/admin/v1/settings/maintenance-lock` — **dört-göz onayı zorunlu** |

Tam kilit ayar ucundan açılamaz; kod bunu açıkça reddeder ve doğru ucu söyler.

**Kritik tasarım:** Tam kilit `/api/admin/v1/**` yolunu **etkilemez.** Kilidi
kapatabilmek için panelin ayakta kalması şarttır — kendi kilidine kilitlenen bir
sistem kurtarılamaz.

Rutin sürüm yükseltmesi için **banner yeterlidir.** Tam kilit, veri bütünlüğünü
tehdit eden bir olay için ayrılmıştır ve iki ayrı `SUPER_ADMIN` imzası ister.

### 6.5 İmajlar

| Uygulama | Dockerfile | Durum |
|---|---|---|
| `apps/api` | `apps/api/Dockerfile` | ✔ Çok aşamalı, `node:22-alpine`, `CMD node dist/main.js` |
| `apps/web` | `apps/web/Dockerfile` | ✔ (`NEXT_PUBLIC_DISABLE_DEMO=1` build arg) |
| `apps/admin` | `apps/admin/Dockerfile` | ✔ |
| `apps/portal` | `apps/portal/Dockerfile` | ✔ |

CD (Faz 4): `vX.Y.Z` etiketi → `.github/workflows/deploy.yml` dört imajı GHCR'ye gönderir
(`ghcr.io/<owner>/nomosos/<uygulama>:<etiket>`) ve sunucuda `pull → prod-migrate.sh → up -d →
/health/ready` dumanı koşar. Sunucu `.env.prod.local`: `IMAGE_REGISTRY=ghcr.io/<owner>/nomosos`.

`apps/admin` için referans (henüz dosya olarak eklenmedi; monorepo kökünden
derlenir, `apps/web/Dockerfile` deseniyle aynıdır):

```dockerfile
# apps/admin/Dockerfile — referans
FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nomosos/shared build && pnpm --filter @nomosos/admin build
ENV NODE_ENV=production
EXPOSE 3002
CMD ["pnpm", "--filter", "@nomosos/admin", "start"]
```

**`NEXT_PUBLIC_*` uyarısı:** Bu değişkenler **derleme zamanında** paketlenir.
API adresi değişirse çalışma zamanı ortam değişkenini güncellemek yetmez —
web ve admin imajları yeniden derlenmelidir. Aynı imajı farklı ortamlarda
kullanamazsınız.

`docker-compose.yml` bir **geliştirme** dosyasıdır: sabit parolalar
(`nomosos`/`nomosos`), açık portlar, `JWT_SECRET` varsayılanı. Üretime
kopyalanmaz.

### 6.6 Dağıtım sonrası duman testi

1. `GET /api/v1/health` → 200
2. `GET /api/admin/v1/health` → üç bileşen `ok`
3. Kiracı girişi → token alınıyor
4. Bir dosya listeleniyor, bir belge indiriliyor (ön-imzalı URL çalışıyor)
5. Bir süre hesabı doğru sonuç veriyor (tatil tablosu yüklü mü?)
6. Bir AI çağrısı başarılı (sağlayıcı anahtarı çözülebiliyor →
   `MASTER_ENCRYPTION_KEY` doğru)
7. Farklı kiracının kaydına ID ile erişim 404/403 (izolasyon)

Madde 6 aslında `MASTER_ENCRYPTION_KEY` testidir; yanlış anahtarla dağıtım
yaptıysanız buradan anlarsınız — ve tam olarak burada anlamalısınız.

---

## 7. İzleme

### 7.1 Sağlık uçları

§4.6'daki iki uç. Yük dengeleyici `/api/v1/health`'i, nöbet panosu
`/api/admin/v1/health`'i kullanır.

### 7.2 Log toplama

- API günlükleri `stdout`'a **JSON** yazar (`LOG_FORMAT=json`, üretim varsayılanı; pino
  uyumlu `level/time/msg/context/reqId`) → konteyner günlüğü → Loki/ELK/Datadog. Her istek
  için tek satır erişim günlüğü (yöntem, rota kalıbı, durum, süre, kiracı) — gövde/sorgu yok.
- `x-request-id`: ters vekilden gelir ya da API üretir; yanıt başlığında döner, tüm günlük
  satırlarına `reqId` olarak eklenir. Hata yanıtındaki `ref` bu kimliktir
  (`AllExceptionsFilter`); kullanıcı bildirdiğinde günlük satırı `reqId` ile bulunur.
- **Günlüğe kişisel veri yazılmaz.** Günlükler de KVKK kapsamındadır ve
  genellikle daha gevşek erişim kontrolüyle saklanır — bu yüzden en tehlikeli
  sızıntı yüzeyidir. Günlük saklama süresi belirlenir (öneri: 90 gün).
- Merkezî toplayıcı kurulumu (Loki/Promtail ya da Datadog agent) müşteri altyapısına göre
  yapılır; API tarafı hazırdır.

### 7.3 Ölçülmesi gereken metrikler

| Metrik (`GET /metrics`, prom-client) | Neden | Uyarı (`prometheus/alerts.yml`) |
|---|---|---|
| `nomosos_http_request_duration_seconds` p95 (rota kalıbı) | Ortalama arızayı gizler | AI dışı uçlar > 1 sn, 10 dk → `NomosOSHighLatencyP95` |
| `nomosos_http_requests_total{status=~"5.."}` oranı | Sunucu hatası | > %2, 5 dk → kritik |
| `nomosos_http_requests_total{status="429"}` | Oran sınırı sıklığı | > 1/sn, 10 dk → uyarı |
| `nomosos_ai_calls_total{outcome}` başarısızlık oranı | BYO-LLM arızası müşteriye NomosOS arızası görünür | provider_error > %20, 15 dk |
| `nomosos_ai_call_duration_seconds` | `AI_TIMEOUT_MS`'e yaklaşıyorsa sağlayıcı sorunlu | p95 > 60 sn → incele |
| `nomosos_queue_jobs{state}` | Belge hattı sağlığı | waiting > 200 (15 dk); failed +20/saat |
| `nomosos_ocr_duration_seconds` | OCR CPU darboğazı | p95 > 60 sn/sayfa |
| `nomosos_backup_last_success_timestamp_seconds` | Yedek tazeliği | > 36 sa ya da 0 → **kritik** |
| `nomosos_credit_wallets_negative_total` | Kredi mutabakatı sapması | > 0, 10 dk → uyarı; `GET /credits/reconcile` |
| `nomosos_subscriptions{status="PAST_DUE"}` / `nomosos_platform_invoices_overdue_total` | Gelir sağlığı | artış / > 5 → bilgi |
| `nomosos_db_up`, `nomosos_db_check_duration_seconds` | Veritabanı erişimi | 0, 1 dk → **kritik** |
| `nomosos_scheduler_job_failures_total{job}` | Zamanlanmış iş hatası | saatte > 0 → uyarı |
| `process_resident_memory_bytes` (varsayılan) | Bellek sızıntısı | > 1.6 GB, 15 dk |

Dış ölçümler (exporter): disk doluluğu (node_exporter), sertifika bitişi (blackbox), DB havuzu
(postgres_exporter). Örnek `prometheus/prometheus.yml`.

Eşikler başlangıç noktasıdır; ilk 30 günün gerçek dağılımına göre düzeltilir.
Sürekli çalan bir alarm, hiç çalmayan alarmdan kötüdür — susturulur ve gerçek
olay kaçırılır.

### 7.4 Denetim izinin izlenmesi

`PlatformAuditLog` bir güvenlik sinyalidir. Şunlar uyarı üretmelidir:
- Mesai dışı platform paneli girişi
- Başarısız 2FA denemesi (5'te hesap kilitlenir)
- Dört-göz onayı gerektiren işlem talebi
- `SupportAccessGrant` verilmesi — yani bir NomosOS personelinin kiracı verisine
  erişimi. Bu, kiracıya karşı en hassas işlemdir ve sessiz kalmamalıdır.

---

## 8. Güvenlik Sertleştirme

### 8.1 TLS

- **Her uçta zorunlu.** İstemci→vekil, vekil→API, API→PostgreSQL (`sslmode=require`),
  API→S3 (`https://`).
- `API_FORCE_HSTS=true` (TLS ters vekilde sonlanıyorsa) → `Strict-Transport-Security:
  max-age=31536000; includeSubDomains`.
- TLS 1.2 altı kapalı.
- API zaten şu başlıkları koyar (`main.ts`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `Cache-Control: no-store`, ve `X-Powered-By` kaldırılır.

### 8.2 CORS

`WEB_ORIGIN` **açıkça** yazılır. Yansıtmalı CORS (`origin: true`) herhangi bir
sitenin tarayıcı üzerinden kimlikli istek atmasına ve yanıt gövdelerini okumasına
izin verir. Kod beyaz liste kullanır; listeyi doldurmayı unutmayın — varsayılan
`http://localhost:3000`'dir.

### 8.3 Veritabanı ağ izolasyonu

- PostgreSQL ve Redis **özel ağda**; internetten erişilemez.
- Güvenlik grubu yalnız API'nin IP/güvenlik grubundan 5432/6379'a izin verir.
- Uygulama kullanıcısı süper kullanıcı değil.
- Redis parola korumalı (`requirepass`). Sağlık yoklaması parola isteyen bir
  Redis'te `degraded` döner — bu beklenen davranıştır, `down` değildir.

### 8.4 Sır yönetimi

**Öneri: ortam değişkeni dosyası değil, sır kasası.** `.env` dosyası diskte
düz metin durur, yedeklenir, kopyalanır ve unutulur.

Hedef: sırlar kasada (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault vb.)
tutulur; konteyner başlatılırken ortama enjekte edilir. Uygulama kodu değişmez —
`process.env`'den okumaya devam eder.

⛔ **EKSİK:** Doğrudan kasa istemcisi entegrasyonu yok (Faz 5). Bugün için asgari:
- `.env` dosyası `chmod 600`, uygulama kullanıcısına ait
- Sürüm kontrolüne **asla** girmez
- Sır değişimi = yeniden başlatma (sıcak yeniden yükleme yok)
- `MASTER_ENCRYPTION_KEY` ve `JWT_SECRET` erişimi kayıt altına alınır

### 8.5 Yönetici erişimi

- `apps/admin` (3002) **internete açılmaz.** VPN veya IP beyaz listesi arkasında.
  Panel zaten `X-Robots-Tag: noindex, nofollow` ve `X-Frame-Options: DENY` koyar
  ama bunlar arama motoruna karşıdır, saldırgana karşı değil.
- `PLATFORM_REQUIRE_2FA=true` — üretimde kod zorlar.
- Panel token'ı kiracı token'ından ayrı anahtarla imzalanır ve `tv` (token
  sürümü) alanı taşır: parola değişimi, 2FA sıfırlama ve rol düşürme bu sayacı
  artırır → ele geçirilmiş oturum **anında** düşer.
- 5 başarısız denemede hesap kilitlenir; kilidi başka bir `SUPER_ADMIN` açar.
- En az iki aktif `SUPER_ADMIN` (§4.3).
- `TRUSTED_PROXY_HOPS` doğru ayarlanmalı — yoksa denetim izindeki IP alanı
  istemci tarafından sahtelenebilir.

### 8.6 S3

§4.5'teki kurallar. Tek cümleyle: **kova herkese açık olmamalıdır** ve uygulama
kimliğinin yetkisi kendi kovasıyla, gereken beş eylemle sınırlı olmalıdır.

### 8.7 Denetim izlerinin saklanması

`AuditLog` ve `PlatformAuditLog` **append-only**'dir: güncellenmez, silinmez,
asgari 10 yıl saklanır. Uygulama veritabanı kullanıcısının bu tablolarda
`UPDATE`/`DELETE` yetkisi olmaması, veritabanı düzeyinde ek bir güvencedir
(GRANT ile kısıtlanabilir). Denetim izi ayrıca değiştirilemez bir depoya
(WORM / object-lock) periyodik olarak aktarılabilir — ⛔ **EKSİK**, Faz 6.

---

## 9. KVKK ve Hukuki

Bu bölüm hukuki tavsiye değildir; operasyonel bir kontrol listesidir. Sözleşme
metinleri hukuk müşaviriyle hazırlanmalıdır.

### 9.1 Veri sorumlusu / veri işleyen ayrımı

| Rol | Kim | Ne demek |
|---|---|---|
| **Veri sorumlusu** | **Hukuk bürosu** | Müvekkil verisinin işlenme amacını ve vasıtalarını belirler. Aydınlatma yükümlülüğü, açık rıza (gerekiyorsa), veri sahibi taleplerine yanıt onda |
| **Veri işleyen** | **NomosOS** | Büronun talimatıyla ve onun adına veri işler. Kendi amacı için kullanamaz |
| **Alt-işleyen** | Bulut sağlayıcı, LLM sağlayıcısı | NomosOS'un (veya bürodaki BYO-LLM tercihinin) devrettiği işleme |

**On-premise'te (topoloji c) NomosOS veri işleyen bile değildir** — veriye
erişmez. Sözleşme bunu açıkça yazmalıdır; aksi hâlde erişmediği veriden sorumlu
tutulur.

**BYO-LLM'in özelliği:** LLM sağlayıcısını **büro seçer** ve **kendi hesabıyla**
bağlar. Bu, o sağlayıcının alt-işleyen ilişkisinin doğrudan büro ile sağlayıcı
arasında kurulduğu anlamına gelir. NomosOS bu ilişkiyi **kolaylaştırır ama taraf
değildir** — ve bunu müşteriye açıkça söylemek gerekir, çünkü müşteri
"NomosOS hallediyordur" varsayabilir.

### 9.2 Veri İşleme Protokolü (DPA)

Sözleşme setinin parçası olmalıdır. Asgari içerik:
- İşlemenin konusu, süresi, niteliği ve amacı
- Veri kategorileri (müvekkil kimlik, iletişim, mali, **sağlık — özel nitelikli**,
  karşı taraf ve tanık verileri) ve ilgili kişi grupları
- Büronun talimat verme hakkı, NomosOS'un talimat dışına çıkmama yükümlülüğü
- Gizlilik taahhüdü ve personel yükümlülüğü
- Teknik ve idari tedbirler (bu dokümanın §8'i ekte verilebilir)
- **Alt-işleyen listesi** ve değişiklik bildirim süresi
- Veri sahibi taleplerinde destek yükümlülüğü
- İhlal bildirimi: NomosOS → büroya **gecikmeksizin** bildirim
- Sözleşme sonunda veri iadesi/imhası ve imha belgesi
- Denetim hakkı

⚠ Özel nitelikli veri (sağlık) işlendiği için tedbir seviyesi KVKK'nın özel
nitelikli veri rehberine göre belirlenir; bu, standart tedbirlerden ağırdır.

### 9.3 Veri yerelliği seçenekleri

| Seçenek | Veri nerede | LLM nerede |
|---|---|---|
| Yönetilen bulut (a) | Sağlayıcı bölgesi — **sözleşmede adıyla yazılır** | Büronun seçtiği sağlayıcıda (yurt dışı olabilir) |
| Türkiye veri bölgesi (b) | Türkiye — **yedekler dahil** | Büronun seçtiği sağlayıcıda (yurt dışı olabilir) |
| Türkiye + `SADECE_YEREL` | Türkiye | Türkiye / büro ağı |
| On-premise (c) | Büro binası | Büro ağı |

**Yurt dışına aktarım:** Dış LLM sağlayıcısına gönderilen (maskelenmiş) metin bir
yurt dışına aktarımdır ve KVKK m.9 rejimine tabidir. Maskeleme riski azaltır,
aktarımı hukuken ortadan **kaldırmaz**. Bu, satış konuşmasında en sık atlanan
noktadır. `SADECE_YEREL` politikası sorunu kaynağında çözer.

### 9.4 Veri sahibi taleplerine operasyonel yanıt

Talep **büroya** gelir (veri sorumlusu odur); büro gerekirse NomosOS'tan destek
ister. KVKK yanıt süresi: **en geç 30 gün**.

| Talep | Bugünkü yol | Durum |
|---|---|---|
| **Erişim / bilgi** | Müvekkil kaydı, bağlı dosyalar, belgeler ve denetim izi uygulamadan okunabilir | Kısmen elle |
| **Düzeltme** | Uygulamadan düzenlenir; denetim izine yazılır | ✔ |
| **Silme / anonimleştirme** | Dosyalar arasındaki bağ ve yasal saklama süresi nedeniyle otomatik silme **yoktur** | ⛔ **EKSİK** — [04-kvkk-veri-guvenligi.md](04-kvkk-veri-guvenligi.md) "Faz 3" demişti, henüz yok. Bugün elle ve dikkatli yapılır |
| **Taşınabilirlik** | Müvekkil bazlı yapılandırılmış dışa aktarım | ⛔ **EKSİK** — tek uçtan dışa aktarım yok |
| **İşlemeye itiraz** | Kiracı düzeyinde `aiPolicy = SADECE_YEREL` ile AI işlemesi büro içine çekilebilir | Kısmen |

**Kritik hatırlatma:** Silme talebi **yedekleri de** kapsar. Yedekten seçici
silme pratikte mümkün değildir; kabul edilen yaklaşım, silmenin üretimde
uygulanması ve yedeklerin kendi saklama süresi dolduğunda doğal olarak
düşmesidir — bu durumun ve süresinin veri sahibine **yazılı olarak** bildirilmesi
gerekir. Yedek saklama süresini gereğinden uzun tutmanın bedeli burada çıkar.

Ayrıca: silme, **yasal saklama yükümlülüğüyle** çatışabilir (avukatlık mevzuatı,
vergi mevzuatı). Bu çatışmanın çözümü hukukidir, teknik değil; ürün her iki
sonucu da destekleyebilmelidir.

### 9.5 İhlal bildirimi

**Süre: KVKK'ya göre veri sorumlusu ihlali öğrendiği tarihten itibaren en geç
72 saat içinde Kurul'a bildirir.** İlgili kişilere de makul en kısa sürede
bildirilir.

Zincir: NomosOS (işleyen) ihlali tespit eder → **gecikmeksizin** büroya (sorumlu)
bildirir → büro 72 saatlik süreyi yönetir. NomosOS'un iç bildirimi bu 72 saatin
içinde, mümkün olduğunca başında olmalıdır — sözleşmede "24 saat içinde" gibi bir
iç süre bağlamak yerinde olur.

Olay kaydı asgari: ne oldu, ne zaman oldu, ne zaman fark edildi, hangi veri
kategorileri, kaç ilgili kişi, alınan tedbirler, ilgili kişilere bildirim durumu.

⛔ **EKSİK:** Yazılı olay müdahale planı ve iletişim ağacı bu depoda tanımlı
değil. Üretime çıkmadan önce yazılmalıdır — ihlal anında yazılacak bir plan, plan
değildir.

### 9.6 Alt-işleyen şeffaflığı

Müşteriye verilen liste güncel tutulur ve şunları içerir:

| Alt-işleyen | Hizmet | Yer |
|---|---|---|
| Bulut/barındırma sağlayıcısı | Sunucu, veritabanı | *(bölge adıyla)* |
| Nesne depolama sağlayıcısı | Belge deposu | *(bölge adıyla)* |
| **LLM sağlayıcısı** | AI işleme | **Büronun kendi seçtiği** — Anthropic / OpenAI-uyumlu / Google / yerel |
| E-posta / bildirim sağlayıcısı | Bildirimler | *(varsa)* |

LLM satırı özel olarak vurgulanır: **büro kendi seçtiği sağlayıcıyı bağlar**;
seçim değiştiğinde alt-işleyen listesi de değişir ve bu değişikliği yapan
NomosOS değil bürodur. Ayarlar ekranında sağlayıcı seçilirken bu sonucun
kullanıcıya hatırlatılması iyi bir uygulamadır.

---

## 10. Olağanüstü Durum

Kurtarma sırası **her zaman** aynıdır: önce kanama durur (erişimi kes), sonra
kapsam belirlenir, sonra geri yükleme yapılır.

### 10.1 Genel sıra

```
1. Bakım TAM KİLİDİ (dört-göz) — yazma durur, veri daha da bozulmaz
2. Kapsamı belirle: ne kayboldu, ne zaman, hangi kiracılar
3. Geri yükle (aşağıdaki senaryoya göre)
4. Doğrula (§6.6 duman testi + kredi mutabakatı)
5. Kilidi aç
6. Olay raporu; kişisel veri etkilendiyse §9.5 bildirim zinciri
```

### 10.2 Senaryolar

| Senaryo | Kayıp | Kurtarma | Beklenen kesinti |
|---|---|---|---|
| API konteyneri düştü | Yok | Yeniden başlat; sağlık ucunu bekle | Dakikalar |
| PostgreSQL düştü, veri sağlam | Yok | Veritabanını başlat; API'yi yeniden başlat | Dakikalar |
| Veritabanı bozuldu | Son yedekten bu yana | PITR varsa olay öncesine dön; yoksa son mantıksal yedek | Saatler |
| Nesne deposu kaybı | Belgeler | Replika/yedekten geri yükle. **Veritabanı belge kayıtlarını korur** — dosyası olmayan kayıtlar görünür, sessiz kayıp olmaz | Saatler |
| S3 erişimi koptu (kimlik/ağ) | Yok | Kimlik bilgisi/ağ düzeltilir. API açık kalır, belge uçları hata döner | Dakikalar |
| Bölge tamamen kayboldu | Değişken | Yedeklerden yeni bölgede yeniden kur. **Tatbikat yapılmadıysa bu süre bilinmiyordur** | Gün(ler) |
| `JWT_SECRET` kaybı | Yok | Yeni anahtar üret, yeniden başlat. Tüm kullanıcılar yeniden giriş yapar | Dakikalar |
| `PLATFORM_2FA_ENCRYPTION_KEY` kaybı | Panel TOTP kayıtları | Tüm platform yöneticilerinin 2FA'sı sıfırlanır ve yeniden kurulur. **Dört-göz kilidi riski** — §10.3 | Saatler |
| **`MASTER_ENCRYPTION_KEY` kaybı** | AI sağlayıcı anahtarları | §10.3 | Gün(ler)e yayılan kısmi kesinti |

### 10.3 En kötü durum: `MASTER_ENCRYPTION_KEY` kaybı

**Bu bir veri kaybı değildir.** Müvekkiller, dosyalar, belgeler, süreler, denetim
izi — hepsi yerindedir ve okunabilir. Kaybolan tek şey, kiracıların LLM sağlayıcı
API anahtarlarının çözülebilirliğidir.

**Ama bir kesintidir** ve tek çözümü **her kiracıdan anahtarını yeniden
girmesini istemektir.** Bu, kontrol edebileceğiniz bir düzeltme değil,
müşterinizin yapması gereken bir iştir — süresi size bağlı değildir.

Kurtarma sırası:
1. **Panik yok, geri yükleme yok.** Eski veritabanı yedeğine dönmek hiçbir işe
   yaramaz: yedekteki şifreli metinler de aynı kayıp anahtarla şifrelenmiştir.
2. Anahtarın gerçekten kaybolduğunu doğrula — ikinci saklama yerini (mühürlü
   zarf, ikinci kasa) kontrol et. Anahtar bulunursa hiçbir şey yapmaya gerek yok.
3. Yeni anahtar üret: `openssl rand -hex 32`. Ortama koy, API'yi yeniden başlat.
4. **`PLATFORM_2FA_ENCRYPTION_KEY` ayrı tanımlı değilse panel 2FA'sı da bozulur.**
   Bu, dört-göz gerektiren işlemleri kilitleyebilir. Bu durumda 2FA kayıtlarının
   veritabanından temizlenmesi ve yöneticilerin yeniden kurulum yapması gerekir —
   bu işlem doğrudan veritabanı erişimi ister ve **kayıt altına alınmalıdır.**
5. Çözülemeyen `AiProviderConfig` kayıtlarını pasifleştir. Kiracının AI uçları
   "Önce Ayarlar → AI Sağlayıcı'dan bir sağlayıcı ekleyin" hatası verecektir —
   bu, kullanıcı için anlaşılır bir mesajdır.
6. **Tüm kiracılara bildirim:** ne oldu, ne yapmaları gerekiyor (Ayarlar → AI
   Sağlayıcı → anahtarı yeniden gir), verilerine bir şey olmadığı. Bu bildirimin
   dürüst olması gerekir; "teknik bakım" demek, ilk kiracı anahtarını yeniden
   girdiğinde güveni bozar.
7. Olay raporu. Kişisel veri **açığa çıkmadıysa** (yalnız kayboldusa) bu bir
   erişilebilirlik olayıdır; yine de değerlendirilir — KVKK ihlali "gizlilik"
   kadar "erişilebilirlik" ihlalini de kapsayabilir.
8. **Kök neden:** anahtar neden tek yerdeydi? §3.3'teki iki-yer kuralı uygulanır.

### 10.4 Hedefler

⛔ **EKSİK:** RTO (kurtarma süresi) ve RPO (kabul edilebilir veri kaybı) hedefleri
henüz belirlenmedi. Bunlar §5.4 tatbikatının **ölçüm sonucundan** türetilmelidir;
önce sözleşmeye yazılıp sonra tutturulmaya çalışılan bir RTO, ilk gerçek olayda
tutmaz. Sıra: tatbikat yap → ölç → taahhüt et.

---

## 11. Üretime Çıkış Kontrol Listesi

**Altyapı**
- [ ] PostgreSQL 16+ ayakta, özel ağda, TLS ile bağlanılıyor
- [ ] Redis 7+ ayakta, parola korumalı, özel ağda
- [ ] S3 kovası elle oluşturuldu; **herkese açık değil**; sürümleme ve SSE açık
- [ ] Uygulama S3 kimliğinde `CreateBucket` yetkisi **yok**
- [ ] Node 22 çalışma zamanı
- [ ] Ters vekilde TLS sonlanıyor; TLS 1.2 altı kapalı

**Yapılandırma**
- [ ] `JWT_SECRET` ≥ 32 karakter, rastgele üretildi
- [ ] `MASTER_ENCRYPTION_KEY` 64 hane hex; **iki ayrı yerde** yedekli; yedeklerin yanında değil
- [ ] `PLATFORM_2FA_ENCRYPTION_KEY` **açıkça tanımlandı** (master rotasyonundan bağımsız olsun)
- [ ] `NODE_ENV=production` ve `PLATFORM_REQUIRE_2FA=true`
- [ ] `WEB_ORIGIN` gerçek alan adlarıyla dolduruldu
- [ ] `TRUSTED_PROXY_HOPS` vekil sayısına göre ayarlandı (varsayılan 0 bırakılmadı)
- [ ] `API_FORCE_HSTS=true`
- [ ] `AI_INTERNAL_HOSTS` iç LLM varsa dolduruldu
- [ ] `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_ADMIN_API_URL` doğru ve imajlar bunlarla derlendi
- [ ] `EINVOICE_PROVIDER` bilinçli olarak ayarlandı (`noop` ise gönderim 503 döner)
- [ ] Konteynerler UTC saat diliminde
- [ ] `.env` dosyası `chmod 600`, sürüm kontrolünde değil

**Veri**
- [ ] `prisma migrate deploy` başarılı, 8 migration uygulandı
- [ ] `pnpm db:seed` üretimde **çalıştırılmadı**
- [ ] Sistem verisi yüklendi: `DeadlineRule` (`tenantId=null`), **`Holiday`**, `PetitionTemplate`, `PlanTier`, `AiTaskCost`, `CreditPackage`, `ModelPrice`
- [ ] En az **iki** aktif `SUPER_ADMIN`, ikisi de TOTP kurulu, parolalar iki ayrı kişide
- [ ] İlk kiracı, `ADMIN` kullanıcısı, `Subscription` ve `CreditWallet` oluşturuldu
- [ ] Demo/varsayılan parolalı hesap **kalmadı** (`Demo1234!` araması boş dönmeli)

**Doğrulama**
- [ ] `/api/v1/health` → 200
- [ ] `/api/admin/v1/health` → üç bileşen de `ok`
- [ ] Kiracı girişi, dosya listeleme, belge yükleme/indirme çalışıyor
- [ ] Süre hesabı doğru (tatil takvimi yüklü)
- [ ] Bir AI çağrısı başarılı (→ `MASTER_ENCRYPTION_KEY` doğru)
- [ ] Kiracı izolasyon testi: başka kiracının ID'siyle erişim 404/403
- [ ] Belgenin doğrudan S3 URL'si tarayıcıda 403
- [ ] PII akışı: dış sağlayıcıya PII'li metin onaysız gitmiyor (409)

**İşletme**
- [ ] Yedekleme kurulu (mantıksal, en az günlük) ve **son yedek doğrulandı**
- [ ] Nesne deposu yedeği/replikasyonu kurulu
- [ ] Yedekler şifreli; anahtarı üretim ortamından ayrı yerde
- [ ] **Geri dönüş tatbikatı en az bir kez yapıldı ve süresi ölçüldü**
- [ ] İzleme ve uyarılar kurulu (§7.3); en az hata oranı, gecikme, disk, yedek tazeliği
- [ ] Günlük toplama çalışıyor; günlüklerde kişisel veri olmadığı örneklemeyle kontrol edildi
- [ ] Nöbet/çağrı listesi tanımlı

**Hukuki**
- [ ] DPA imzalandı
- [ ] Alt-işleyen listesi müşteriye verildi (LLM sağlayıcısı ve bölgeler dahil)
- [ ] Veri yerelliği taahhüdü sözleşmede **bölge adıyla** yazılı; yedekleri de kapsıyor
- [ ] Dış LLM kullanılıyorsa yurt dışına aktarım rejimi değerlendirildi
- [ ] İhlal bildirimi süreci ve iletişim ağacı yazılı (⛔ bugün eksik)
- [ ] Saklama ve imha politikası yazılı
- [ ] Veri sahibi taleplerinin elle karşılanacağı ve süresi (30 gün) müşteriye bildirildi

**Bilinen boşluklar — müşteriye açıkça söylenmiş olmalı**
- [ ] API tek örnek çalışır (tekil arıza noktası, yatay ölçekleme Faz 5)
- [ ] Kuyruk yok; belge → aksiyon hattı senkron (Faz 5)
- [ ] Otomatik yedekleme betikleri ve PITR yapılandırması yok (Faz 5)
- [ ] Sır kasası entegrasyonu yok (Faz 5)
- [ ] Anahtar rotasyon komutu yok (§3.4 elle prosedür)
- [ ] Kiracı açma ucu ve otomatik onboarding yok
- [ ] Ayrık üretim tohumu (`seed:system`) yok
- [ ] `apps/admin` Dockerfile'ı yok (§6.5 referans mevcut)
- [ ] KVKK silme/anonimleştirme ve taşınabilirlik uçları yok
- [ ] RTO/RPO hedefleri belirlenmedi
