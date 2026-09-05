# NomosOS — Kalan Görevler ve Çalışma Sözleşmesi

> **Bu dosya bir çalışma sözleşmesidir.** Kullanıcı, tüm görevler eksiksiz bitene kadar
> durmadan çalışmamı istedi. Bağlam sıkışsa veya oturum yenilense bile buradan devam
> edilir. Her adım bitiminde bu dosyadaki durum işaretlenir ve GitHub'a gönderilir.

## Üretim Dağıtım Notu (İ-48)

- `NEXT_PUBLIC_DISABLE_DEMO=1` üretim web build'inde MUTLAKA ayarlanmalıdır —
  `/demo-giris` sayfasını kapatır. Derleme anında gömülür; çalışma zamanında
  ayarlamak yetmez, build komutunda verilmesi gerekir.
- Demo hesaplar yalnız demo seed'i çalıştıran ortamlarda geçerlidir; üretim
  veritabanında demo kullanıcısı AÇILMAZ.

## Çalışma Kuralları (değiştirilemez)

1. **Durma yok.** Bir aşama bitince bir sonraki aşama hemen başlatılır; onay beklenmez.
2. **Her aşama ultracode ile çalışır** — çok ajanlı workflow, denetim ve düzeltme fazları dahil.
3. **Her aşama sonunda kendi doğrulamam yapılır** (build + test + canlı duman testi), ajan raporuna körlemesine güvenilmez.
4. **Her aşama sonunda GitHub'a gönderilir** (`cuneytdirican/NomosOS`). `.env` ASLA commit edilmez.
5. **Ürün ilkelerinden taviz verilmez**: AI önerir avukat onaylar · **AI tarafsızdır — müvekkil adına taraf tutmaz, aleyhte bulguyu lehte bulgu kadar açık yazar** (çekirdek prompt kuralı; sözleşme testleri prompts.test.ts + assistant.prompts.test.ts) · süre ve para hesapları deterministik · kaynak gösterme zorunlu, uydurma yasak · atıflar kayıt üzerinden doğrulanır · KVKK maskeleme onayı · tenant izolasyonu.
6. **Dosya sahipliği** ajanlar arasında keskin bölünür; `app.module.ts`, `main.ts`, kök `package.json` yalnız entegrasyon ajanına aittir.

---

# 🔖 KALDIĞIM YER — 6 Eylül 2026, 11:00

> Üç persona planı (`~/.claude/plans/wiggly-giggling-lighthouse.md`):
> **Faz 0 ✅ · 1 ✅ · 2 ✅ · 3 ✅ · 4 ✅ · 5 ✅ (bu commit)** · sırada Faz 6 (UYAP/icra/finans).

**FAZ 4 canlı doğrulama (5aefeef + 05a432e):** readiness `ready` (pg/redis/s3 up), `x-request-id`
korunuyor/üretiliyor, `/metrics` 207+ nomosos_ satırı (abonelik/kuyruk/yedek/DB), 320 istek → 315×429
+ `Retry-After`, OpenAPI 514 yol, rotasyon dry-run 3 satır. Bulgu: `Parola123456!` zxcvbn'de 3 puan
alıp geçti → eşik 10^9 tahmin + "sözlük kelimesi + rakam/sembol" kalıbı reddi eklendi. Ayrıca
`@nestjs/swagger@12` ESM-only (Nest 11) → 7.x'e indirildi (açılış SyntaxError).

**FAZ 5 — RAG ÖLÇEK + TEST ALTYAPISI TAMAMLANDI** (belge: `docs/faz5-rag-olcek-test.md`):
1. **pgvector**: `pgvector/pgvector:pg16` imajı (dev/test/prod/CI), göç `20260927100000_faz5_pgvector`
   (`embeddingVec vector` + `embeddingDim`, Float[] → vector taşıma, HNSW 768/1024/1536 kısmi indeksler,
   `pg_trgm` GIN content/ocrText, `[tenantId,caseId]`). `IndexingService.syncVectorColumn`,
   `RetrievalService.retrieveByPgvector` (`<=>` LIMIT k); `RAG_VECTOR_BACKEND=js` eski yol.
2. **Entegrasyon testleri** (supertest): `apps/api/test/kritik-uclar.int.test.ts` (10 uç),
   `vitest.integration.config.ts`, `test:int`; CI `entegrasyon.yml` (pgvector servisi + göç + seed).
3. **e2e**: `e2e/` Playwright paketi (readiness/metrik, giriş → Abonelik, parola sıfırlama Mailpit,
   admin Kuponlar); CI gecelik/elle Docker yığınıyla.
4. **Admin/portal Vitest** (rbac matrisi, uçlar, menü; portal api yardımcıları/etiketler) — `pnpm -r test`.
Testler: api 1380+, admin 3, portal 4; lint 0.
Bulgu (husky sayesinde): Faz 4'te prod compose'a eklenen `volumes:` bloğu `environment:` içine girmiş,
`docker-compose.prod.yml` 5aefeef'ten beri YAML olarak BOZUKTU → düzeltildi; CI'ya `docker compose config`
doğrulaması (test + prod + edge profili, örnek env sahte değerle doldurularak) eklendi. Entegrasyon paketi
yerelde 10/10 (pgvector'lu test yığını DB'si).

**SIRADA: FAZ 6 — UYAP / icra / finans:** UYAP'tan dosya oluşturma (eşleşmeyen → onaylı `Case`) + icra
ekranı parser'ı; `InterestRatePeriod` + TCMB avans/yasal faiz seed + dönemli faiz; İİK 106/110 sürelerinin
icra aşamasından otomatik üretimi + portföy özeti; `Tebligat` varlığı + KEP/UETS adaptör arayüzü; finans:
kronometre + timesheet onayı, storno, AAÜT yıllık iş, maktu harç tablosu, Luca/Logo CSV.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 6 Eylül 2026, 08:00

> Üç persona planı (`~/.claude/plans/wiggly-giggling-lighthouse.md`) yürüyor:
> **Faz 0 ✅ · Faz 1 ✅ · Faz 2 ✅ · Faz 3 ✅ · Faz 4 ✅ (bu commit)** · sırada Faz 5 (RAG ölçek + test altyapısı).

**FAZ 4 — OPERASYON/SRE TAMAMLANDI** (CHANGELOG "Yayımlanmamış", `docs/uretim-dagitimi.md` §0/§3.4/§4.6/§5.1/§7.2/§7.3/§6.5 güncel):
1. **Readiness** `GET /health/ready` (DB/Redis/S3 gerçek yoklama, 2 sn, 503 + bileşen); compose liveness `/health/live` kaldı.
2. **JSON günlük** (`common/json-logger.ts`, `LOG_FORMAT=json` üretim varsayılanı, pino uyumlu) + **`x-request-id`**
   (`common/request-context.ts`, AsyncLocalStorage; erişim günlüğü rota kalıbıyla; hata `ref` = reqId).
3. **Metrikler**: prom-client kaydı (`metrics/metrics.registry.ts`, 12 iş metriği + varsayılan süreç), HTTP
   histogram/sayaç ara katmandan, AI (`observeAiCall`), OCR, kuyruk, yedek tazeliği, eksi bakiye cüzdanı,
   abonelik durumu, vadesi geçmiş fatura, iş hatası; `prometheus/alerts.yml` (15 kural) + `prometheus.yml`.
4. **Global oran sınırı** (`GlobalRateLimitGuard`, IP 300/dk, kullanıcı 600/dk, Redis/süreç-içi, fail-open).
5. **Parola gücü** (`common/password-strength.ts`, zxcvbn ≥ 3 + Türkçe sözlük + hesap parçası yasağı) —
   kullanıcı oluşturma, değiştirme, sıfırlama, portal (2).
6. **Anahtar rotasyonu** `scripts/rotate-master-key.ts` (`key:rotate`, `--dry-run`, tek transaction, 6 model).
7. **Yedek/geri yükleme**: compose `backup` + `backup-minio` servisleri, `scripts/backup-container.sh`
   (last-success.json), `scripts/prod-restore.sh` (tatbikat `--target-db`, RTO çıktısı).
8. **CD** `.github/workflows/deploy.yml` (v* etiketi → GHCR 4 imaj → SSH pull/migrate/up → readiness dumanı),
   compose `IMAGE_REGISTRY`; **Caddy** `deploy/Caddyfile` + `--profile edge` (HSTS, panel IP kısıtı).
9. **OpenAPI** `/api/docs` (yalnız dev/test), prettier + husky + lint-staged, CHANGELOG, CONTRIBUTING, README durum;
   kök ekran görüntüleri kaldırıldı.
