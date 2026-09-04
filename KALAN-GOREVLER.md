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

# 🔖 KALDIĞIM YER — 4 Eylül 2026, 10:40

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
| 8 | **DERİN DENETİM** (aşağıdaki prompt) | ⏳ |
| 9 | Final GitHub gönderimi + kapanış raporu | ⏳ |

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
