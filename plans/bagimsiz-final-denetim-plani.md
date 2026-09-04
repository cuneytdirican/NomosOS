# Bağımsız Final Denetim ve Kapanış Planı — Eylül 2026

> Temel: 8 dikey kesit ajanı, depodaki tüm kaynak dosyaları (~1.000 dosya; apps/api 49 modül,
> apps/web/admin/portal/mobile/uyap-extension, 7 paket, docker/CI/scripts/docs) **baştan sona
> okudu**. Bu plan o tam okumanın bulgularını ve Aşama 8→9 (bağımsız final denetim + kapanış)
> için uçtan uca yürütme sırasını içerir. Kural: tahmin yok — her madde dosya:satır kanıtlı.

## Kapsam haritası (okunan kesitler)

| Kesit | Kapsam |
|---|---|
| Kimlik & çekirdek | auth, users, clients, cases, hearings, deadlines, deadline-rules, tasks, agenda, common, shared, db (schema 4.241 satır + seed 2.900) |
| AI katmanı | ai, assistant, agents, ai-training, chat; packages/ai, packages/legal-ai; web AI yüzeyleri |
| Belge & UYAP | documents, pipeline, storage, disk-quota, uyap; packages/udf; uyap-extension |
| Finans | billing (e-Fatura/e-SMM/odeme-linki), finance, case-expenses, credits, vekalet-ucreti |
| Müvekkil yüzeyleri | portal (32 dosya), communication, poa, contracts, randevu; packages/e-signature; apps/portal |
| Hukuki analiz | evidence, expert, conflict, strategy, simulation, risk, petitions, caselaw, legislation, judicial, mediation, enforcement, concordato; packages/legal-core |
| Platform & raporlama | platform (69 dosya), audit, dashboard, reports, hepo, demo-talep, scheduler (7 job); apps/admin |
| Kabuk & altyapı | web shell/pazarlama/yardım/araçlar, apps/mobile, docker×3, CI, scripts, env sözleşmesi, uretim-dagitimi.md |

Doğrulanan güçlü yönler (yeniden test gerekmez): para disiplini (Decimal/BigInt, FOR UPDATE,
kuruş), tenant izolasyonu (her sorguda tenantId + 404), üç kimlik evreni (tenant/platform/portal
ayrı secret+audience+tablo), KVKK 409 kapısı + sözlük maskeleme (`/ai/chat` yolunda), atıf
fail-closed teyidi, deterministik süre motoru (30 kural, altın değer testli), four-eyes matrisi
(yapısal guard + ikiz test), vaat-kısıtı testleri, CI migration drift kontrolü.

---

## AŞAMA 1 — P0: Çalışma zamanı hataları (her biri: düzelt + regresyon testi)

