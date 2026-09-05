# Faz 6 — UYAP / İcra / Finans (6 Eylül 2026)

Üç persona planının 6. fazı. Amaç: UYAP'tan gelen dosyanın NomosOS'ta **oluşturulabilmesi**, icra
takibinde **değişken (dönemli) faiz**, İİK sürelerinin icra aşamasından **otomatik** üretimi,
**Tebligat** varlığı ve büro finansında **kronometre + timesheet onayı + storno + muhasebe CSV**.

Tasarım ilkesi: hukuki/mali sonuç doğuran her değer (faiz oranı, harç tarifesi, tebliğ tarihi) ya
platform tarafından girilir ya da avukat onayından geçer; kod içinde **uydurma oran/tarife yoktur**.

## 1. UYAP → dosya oluşturma (6.1)

- **API:** `POST /uyap/match-queue/:id/create-case` `{ clientId (zorunlu uuid), type?, responsibleUserId?, title? }`.
  Kuyruktaki UYAP dosyası için `Case` açılır (`courtName`=birim, `fileNumber`=UYAP dosya no,
  `subject`=konu); tür verilmezse birim adından çıkarılır (`inferCaseType`: İcra → ICRA, Ceza → CEZA,
  Arabuluculuk → ARABULUCULUK, aksi DAVA). ICRA ise aynı transaction'da `EnforcementFile` de açılır
  (`takipTuru` → `trackingTypeFrom`, `alacakTutari`, `takipTarihi`, `borclu`). `UyapCaseLink` yazılır,
  kuyruk kaydı çözülür, sahnelenmiş UYAP olayları `resolveMatch` ile işlenir (`replayed`).
- **Eklenti:** `apps/uyap-extension/src/content/parsers/icra-dosya.ts` — `ICRA_DOSYA` sayfa türü. Dosya
  detay iskeleti (künye + taraflar) üzerine takip türü / takip tarihi / alacak tutarı / aşama okur;
  borçlu-alacaklı künyede yoksa taraflar tablosundan (rol metni) türetilir. Eşleşme dar: künyede
  takip etiketi ya da birimde "İcra" olmalı; hukuk dosyasında eşleşmez (yanlış pozitif testi).
  Tutar `"125.750,40 TL"` → `"125750.40"`. `SyncFileDto.icra` ile API'ye taşınır (`syncFilesSchema.icra`).
- **Web:** UYAP sayfası → eşleştirme kuyruğunda "Yeni dosya olarak aç" (müvekkil RemoteSelect + tür +
  başlık); sonuç bildirimi icra dosyası/işlenen olay sayısını gösterir.

## 2. Dönemli faiz (6.2)