Testler: api 1380 (160 dosya), lint 0. Canlı duman: readiness 200/503, metrik çıktısı, x-request-id, 429, JSON günlük,
zayıf parola 400, rotasyon dry-run (bu commit sonrası Docker'da koşulacak — aşağıya işlenecek).

**SIRADA: FAZ 5 — RAG ölçek + test altyapısı:** pgvector migration (HNSW) + `ORDER BY embedding <=> $1 LIMIT k`,
`[tenantId,caseId]` indeksi, `pg_trgm` GIN; eski JS yolu bayrakla; Supertest + Testcontainers entegrasyon iskeleti
(ilk 10 kritik uç); grep-tabanlı 35 testten en kırılgan 10'u davranış testine; admin/portal Vitest; mobil `tsc` CI'da;
Playwright dumanı CI'da.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 6 Eylül 2026, 04:30

> Üç persona planı (`~/.claude/plans/wiggly-giggling-lighthouse.md`) yürüyor:
> **Faz 0 ✅ · Faz 1 ✅ · Faz 2 ✅ · Faz 3 ✅ (bu commit)** · sırada Faz 4 (operasyon/SRE).

**FAZ 3 — GELİR HATTI TAMAMLANDI** (belge: `docs/faz3-gelir-hatti.md`):
1. **Dönem faturası**: `subscription-renewal-daily` dönem sonuna 7 gün kala `InvoiceRecord(ABONELIK)`
   keser (tekil `[tenantId,type,periodStart]`), yöneticilere FATURA_KESILDI; **dunning** PAST_DUE
   1/3/7. gün ODEME_GECIKTI, deneme bitişi DENEME_BITIYOR (Faz 2 dağıtım işi e-postalar).
2. **Checkout/kesinleştirme** (`platform-billing/`): kredi paketi ve abonelik faturası ödemesi →
   `PaymentRecord` → SIMULASYON anında / **iyzico** Checkout Form (IYZWSv2 + Webhook V3 imza,
   callback/webhook uçları) / tanımsız 503. **Krediler ödeme kesinleşince yüklenir** (gelir kaçağı
   kapandı); abonelik ödenince dönem ilerler + ACTIVE; tutar uyuşmazlığı reddedilir; idempotent.
3. **Kupon** (`Coupon`, panel CRUD), **BYO-LLM %30** otomatik (kuponla birleşmez), **yıllık fiyat**
   (`annualPricePerUser`), **pro-rata** plan farkı faturası (executor).
4. **`@RequiresModule` guard**: plan `features.modules` zorlaması (icra/finans/faturalama/sso; 60 sn önbellek).
5. **Fatura PDF** (pdfkit + DejaVu Sans): büro→müvekkil ve platform→büro. **e-Fatura ayarı tenant
   başına** (`EInvoiceSettings`, şifreli kimlik; `RestEInvoiceAdapter` köprü sözleşmesi; `resolve` async).
6. Web **Ayarlar → Abonelik** (plan, önizleme, aralık, kupon, faturalar Öde/PDF); AI Kullanımı satın
   alma → ödeme akışı. Admin **Kuponlar** + **Platform Faturaları** (ödendi işaretle).
Migration `20260926100000_faz3_gelir_hatti`. Testler: api 1354 (152 dosya), web 100; lint 0.
Canlı doğrulandı (Docker test yığını, SIMULASYON; `d24313c` sonrası): kupon oluştur→bağla→önizleme
%10; kredi paketi satın alma → NOM-2026-0000xx ODENDI, cüzdan +500; dönem faturası kes (idempotent
ikinci kesim aynı fatura) → Öde → dönem 09-21→10-21, tekrar 409; havale ile mark-paid; SOLO plana
geçince icra 403 (plan adı + yükseltme yolu), BURO 200; e-Fatura ayarı kimlik bilgisini yanıta
sızdırmıyor; büro ve platform fatura PDF'leri Türkçe glifli. Web: Abonelik ekranı (6 fatura satırı),
geçersiz kupon hatası, AI Kullanımı satın alma → ödendi + 500 kredi, Öde; admin Kuponlar oluşturma ve
Platform Faturaları tablosu. İki açılış hatası dumanda yakalanıp düzeltildi: web `useSearchParams`
Suspense (`d62b4ab`), `OdemeSaglayici` dışa aktarımı (`d24313c`) — DI sözleşme testi eklendi.
Açık not: otomatik kredi yükleme (`tryAutoTopUp`) hâlâ ödemesiz yükler (iş kuralı 12, açık onaylı);
iyzico canlı doğrulama sandbox anahtarı gerektirir (sözleşme sonrası).

**SIRADA: FAZ 4 — operasyon/SRE:** `/health/ready` (DB/Redis/S3) + compose healthcheck; pino JSON
log + `x-request-id`; 12 metrik + `prometheus/alerts.yml`; backup cron servisi + `prod-restore.sh` +
tatbikat; `deploy.yml` (tag → GHCR → SSH); `Caddyfile`; global oran sınırı, parola gücü, anahtar
rotasyonu; README/`docs/uretim-dagitimi.md` §0, OpenAPI (dev), CHANGELOG/CONTRIBUTING.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 6 Eylül 2026, 01:30

> Üç persona planı (`~/.claude/plans/wiggly-giggling-lighthouse.md`) yürüyor:
> **Faz 0 ✅ · Faz 1 ✅ · Faz 2 ✅ (bu commit)** · sırada Faz 3 (gelir hattı).

**FAZ 2 — BİLDİRİM GERÇEK KANALLAR TAMAMLANDI** (belge: `docs/faz2-bildirim-kanallari.md`):
1. **SMTP tam çalışır:** `MailService` (@Global, nodemailer, SMTP_*); tanımsızsa dürüst
   `{sent:false,reason}`. Test yığınında **Mailpit** (`localhost:8025`).
2. **Kanal adaptörleri:** `SmtpChannelProvider`, `NetgsmSmsProvider` (REST v2), `WhatsAppCloudProvider`
   (Graph v20, şablon/metin) — env'e göre `ChannelProviderRegistry`'ye kaydolur; 9 fixture testi.
3. **Push:** `ExpoPushProvider` (`PUSH_PROVIDER=expo`), mobil `push-token.ts` gerçek Expo jetonu
   (`expo-notifications`/`expo-device`), `DeviceNotRegistered` → jeton pasif.
4. **İşler:** `bildirim-dagitimi-5dk` (outbox → e-posta/push, `dispatchedAt` tek damga),
   `bildirim-temizligi-gunluk` (90/180 gün).
5. **Büro parola sıfırlama:** `POST /auth/forgot-password|reset-password`, `PasswordResetToken`
   (SHA-256, 30 dk, tek kullanım), web `/sifre-unuttum`, `/sifre-sifirla`, giriş bağlantısı.
6. **Demo talebi → `PLATFORM_NOTIFY_EMAIL`**; **duyurular** `GET /notifications/announcements`
   + web `AnnouncementBanner` (TUM/PLAN_BAZLI/TENANT_BAZLI hedefleme).
Migration `20260925100000_faz2_bildirim_kanallari`. Testler: api 1314, web 100; lint 0.
Canlı doğrulandı (Docker + Mailpit): forgot → Mailpit'te bağlantı → reset 200 → ikinci kullanım
401 → yeni parola ile giriş; demo talebi e-postası (reply-to talep sahibi); duyuru TUM görünür /
TENANT_BAZLI (başka kiracı) ve süresi dolmuş görünmez; dağıtım işi 2 outbox → 2 e-posta, ikinci koşu
0 (tek damga); kanal durumu EPOSTA AKTIF(SMTP). Web Playwright: giriş → Parolamı unuttum →
/sifre-unuttum → e-postadaki bağlantı → /sifre-sifirla → /app; duyuru şeridi görünür + Kapat.
NOT: demo parolası `Demo1234!` 9 karakter; change-password/reset 10 ister → duman sonrası
`scratchpad/restore_demo_pw.sh` (bcrypt + psql) ile geri yüklenir.

**SIRADA: FAZ 3 — gelir hattı:** dönem faturası (`InvoiceRecord(type=SUBSCRIPTION)`, tenant+dönem
tekil), iyzico adaptörü + webhook imza + kredi satın alma `BEKLIYOR→ODENDI`, dunning (PAST_DUE
1/3/7 gün e-posta → Faz 0 guard), `@RequiresModule` guard (`features.modules`), `Coupon` modeli
(BYO-LLM %30), yıllık fiyat/pro-rata, fatura PDF (`pdfkit`) + e-fatura ayarı tenant başına.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 23:30

> Üç persona planı (`~/.claude/plans/wiggly-giggling-lighthouse.md`) yürüyor:
> **Faz 0 ✅ (`eaccbb4`) · Faz 1 ✅ (`8889048` + `524afaf`)** · sırada Faz 2.

**FAZ 1 — AVUKAT ÇEKİRDEĞİ TAMAMLANDI** (belge: `docs/faz1-avukat-cekirdegi.md`; canlı doğrulandı):
1. **OCR** tesseract.js sunucu içi — görsel + taranmış PDF (gömülü JPEG sayfa akışları);
   canlı: taranmış JPEG tebligat 10 sn'de doğru Türkçe metin (`ocrStatus=TAMAM`). Hat
   kuyruksuz da HTTP dışında koşar.
2. **HEARING_PREP canlı:** `POST /hearings/:id/prep` → 9 bölüm, output-guard, `prepJson`;
   canlı: Gemma 4 ile 2.5 dk, 9/9 bölüm, 0 uyarı, `SourceRefSchema` null toleransı.
3. **Duruşma:** sorumlu avukat (`attendeeUserId`), ±2 sa çakışma → 409 / `force`,
   `GET /hearings/pending-results`; web: "yalnız benim duruşmalarım", bekleyen sonuç
   listesi, "AI ile hazırla" + paket modalı.
4. **ICS:** `POST /agenda/feed-token` + `GET /agenda/feed.ics` (canlı: 41 VEVENT).
5. **Süre kuralları 30 → 52** (AYM/AİHM/İYUK/İİK 106 vd./CMK/KVKK/TMK/TTK/SMK/HMK 377/İş K.
   m.20), tatiller 2028-2032, `DEADLINE_RULES_VERSION` → `Deadline.rulesVersion`;
   seed: 52 kural, 419 tatil günü.
6. `Deadline.sourceDocumentId` + Süreler'de "Kaynak belgeyi oku"; `preferredChannels`;
   dosya detayında vekaletname kartı.
Testler: legal-core 120, legal-ai 81, api 1283, web 100; lint 0.

**SIRADA: FAZ 2 — bildirim gerçek kanallar:** SMTP (nodemailer, tam çalışır), SMS
(Netgsm) + WhatsApp Cloud API adaptörleri + fixture sözleşme testleri, `ExpoPushProvider`
+ mobil jeton, büro parola sıfırlama (`/auth/forgot-password`, `/auth/reset-password`),
demo talebi → platform e-postası, Announcement → `GET /announcements` + web şeridi, outbox
budama işi. Mevcut registry: `communication/channel-providers.ts` (Noop/Portal),
`scheduler/push/push-provider.ts` (Noop), portal parola sıfırlama deseni
(`portal-auth.service.ts` forgot/reset, PortalInvite token).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 20:30

> **ÜÇ PERSONA BOŞLUK ANALİZİ → 9 FAZLI PLAN** onaylandı (plan dosyası:
> `~/.claude/plans/wiggly-giggling-lighthouse.md`; ~150 kanıtlı bulgu: firma sahibi /
> yazılımcı+sistem yöneticisi / avukat+büro). Sıra: Faz 0 kritikler → 1 avukat çekirdeği →
> 2 bildirim kanalları → 3 gelir hattı → 4 operasyon → 5 RAG/test → 6 UYAP/icra/finans →
> 7 büro yönetimi → 8 büyüme. Kararlar: dış entegrasyonlar adaptör + sözleşme testi (SMTP
> tam çalışır), OCR tesseract.js sunucu içi, self-signup MANUEL kalır.

**FAZ 0 TAMAMLANDI (`eaccbb4`, canlı doğrulandı):**
1. `docker-compose.prod.yml` çift `AI_TIMEOUT_MS` (ikincisi 60 sn'ye eziyordu) → tek 180 sn;
   `API_PUBLIC_URL` zorunlu, `METRICS_TOKEN`, web `NEXT_PUBLIC_DISABLE_DEMO=1` build arg
   (Dockerfile ARG/ENV); prod env örneği güncel.
2. Sohbet eki: Multer `limits` (60 MB → 413) + `validateUpload` beyaz listesi multipart ve
   presign yolunda (.svg/.html → 415).
3. Seed üretim kapısı (`NODE_ENV=production` → `SEED_ALLOW_PROD=true` olmadan durur);
   test compose migrate servisinde açıkça geçilir.
4. Kiracı açılışında `CreditWallet` + TAHSIS aynı işlemde; API açılışında cüzdansız
   kiracı yedeklemesi (`ensureWalletsForAllTenants`, canlı: 2 kiracıya açıldı, 3/3).
5. Koltuk sınırı: `users.create` ve yeniden etkinleştirmede `seats`/`plan.maxUsers`
   (canlı: 5/5 → 409).
6. `TenantStatusGuard`: süresi dolmuş TRIAL ve 14 gün (SUBSCRIPTION_GRACE_DAYS) sonrası
   PAST_DUE yazma isteklerinde 402; GET, /auth, /billing, /credits açık.
7. Sözleşme testi: seed fiyat listesi 33 görev tipinin tamamını kapsıyor.
Testler: tenant-status.guard 5, users.seat-limit 4, faz0 sözleşme 8; api 1265/1265, lint 0.

**SIRADA: FAZ 1 — avukat çekirdeği** (OCR tesseract.js kuyrukta, `POST /hearings/:id/prep`,
duruşma sorumlu avukat + çakışma + sonuç girilmemiş listesi, ICS beslemesi, süre kural paketi
[AYM/AİHM/İYUK/İİK 106-110/CMK 268/KVKK 14/TMK 605…] + tatiller 2028-2032, öneri ekranında
kaynak belge, bildirim tercihlerinde email/push, dosya detayında vekaletname kartı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 17:30

> **LM STUDIO (yerel Gemma 4) ENTEGRASYONU + RAG kullanımı** — kullanıcı isteği:
> "sistemdeki RAG ile AI modelini kullanmamız lazım; avukat tarafında kendi LLM sunucusu
> yoksa sistemde tanımlı sunucu aktif kullanılmalı". Belge: `docs/lm-studio-yerel-model.md`.

1. **Tanım:** LM Studio `lms server start --port 1234 --bind 0.0.0.0` (API anahtarlı);
   Sistem Paneli → Platform AI Sağlayıcıları'na Playwright ile (görünür tarayıcı)
   "LM Studio (Gemma 4, yerel)" OPENAI_COMPAT + Varsayılan; büro tarafında kullanıcı
   kendi kaydını ("LLM-GEMMA4") açtı, 33 görev rotası + EMBEDDING → nomic.
2. **Canlı bulgu → düzeltme (kod):** (a) `resolveEmbedding` EMBEDDING rotasını okumuyordu
   → rota öncelikli + platform yedeği; (b) platform sağlayıcısıyla koşan görevde
   `AiUsageLog.providerConfigId` FK ihlali (500) → `platformAiProviderId` sütunu +
   `usageProviderRef()` dört yürütücüde (migration 20260924150000); (c) küçük modelde JSON
   reddi → `responseFormat:"json"` (json_schema → json_object → düz); (d) `fetch failed`
   nedeni yüzeye çıkarıldı; (e) yavaş modelde `UND_ERR_HEADERS_TIMEOUT` → OpenAI-uyumlu
   adaptör AKIŞLI (SSE) + `fetchWithTimeout` undici Agent (başlık/gövde zaman aşımı =
   AI_TIMEOUT_MS); (f) `GET /ai/platform-status` `fallback:true` + web şeridi ("Sistemde
   tanımlı sunucu kullanılıyor"). Testler: embedding-route 4, openai-compat-json-mode 4,
   ai-usage-provider 2, openai-compat-stream 5, fetch-timeout-dispatcher 2; api 1248/1248, lint 0.
3. **RAG kanıtı:** İşe iade dosyasına 3 belge → 7 parça, `retrievalMode=EMBEDDING`
   (nomic via LM Studio); dosya sohbeti Gemma 4 ile 3/3 doğrulanmış alıntı (~2 dk).
4. **LM Studio ayarı:** model 8192 bağlamla yeniden yüklendi (4096'da analiz "context
   exceeded"); test compose `AI_TIMEOUT_MS=600000`, `AI_EMBEDDING_MODEL_OPENAI_COMPAT`.
5. Canlı SON DURUM (08:30): büro sağlayıcısı yokken platform LM Studio ile
   `platform-status fallback:true`, gömme=EMBEDDING, dosya sohbeti 55 sn (2/2 doğrulanmış
   atıf), TAM DOSYA ANALİZİ 3 dk 35 sn tam yapısal rapor (model 16384 bağlam, `--gpu 0.5`;
   kaynaksız 2 bulgu guard'da elendi). Atıf şeması `page/quote` null toleransı (`3e13ee7`); DİKKAT: `docker compose` komutu depo kökünden çalıştırılmalı (apps/web
   cwd'de dosya bulunamadı, derleme sessizce atlandı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 15:30

> **Enterprise++ altıncı (SON) paket — CİHAZ BAZLI OTURUM LİSTESİ** kodlandı
> (`docs/enterprise-guvenlik.md` §11). Belgede söz verilen altı aday tamamlandı (§12).
> Docker yığını yeniden kuruluyor; canlı duman testi (`smoke3.sh`: iki cihaz, tekil
> kapatma, diğerlerini kapatma, yönetici görünümü, SSO uçları, temizlik işi) sırada.

1. **Kayıt:** `UserSession` (JWT `jti`), UA → etiket (`user-agent.ts`), IP, giriş yolu;
   üç giriş yolu (parola/2FA/SSO) `sessionMetaFrom(request)` geçirir.
2. **Guard:** `resolveSession(jti)` — iptal 401, 30 sn önbellek, `lastSeenAt` 5 dk'da
   bir; jti'siz eski token geriye uyumlu; `AuthUser.sessionId`.
3. **Uçlar:** `GET/DELETE /auth/sessions`, `DELETE /auth/sessions/:id`; yönetici
   `GET /users/:id/sessions`, `DELETE /users/:id/sessions/:sid`. İş
   `oturum-temizligi-gunluk`. Ekranlar: Güvenlik "Açık oturumlar" kartı, Kullanıcılar
   "Oturumlar" penceresi.
4. Testler: `user-agent.test`, `user-sessions.service.test`, `jwt-auth.guard.session.test`,
   sözleşme; api 1231/1231, web 100/100, lint 0.
5. Sırada: Docker duman testi sonucu → gerekirse düzeltme; ardından bellek/özet notu.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 14:00

> **Enterprise++ beşinci paket — SSO / OIDC KURUMSAL GİRİŞ** kodlandı
> (`docs/enterprise-guvenlik.md` §10). Docker test yığını her paket sonrası yeniden
> kurulup canlı duman testi yapılıyor (KVKK + API anahtarı + webhook 19/19 geçti).

1. **Yapılandırma:** `Tenant.sso*` (issuer HTTPS+SSRF, client id, şifreli sır, e-posta
   alan adı, zorlama [ADMIN hariç], otomatik açma + varsayılan rol); `GET/PUT
   /security/sso` (yalnız ADMIN yazar), `POST /security/sso/test` (discovery);
   ekran `/app/ayarlar/sso`; `API_PUBLIC_URL` (.env.example) → redirect_uri.
2. **Akış:** `POST /auth/sso/start {email}` → imzalı state (JWT tenant-sso, 10 dk,
   nonce) → IdP; `GET /auth/sso/callback` → kod takası (client_secret_post) →
   ID token iss/aud/nonce/exp → e-posta (userinfo yedeği) → alan adı → kullanıcı
   eşleme (`User.ssoSubject`, farklı sub red, otomatik açma) → oturum "sso"
   (2FA atlanır — IdP'nin sorumluluğu) → çerez + `/app`; hata `/giris?sso_error=`.
3. **Zorlama:** `AuthService.login` — `ssoEnforced` ve rol ≠ ADMIN → 403 + LOGIN_FAILED.
4. Testler: `sso.service.test.ts` (17), sözleşme; api 1218/1218, web 100/100, lint 0.
5. Sırada: cihaz bazlı oturum listesi (son Enterprise++ adayı) → Docker + duman.
   SAML kapsam dışı (belgede gerekçeli).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 12:30

> **Enterprise++ üçüncü + dördüncü paket — KVKK SAKLAMA/İMHA** (§8) ve
> **API ANAHTARI + WEBHOOK** (§9) kodlandı (`docs/enterprise-guvenlik.md`).

1. **KVKK:** `Tenant.retentionYears` (10-30), saklama raporu, kapalı dosya
   anonimleştirme (ADMIN, gerekçe), veri öznesi talepleri (30 gün), aylık iş
   `kvkk-saklama-aylik`, `/app/ayarlar/kvkk`.
2. **API anahtarı:** `ApiKey` (yalnız SHA-256 özeti), `X-Api-Key` →
   `JwtAuthGuard.resolveApiKey`: yalnız GET/HEAD, kapsam-yol eşlemesi
   (`webhook-events.ts` API_KEY_SCOPES), kimlik `apikey:<id>` rol AVUKAT (gizli
   dosya görünmez). `GET/POST/DELETE /integrations/api-keys`.
3. **Webhook:** olay kaynağı DENETİM İZİ (`AuditService.subscribe` → `fanOut`);
   katalog = gerçek eylem adları (sözleşme testi her birini servislerde doğrular);
   HTTPS + SSRF kapısı; HMAC-SHA256 `X-NomosOS-Signature`; dağıtım işi
   `webhook-dispatch-5dk` (10 sn zaman aşımı; 1 dk → 5 dk → 30 dk → 2 sa → 12 sa;
   5 yeniden deneme sonra BASARISIZ). `/integrations/webhooks` CRUD + `/test` +
   `/deliveries`; ekran `/app/ayarlar/entegrasyonlar`.
4. Testler: `api-keys.service.test`, `webhooks.service.test`,
   `jwt-auth.guard.apikey.test`, sözleşme. api 1202/1202, web 100/100, lint 0.
5. Sırada (Enterprise++ adayları): SSO (OIDC) → cihaz bazlı oturum listesi.
   Docker test yığını her paket sonrası yeniden kuruluyor (canlı duman testi).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 09:15

> **Enterprise++ ikinci paket — GİZLİ DOSYA (dosya bazlı erişim kısıtı)** kodlandı
> (`docs/enterprise-guvenlik.md` §7). Docker test yığını güncel imajlarla yeniden kuruluyor.

1. `Case.isConfidential` + `CaseMember`; kural tek yerde (`common/case-visibility.ts`):
   ADMIN/PARTNER hepsini görür, diğerleri açık + sorumlu + üye dosyaları.
2. Global `CaseAccessGuard` (3. APP_GUARD): `:caseId` / `/cases/:id` / `?caseId` / gövde
   `caseId` → görünmeyen dosya 404. Liste süzgeçleri: dosya, duruşma, süre, görev,
   belge, ajanda (`AND` altında).
3. `PATCH /cases/:id { isConfidential }`, `GET/PUT /cases/:id/members`; web dosya
   detayında "Gizlilik ve erişim" kartı, listede "Gizli" rozeti.
4. Testler: `case-visibility.test.ts` (kural + extractCaseId + guard), sözleşme.
5. Sırada (Enterprise++ adayları, sırayla): KVKK saklama/imha politikası → API
   anahtarı/webhook → SSO → cihaz bazlı oturum listesi.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 08:30

> **ENTERPRISE++ GÜVENLİK & YÖNETİŞİM PAKETİ** (iki gözle boşluk analizi: sistem
> yöneticisi + avukat/büro). Belgede söz verilip kodda olmayan güvenlik katmanı
> kapatıldı — belge: `docs/enterprise-guvenlik.md`.

1. **Kiracı 2FA (TOTP):** `User.twoFactorSecret` (şifreli) + `lastTotpCounter`;
   `POST /auth/2fa/verify|setup|setup-with-challenge|disable`; login challenge
   döner (çerez yazılmaz); yönetici sıfırlama `POST /users/:id/reset-2fa`;
   web giriş 2FA adımı + zorunlu kurulum (QR), `/app/ayarlar/guvenlik`,
   kullanıcılar ekranında rozet + sıfırla; mobil kod adımı.
2. **Büro güvenlik politikası:** `Tenant.require2fa`, `sessionMaxHours` (1-24 sa);
   `GET/PATCH /security/policy` (yalnız ADMIN yazar); oturum tek kapı
   `SessionService` (JWT expiresIn + çerez maxAge politikadan).
3. **Büro denetim izi:** `GET /security/audit` (+actions, +export.csv formül
   korumalı, AUDIT_EXPORT izi), `/app/ayarlar/denetim`.
4. **Bildirim tercihleri:** `NotificationPreference` (tür × kanal); giden kutusu
   inApp=false'ta yazmaz; `/notifications/preferences`; `/app/ayarlar/bildirimler`.
5. **Doğrulama:** api 1162+ (yeni: two-factor 7, security 8, preferences 5,
   sözleşme 8), web 100, typecheck api/web/mobil, lint temiz.
6. **Envanter bulgusu:** FINAL raporundaki "~50 İ- açık" iddiası bayat — F2 İ-14,
   16, 18, 19, 38, 46, 47, 49 vb. zaten kapalı; Q4 gelişim planı D1-D8 tamam.
   Kalan Enterprise++ adayları (karar/kapsam ister): dosya bazlı erişim kısıtı,
   KVKK saklama/imha politikası, API anahtarı/webhook, SSO, cihaz bazlı oturum.

## Sırada

1. Enterprise++ ikinci paket (ürün kararı sonrası): gizli dosya erişimi, KVKK
   saklama politikası, API anahtarı/webhook, SSO.
2. Veri operasyonu (Aşama 4 içtihat havuzu) — dış kaynak sözleşmesi.
3. Üretim ön koşulları (FINAL §18): POS/GİB/SMS, yük ve sızma testi.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 07:45

> **AÇIK GÖREVLER KAPATILDI:** kullanıcı tanımlı model eğitimi planı (7/7 adım),
> AAÜT platform tarifesi (Aşama 2), FINAL-COMPLETION-REPORT güncellemesi (Aşama 9).
> İçtihat havuzu doldurma (Aşama 4) kod olarak hazır, VERİ operasyonu dış kaynak bekliyor.

1. **Model eğitimi (kullanıcı tanımlı model):** model yalnız katalogdan seçilir
   (serbest metin yok); lisanslı kiracı kendi modelinde iş açar
   (`/ai-training/fine-tune-jobs`, web `/app/ayarlar/model-egitimi`, manifest
   yalnız kendi örnekleri, allowBYOLLM 403); dışarıda eğitilmiş model KAYDI içe
   aktarma (`/ai/providers/import`, admin `/ai/providers/import`, origin=IMPORTED).
   Platform manifest kapsamı plandaki karara göre korundu, `tenantCount` ile şeffaf.
   Plan: `.mindaeon/plans/1788544126809-kullanici-tanimli-model-egitimi.md`.
2. **AAÜT platform tarifesi:** `PlatformVekaletTarife` + büro>platform>404 çözümü +
   admin `/yargi/aaut` + `aaut-tarife-yilbasi` işi + web kaynak notu. Rakamları
   platform görevlisi RG'den girer; sistem üretmez.
3. **Doğrulama:** api 1133, web 100, legal-ai 79, legal-core 111, e-imza 37, udf 44,
   eklenti 35 (toplam 1539); typecheck api/web/admin + lint temiz.
4. **Kapanış raporu:** `docs/FINAL-COMPLETION-REPORT.md` §19 (5 Eylül eki).

## Sırada

1. **Veri operasyonu (Aşama 4):** resmî/lisanslı içtihat kaynağı sözleşmesi → ilk
   10.000 künye partisi (`/caselaw-pool/import`, KVKK maskeli) — kod hazır, kaynak bekliyor.
2. **Aşama 5 (tatil takvimi 2028+) ve Aşama 3 (tam yargı/noter/vergi kataloğu)** veri girişi.
3. Üretim ön koşulları (FINAL rapor §18): sanal POS, GİB entegratör, SMS sözleşmeleri;
   yük testi; sızma testi; JWT httpOnly cookie geçişi.

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 5 Eylül 2026, 07:10

> **Mevzuat besleme hattı (Faz 1+3) + AYM/Uyuşmazlık adaptörleri (Faz 2) + derin
> analiz düzeltme turu TAMAMLANDI ve commit/push edildi.** Plan:
> `.mindaeon/plans/1788534218873-hukuki-veri-kaynagi-besleme-plani.md`,
> hat belgesi `docs/mevzuat-besleme-hatti.md`.

1. **Ne kuruldu:** `Statute`/`StatuteArticleVersion` (madde sürüm zinciri) +
   `LegislationIngestItem` onay kuyruğu + platform `Legislation` (tenantId=null);
   konektörler `MevzuatGovConnector` (mevzuat.gov.tr), `ResmiGazeteClient`,
   `KvkkClient`, `RekabetClient`; işler `resmi-gazete-gunluk` (07:30),
   `mevzuat-tohumu-haftalik`, `kvkk-kurul-haftalik`, `rekabet-kurul-haftalik`;
   atıf teyidi mevzuat kolonu (`StatuteLookupService` → "TCK 86" DOGRULANDI);
   admin **Mevzuat Onay Masası** `/yargi/mevzuat`.
2. **Derin analiz bulguları ve düzeltmeleri (5 Eylül):**
   - `simulation.modes.ts` cp1252 mojibake + BOM ile yazılmıştı (SIMULATION_NOTICE
     ve beş persona promptu bozuk) → HEAD'den geri alındı, `maxTokens 12288` korundu.
     **DERS: PowerShell `Set-Content` daima `-Encoding utf8`.**
   - Mevzuat aramasında kiracı izolasyonu kayboluyordu (aynı nesnede iki `OR`) →
     `AND` bloğu + sızıntı testi.
   - AYM/Uyuşmazlık adaptörleri her künyede ağa çıkıyor, Yargıtay künyesini AYM
     kaydıyla DOGRULANDI yapabiliyordu → kaynak kapısı + servis katmanında mahkeme
     uyum kapısı + DI + paralel registry.
   - Havuz kapısı alan koruması, sürüm sınırı tarih yedeği, gov-tls yönlendirme/
     akış sınırı/sertifika uyarısı, RG "KANUNLAR", hermetik Redis testi.
3. **Doğrulama:** api testleri 1101/1101 (Redis'siz), typecheck + lint temiz.
4. **Açık konu (ayrı plan):** `FineTuneService.manifest/poolSnapshot` ONAYLANMIŞ
   eğitim örneklerini kiracı süzmesi olmadan topluyor — `1788544126809-kullanici-
   tanimli-model-egitimi.md` planında tasarım kararı gerekiyor (rıza/kapsam).

## Sırada

1. Plan Aşama 2: AAÜT platform tarifesi.
2. Plan Aşama 4: içtihat havuzunu gerçek kararla doldurma (veri operasyonu).
3. Kullanıcı tanımlı model eğitimi planı (fine-tune kiracı kapsamı dahil).
4. `FINAL-COMPLETION-REPORT.md` üretimi (Aşama 9 kapanışı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 4 Eylül 2026, 11:20

> **AI kalıcılık + detay + URL doğrulama turu tamamlandı.**

1. **AI çıktı kalıcılığı (canlı bulgu):** Simülasyon koşuları KALICIYDI
   (SimulationRun + "Geçmiş Koşular" listesi) ama ÇALIŞMIYORDU — LLM
   `page: 0` döndürünce `SourceRefSchema` (positive) tüm koşuyu reddediyordu.
   Düzeltme: `page`/`paragraph` artık `min(0)` (0-indeksli sayfa geçerli);
   ChatCitationSchema da aynı. Canlı doğrulandı: "Karşı Taraf Avukatı"
   simülasyonu 3 bulgu üretti, "Geçmiş Koşular (1)" listesinde model/süre
   bilgisiyle duruyor ve okunabiliyor. Diğer AI katmanları zaten kalıcı:
   strateji (StrategyVersion), bilirkişi diff (ExpertReportDiff), risk
   (RiskAssessment), dilekçe sürümleri, sohbet (ChatSession/Message).
2. **Detay:** İçtihat arama sonuçlarında iç detay YOKTU (yalnız dış kaynak
   bağlantısı). Yeni sayfa `/app/ictihat/[id]`: tam künye, özet, tam metin,
   kaynak bağlantısı, bu büronun bağlı dosyaları (emsal bağları + durumları).
   Kartlara "Karar detayını aç" eklendi; arama sonucu `caseLawId`→`id`
   eşlemesi tek noktada düzeltildi (`/ictihat/undefined` hatası gitti).
   Canlı doğrulandı.
3. **URL doğrulaması:** Tüm kaynak URL'leri tarandı. Doğru resmî adres
   `https://karararama.yargitay.gov.tr/` (canlı webfetch ile doğrulandı —
   kullanıcı bulgusu). Besleme fikstürü + havuzdaki FEED_TEST kayıtları
   düzeltildi (eski `kararlar.yargitay.gov.tr`). Sağlayıcı varsayılanları
   (api.openai.com/v1, open.bigmodel.cn/api/paas/v4) standart uçlar — doğru.
   Kalan URL'ler örnek/SSRF-test dizgileri (kasıtlı).
4. **Doğrulama:** build 12/12 · typecheck 20/20 · lint 0/0 · testler
   1324/1324 (api 939, web 88, legal-ai 79, e-imza 37, udf 44, eklenti 35,
   legal-core 102).

## Sırada

1. Plan Aşama 1-2: platform mevzuat havuzu + AAÜT platform tarifesi.
2. Plan Aşama 4: içtihat havuzunu gerçek kararla doldurma (veri operasyonu).
3. `FINAL-COMPLETION-REPORT.md` üretimi (Aşama 9 kapanışı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 4 Eylül 2026, 10:40

> **İÇTİHAT TOPLAMA HATTI (caselaw-ingest) KURULDU VE CANLI DOĞRULANDI.**
> Plan dosyası: `plans/acilis-oncesi-hazir-veri-havuzu-plani.md`.

1. **Ne eklendi:** `CaselawSourceConfig` (besleme kaynağı yapılandırması — adres
   KODDA DEĞİL, tabloda) + `CaseLawIngestItem` (onay kuyruğu) + migration
   `20260904095000_caselaw_ingest` + `caselaw-ingest-daily` zamanlanmış iş
   (her gün 06:00, panelden ayarlanabilir) + admin uçları (`/api/admin/v1/caselaw-ingest`:
   sources PUT/GET, items, run, approve, reject) + admin panelinde
   `/yargi/havuz` sayfasına "Toplama Hattı" bölümü (kaynak kartları, "Şimdi
   Topla", kuyruk tablosu, onayla/reddet, +Kaynak modalı) + 11 birim testi.
2. **Tasarım taahhütleri:** çekim havuza OTOMATİK YAZMAZ — kayıt kuyrukta
   bekler, onay `CaselawPoolService`'in künye doğrulamasından geçer (tek kapı);
   red için gerekçe ZORUNLU; kuyrukta @@unique ile aynı künye ikinci kez
   girmez (idempotent); biçimsiz künye kuyruğa da girmez (poolRecordSchema
   birebir); FEED_TEST kaynağı [DEMO VERİ] işaretli — dilekçe teyit kapısından
   geçmez; web `isDemoCaseLaw` artık sunucunun `isDemo` bayrağına bakıyor.
3. **Canlı doğrulanan akış:** kaynak tanımladı (FEED_TEST → web konteynerındaki
   besleme örneği) → "Şimdi Topla" → 3 kayıt kuyruğa → 2 onay (EKLENDI) +
   1 red (gerekçeli) → ikinci çekimde 0 kuyruk / 3 mükerrer → büro içtihat
   aramasında "tazminat" FEED_TEST kaydını [DEMO VERİ] işaretiyle buldu →
   /isler sayfasında iş + koşu geçmişi görünüyor.
4. **Doğrulama:** build 12/12 · typecheck 20/20 · lint 0/0 · testler
   1324/1324 (api 939 — 11 yeni, e-signature 37, udf 44, extension 35,
   legal-core 102, web 88, legal-ai 79). Test yığını 7/7 sağlıklı.
5. **Üretim kullanımı:** lisanslı/resmî dönüşüm beslemesini panelden "+ Kaynak"
   ile tanımlayın (GET → `{records:[...]}` sözleşmesi; örnek:
   `apps/web/public/feeds/caselaw-feed-test.json`). Onay kuyruğu sürekli izlenir.

## Sırada

1. Plan Aşama 1-2: platform mevzuat havuzu (Legislation tenant-scoped → ortak)
   + AAÜT tarifesinin platform varsayılanı.
2. Plan Aşama 4: içtihat havuzunu gerçek kararla doldurma (veri operasyonu).
3. `FINAL-COMPLETION-REPORT.md` üretimi (Aşama 9 kapanışı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 4 Eylül 2026, 09:50

> **ÜÇ YÜZEY CANLI MODÜL TESTİ TAMAMLANDI (admin paneli + büro/avukat + müvekkil
> portalı) — bulunan hatalar düzeltildi ve canlı olarak doğrulandı.**

1. **Canlı test kapsamı:** admin paneli 17 sayfa (giriş→genel bakış→tenantlar→detay
   4 sekme→abonelikler→ödemeler→AI kullanımı→krediler→onaylar→işler→sistem 4 sekme→
   yöneticiler→denetim→yargı→içtihat havuzu→eğitim→AI sağlayıcılar→demo talepleri);
   büro tarafı tüm modüller + etkileşimli akışlar (finans, faturalar, zaman kayıtlarından
   fatura, bilirkişi, süreler, öneri onayı, raporlar); portal 8 sayfa + randevu + mesaj
   akışları.
2. **Düzeltilen hatalar (canlı doğrulandı):**
   - **Admin:** /metrics/overview kart şekli (iç içe tenants/revenue/ai'ye bağlandı),
     sağlık kartı `components` şekli (PostgreSQL/Redis + gecikme artık görünüyor),
     tenant listesi `subscription` nesnesi + `aiCallCount30d`, tenant detayı gerçek
     şekle (counters/usage/plan) yeniden yazıldı + AI üstverisi ayrı uçtan, /isler
     sayfası gerçek sözleşmeye yazıldı (koşu geçmişi modalı + PATCH ayarla), onay
     kataloğu etiketleri, demo talepleri çift başlıklar.
   - **Büro:** zaman kayıtlarından fatura artık ADANAN `from-time-entries` ucuna
     gidiyor (12.375₺ taslak canlı oluşturuldu), bilirkişi süre önerisi `deadline`
     alanından okunuyor (HMK m.281 önerisi canlı oluştu), finans özet kartları
     periodTotals'tan eşleniyor (28.000₺ tahsilat görünüyor), tarih filtreleri
     `from`/`to` gönderiyor, dilekçe stüdyosu UDF dışa aktarımı ortak yardımcıya
     geçti, manuel süre modalı BEKLIYOR açılıyor + rol bilinçli sunucu varsayılanı,
     ajanda kontrolde/onay bekleyen görevleri gösteriyor.
   - **Portal:** ana sayfa gerçek dashboard şekline bağlandı (4 kart dolu), dosya
     kartı `nextPublishedHearingAt`/`publicationNote` okuyor.
   - **API (P0):** icra-tahsilat raporu TDZ hatası (canlı 200 + 14 ms), seed
     `segmentAdded` çökmesi, platform sağlayıcı `headersJson` şifrelemesi (K-08
     platform tarafı), `/ai/chat` promptu legal-ai çekirdek sözleşmesine bağlandı
     (+ regresyon testi).
3. **Doğrulama:** build 12/12 · typecheck 20/20 · lint 0/0 · testler 1313/1313
   (yeni: ai-chat-prompt-contract). Test yığını 7/7 sağlıklı; tüm yüzeyler 200.

## Sırada

1. Plan Aşama 1'den kalanlar: BANKA_CEVABI ölü yolu (MALVARLIGI), UYAP pipeline
   tetikleme, kısmi iade tutarı, rol hiyerarşisi sunucu tarafı.
2. Plan Aşama 4 test borcu (petition-gate, balance engine).
3. `FINAL-COMPLETION-REPORT.md` üretimi (Aşama 9 kapanışı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 4 Eylül 2026, 08:00

> **Bağımsız final denetim TAM OKUMA tamamlandı + Docker üretim/topoloji güncellendi.**
> 8 dikey kesit ajanı depoyu baştan sona okudu (~1.000 dosya); bulgular
> `plans/bagimsiz-final-denetim-plani.md` dosyasında (P0-P3, dosya:satır kanıtlı).
> Docker bulguları bu turda KAPATILDI (plan Aşama 3.1-3.4 + 3.18):

1. **Docker düzeltmeleri:** dev `full` profili JWT_SECRET'i ≥32 karaktere çıkarıldı
   (API açılışta reddediyordu) · `.dockerignore`'a UYAP zip istisnası (web imajı
   `/downloads` 404 veriyordu) · prod compose'a `WEB_ORIGIN` (CORS) zorunlu alanı
   eklendi · prod compose'a `portal` servisi (3003) eklendi · prod compose'daki çürük
   yorumlar düzeltildi (web Dockerfile ARG'yi tanımlıyor + `USER node` var; `/root`
   tmpfs → `/home/node`) · `docker-compose.prod.env.example`'a `WEB_ORIGIN` +
   `PORTAL_BIND_PORT` eklendi. Üç compose dosyası `config` doğrulamasından geçti.

## Sırada

1. Plan Aşama 1 (P0 çalışma zamanı hataları: seed çökmesi, icra-tahsilat TDZ,
   BANKA_CEVABI ölü yolu, UYAP pipeline tetiklenmesi, platform headersJson şifreleme,
   /ai/chat prompt sözleşmesi, assistant maskeleme, kısmi iade, rol hiyerarşisi).
2. Plan Aşama 2 (istemci-sunucu sözleşme kopuklukları) ve Aşama 4 (test borcu).
3. `FINAL-COMPLETION-REPORT.md` üretimi (Aşama 9 kapanışı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 4 Eylül 2026, 07:15

> **DENETİM İYİLEŞTİRME BORCU KAPANDI + Yardım Merkezi, HEPO ve havuz yönetimi teslim edildi.**
> Son commit `f8cfcf9` GitHub'da (main).

## Bu turda teslim edilenler

1. **Yardım Merkezi (Modül 27):** paylaşılan yardım kataloğu (31 modül konusu) +
   aranabilir `/app/yardim` (konu → bölüme çapa atlama, `?konu=`/`?sayfa=` girişleri) +
   üst çubukta her sayfada bağlamsal `?` düğmesi.
2. **HEPO (Modül 28, Faz 1–5) uçtan uca:** `@nomosos/shared` tek katalog kaynağı →
   `HepoObligation`/`HepoClientObligation` (migration `20260903210000`, canlı DB'ye
   uygulanmadı) → `/hepo` uçları (HUKUKI, kiracı izolasyonu) → web "Müvekkil Takibi"
   sekmesi → `hepo-reminder-daily` işi (30/7/1 kala + tek seferlik SURE_GECTI;
   `HEPO:<satır>` dedupeKey) → `hepo-uyum` deterministik raporu → risk motoru
   `HEPO_CLIENT_OVERDUE` sinyali.
3. **İçtihat havuz yönetimi (D1):** `/api/admin/v1/caselaw-pool` + admin paneli
   `/yargi/havuz` — künye ön doğrulamalı toplu içe aktarma; büro MANUEL kaydı
   ezilmez (ATLANIR); `CASELAW_POOL_IMPORT` denetim izi.
4. **AI eğitim stratejisi kararı:** `docs/ai-egitim-stratejisi.md` — RAG öncelikli
   mimari; fine-tuning Super Admin tekelinde, avukat/büro eğitim yüzeyini göremez.
5. **İYİLEŞTİRME borcu (66/66) doğrulandı:** 63 madde önceki turlarda kapatılmış
   (kaynak etiketleriyle kanıtlı); bu turda **İ-15** (üretimde gömülü S3 varsayılanı
   yasak — açılışta düşer, 3 sözleşme testi) ve **İ-65** (MinIO imajları doğrulanmış
   RELEASE etiketlerine sabitlendi — Docker Hub'dan teyitli) kapatıldı; **İ-26**
   (User.email küresel unique) bilinçli mimari karar olarak şemada belgelendi
   (giriş akışı e-posta tek başına kullanıcı bulur; kiracı-uzaylı unique geçişi
   ürün kararı + göç gerektirir).

## Doğrulama

- `pnpm build` 12/12 · `pnpm typecheck` 20/20 · `pnpm lint` 0 hata / 0 uyarı
- **Testler: api 925 (+37) · legal-core 90 · web 88 · legal-ai 79 · udf 44 ·
  e-signature 37 · uyap 35** — hepsi geçiyor
- Migration `20260903210000_hepo_yukumluluk_takibi` yazıldı; canlı veritabanına
  UYGULANMADI — dağıtımda `prisma migrate deploy` çalıştırılmalı.

## Sırada

1. **Bağımsız final denetim** (yeni gözle sıfırdan okuma) — bu oturumun ve önceki
   turların yeni kodları (HEPO hattı, havuz yönetimi, yardım merkezi) dâhil.
2. `FINAL-COMPLETION-REPORT.md` üretimi (Aşama 9 kapanışı).

---

## 🔖 ÖNCEKİ KALDIĞIM YER — 1 Eylül 2026, 22:30

> **RAKİP FARKLARI 7/7 TAMAMLANDI + kritik İYİLEŞTİRMELER kapatıldı.**
> Son commit `88a8615` GitHub'da; Docker 7/7 sağlıklı; tüm yüzeyler 200.
>
> Kalan: 63 İYİLEŞTİRME maddesi (P2-P4) + bağımsız final denetim.

## Bu turda teslim edilenler

1. **Vekalet ücreti web aracı** (D7): `/araclar/vekalet-ucreti` — hesap sunucudaki
   D7 motorundan (kuruş hassasiyeti + iz gösterimi); tarife girilmemişse dürüst 404;
   nav'da "Vekalet Ücreti Hesabı" altında
2. **B7 banka haciz cevabı ajanı**: `BANKA_CEVABI` pipeline adımı — İİK m.89/2
   banka cevabı belgesi DETERMİNİSTİK analiz edilir (banka adı, IBAN, bakiye, tarih
   regex); icra dosyasına bağlıysa malvarlığı ÖNERİSİ (kayıt değil)
3. **İYİLEŞTİRME İ-02**: TOTP adım tüketimi koşullu yazımla (updateMany) — TOCTOU
   kapatıldı, eşzamanlı tekrar oynatma engellendi
4. **İYİLEŞTİRME İ-03**: CSV dışa aktarmada formül enjeksiyonu koruması (`, +, -, @, tab`
   ile başlayan hücrelere tek tırnak)
5. **İYİLEŞTİRME İ-04**: Redis sayaç resetleme FLUSHDB yerine önekli SCAN+DEL
   (BullMQ kuyruklarını korur)

## Rakip farkları durumu: 7/7 TAMAMLANDI

| # | Özellik | Uç/Arayüz |
|---|---|---|
| D7 | AAÜT vekalet ücreti | Motor + API + web aracı sayfası |
| A6 | e-SMM | POST /billing/invoices/:id/e-smm/send |
| E8 | Portal ödeme | Tek kullanımlık bağlantı + portal ödeme sayfası |
| E9 | Randevu | Büro ajandası + portal self-servis sayfası |
| A1 | CSV içe aktarma | POST /clients/import (mükerrer kontrolü dahil) |
| B7 | Banka cevabı ajanı | Deterministik pipeline adımı + öneri |
| Demo talep | Sistem kaydı | DemoRequest + platform paneli sayfası |

## Doğrulama

- `pnpm build` 12/12 · tip 20/20 · lint **0/0**
- **1014 test** (api 662 · legal-core 90 · web 70 · legal-ai 76 · udf 44 · e-signature 37 · uyap 35)
- Migration 28 · Docker 7/7 · tüm yüzeyler 200

## Sırada

1. Kalan ~60 İYİLEŞTİRME maddesi (P2 UX → P4 mimari) — önceliklendirilmiş işleme
2. Bağımsız final denetim (yeni gözle, sıfırdan okuma)
3. FINAL-COMPLETION-REPORT.md üretimi

## Anlık durum (önceki turların özeti)

## Bu kesitte teslim edilenler

1. **E8 — PORTAL ÖDEME BAĞLANTISI** (canlı kanıtlı):
   - Büro: `POST /billing/invoices/:id/odeme-linki` → kalan bakiyeli, 64 hex
     token'lı, 30 gün geçerli TEK KULLANIMLIK bağlantı (PAYMENT_WRITE yetkisi)
   - Müvekkil (public, token yetkidir): `/portal/odeme/:token` bilgi +
     `/ode` ödeme — Ödeme sayfası portal uygulamasında (`/odeme/[token]`)
   - Para disiplini PaymentsService ile aynı: transaction + FOR UPDATE kilidi +
     Payment(ONLINE) + FinancialEntry(TAHSILAT) + fatura durumu yeniden hesap;
     fazla ödeme YOK (kalan kadar tahsilat)
   - Sağlayıcı: `ODEME_SAGLAYICI=SIMULASYON` test modu; tanımsızsa DÜRÜST 503
   - **Canlı**: bağlantı 28.000 TRY → ödeme OK → fatura ODENDI → ikinci ödeme 409
2. **E9 — RANDEVU** (canlı kanıtlı):
   - Büro ajandası `/randevular` (her rol alabilir; durum OPERASYON)
   - Çakışma kapısı: yarı-açık aralık; KESİŞEN randevu 409 (canlı sınandı)
   - Portal self-servisi: `GET/POST /portal/randevular` + `:id/iptal` — süre
     sabit 30 dk, clientId oturumdan (istemciden ASLA alınmaz), hız sınırı
   - **Canlı**: sekreter büro randevusu → portal telefon randevusu (30 dk) →
     çakışma 409 → portal iptal IPTAL
3. **Düzeltmeler**: PaymentMethod.ONLINE enum'u DB'ye migration'la eklendi
   (canlı 500 hatası bulundu ve kapatıldı) · katalog sözleşme testi portal
   composite dekoratörünü öğrendi · test yığınına SIMULASYON modu

## Doğrulama

- `pnpm build` 12/12 · lint 0/0 · **1004 test** (api 652 · legal-core 90 ·
  web 70 · legal-ai 76 · udf 44 · e-signature 37 · uyap 35)
- Migration 25 adım; Docker 7/7 sağlıklı; E8 + E9 canlı uçtan uca kanıtlı

## Sıradaki kesit (kalan 4/7)

1. **A6 e-SMM**: fatura → e-SMM gönderim ucu (belge türü hazır) + arayüz düğmesi
2. **B7 banka cevabı ajanı**: BANKA_HACIZ_CEVABI sınıfı hazır → deterministik
   çıkarım (banka/tutar/IBAN) → icra malvarlığı ÖNERİSİ
3. **A1 CSV içe aktarma + özel alanlar** (customFieldsJson hazır) + arayüzleri
4. **Vekalet ücreti web aracı** sayfası + portal randevu SAYFASI (API hazır)
5. Pazarlama: yalnız YAPILANLAR (vaat kısıtı) + docs/08 birebir
6. F2 düzeltme turu (denetim: 2 KRİTİK + 40 ÖNEMLİ — admin 2FA K-01 başta)

## Anlık durum (önceki turların özeti)

## Bu turda yapılanlar

1. **DEMO TALEP ARTIK SİSTEMDE** (kullanıcı kararı — e-posta/webhook YOK):
   tanıtım sitesi formu → `POST /api/v1/demo-talepleri` (herkese açık; IP hız
   sınırı 3/dk+10/sa; aynı e-posta 10 dk'da bir) → **DemoRequest** kaydı →
   platform paneli **"Demo Talepleri"** sayfası (liste + durum: Yeni/İletişime
   geçildi/Kapandı; iz PlatformAuditLog'a). Yetkiler: demoRequests.view (tüm
   okuma rolleri) / demoRequests.update (OPS_ADMIN+; SUPPORT_AGENT yalnız okur).
   Canlı kanıt: form → kayıt → panel listesi → durum değişimi doğrulandı.
2. **D7 — AAÜT vekalet ücreti hesabı** (rakip farkı): legal-core motoru
   (kademeli maktu + tekrar dilimi + nispi asgari kuralı + KDV; kuruş/BigInt)
   + tarife API'si (tarife RAKAMLARI büro tarafından RG'den girilir — motor
   uydurmaz) + hesap ucu + 15 test. Canlı kanıt: tarife girişi (Partner) →
   1.000.000 TL → NİSPİ 165.000 TL + KDV = 198.000 TL, iz görünür.
3. **Şema hazırlığı**: E8 ödeme bağlantısı (OdemeLinki) ve E9 randevu (Randevu)
   tabloları + e-SMM belge türü + müvekkil özel alanları + banka cevabı belge
   sınıfı migration'da yaratıldı (kodları sıradaki kesitte).

## Doğrulama

- `pnpm build` 12/12 · `pnpm typecheck` ✅ · `pnpm lint` 0/0
- **Testler: api 635 (+13) · legal-core 90 (+11) · web 60** — hepsi geçiyor
- Migration 23 adım; Docker 7/7 sağlıklı; canlı uçtan uca: demo talep kaydı →
  panel listesi → durum güncelleme; vekalet tarife → hesap (404 dürüst yanıtı dahil)

## Sıradaki iş (kesit kesit)

1. **E8 portal ödemesi** (OdemeLinki tablosu hazır): bağlantı üretimi + portal
   ödeme sayfası + Noop sağlayıcı (dürüst 503) + webhook → Payment kaydı
2. **E9 randevu** (Randevu tablosu hazır): büro ajandası + portal self-servis +
   çakışma kapısı + hatırlatma işi
3. **A6 e-SMM** (belge türü hazır): fatura → e-SMM gönderim ucu (Noop adaptör) + arayüz düğmesi
4. **B7 banka cevabı ajanı** (sınıf hazır): deterministik çıkarım → icra önerisi
5. **A1 CSV içe aktarma + özel alanlar UI + vekalet ücreti web aracı**
6. F2 düzeltme turu (denetim: 2 KRİTİK + 40 ÖNEMLİ — admin 2FA K-01 başta)
7. Pazarlama: yalnız YAPILAN özellikler (vaat kısıtı)

## Anlık durum (önceki turların özeti)

## Denetim sonuç özeti

- **F2-K-01** — admin panelinde 2FA'lı giriş tamamlanamıyor (istemci `totp`'yi login
  gövdesine gönderiyor; sunucu `challengeToken` + `POST /auth/2fa/verify` sözleşmesi
  istiyor) — **ÜRETİMDE PANEL GİRİŞİ YOK**; ilk düzeltme bu.
- **F2-K-02** — UYAP eklentisinin arka ucu hâlâ yok (belgeli B4 kalemidir) ama eklenti
  popup'ı "backend hazır değil" durumu göstermiyor.
- Öne çıkan ÖNEMLİ: admin ayar sayfası yanlış uca gidiyor (PUT /settings vs
  /settings/:key — hiçbir ayar kaydedilmiyor), denetim izi personel alanları düz
  bekleniyor/sunucu iç içe döndürüyor, panel kullanıcı bcrypt'i hâlâ 10, /ai/chat
  guard+ajan izi taşımıyor, vade günü "kaçırılmış" sayılıyor (risk off-by-one),
  azil istisnası süresi dolmuş vekaletnameyi "aktif" sayıyor, KVKK export manifesti
  kapsam beyanıyla çelişiyor, e-Fatura satıcı VKN'si gönderilmiyor, iletişim AI
  önerisi KVKK onay çıkmazında, tabPanelProps hiç kullanılmıyor.

## Düzeltme turu önceliği (rapordan)

1. Sözleşme hizalamaları (küçük, hızlı): K-01, Ö-01, Ö-31, Ö-32, Ö-28, Ö-24, Ö-23, K-02 popup durumu.
2. Hukuki doğruluk: Ö-13 (off-by-one), Ö-05 (azil), Ö-04 (dayanak görünürlüğü), Ö-08 (duruşma), Ö-14 (para birimi).
3. Sözleşme genişletmeleri: Ö-11/12, Ö-15, Ö-16/17, Ö-33 (jobs sayfası), Ö-25.
4. İyileştirmeler: test/CI çıtaları önce (İ-07, İ-62, İ-66), kalan 63 madde kademeli.

## Anlık durum (önceki turların özeti)

## Bu oturumda yapılanlar

1. **E6 kalanı** — `Evidence.offeredBy` (BIZ/KARSI_TARAF/ORTAK, migration
   `20260915090000`): BİZ delilinin BİZ iddiasına CONTRADICTS bağı 422 (KK6);
   arayüzde "Kim sundu?" seçicisi + envanterde taraf rozeti.
2. **A1 politika matrisi** — `docs/kvkk-politika-matrisi.md`: 9 veri kategorisi
   (şemadan türetilmiş) × 9 kural kümesi; Avukatlık K. m.39 ↔ KVKK m.7
   çelişkisinin çözümü; yeniden açılma tetikleyicileri.
3. **A1 müvekkil dışa aktarma** — `GET /clients/:id/export` (K1-K7 tek JSON,
   rol kapısı + denetim izi) + arayüzde indirme düğmesi.
4. **B1 ilk kesit** — `PipelineQueueService` (BullMQ): 3 deneme üstel geri
   çekilme, DLQ (takılan koşum BASARISIZ'a çekilir), **yumuşak düşüş**
   (Redis yoksa senkron — belge yükleme Redise sert bağımlı DEĞİL).
   Yükleme ve reprocess yollarının ikisi kuyruğa girdi; arayüzde "Kuyruğa
   alındı" durumu.
5. **Web** — Ayarlar → AI Kullanımı'nda **ajan koşu izleri paneli** (durum
   süzgeci, model, süre, PII maskesi); "KUYRUKTA" durum etiketi.
6. **Kararlar** — B2 OCR: kendi barındırılan tesseract.js (şartname B2
   dosyasında, bulut REDDEDİLDİ); PoaScopeItem terfisi ve POST /tenants
   expand-contract planıyla sonraki keside; A3a UETS: PTT süreci tarafımızda
   başlatılamıyor, izleme dosyasında.

## Doğrulama

- `pnpm build` 12/12 ✅ · `pnpm typecheck` 20/20 ✅ · `pnpm lint` 0/0 ✅
- **947 test** (api 622 · web 51 · legal-core 79 · legal-ai 76 · udf 44 ·
  e-signature 37 · uyap 35)
- Migration 21 → **22** (`20260915090000_f2_e6_delil_taraf`);
  **sonraki: `20260916090000_…`**

## Sıradaki iş

1. **B2 OCR kesiti** — karar verildi, şartname hazır (tesseract.js + paketli
   dil verisi + %90 güven kapısı + kuyrukta ücretsiz).
2. **A1 PoaScopeItem** terfisi (expand-contract, üç servis).
3. **A1 POST /tenants** + hard-purge → soft-delete dönüşümü (dört-gözle).
4. **B1 kalanı** — toplu yeniden deneme ucu, korpus ingest ve UYAP senkronun
   kuyruğa bağlanması.
5. **A3a UETS** — PTT yazılı görüş talebi (dış takvim).

## Anlık durum (önceki turların özeti)

## Bu oturumda yapılanlar (F2 · T1)

1. **A4** — 7 yeni süre kuralı (İİK m.89 ÜÇLÜSÜ 7/7/15 gün, İİK m.33, İİK m.363,
   HMK m.394, HMK m.317/2); kural seti 22 → **29**; pazarlama sayısı düzeltildi (18→29).
2. **E6** — delil bağı YÖNÜ kullanıma girdi: SUPPORTS taşır, CONTRADICTS taşımayıp
   iddiayı ÇÜRÜTÜLMÜŞ işaretler, BELIRSIZ taşımaz. Arayüzde yön seçici + ✕/?/● hücre göstergesi.
   İstemcinin uydurma uç çağrıları (`/claims/:id/evidence-links`) gerçek uçlara bağlandı.
3. **E2** — gece risk işi (`risk-nightly`, cron 02:30): aktif dosyaların deterministik
   tabanı tazelenir (AI ÇAĞRILMAZ, önceki AI düzeltmesi korunur, `computedBy: null`) +
   kiracı günlük `DashboardSnapshot` (migration `20260913090000`).
4. **B2 ilk kesit** — DOCX (`word/document.xml`) ve UDF (`readUdf` + `rawText`) metin
   çıkarma; jszip bağımlılığı eklendi. OCR hâlâ YOK (vaat kısıtı sürer).
5. **E1** — ajan gözlemlenebilirliği: `AgentDefinition`/`AgentRun` (migration
   `20260914090000`), 17 ajanlık katalog (her görev tipinin bir sahibi),
   iki LLM yürütücüsü üç durumla izler, `GET /ai/agent-runs` iz görünümü,
   KVKK özet sözleşmesi (tam metin ASLA yazılmaz).
6. **A5/F1/F7 kesitleri** — İ-01 (TOTP tekrar oynatma, `lastTotpCounter`),
   İ-02 (bcrypt 12 panel+portal), İ-19 (Gemini anahtarı başlıkta), İ-25 (demo
   formu hız sınırı), İ-26 (`tabPanelProps`), İ-20 (Türkçe rol etiketi),
   lint 10 uyarı → **0**.

## Doğrulama

- `pnpm build` 12/12 ✅ · `pnpm typecheck` 20/20 ✅ · `pnpm lint` **0 hata / 0 uyarı** ✅
- **931 test geçiyor** (api 609 · web 51 · legal-core 79 · legal-ai 76 · udf 44 ·
  e-signature 37 · uyap 35)
- Migration 18 → **21** (`20260912090000` İ-01, `20260913090000` E2, `20260914090000` E1);
  **sonraki: `20260915090000_…`**

## Sıradaki iş (F2 T1 kalanı)

1. **A1 (L-65)** — KVKK veri özne hakları: İLK İŞ politika matrisi (Avukatlık K. m.39
   saklama ↔ append-only iz ↔ imha çelişkisi), sonra `POST /tenants/:id/export` +
   müvekkil bazlı dışa aktarma + `PoaScopeItem`'ı JSON'dan entity'ye terfi.
2. **B1 (L-55)** — asenkron iş altyapısı: BullMQ worker + DLQ + kısmi başarısızlık.
3. **A3a** — UETS tedarik/PTT yazılı görüşü (kod değil süreç — gün 1'den gecikmede).
4. **B2 ikinci kesit** — OCR (ürün kararı: kendi barındırılan OCR; doğruluk kapısı zorunlu).
5. E6 kalanı — `Evidence.offeredBy` + KK6 (422 kapısı).

## Anlık durum (önceki turların özeti)

## Bu turda yapılanlar

1. **K-12 kalıntısı KAPANDI** — portal guard'ına okuma-anı vekaletname canlılık
   kontrolü (`portal/guards/portal-poa-liveness.ts` + KAPI 8). Kayıt VAR ve
   hiçbiri canlı değilse (azil + süre dolumu + pasif) portal erişimi anında kesilir.
   Regresyon: `portal-poa-liveness.test.ts` (7 test).
2. **PlatformUser hard delete yapısal olarak imkânsızlaştı** — `PlatformAuditLog.platformUserId`
   FK'sı kaldırıldı (tenantId deseni); migration `20260910090000_platform_audit_fk_kaldirma`
   uygulandı, DB'de doğrulandı (FK yok, append-only trigger yerinde).
   `platform-audit-query.service.ts` ad-soyadı "(silinmiş kullanıcı)" şeridiyle ayrı sorguda çözüyor.
   Regresyon: `platform-audit-fk.test.ts` (5 test).
3. **İ-31 telafi göçü** — `20260911090000_i31_sahiplik_telafi_gocu`: tüm mevcut yayınların
   `ownershipVerified` bayrağı 7 kaynak türü için yeniden hesaplandı, DB'de doğrulandı.
4. **1. tur düzeltmelerine regresyon testleri** (+36 test):
   K-13 `deadline-status-policy.test.ts` (9) · K-05 `aging-rules.test.ts` (7) ·
   K-01 `platform-2fa-key.test.ts` (5) · K-03 `account-lockout.test.ts` (8) ·
   K-08/K-09 `provider-secrets.test.ts` (7).
5. **İ-27 rota kataloğu dolduruldu** — `packages/shared/src/api-routes.ts` 3 → 27 modül
   (AUTH, USERS, CLIENTS, CASES, DEADLINES, HEARINGS, TASKS, DOCUMENTS, PROPOSALS,
   AI, ASSISTANT, CASELAW, PETITION, CONFLICT, EVIDENCE, EXPERT, SIMULATION, STRATEGY,
   RISK, COMMUNICATION, CONTRACT, POA, PORTAL_ADMIN, REPORT, CREDIT, NOTIFICATION,
   DEVICE_TOKEN, DASHBOARD, HEALTH). **Sözleşme testi** `api-route-catalog.test.ts` (4):
   katalogdaki hiçbir yol 404'e gitmez + her controller öneği katalogda temsil edilir.
6. **docs/uretim-dagitimi.md güncellendi** — §3.2.1 `TRUSTED_PROXY_HOPS` (üretimde
   zorunlu, açılış durdurur), §3.2.2 `RATE_LIMIT_BACKEND` (çok örnekli dağıtımda redis),
   §3.2.3 büro bazlı AI kovaları (`AI_RATE_LIMIT_TENANT_*`).

## Doğrulama

- `pnpm build` 12/12 ✅ · `pnpm typecheck` 20/20 ✅ · `pnpm lint` 0 hata / 10 uyarı ✅
- `pnpm -r test`: **851 test geçiyor** (api 564 — 52 yeni; diğerleri aynı)
- Migration 16 → **18** (`20260910090000`, `20260911090000`); **sonraki: `20260912090000_…`**

## Kalan iş (sırayla)

1. **Kapatıcı 6 — backlog vaatlerinin arayüz/pazarlama metninden çıkarılması** (Ö-24 OCR,
   Ö-25 mevzuat atıf doğrulaması, Ö-26 UYAP) — kullanıcı onayı gerektirir, tek başına yapılmaz.
2. Kalan İYİLEŞTİRME maddeleri: İ-21 kontrast (50 dosya), kimlik sertleştirme
   (İ-01 TOTP window, İ-02 bcrypt maliyeti 10→12, İ-19 Gemini anahtarı URL'den başlığa),
   İ-29 jwt-audience.ts "iki evren" yorumu, `WEB_ORIGIN`'in `.env.example`'a eklenmesi.
3. `docs/DENETIM-RAPORU.md`'ye "Kapatıcılar Turu Sonucu" bölümü ekle.
4. **Aşama 9 — Kapanış**: final build+test+canlı duman testi, GitHub'a gönderim, kapanış raporu.

## Anlık durum (önceki turların özeti)

## Anlık durum

**Aşama 8 (derin denetim) düzeltme turu bitti; Aşama 8.5 (Docker test ortamı) bitti.**

- Denetim raporu: `docs/DENETIM-RAPORU.md` (1.094 satır, "Düzeltme Turu Sonucu" bölümü yazıldı)
- **KRİTİK: 16/16 kapalı** (K-12 kalıntısı için bkz. aşağıdaki kapatıcı 1)
- **ÖNEMLİ: 34/39 kapalı** (5'i backlog — yazılmamış özellik, hata değil)
- **İYİLEŞTİRME: 8 kapalı** (+1 kısmen); 15 madde yeniden denetlenmedi, 7 açık doğrulandı
- `pnpm build` 12/12 ✅ · `pnpm typecheck` 20/20 ✅ · `pnpm lint` 0 hata / 10 uyarı ✅
- **815 test geçiyor** (api 512, legal-ai 76, legal-core 79, udf 44, e-signature 37, uyap 35, web 32)
- Migration sayısı 16; **sonraki migration `20260910090000_…` olmalıdır**

## Üretim öncesi kalan kapatıcılar (sırayla, raporun son bölümü)

1. **K-12 kalıntısı** — portal erişiminde okuma-anı vekaletname canlılık kontrolü yok;
   süresi dolmuş vekaletnameyle erişim açık kalıyor (canlı kanıtlandı). Portal guard'ına
   canlılık kontrolü ya da süre dolumu için zamanlanmış iş.
2. **`PlatformUser` hard delete'inin yapısal olarak imkânsız kılınması** — ya FK kaldır
   (`platformUserId` tenantId gibi FK'sız nullable kolon) ya da silme yolunu şema düzeyinde kapat.
3. **1. tur düzeltmelerine regresyon testi** — en az: K-01 (2FA gidiş-dönüş), K-03 (kilit/çıkış/parola),
   K-05 (vadesiz fatura kovası), K-08+K-09 (şifreleme+rol kapısı), K-13 (`deadline-status-policy` birim testi).
4. **`docs/uretim-dagitimi.md` güncellemesi** — `TRUSTED_PROXY_HOPS` (üretimde zorunlu, tanımsızsa API açılmaz),
   `RATE_LIMIT_BACKEND=redis` (çok örnekli dağıtım), `AI_RATE_LIMIT_TENANT_PER_MINUTE/_PER_DAY` belgelenmeli.
5. **İ-31 telafi göçü** — `PortalPublication.ownershipVerified` `DEFAULT true` damgası; `20260910090000_…` göçü.
6. **Backlog vaatlerinin arayüz/pazarlama metninden çıkarılması** — mevzuat atıf doğrulaması (Ö-25),
   UYAP entegrasyonu (Ö-26), OCR (Ö-24) vaat edilemez.

Bunlardan sonra: kalan İYİLEŞTİRME maddeleri (İ-27 rota kataloğu, İ-21 kontrast, kimlik
sertleştirme İ-01/İ-02/İ-19) ve **Aşama 9 — Kapanış** (final build+test+duman testi,
GitHub'a gönderim, kapanış raporu).

## Workflow bilgisi (gerekirse)

Ölen düzeltme workflow'u: `resumeFromRunId: "wf_e8e70670-0c4"`,
script: `C:\Users\cdiri\.claude\projects\C--Projeler-NomosOS\f2f9eb96-2326-4f00-a47b-4a6c30f86d9c\workflows\scripts\nomosos-derin-denetim-wf_e8e70670-0c4.js`
Tamamlanan ajanlar önbellekten döner. **Ama muhtemelen daha temizi: kalan 4 kritik bulgu için
yeni ve dar kapsamlı bir workflow açmak** — denetim ve rapor zaten bitti.

## Ortam hatırlatması

- Docker konteynerleri (postgres/redis/minio) laptop kapanınca durur; `docker compose up -d` ile geri başlat.
- API duman testi için: `docs/test-ortami.md` §3 ve ortam değişkenleri.
- Migration tuzağı: sistem saati migration geçmişinin gerisinde. `--create-only` ile üret,
  klasörü elle adlandır. Son migration: `20260906090000_faz6_raporlama_zamanlanmis`.

---

## Durum

| # | İş | Durum |
|---|----|-------|
| 0 | Faz 0 — İskelet, BYO-LLM, KVKK hattı, monorepo | ✅ |
| 1 | Faz 1 — Legal Core (CRM, dava, duruşma, süre motoru, görev) | ✅ |
| 2 | Faz 2 — AI asistan/RAG, belge→aksiyon hattı, dilekçe, içtihat, UYAP eklentisi | ✅ |
| 3 | Faz 3 — İcra + Copilot, finans, faturalama, platform admin API | ✅ |
| 4 | Faz 4 (strateji/simülasyon/risk/delil/bilirkişi/çakışma) + tanıtım sitesi + Modül 26 kredi sistemi | ✅ |
| 7 | Üretim dağıtımı — `docs/uretim-dagitimi.md`, CI, Docker üretim profili | ✅ ⚠️ |
| 5 | Faz 5 — Müvekkil portalı, iletişim merkezi, vekaletname, sözleşme + e-imza | ✅ |
| 6 | Faz 6 — Kurumsal raporlama, zamanlanmış işler, bildirimler, mobil | ✅ |
| 8 | **DERİN DENETİM** (aşağıdaki prompt) | ✅ (31 Ağustos raporu + 5 Eylül derin analiz turu) |
| 9 | Final GitHub gönderimi + kapanış raporu | ✅ (`docs/FINAL-COMPLETION-REPORT.md` §19, 5 Eylül 2026) |

### ✅ Çözülen engel — CI dosyaları

Kullanıcı 31 Ağustos 2026'da token'a `workflow` yetkisi verdi; `ci.yml`, `security.yml` ve
`workflows/README.md` commit `b62e5b1` ile gönderildi. Depo ayarı önerisi: `dogrula` ve
`sir-taramasi` işlerini branch protection'da zorunlu status check yapın.

## Aşama 5 — Faz 5 kapsamı

- **Müvekkil portalı** (`apps/portal`, yeni Next.js uygulaması + `PortalUser` ayrı kimlik):
  Dosyalarım · Belgelerim · Son gelişmeler · Duruşmalar · Ödemeler · Mesajlar · Avukatım.
  Avukat neyin yayınlanacağını denetler (`PortalPublication`). Modül 10.
- **İletişim merkezi** (Modül 19): tüm müvekkil iletişim geçmişi, AI durum özeti →
  WhatsApp/e-posta/SMS; **AI taslak yazar, avukat onaylar, sistem gönderir** akışı;
  gelen mesajın dosyaya eşleştirilmesi.
- **Vekaletname** (Modül 12): kapsam/azil/süre takibi, süre uyarıları Deadline motoruna
  bağlı, AI kapsam yeterlilik analizi.
- **e-Fatura/e-Arşiv** (Modül 09 tamamlama): GİB özel entegratör adaptörünün
  gerçek bir sağlayıcıya bağlanabilir hâle getirilmesi (kimlik bilgisi yoksa Noop kalır).
- **Sözleşme + e-imza** (Modül 20): sözleşme yaşam döngüsü, versiyon, sağlayıcı-bağımsız
  `ISignatureProvider`, yenileme/fesih ihbar sürelerinin Deadline'a yazılması.

## Aşama 6 — Faz 6 kapsamı

- **Kurumsal raporlama**: partner dashboard'un tam sürümü, kaydedilebilir raporlar,
  CSV/PDF dışa aktarım, dönemsel karşılaştırmalar, avukat bazlı iş yükü ve verimlilik.
- **Mobil uygulama** (`apps/mobile`, React Native/Expo): aynı API'yi tüketir —
  bugünün duruşmaları, kritik süreler, görevler, dosya arama, belge görüntüleme,
  bildirimler. Tam CRUD hedeflenmez; sahada ihtiyaç duyulan okuma + hızlı aksiyon.
- **Zamanlanmış işler**: `UsageSnapshot` gece toplu işi, süre hatırlatmaları,
  abonelik dönem yenileme (BullMQ + Redis — altyapı zaten ayakta).

## Aşama 7 — Üretim dağıtımı

- `docs/uretim-dagitimi.md`: yönetilen PostgreSQL/S3/Redis, ortam değişkenleri,
  gizli anahtar yönetimi, yedekleme ve geri dönüş, ölçekleme notları.
- Docker üretim profili (çok aşamalı imajlar), sağlık kontrolleri.
- CI: GitHub Actions — `pnpm install`, `build`, `typecheck`, `test`, migration kontrolü.

## Aşama 8 — DERİN DENETİM (kullanıcının verdiği prompt)

> **"do not guess, read all files. read all lines. then deep audit against all projects."**

Uygulama biçimi: çok ajanlı, **tam okuma** esaslı denetim. Ajanlar dosyaları örneklemez,
**baştan sona okur**. Denetim eksenleri:

1. **Spec ↔ kod uyumu** — 26 modül spec'inin her kabul kriteri gerçekten karşılanıyor mu;
   dokümanda vaat edilip kodda olmayan ne var (ve tersi).
2. **Ürün ilkeleri ihlali** — AI'ın deterministik hesabın yerine geçtiği, insan onayının
   atlandığı, kaynak gösterilmeyen, uydurmaya açık her nokta.
3. **Güvenlik** — tenant izolasyonu (her sorgu tek tek), kimlik/aud ayrımı, RBAC'ın
   sunucu tarafında gerçekten uygulanması, dosya yükleme, SSRF, sır sızıntısı.
4. **KVKK** — maskeleme hattında kaçak, RAG'de ham veri saklama, dış sağlayıcıya giden
   her yol, veri minimizasyonu.
5. **Doğruluk** — para aritmetiği (float kullanımı), süre hesabı, faiz ve mahsup sırası,
   KDV, kredi mutabakatı.
6. **Tutarlılık** — Prisma şeması ↔ `docs/02-veri-modeli.md`, `packages/shared` sabitleri ↔
   veritabanı enum'ları, API rota kataloğu ↔ gerçek controller'lar, ölü kod, kullanılmayan
   bağımlılık, TODO/FIXME envanteri.
7. **Test kapsamı** — hangi kritik yol test edilmiyor.

Çıktı: `docs/DENETIM-RAPORU.md` — bulgu listesi (KRİTİK/ÖNEMLİ/İYİLEŞTİRME), her bulguda
dosya:satır, kanıt ve düzeltme önerisi. Ardından KRİTİK ve ÖNEMLİ bulgular düzeltilir ve
düzeltmeler kanıtlanır.

## Aşama 8.5 — Docker imajları ve test ortamı (kullanıcı isteği, 31 Ağustos 2026)

Kullanıcı denetim bitince sistemi Docker üzerinden test etmek istiyor.

**Yapılacak:**
1. Beş imajı yerelde derle ve çalıştığını doğrula: `api`, `web`, `admin`, `portal` (+ `postgres/redis/minio` hazır imajlar). `apps/mobile` imaja girmez (Expo, cihazda çalışır).
2. `docker-compose.test.yml` — TEK KOMUTLA ayağa kalkan test yığını: altyapı + uygulamalar + **otomatik migration ve seed** (operatör elle adım atmasın). Üretim profilinden farkı: sırlar üretilmiş test değerleriyle gelir, MinIO konsolu açıktır, portlar dışarı yayınlanır.
3. `docs/test-ortami.md` — tek sayfa: `docker compose -f docker-compose.test.yml up -d --build`, açılacak adresler, giriş bilgileri, neyin çalıştığı/çalışmadığı.
4. **Kayıt defterine (registry) gönderim** — kullanıcıya seçenek sunuldu, kararı bekleniyor:
   - **(a) Yerel derleme (önerilen, kimlik bilgisi gerektirmez):** kullanıcı kendi makinesinde `--build` ile ayağa kaldırır. Test için yeterli.
   - **(b) GitHub Container Registry (ghcr.io):** GitHub token'ında `write:packages` yetkisi gerekir; depo zaten GitHub'da olduğu için en doğal yol. CI'ya imaj yayımlama adımı eklenebilir.
   - **(c) Docker Hub:** ayrı hesap ve erişim jetonu gerekir. Parola ASLA sohbete yazılmamalı; `docker login` kullanıcı tarafından yapılır ya da erişim jetonu CI secret'ı olarak tanımlanır.

## Aşama 9 — Kapanış

Final build + tüm testler + uçtan uca duman testi → GitHub'a gönderim → kullanıcıya
kapsamlı kapanış raporu (ne yapıldı, ne çalışıyor, ne eksik kaldı, sonraki adımlar).
