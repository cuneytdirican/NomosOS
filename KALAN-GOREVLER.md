# NomosOS — Kalan Görevler ve Çalışma Sözleşmesi

> **Bu dosya bir çalışma sözleşmesidir.** Kullanıcı, tüm görevler eksiksiz bitene kadar
> durmadan çalışmamı istedi. Bağlam sıkışsa veya oturum yenilense bile buradan devam
> edilir. Her adım bitiminde bu dosyadaki durum işaretlenir ve GitHub'a gönderilir.

## Çalışma Kuralları (değiştirilemez)

1. **Durma yok.** Bir aşama bitince bir sonraki aşama hemen başlatılır; onay beklenmez.
2. **Her aşama ultracode ile çalışır** — çok ajanlı workflow, denetim ve düzeltme fazları dahil.
3. **Her aşama sonunda kendi doğrulamam yapılır** (build + test + canlı duman testi), ajan raporuna körlemesine güvenilmez.
4. **Her aşama sonunda GitHub'a gönderilir** (`cuneytdirican/NomosOS`). `.env` ASLA commit edilmez.
5. **Ürün ilkelerinden taviz verilmez**: AI önerir avukat onaylar · süre ve para hesapları deterministik · kaynak gösterme zorunlu, uydurma yasak · atıflar kayıt üzerinden doğrulanır · KVKK maskeleme onayı · tenant izolasyonu.
6. **Dosya sahipliği** ajanlar arasında keskin bölünür; `app.module.ts`, `main.ts`, kök `package.json` yalnız entegrasyon ajanına aittir.

---

# 🔖 KALDIĞIM YER — 31 Ağustos 2026, 17:10

> **KAPATICILAR TURU TAMAMLANDI.** Denetim raporunun "Üretim öncesi kalan
> kapatıcılar" listesindeki 1, 2, 3 (kısmen), 4, 5 numaralı maddeler ve İ-27
> kapandı. Bu bölümün altındaki ayrıntıya bakmadan şunu bil: **kalan tek iş
> Aşama 9 (kapanış raporu) ve 6. madde (backlog vaatlerinin arayüz/pazarlama
> metninden çıkarılması — ürün kararı gerektirir).**

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