- **Şema** (`20260928100000_faz6_uyap_icra_finans`): `InterestRatePeriod { kind YASAL|AVANS|TICARI_TEMERRUT|SOZLESME, validFrom, ratePercent, source, note }`
  (platform yönetir), `EnforcementFile.interestKind` (null → sabit `interestRate` eski davranış).
  Göç yalnız **YASAL %9 (3095 s. Kanun m.1, 01.01.2006'dan itibaren)** satırını ekler; **avans faizi
  koda gömülmez** (TCMB duyurusuna göre platform panelinden girilir).
- **Hesap:** `packages/legal-core/src/faiz.ts` `calculatePeriodInterest({principal, fromDate, toDate, periods})`
  — aralığı dönem sınırlarında böler, her dilimi o günkü oranla basit faizle (365 gün) işler, dilim
  adımlarını `steps` ile döner; tanımsız dönem → faizsiz dilim + uyarı. `enforcement/balance.service.ts`
  aynı bölme mantığını tahsilat kırılımlı bakiyeye uygular (`accrueOne` + dönem bölücü `accrue`);
  `interestKind` seçili ama oran yoksa faiz **hesaplanmaz** ve bakiye uyarısı bunu açıkça söyler.
- **Uçlar:** kiracı `GET /finance/faiz-oranlari?kind=`, `GET /finance/harc-tarifesi/:yil`; platform
  `GET/POST/DELETE /api/admin/v1/faiz-oranlari`, `GET/PUT /api/admin/v1/harc-tarifesi/:yil`
  (`PlatformHarcTarifesi`: peşin/karar-ilam binde, başvuru/vekâlet/maktu harçlar — yıl bazlı).

## 3. İİK süreleri + portföy (6.3)

- Yeni tetikleyiciler (`enforcement-deadlines.service.ts`): `HACIZ_UYGULAMA` → **İİK 106 satış isteme**,
  `KIYMET_TAKDIRI` → **İİK 128a kıymet takdirine itiraz (7 gün)**, ödeme emri tebliği → **İİK 68
  itirazın kaldırılması (6 ay)**, tahliye emri → **itiraz (7 gün)**. `createAction` kancaları IHALE /
  HACIZ_UYGULAMA / KIYMET_TAKDIRI işlemlerinde öneriyi yeniler; kural anahtarları `packages/legal-core/src/rules.ts`.
- `GET /enforcement/portfolio` (sabit yol, `:id`'den önce): toplam/açık dosya, aşama dağılımı, toplam
  asıl alacak, toplam tahsilat + oran, vadesi geçmiş süre sayısı, 14 gün içindeki süreler (10).
  Web icra listesinde "Portföy Özeti" kartı.

## 4. Tebligat (6.4)

- **Şema:** `Tebligat { channel UETS|KEP|PTT|ELDEN|EPOSTA|DIGER, direction GELEN|GIDEN, subject, counterparty, sentAt, servedAt, externalRef, deadlineRuleKey, deadlineId, documentId, note }`.
- **Servis:** `tebligat.service.ts` — `servedAt` + `deadlineRuleKey` birlikte varsa süre kural motorundan
  (`DeadlinesService.createFromRule`, ONAYLI) açılır ve kayda bağlanır; yöntem kanaldan türetilir
  (UETS/KEP/EPOSTA → `ETEBLIGAT`, PTT → `POSTA`, ELDEN/DİĞER → `ELDEN`). Aynı kayıt için süre iki kez
  açılmaz; süre motoru hata verirse kayıt durur, hata 400 ile görünür (sessiz yutma yok).
- **Sağlayıcı arayüzü:** `tebligat-saglayici.ts` — `TebligatSaglayici { key, configured, gonder(), sorgula() }`,
  `TEBLIGAT_SAGLAYICI=NOOP|UETS|KEP` (env). Sözleşme yokken Noop: `GET /tebligatlar/saglayici`
  bunu dürüstçe raporlar. PTT KEP / UETS yetkisi sonrası adaptör yazılır (dış bağımlılık tablosu).
- **Uçlar:** `GET/POST /cases/:caseId/tebligatlar`, `PATCH/DELETE /tebligatlar/:id`. Web dosya detayında
  "Tebligatlar" sekmesi (`components/tebligat-tab.tsx`): liste + "Bugün tebliğ edildi" + ekleme formu (kural seçici).

## 5. Finans (6.5)

- **Kronometre:** `TimeTimer` (kullanıcı başına `@unique`), `GET/DELETE /billing/time-entries/timer`,
  `POST …/timer/start|stop`. Durdurunca dakikaya **yukarı** yuvarlanmış (min 1) **TASLAK** zaman kaydı.
- **Timesheet onayı:** `TimeEntry.status TASLAK|ONAY_BEKLIYOR|ONAYLANDI|REDDEDILDI` (+ `approvedBy/At`,
  `rejectionReason`); mevcut kayıtlar göçte ONAYLANDI. `POST /billing/time-entries/:id/submit|approve|reject`,
  `GET /billing/time-entries/pending` (TIME_MANAGE_OTHERS). **Yalnız ONAYLANDI kayıtlar faturaya girer**
  (`invoices.service` süzgeci). Web zaman sayfası: kronometre kartı, durum rozetleri, "Onaya gönder",
  yönetici için "Onay Kuyruğu" kartı.
- **Storno:** `POST /billing/payments/:id/storno { reason }` — tahsilat **silinmez**; `stornoAt/By/Reason`
  yazılır, otomatik TAHSILAT finans hareketi kaldırılıp **IADE** hareketi düşülür, fatura ödeme durumu
  yeniden hesaplanır. `stornoAt` dolu satır fatura toplamına/bakiyeye **girmez**. Faturaya bağlı tahsilat
  için sert silme artık 400 ("storno kullanın"). Web fatura detayında "Storno" düğmesi + rozet.
- **Muhasebe CSV:** `GET /finance/export?format=luca|logo&from&to&clientId` (`finance-export.ts`):
  her hareket borç + alacak çift satır, TDHP varsayılan hesap planı (`DEFAULT_HESAP_PLANI`, ezilebilir),
  Luca `;` + TR ondalık + BOM, Logo `,` + İngilizce başlık. **TCKN/VKN alanı yok** (KVKK). Web finans
  sayfasında "Luca CSV" / "Logo CSV".
- **AAÜT / harç:** yıllık AAÜT işi mevcut (`aaut-yilbasi.job`); maktu harç tablosu platform yönetiminde
  (`PlatformHarcTarifesi`), kiracı salt okur.

## 6. Test ve doğrulama

- API: `faz6-contract.test.ts` (kaynak sözleşmeleri), `finance-export.test.ts`, `time-timer.service.test.ts`,
  `tebligat.service.test.ts`, `uyap-create-case.test.ts`; legal-core `faiz-donemli.test.ts` (3 dönemli
  fixture elle hesapla birebir). Eklenti `parsers.test.ts` (ICRA_DOSYA 3 test).
- Canlı duman (Docker test yığını): faiz oranları ucu, portföy, tebligat → süre açılması, kronometre
  start/stop → TASLAK kayıt → submit/approve, storno → fatura durumu, Luca/Logo CSV başlıkları,
  kuyruktan dosya oluşturma (icra) — `scratchpad/smoke_faz6.sh`.

## 7. Açık noktalar (sözleşme sonrası)

- Avans faizi ve ticari temerrüt oranları: platform panelinden TCMB duyurusuyla girilecek (kod uydurmaz).
- KEP/UETS adaptörü: PTT/UETS yetkisi sonrası; şu an Noop, kayıtlar elle.
- Luca/Logo hesap planı eşlemesi: ilk aktarımda büro muhasebecisi doğrular (varsayılan TDHP).