| # | Bulgu | Kanıt | Düzeltme |
|---|---|---|---|
| 1.1 | **Seed taze DB'de çöker** — `segmentAdded` tanımsız değişken (ReferenceError) | packages/db/src/seed.ts:2681 | `let segmentAdded = 0` ekle; seed'i sıfır DB'de çalıştırarak kanıtla |
| 1.2 | **`icra-tahsilat` raporu her çağrıda TDZ hatası** — `primaryCurrency` kullanım (173, 176) tanımdan (182) önce | apps/api/src/reports/builders/icra-tahsilat.report.ts:173-182 | Bildirimi yukarı taşı; rapor için birim test ekle (bug'ı yakalayacak) |
| 1.3 | **BANKA_CEVABI önerileri üç katmanda ölü** — `proposalDrafts` hiç birleştirilmiyor; `"MALVARLIGI" as never` enum dışı; approve dalı yok | pipeline.service.ts:835-849, 150-170; schema.prisma:746-753; proposals.service.ts:151-152 | ProposalType'a MALVARLIGI ekle (migration yok — enum String) veya mevcut türe eşle; `run()` içinde `result.proposalDrafts`'ı `ctx.proposals`'a birleştir; approve materializer yaz |
| 1.4 | **UYAP belgeleri hattı hiç tetiklemiyor** — commit pipeline enqueue çağırmıyor, `pipelineRunId: null` sabit; README/dto aksini iddia ediyor | uyap.service.ts:550-575; extension README.md:17,112 | commit sonrası `pipelineQueue.enqueue` + `ocrStatus:"BEKLIYOR"`; test stack'te canlı kanıt |
| 1.5 | **Platform sağlayıcı `headersJson` düz metin** — K-08'in platform tarafındaki kopyası | platform-ai.service.ts:243, 305 | Tenant tarafıyla aynı: `encryptSecret` + `readProviderHeaders` (zaten uyumlu) |
| 1.6 | **`/ai/chat` çekirdek prompt sözleşmesinden kaçıyor** — yerel 3-cümlelik SYSTEM_PROMPT; tarafsızlık/atıf/veri-ayrımı kuralları bu uçta yok | ai.service.ts:41-44 | legal-ai `composeSystemPrompt`'una bağla; prompts.test.ts kapsamına `/ai/chat` prompt'unu dahil et |
| 1.7 | **Assistant hattı sözlük maskeleme kullanmıyor** — taraf/avukat isimleri dış sağlayıcıya maskesiz gidiyor (Ö-22 yalnız `/ai/chat`'te uygulanmış) | case-context.builder.ts:8-11, 133 vs case-context.ts:531-579 | `maskEntityNames: true` geçir; `piiMasked` bayrağına `maskedEntityCount` dahil et; test ekle |
| 1.8 | **Kısmi iade tutarı sessizce düşüyor** — şema `amount` alıyor, hizmet payload'a koymuyor, executor tam iade damgası basıyor | platform-payments.schemas.ts:12-23; platform-payments.service.ts:136-144; executor:326-361 | amount'u approval payload'ına taşı, executor'da kısmi iade uygula (veya şemadan kaldır); test: kısmi istek tam iade olamaz |
| 1.9 | **Kullanıcı self-koruması + rol hiyerarşisi** — web `/me` şekil uyumsuzluğu kendi satırını düzenlenebilir gösteriyor; sunucuda ROLE_RANK yalnız istemcide | apps/web ayarlar/kullanicilar/page.tsx:97-103, 176; users.service.ts:272-287 | Sayfayı `{id, role}` şekline düzelt; **sunucuya** rol hiyerarşisi kontrolü ekle (PARTNER, API üzerinden ADMIN atayamaz) |

## AŞAMA 2 — P1: İstemci-sunucu sözleşme kopuklukları (kullanıcıda kırık yüzeyler)

| # | Yüzey | Kanıt | Düzeltme |
|---|---|---|---|
| 2.1 | Web "Zaman kayıtlarından fatura" akışı 400 — `createInvoice({timeEntryIds})`, şema `lines` zorunlu; gerçek uç `from-time-entries` hiç çağrılmıyor | faturalar/page.tsx:624-628; billing.dto.ts:216-220; api-routes.ts:30 | Sayfayı `invoicesFromTimeEntries` ucuna bağla; ölü `financialEntryIds` alanını kaldır |
| 2.2 | Portal ana sayfa tüm kartları "—" — `DashboardSummary` düz alanlar bekliyor, sunucu iç içe `{cases,finance,…}` dönüyor | apps/portal types.ts:65-74 vs portal.service.ts:85-94 (odemelerim sayfası doğru okuyor) | İstemci tiplerini sunucu şekline düzelt |
| 2.3 | Portal dosya kartı — `nextHearing`/`timeline` bekliyor, sunucu `nextPublishedHearingAt`/`publicationNote` dönüyor | dosyalarim/page.tsx:66-96 vs portal.service.ts:123-129 | Alan adlarını hizala |
| 2.4 | Portal ödemeler (ana sayfa) — `{openBalance,invoices}` bekliyor, sunucu `{items,total}` | portal types.ts:192-198 vs portal.service.ts:334-348 | Hizala |
| 2.5 | Bilirkişi süre önerisi hiç görünmüyor — istemci `deadlineSuggestion`, sunucu `deadline` | faz4-types.ts:365 vs expert.service.ts:283, 342-356 | Alan adını hizala |
| 2.6 | `/dilekceler` UDF dışa aktarım `href="undefined"` — `res.url` vs `downloadUrl`; `confirmedStatuteCitations` gönderilmiyor | dilekceler/page.tsx:369-373 vs petition-export.storage.ts:27-37; lib/faz2.ts:154 | `exportPetitionUdf` yardımcısını kullan; statü beyan UI'sını ekle (per-case stüdyo ile aynı) |
| 2.7 | Admin `/isler` sayfası eski API sözleşmesi — `useResource` zarfını açmıyor, alan adları farklı; PATCH/çalıştırma yeteneği erişilmez | isler/page.tsx:29-38 vs platform-jobs.service.ts:66-124 | Sayfayı gerçek şekle yaz; jobs.patch/run uçlarını bağla |
| 2.8 | Admin sağlık kartı — `components` şeklini tanımıyor | health.ts:39-72 vs platform-health.service.ts:41-63 | Normalizere `components` ekle |
| 2.9 | Admin tenant liste/detay alanları (storageBytes/mrr/aiProviders/usersByRole…) kalıcı "—" | tenantlar sayfaları vs platform-tenants.service.ts:130-157, 200-248 | Gerçek alanlara bağla veya sunucuya ekle |
| 2.10 | Finans ofis özeti tarih filtresi sessizce düşüyor — `dateFrom/dateTo` vs `from/to` | lib/finance.ts:99-111 vs finance.controller.ts:38 | Parametre adlarını hizala |
| 2.11 | UYAP `storageHosts` hiç gönderilmiyor — ayrı storage host'lu üretimde belge yüklemesi kalıcı FORBIDDEN | uyap.service.ts:270-281, 316-327 vs extension http.ts:119-154 | pair/refresh yanıtına `storageHosts` ekle (S3 endpoint host listesi) |
| 2.12 | Ajanda görevleri KONTROLDE/ONAY_BEKLIYOR durumlarında kaybediyor; manuel süre modalı SEKRETER'e her zaman 403 (status ONAYLANDI sabit) | agenda.service.ts:119-132; sureler/page.tsx:507-517 vs deadlines.service.ts:168-170 | Ajanda `OPEN_TASK_STATUSES` kullan; modal rol kapısı + varsayılan BEKLIYOR |
| 2.13 | Arabuluculuk web geçiş haritası sunucudan ayrışmış (TOPLANTI→TOPLANTI eksik) | arabuluculuk/page.tsx:55-63 vs mediation.service.ts:42 | Sunucu makinesini tek kaynak yap (paylaşımlı sabit veya API'den al) |
| 2.14 | `/simulations/compare` sunucu ucu kullanılmıyor, web kendi sezgisel karşılaştırmasını yazmış | simulation-tab.tsx:497-548 vs simulation.controller.ts:80-83 | Web'i sunucu ucuna bağla |

## AŞAMA 3 — P2: Üretim/dağıtım ve güvenlik sertleştirme

| # | Konu | Kanıt | İş |
|---|---|---|---|
| 3.1 | Dev `full` profili ölü JWT_SECRET (26 karakter < 32) — API açılışta durur | docker-compose.yml:72 | ≥32 karakter atılabilir varsayılan |
| 3.2 | `.dockerignore` UYAP zip'i imajdan atıyor — web konteyneri `/downloads/…zip` 404; vaat testi depoda geçer ama imajda kırılır | .dockerignore:73-74; vaat-kisitlari.test.ts:69-77 | `!apps/web/public/downloads/*.zip` istisnası |
| 3.3 | `WEB_ORIGIN` prod compose + env example'da yok → CORS localhost'a kilitli dağıtım | uretim-dagitimi.md:218 vs docker-compose.prod.yml:248-305 | İkisine de ekle (`:?` zorunlu) |
| 3.4 | Prod compose'da `portal` servisi yok (test yığınında var; Dockerfile hazır) | docker-compose.prod.yml | Portal servisi ekle (edge ağı, 127.0.0.1) |
| 3.5 | Üretim dokümanı çürük iddialar: yedek betiği "yok" (var), admin Dockerfile "⛔ EKSİK" (var), `RATE_LIMIT_BACKEND` çelişkisi, 8 migration iddiası (gerçek 44) | uretim-dagitimi.md:24, 30, 270, 371, 477, 618 | Dokümanı gerçeğe hizala |
| 3.6 | Çerez politikası "localStorage" diyor — İ-46 sonrası yanlış (httpOnly cookie) | legal-content.ts:266-270 | Metni düzelt |
| 3.7 | Mobile README quick-result'ı "yok" diyor; `next` derin bağlantı parametresi ölü | apps/mobile/README.md:127; middleware.ts:30; giris/page.tsx:43 | README + `?next=` yönlendirmesini tamamla |
| 3.8 | OdemeLinki: sağlayıcı tahsilatı işlem öncesinde (gerçek PSP'de çift tahsilat penceresi); ödeme toplamları para birimi filtresiz; `/portal/odeme/:token` hız limiti + portal denetim izi yok; token URL yolunda (davet akışının parça disipliniyle çelişir) | odeme-linki.service.ts:165-235; portal güvenlik raporu §2.2 | Tahsilatı tx sonrası/telefutu tasarımını netleştir; para birimi filtresi; hız limiti + denetim izi dekoratörleri |
| 3.9 | UYAP presign kota kontrolünden önce — kota reddinde MinIO'da öksüz nesne | uyap.service.ts:547-549 vs documents.service.ts:85 | Presign öncesi assertCanStore (bayt boyutu biliniyorsa) veya commit reddinde deleteObject telafisi |
| 3.10 | `reprocess` senkron fallback'i try/catch'sız (upload sözleşmesiyle tutarsız) | documents.service.ts:529-540 | Upload'daki gibi sarmala |
| 3.11 | e-SMM yükü E_ARSIV/EARSIVFATURA olarak etiketleniyor | invoices.service.ts:1016; ubl-tr-mapping.ts:52-58 | Belge türü eşlemesini netleştir (SMM profil kodu) veya durumu dokümante et |
| 3.12 | Kredi/disk paket alımı KDV'yi koda gömüyor (0.20) — "KDV veri" ilkesine aykırı | credit.service.ts:975 | `defaultVatRate()` kullan |
| 3.13 | Demo-talep hız limiti + e-posta dedupe süreç-içi Map (çok örnekli dağıtımda baypas) | demo-talep.service.ts:8-11; web route.ts:35-64 | attemptCounter (Redis) altyapısına taşı |
| 3.14 | `enforceCitationLookups`/VERIFIER ajanı kodda var, çağrılmıyor (ölü orkestrasyon) | output-guard.ts:225; caselaw modülü | Ya teyit ajanı koşullu zincire bağla ya da kataloğu daralt (karar: şu an deterministik teyit kasıtlı — belgele) |
| 3.15 | İki ajan taksonomisi (legal-ai AGENT_REGISTRY ↔ shared AGENT_CATALOG) ilişkisiz; UI etiketlerinde büyük/küçük harf mükerrer | agent-run.service.ts:76; ai-kullanim/page.tsx:629-648 | Eşleme testi yaz + etiketleri temizle |
| 3.16 | Rota çözümleme üç kopya (ai.service / assistant-llm / platform-ai) | ai-policy.ts:4-8 uyarısı | Tek `resolveRoute` servisine indir |
| 3.17 | seed migration borcu: HEPO `20260903210000` canlı DB'ye uygulanmadı | KALAN-GOREVLER.md:60-61 | Dağıtımda `prisma migrate deploy` — kapanış kontrol listesine |
| 3.18 | Web Dockerfile devDependencies'i çalışma imajına taşıyor; prod compose'da çürük yorumlar (ARG, /root tmpfs) | apps/web/Dockerfile; docker-compose.prod.yml:364-394 | Admin/portal gibi sling; yorumları düzelt |

## AŞAMA 4 — P3: Güvenlik-kritik test borcu (öncelik sırasıyla)

1. **petition-gate.ts** (hazırlık kapısı — K-10 kuralları): birim testi YOK. En kritik saf fonksiyon.
2. **balance.service.ts** (kesimli faiz + mahsub sırası): birim testi YOK — kuruş hesabı, ikinci en kritik.
3. **invoice-math.ts** (yuvarlama değişmezleri), **payments overpayment gate**, **invoice-number sequence**.
4. **collection-score / enforcement-stage** geçiş matrisi + ön koşullar.
5. Admin & portal tip sözleşme testleri (2.x maddelerinin sınıfını CI'da yakalar; her iki uygulamada test koşucusu YOK — Ö-33b sınıfı sessiz yeşil riski).
6.verifyCitations / retrieval / office-query / platform-credits margin birim testleri.
7. Web-server geçiş haritası çiftlerini kilitle (arabuluculuk 2.13, konkordato, icra ASSET_TRANSITIONS ×2 kopya).

## AŞAMA 5 — Uçtan uca doğrulama

1. `pnpm build` 12/12 · `pnpm typecheck` 20/20 · `pnpm lint` 0/0 · `pnpm -r test` (hedef: mevcut ~1.298 + yeni regresyonlar).
2. `docker compose -f docker-compose.test.yml up -d --build` — 7 servis sağlıklı; migrate+seed otomatik (Aşama 1.1'in gerçek sınaması).
3. Canlı duman (docs/test-ortami.md): giriş (4 rol) → dosya aç → belge yükle (KUYRUKTA) → öneri onayla → AI asistan sor + KVKK 409→onayla → UYAP eşleştirme kodu + eklenti eşleştir → portal ödeme linki ödemesi → admin 2FA giriş → `/isler`, `/sistem` sağlık, `icra-tahsilat` raporu.
4. CI (dogrula + security) yeşil; migration drift/hijyen kontrolleri geçiyor.

## Aşama sırası ve duraklama kuralları

- Aşama 1→5 sırayla; her aşama sonunda build+test+commit (anlamlı mesaj, `.env` asla commit edilmez).
- Aşama 2 ve 3 paralel kesitlere bölünebilir; dosya sahipliği ayrışır (app.module.ts/main.ts/kök yapılandırma yalnız entegrasyon adımında).
- Kullanıcı kararı gerektirenler tek başına yapılmaz: 3.14 (VERIFIER ajanını devreye alma), 3.8 (gerçek PSP sözleşmesi varsa tahsilat sırası).
- Her şey bittiğinde: `FINAL-COMPLETION-REPORT.md` güncelle (ne yapıldı/çalışıyor/eksik/sonraki adımlar) + GitHub push (`cuneytdirican/NomosOS`).
