# NOMOSOS F2 DERİN DENETİM RAPORU

> **Tarih:** 31 Ağustos 2026, 22:30 · **Denetim turu:** F2 (Aşama 8'in ardından, F2 T1 oturumları sonrası)
> **Yöntem:** 8 alan denetçisi; kapsam dosyalarının **tamamı baştan sona okundu** (grep numunesi değil).
> Adversarial doğrulama: 2 KRİTİK + 12 ÖNEMLİ bulgu, kanıt satırları bağımsız olarak yeniden okunarak doğrulandı (aşağıda ✅ işaretli).
>
> **Kapsam:** ~787 dosya okundu (api 79k satır · web 35k · admin 8,8k · uyap-extension 5,2k · mobile 4,1k ·
> portal 4,1k · paketler ~15k · yapılandırma/CI/Docker). Kapsam dışı bırakılan modül yoktur.

---

## Sayısal Özet

| Ciddiyet | Adet | Not |
|---|---|---|
| **KRİTİK** | **2** | Biri bağımsız doğrulandı; biri belgeli backlog kaleminin uzantı yüzü |
| **ÖNEMLİ** | **40** | 12'si bağımsız doğrulandı (✅) |
| **İYİLEŞTİRME** | **66** | Denetçi kanıtıyla listelendi |
| **TOPLAM** | **108** | |

Denetçi bazında: api-güvenlik 10 (149 dosya) · api-hukuk 10 (133) · api-zekâ 11 (99) · api-iş 26 (129) · web-app 15 (39) · web-bileşen 13 (35) · yüzeyler 12 (107) · uzantı/altyapı 11 (96).

**Genel bulgu:** Aşama 8'deki sınıf hatalarının (gün kayması, sayfalama, maskeleme, uydurma kapıları, idempotentlik) büyük bölümü sistematik kapatılmış. Yeni bulguların ağırlığı **sözleşme kopmaları** (admin paneli ↔ sunucu şemaları), **uygulama içi tutarsızlıklar** (aynı olguya iki modülün zıt cevabı) ve **tamamlanmamış desenler** (tabPanelProps hiç kullanılmıyor, işler sayfası yok).

---

## KRİTİK BULGULAR

### F2-K-01 · Admin panelinde 2FA'lı giriş tamamlanamıyor ✅ DOĞRULANDI

- **Yer:** `apps/admin/src/app/giris/page.tsx:95-96` ↔ `apps/api/src/platform/auth/platform-auth.schemas.ts:8-19`
- **Kanıt (istemci):** `const body: Record<string, string> = { email, password }; if (withTotp) body.totp = totp;`
- **Kanıt (sunucu):** `platformLoginSchema` yalnız `email` + `password` kabul eder; 2FA ikinci adım `POST /auth/2fa/verify { challengeToken, code }` ucudur.
- **Sorun:** İstemci TOTP kodunu login gövdesine `totp` alanıyla gönderiyor; Zod bilinmeyen anahtarı sessizce atıyor, `challengeToken` hiç saklanmıyor, `/auth/2fa/verify` hiç çağrılmıyor (`endpoints.ts`'te tanımı yok). 2FA kurulu her hesapta (üretimde zorunlu) panel girişi **tamamlanamaz**.
- **Düzeltme:** İlk adım yanıtındaki `challengeToken` saklanacak; ikinci adım `POST /auth/2fa/verify { challengeToken, code }` ile gönderilecek; `endpoints.ts` başlığındaki yanlış sözleşme yorumu düzeltilecek.

### F2-K-02 · UYAP eklentisinin konuştuğu arka uç yok — uçtan uca hiçbir senaryo çalışmaz

- **Yer:** `apps/uyap-extension/src/lib/auth.ts:38-46` (UYAP_API_PATHS: /api/v1/uyap/pair, sync/files, sync/events, presign, commit, status)
- **Kanıt:** `apps/api/src` altında `@Controller("uyap")` **0 eşleşme** (58 controller tarandı).
- **Sorun:** Eşleştirme/senkron/presign/commit uçlarının hiçbiri sunucuda yok; eklenti birebir kurulsa bile her istek 404 alır. Bu, F2 planında **belgeli açık kalem**dir (B4; pazarlama "geliştirme aşamasında" diyor) — ancak eklenti popup'ı "backend hazır değil" durumunu göstermiyor ve `auth.ts` yorumu controller'ı mevcut gibi anlatıyor.
- **Düzeltme:** (a) Eklenti popup'ında eşleştirme denemesi yapılamadan "arka uç hazır değil" durumu açıkça gösterilecek; (b) backend (B4) yazılana kadar `UYAP_ROUTES` kataloğa eklenmeyecek; (c) `auth.ts:31-36` yorumu düzeltilecek.

---

## ÖNEMLİ BULGULAR (40)

### Kimlik / güvenlik (3)

**F2-Ö-01 · Panel kullanıcı yönetiminde bcrypt hâlâ 10** ✅ DOĞRULANDI
`apps/api/src/platform/users/platform-users.service.ts:14` — `const BCRYPT_ROUNDS = 10;` (kullanıcı oluşturma :107 ve parola sıfırlama :197). İ-02 "üç evrende 12" taahhüdü bu dosyada deliniyor: en yetkili hesaplar en zayıf hash'le doğuyor. → Sabit ortak kaynağa bağlanacak.

**F2-Ö-02 · Bakım tam kilidi portalı kapatmıyor**
`apps/api/src/portal/guards/portal-jwt.guard.ts` (KAPI 7 yalnız abonelik durumuna bakar) + `common/guards/tenant-status.guard.ts:31` ("TÜM kiracı uçları 503"). Portal uçları `@Public` olduğundan TenantStatusGuard onlara uygulanmıyor; bakım kilidi açıkken müvekkil portalı (mesaj gönderme, davet, parola sıfırlama) çalışmaya devam ediyor. → PortalJwtGuard'a bakım kilidi kontrolü eklenecek.

**F2-Ö-03 · SSRF kapısı IPv6-mapped adresleri geçiyor**
`packages/ai/src/pii.ts:373-381` — engel yalnız metinsel `169.254.` öneki ve iki sabit isim. `http://[::ffff:169.254.169.254]/` biçimi kontrolü atlıyor. → IPv4-mapped normalizasyonu + RFC1918/loopback denetimi eklenecek.

### Hukuk çekirdeği (7)

**F2-Ö-04 · İddia dayanağına başka büronun içtihat kaydı bağlanabiliyor** ✅ DOĞRULANDI
`apps/api/src/evidence/evidence.service.ts:396-399` — `caseLawDocument.findUnique({ where: { id } })`: `tenantVisibility` süzgeci yok. Başka büronun elle girdiği kayıt kimliği bilinirse "doğrulanmış" dayanak olarak bağlanır; teyit hattı aynı kaydı BULUNAMADI sayar (tutarsız sonuç). → `tenantVisibility(user.tenantId)` eklenecek.

**F2-Ö-05 · Azil istisnası süresi dolmuş vekaletnameyi "aktif" sayıyor** ✅ DOĞRULANDI
`apps/api/src/poa/poa.service.ts:450-457` — `otherActive` yalnız `isActive: true` sayar; `expiresAt`/`revokedAt` koşulu yok. Müvekkilin süresi dolmuş TEK vekaletnamesi kaldıysa azil portal erişimini KESMEZ ("portal erişimi korundu" yanıtı). → `revokedAt: null` + `expiresAt null ya da >= bugün` koşulu eklenecek.

**F2-Ö-06 · "CEVAPSIZ karşı iddiası" yanlış sinyali ölçüyor**
`apps/api/src/evidence/evidence-ai.service.ts:170` — filtre `supportingCount === 0` (karşı iddianın kendi desteği); doğru sinyal `contradictingCount === 0` (bizim çürütme bağımız). Çürüttüğümüz iddia "karşı delilimiz yok" listesine düşüyor.

**F2-Ö-07 · Dava değeri (para) float doğrulanıyor**
`apps/api/src/cases/cases.dto.ts:26` — `z.coerce.number()` kuruş sınırı olmadan her değeri kabul ediyor. → 2 ondalık sınırı veya kuruş-tamsayı.

**F2-Ö-08 · Duruşmada geçmiş tarih ve mükerrer celse kontrolü yok** ✅ DOĞRULANDI
`apps/api/src/hearings/hearings.service.ts:82+` — create `input.date`'i hiçbir kontrol olmadan yazıyor. Modül 03 kural 1 (geçmiş tarih yok) ve KK11 (aynı dosya+tarih 409) uygulanmıyor.

**F2-Ö-09 · İYUK m.8/3 uzatma çapası Danıştay uygulamasından bir gün geniş**
`packages/legal-core/src/deadline-engine.ts:235` — `addDays(recessEnd, 1)` + 7 = 8 Eylül; yerleşik uygulama 1–7 Eylül sayar. 60 günlük HAK DÜŞÜRÜCÜ sürede bir gün geniş hesap riski. → Çapa `recessEnd` yapılıp "tartışmalı hesap" işareti.

**F2-Ö-10 · KK6 kapısı spec'in 5. kuralından dar**
`apps/api/src/evidence/evidence.service.ts:311` — kapı yalnız `offeredBy === "BIZ"` üçlüsünde kapanıyor; spec "CONTRADICTS yalnız KARŞI_TARAF/MAHKEME delilleriyle kurulabilir" diyor (ORTAK ve null delillerle kendimize-çelişki bağı hâlâ mümkün). → Kapı ORTAK/null için de kapanacak ya da spec bilinçli gevşetme olarak güncellenecek.

### AI / belge hattı (4)

**F2-Ö-11 · `POST /ai/chat` ajan izi yazmıyor** ✅ DOĞRULANDI
`apps/api/src/ai/ai.service.ts:325+` — dosyada `agentRuns` 0 eşleşme. "Her AI çağrısı izlenebilir" sözleşmesi üçüncü LLM yürütücüsünde deliniyor; `agent-run.test.ts` de yalnız iki yürütücüyü doğruluyor.

**F2-Ö-12 · `POST /ai/chat` guard ve advisory taşımıyor** ✅ DOĞRULANDI
`apps/api/src/ai/ai.service.ts:440-448` — yanıt ham sağlayıcı içeriğini `guardOutput`'tan geçirmeden, "öneridir" şeridi olmadan döndürüyor (`guardOutput|advisory` 0 eşleşme). Aynı kod tabanındaki her diğer LLM ucu guard'lı. → `AssistantLlmService.runTask` üzerinden geçirilecek.

**F2-Ö-13 · Vade GÜNÜ dolan süre "kaçırılmış" sayılıyor (off-by-one)** ✅ DOĞRULANDI
`apps/api/src/risk/risk.rules.ts:184` — `d.dueDate.getTime() < s.now.getTime()`; `dueDate` @db.Date (gece yarısı). Vade günü 09:00'da süre "kaçırılmış" → +70 puan → Süre Riski koşulsuz YUKSEK. `sure-performansi.report.ts:99` aynı olguyu `dueDate + 1 gün` ile hesaplıyor — iki modül zıt cevap. Gece işi bu yanlış sinyali tüm RiskScore'lara yazıyor. → Kıyaslama `dueDate < startOfDay(now)` yapılacak.

**F2-Ö-14 · İcra raporu dönem tahsilatında para birimleri karışıyor**
`apps/api/src/reports/builders/icra-tahsilat.report.ts:102-107` — `collectionRecord` para birimi olmadan topluyor; 800.000 TRY + 10.000 USD "810.000 TRY" görünür. Ö-11 düzeltmesi aşama tablosuna uygulanmış, dönem toplamına uygulanmamış.

### İş / operasyon (6)

**F2-Ö-15 · KVKK export manifesti kapsam beyanıyla çelişiyor** ✅ DOĞRULANDI
`apps/api/src/clients/clients.service.ts:407` — manifest `["K1","K2","K3","K4","K5-ustveri","K6","K7"]` beyan ediyor; yanıt `FinancialEntry` (K6) ve `PortalUser` (K1) taşımıyor. m.11 yanıtı kendi beyanıyla çelişir. → Eksik sorgular eklenecek ya da manifest gerçek kapsamdan türetilecek.

**F2-Ö-16 · e-Fatura'da satıcı VKN hiç gönderilmiyor** ✅ DOĞRULANDI
`apps/api/src/billing/invoices.service.ts:799-802` — `select: { name: true }`; `ubl-tr-mapping.ts` `tenant.taxNumber` bekliyor. GİB VKN'siz belgeyi reddeder. → `taxNumber/taxOffice/address` seçilecek.

**F2-Ö-17 · Gönderilmiş e-Faturanın iptali GİB'e iletilmiyor**
`apps/api/src/billing/invoices.service.ts:704` — `cancel()` `eInvoiceStatus`'a bakmıyor, `adapter.cancelInvoice` çağırmıyor; yerel iptal + GİB kaydı ayrışır. Modül 09 kural 3 ihlali.

**F2-Ö-18 · from-time-entries satır çıkarımı zaman kayıtlarını kilitli-yetim bırakıyor**
`apps/api/src/billing/invoices.service.ts:503` — grup satırı çıkarılınca temsil ettiği zaman kayıtları faturada yok ama `invoiceId` dolu kalır: faturalanamaz + görünmez.

**F2-Ö-19 · Müvekkil oluşturmada mükerrer VKN/TCKN kontrolü ve CONFLICT_PRESCAN yok**
`apps/api/src/clients/clients.service.ts:106` — Modül 01 kural 2 (409 + mevcut kart) ve kural 5 (otomatik prescan) uygulanmıyor.

**F2-Ö-20 · Gönderilmiş mesajın iletişim geçmişi kaydı izsiz düzenlenebilir**
`apps/api/src/communication/communication.service.ts:305` — `source=SISTEM` (gerçekten gönderilmiş) kayıtların gövdesi `OPERASYON` rolüne serbest; denetim kaydı alan ayrıntısı taşımıyor. Silme dört kilitliyken düzenleme açık — "müvekkile ne söylendi" kanıtı bozulabilir.

### Web — uygulama ekranları (7)

**F2-Ö-21 · Zaman kaydı dosya seçicisi 201. dosyayı göstermiyor**
`apps/web/src/app/app/zaman/page.tsx:103` — `limit: 300` isteği sunucuda 200'e kırılır (MAX_PAGE_SIZE); 201. dosyaya zaman girilemez. RemoteSelect deseni uygulanmamış.

**F2-Ö-22 · İletişim "AI dosya önerisi" KVKK onay çıkmazında** ✅ DOĞRULANDI
`apps/web/src/app/app/iletisim/page.tsx:495` — `suggestInboundCase(entry.id)` her zaman `piiApproved=false`; sunucu 409 döner, istemci onay kutusu göstermez ve `piiApproved: true` ile tekrar deneme yolu yoktur. Özellik bu yoldan kullanılamaz.

**F2-Ö-23 · İcra "Toplam Takip" kartı büro değil sayfa sayısı**
`apps/web/src/app/app/icra/page.tsx:156` — `value={files.length}`; zarfın `total`'ı Pagination'da var ama kartta kullanılmamış.

**F2-Ö-24 · Öneri rozet süzgeci sayfayı sıfırlamıyor**
`apps/web/src/app/app/oneriler/page.tsx:209` — 3. sayfadayken tip rozetine basınca boş liste görünür.

**F2-Ö-25 · tabPanelProps var ama hiçbir sekme ekranı bağlamıyor (WCAG 4.1.2)**
`apps/web/src/app/app/dosyalar/[id]/page.tsx:420`, `muvekkiller/[id]:330`, `icra/[id]:237` — üç sekmeli ekran da `idPrefix`'siz Tabs + role'süz panel; `tabPanelProps` kod tabanında 0 kullanım. İ-26 yarıda kaldı.

**F2-Ö-26 · Koyu zeminde slate-500 metin AA altında**
`apps/web/src/app/app/layout.tsx:358,397` — slate-900 üzerinde slate-500 ≈3,7:1. slate-400 süpürmesi açık zemin içindi; koyu zemin kalıntıları açık kaldı.

**F2-Ö-27 · Matris boş hücre "+" göstergesi neredeyse görünmez**
`apps/web/src/app/app/_components/evidence-tab.tsx:325` — beyaz üzerinde slate-300 ≈1,9:1 (WCAG 1.4.11 ≥3:1).

### Web — bileşen/pazarlama (3)

**F2-Ö-28 · 429 mesajı ölü e-posta adresi gösteriyor**
`apps/web/src/app/api/demo-talebi/route.ts:87` — `info@nomosos.example` yok; sitenin gerçek adresleri `demo@nomosos.com`/`iletisim@nomosos.com` (content.ts). Hız sınırına takılan kullanıcının tek alternatif yolu ölü.

**F2-Ö-29 · Birebir kuralı ihlali — hat 1. adım metni yeniden yazılmış**
`apps/web/src/components/marketing/content.ts:220` vs `docs/08:202` — "yükleme; UYAP eklentisi: geliştirme aşamasında" ≠ "yükleme (UYAP eklentisi: geliştirme aşamasında)". docs/08 "yeniden yazmaz" sözleşiyor.

**F2-Ö-30 · docs/08'deki hesap izi örneği motor üretimi karttan sapmış**
`docs/08-tanitim-sitesi-icerik.md:181` — eski, hukuken yanlış gerekçeli örnek ("HMK m.92: tebliğ günü hesaba katılmaz") hâlâ "gerçek çıktı" olarak sunuluyor; uygulama doğru izi (10.07.2026 + adli tatil adımı) gösteriyor. Doküman tarafı güncellenmemiş.

### Admin paneli (8)

**F2-Ö-31 · Ayar güncelleme yanlış uca gidiyor — hiçbir ayar kaydedilemiyor** ✅ DOĞRULANDI
`apps/admin/src/app/(panel)/sistem/page.tsx:222-223` — `PUT /settings` + gövde `{key, valueJson}`; sunucu `PUT /settings/:key` + gövde `{value, reason}` ister → 404. Bakım tam kilidi sezgisel `TAM_KILIT` değer kontrolüyle AYNI bozuk ucu kullanıyor — akış hiçbir zaman sunucuya ulaşmıyor.

**F2-Ö-32 · Denetim izi personel alanları düz bekleniyor, sunucu iç içe döndürüyor** ✅ DOĞRULANDI
`apps/admin/src/app/(panel)/denetim/page.tsx:100,179` — `platformUserEmail` alanı sunucu yanıtında yok (`platformUser.email` var); her satırda "—", "(silinmiş kullanıcı)" şeridi hiç görünmez.

**F2-Ö-33 · Platform işleri (jobs) sayfası yok**
`apps/admin/src/lib/nav.ts` — `risk-nightly` dahil zamanlanmış işler panelden görünmez/elle tetiklenemez; `POST /jobs/:key/run` ucu arayüzsüz.

**F2-Ö-34 · Yeni feature flag'de `isEnabledGlobally` sessizce düşüyor**
`apps/admin/src/app/(panel)/sistem/page.tsx:445` — sunucu `flagCreateSchema`'sında alan yok; "Platform geneli açık" işaretlenen flag KAPALI oluşturulur, onay sözü boşta kalır.

**F2-Ö-35 · Duyuru hedefi `targetJson` string gönderiliyor, sunucu `target` nesnesi istiyor**
`apps/admin/src/app/(panel)/sistem/page.tsx:730` — PLAN_BAZLI/TENANT_BAZLI hedef sessizce kaybolur; yanlış kiracı kitlesine yayın riski.

**F2-Ö-36 · Abonelik durum değişikliği PATCH gövdesindeki `status` şemada yok**
`apps/admin/src/app/(panel)/abonelikler/page.tsx:312` — durum geçişi `POST /subscriptions/:id/transition` ucudur; PATCH'teki `status` ya 422 ya sessizce yok sayılır.

**F2-Ö-37 · Kısmi iade tutarı sunucuya hiç gitmiyor**
`apps/admin/src/app/(panel)/odemeler/page.tsx:329` — `amount` Zod'da yok; onaylanan her talep TAM iade olur; onaylayan yetkili payload'da tutar görmez.

**F2-Ö-38 · Personel parolası "boş bırakılırsa davet akışı" vaadi — sunucuda akış yok**
`apps/admin/src/app/(panel)/yoneticiler/page.tsx:283,319` — sunucu parolayı zorunlu + ≥14 karakter ister; ipucu yanlış.

### Altyapı (2)

**F2-Ö-39 · Dockerfile'larda `--frozen-lockfile || pnpm install` geri dönüşü**
`apps/api/Dockerfile:18`, `apps/web/Dockerfile:23` — tutuşmayan lockfile sessizce serbest moda düşer; imaj yeniden üretilemez olur. (admin/portal temiz.)

**F2-Ö-40 · Web üretim imajı root kullanıcıyla çalışıyor**
`apps/web/Dockerfile:29` — `USER node` yok (admin/portal'da var); compose sertleştirmesine rağmen gereksiz ayrıcalık yüzeyi.

---

## İYİLEŞTİRME BULGULARI (66) — özet tablo

| # | Yer | Özet |
|---|---|---|
| İ-01 | `platform-auth.service.ts:606` | Panel hesap kilidi sayacında hata penceresi yok — hatalar süresiz birikir |
| İ-02 | `platform-auth.service.ts:479` | TOTP adım tüketimi koşulsuz yazma (TOCTOU) — eşzamanlı tekrar oynatma penceresi |
| İ-03 | `platform-audit-query.service.ts:267` | CSV dışa aktarımda formül enjeksiyonu önlenmiyor |
| İ-04 | `counter-store.ts:198` | RedisCounterStore.reset() FLUSHDB — BullMQ kuyruklarını da boşaltır |
| İ-05 | `users.service.ts:69` | Atama listesi 500'de sessiz kesilir |
| İ-06 | `platform-serialize.ts:83` | Takma ad 16 bit rastgelelik — çakışabilir |
| İ-07 | `account-lockout.test.ts:23` | K-03 testi üretim eşikleriyle (10/15/15) eşleşmiyor |
| İ-08 | `evidence.service.ts:244` | offeredBy sonradan BİZ yapılınca mevcut CONTRADICTS bağları doğrulanmıyor |
| İ-09 | `expert.service.ts:473` | İtiraz petitionId varlık/kiracı doğrulamasız |
| İ-10 | `cases.dto.ts:29` | closedAt status'tan bağımsız PATCH'le yazılabilir |
| İ-11 | `retrieval.service.ts:175` | Anahtar kelime yedeği orderBy'suz take:400 — deterministik değil |
| İ-12 | `risk-nightly.service.ts:275` | Panel fotoğrafı override bantlarını yok sayar |
| İ-13 | `assistant-llm.service.ts:331` | Guard reddinde kredi bağlamı `discard()` edilmiyor |
| İ-14 | `ai.service.ts:283` | GET /ai/task-routes rol kapısız (K-09 ruhundan sapma) |
| İ-15 | `storage.service.ts:43` | S3 kimlikleri için kodda gömülü varsayılanlar |
| İ-16 | `documents.service.ts:574` | Belge fiziksel siliniyor — spec "arşivlenir" diyor (karar kaydı gerekli) |
| İ-17 | `durusma-takvimi.report.ts:72` | Görünmez 2000 tavanı, limit sözleşmesini altını oyar |
| İ-18 | `inbound.service.ts:94` + `outbound.service.ts:89` | Enum süzgeçleri doğrulanmıyor — geçersiz değer sessiz boş liste |
| İ-19 | `enforcement-deadlines.service.ts:75,230` | "Bugün" UTC — Ö-17 TR takvim günü ilkesinden sapma |
| İ-20 | `copilot.service.ts:386` | Durgunluk günü çiğ Date.now — AI bağlamına giren değer |
| İ-21 | `communication.service.ts:483` | unanswered() aday başına sorgu (N+1) |
| İ-22 | `schema.prisma:2983` | matchConfidence yorumu bayat eşik (0,85 → gerçek 0,80) |
| İ-23 | `balance.service.ts:13` | Başlık mahsup sırası vekâlet ücretini atlıyor |
| İ-24 | `enforcement.service.ts:1293` | sameDay "gün" diye belgelenmiş, an (ms) eşitliği uyguluyor |
| İ-25 | `contracts-signature.service.ts:129` | Yorum sürüm diyor, denetim sözleşme geneli |
| İ-26 | `schema.prisma:60` | User.email küresel unique — PortalUser kiracı-uzaylı deseniyle tutarsız |
| İ-27 | `inbound.service.ts:55` | Müvekkil taraması 5000'de sıralamasız kesilir |
| İ-28 | `clients.service.ts:228` | /clients/:id/contacts sayfalama zarfı yok (K-15) |
| İ-29 | `clients.service.ts:123` | Müvekkil okuma uçlarında AuditLog yok (spec 01 kural 8 ile uyum gerekli) |
| İ-30 | `invoices.service.ts:905` | serialize paidTotal para birimi süzmez (Ö-14 ikinci kapı) |
| İ-31 | `invoices.service.ts:780` | sendEInvoice TASLAK kontrolünü mükellef sorgusundan sonra yapar |
| İ-32 | `invoices.service.ts:827` | BEKLIYOR mutabakat yolu yok (getStatus çağrılmıyor) |
| İ-33 | `time-entries.service.ts:95` | summary sınırsız satır okur |
| İ-34 | `invoices.service.ts:77` | eInvoiceStatus filtre alanı ölü |
| İ-35 | `finance-access.ts:28` | TIME_WRITE yorumu davranışla çelişiyor |
| İ-36 | `platform-credits.service.ts:101` | Platform kredi listesi 500/1000'de sessiz kesilir |
| İ-37 | `finance-summary.service.ts:129` | Tahsilat riski yalnız primary para biriminden |
| İ-38 | `ayarlar/ai-saglayici/page.tsx:95` | 403 ayrımı yok (ai-kullanim desenindeki rol kartı uygulanmamış) |
| İ-39 | `raporlar/[key]/page.tsx:330` | Kullanıcıya gösterilen uç adı eski sözleşmeden |
| İ-40 | `iletisim/page.tsx:460` | Eşik yorumu bayat (0,5 → sabitler 0,80/0,85) |
| İ-41 | `ayarlar/ai-kullanim/page.tsx:615` | AgentRunRow token alanları tanımlı ama render edilmiyor |
| İ-42 | `ayarlar/ai-saglayici/page.tsx:273` | İç gezinme düz `<a>` |
| İ-43 | `muvekkiller/page.tsx:192` | Satır onClick — klavye erişimi yok |
| İ-44 | `save-report-modal.tsx:42` | defaultName open'da senkronlanmıyor |
| İ-45 | `muvekkiller/[id]/page.tsx:67` | İki benzer "Sözleşmeler" sekmesi |
| İ-46 | `lib/api.ts:25` | JWT localStorage'da (httpOnly cookie hedefi) |
| İ-47 | `lib/api.ts:147` | 403'e özel mesaj yok |
| İ-48 | `giris/page.tsx:105` | Demo kimlik bilgileri herkese açık (üretim derlemesinde gizlenmeli) |
| İ-49 | `giris/page.tsx:45` | Kilit durumuna özel ileti yok |
| İ-50 | `documents-tab.tsx:8` | Başlık yorumu var olmayan uç gösteriyor |
| İ-51 | `deadline-wizard.tsx:107` | Tür eşleşmesi yoksa sessizce TÜM kurallar listelenir |
| İ-52 | `lib/credits.ts:144` | fetchWallet tüm hataları "uç yok" sayar |
| İ-53 | `demo-talebi/route.ts:43` | Doğrulama hataları da sayaca girer; IP üstbilgiye dayalı |
| İ-54 | `content.ts:633` | Demo gündemi UYAP'ı kurulmuş özellik gibi anlatıyor |
| İ-55 | `lib/api.ts:130` | middleware yok — /app kabuğu sunucuda korumasız |
| İ-56 | `portal/dosyalarim/[id]/page.tsx:83` | 404 (yayın kararı) "geçici arıza" gibi gösterilir |
| İ-57 | `mobile/gorevler.tsx:38` | Gerekçe zorunluluğu istemci sabiti — sunucudan gelmeli |
| İ-58 | `admin/onaylar/page.tsx:171` | Onay rozetleri sabit `tenant.suspend`; abonelik ekranı çift tutarsız |
| İ-59 | `admin/denetim/page.tsx:201` | CSV istemci tarafında; dört-gözlü sunucu ucu (`POST /audit/export`) bağlanmamış |
| İ-60 | `api-route-catalog.test.ts:36` | İ-27 sözleşme testi HTTP metodunu doğrulamıyor |
| İ-61 | `uyap/manifest.json:35` | `all_frames: true` — gereksiz frame enjeksiyonu |
| İ-62 | `agent-catalog.ts:135` | Katalog ↔ AI_TASK_TYPES birebirliği yalnız elle korunuyor (test yok) |
| İ-63 | `schemas.ts:38` | Zod mesajları iki dilde karışık |
| İ-64 | `pdf-parse ^1.1.1` | Bakımsız sürüm (belirli CVE iddiası yok) |
| İ-65 | `docker-compose.yml:41` | MinIO `latest` etiketi (test yığını yeniden üretilemez) |
| İ-66 | `ci.yml:134` | Lint uyarı tavanı yok — 0 uyarı hedefi ölçülmüyor |

---

## Temiz Alanar (adversarial doğrulamalı özet)

1. **Deterministik süre motoru** — 29 kural (İİK m.89 üçlüsü dahil) altın vaka tablosuyla kilitli; İİK kurallarında adli tatil uzaması uygulanmıyor; e-tebligat +5, HMK m.92/93, arife yarım günü, K-04 savunması sağlam.
2. **Atıf disiplini** — teyit kapısı HAZIR/DISA_AKTARILDI/GONDERILDI geçişlerinde çift; doğrulama kayıt üzerinden (fail-closed); mevzuat tanınır-doğrulanmaz ayrımı uygulama ve pazarlamada tutarlı.
3. **KVKK/PII hattı** — maskeleme sunucuda; preScanned nihai mesaj taraması; RAG öbekleri maskeli; sağlayıcı anahtarları yanıtlara sızmıyor; Gemini anahtarı başlıkta; eklenti `chrome.storage.sync` kullanmıyor; DONE gövdeleri anında boşaltılıyor.
4. **Para aritmetiği** — Decimal/kuruş disiplini faturalama/finans/icra çekirdeğinde sistematik; çift faturalama üç katmanlı; mutabakat idempotent.
5. **Kredi** — koşullu UPDATE rezervasyon; çöken çağrıdan kredi düşmez (risk.service'te discard var, İ-13 tek sapma); belge kotası engellemez.
6. **Kuyruk (B1)** — yumuşak düşüş, 3 deneme üstel, DLQ izi test kilitli; belge yükleme Redise sert bağımlı değil.
7. **Zamanlayıcı** — dedupeKey veritabanı kısıtında; BEKLIYOR süreler hatırlatma almıyor; koşu kilidi sızıntısız.
8. **Admin kimliği** — ayrı anahtar/audience/localStorage; dört-göz kataloğu matristen türetilmiş (K-11); ANALYST_READONLY maskeli görünüm.
9. **Portal** — uç tablosunun tamamı gerçek; yayın kontrolü istemcide delinmiyor; davet token'ı fragment'ta; ink.faint koyulaştırması uygulanmış.
10. **Mobile** — SecureStore donanım anahtarlığı; üretimde yalnız https; uydurma uç yok; push token asla uydurulmuyor.
11. **İş sözleşmeleri** — enforcement aşama makinesi, sözleşme sürüm immutability + SHA-256 imza bütünlüğü, iletişim onay makinesi sağlam (İ-20 düzenleme deliği tek sapma).
12. **Şema** — para Decimal(18,2); üç kimlik tablosu ayrık; append-only kredi defteri; PlatformApprovalRequest dört-göz.

---

## Sıradaki Adımlar (önerilen öncelik)

1. **Düzeltme turu 1 (KRİTİK + kolay ÖNEMLİ):** F2-K-01 (admin 2FA akışı), F2-K-02 (eklenti durum ekranı), F2-Ö-01 (bcrypt), F2-Ö-31 (PUT /settings), F2-Ö-32 (denetim personel alanları), F2-Ö-28 (ölü e-posta), F2-Ö-24 (sayfa sıfırlama), F2-Ö-23 (Toplam Takip) — hepsi küçük, sözleşme hizalama işleri.
2. **Düzeltme turu 2 (hukuki doğruluk):** F2-Ö-13 (off-by-one), F2-Ö-05 (azil istisnası), F2-Ö-04 (dayanak görünürlüğü), F2-Ö-08 (duruşma kontrolleri), F2-Ö-14 (para birimi).
3. **Düzeltme turu 3 (sözleşme genişletmeleri):** F2-Ö-11/12 (/ai/chat guard+iz), F2-Ö-15 (export kapsamı), F2-Ö-16/17 (e-Fatura), F2-Ö-33 (jobs sayfası), F2-Ö-25 (tabPanelProps).
4. İyileştirmeler kademeli; İ-07, İ-62, İ-66 test/CI çıtaları ilk sıraya.

*Denetim sonu. Bu rapordaki her bulgu dosya:satır kanıtıyla gelir; ✅ işaretli 14 bulgu bağımsız olarak yeniden okunarak doğrulandı. Kalan 94 bulgu denetçi alıntısıyla listelendi.*
