# Modül 28 — HEPO (Sağlık, Güvenlik, Çevre) Uyum Hukuku

Kullanıcı yüzü: `apps/web/src/app/app/hepo` + `apps/web/src/lib/hepo-content.ts`.

## Kapsam

Müşteri şirketlere İSG/çevre/sağlık uyum hukuku hizmeti veren bürolar için:

1. **Yükümlülük kütüphanesi** — kanun maddesine bağlı yükümlülükler (6331 İSG, Çevre
   Kanunu, hasta hakları): sorumlu, periyot, yaptırım notu.
2. **Yasal takvim** — periyodik/bildirim yükümlülükleri, süre ve hatırlatma penceresi.
3. **Yaptırım matrisi** — ihlal → idari para cezası dayanağı + cezayı artıran nitelikler.
4. **Dava rehberi** — iş kazası maddi/manevi tazminat, idari ceza itirazı, çevre
   davaları: ispat yükü, süreler, strateji adımları.
5. **Kontrol listeleri** — sektörel (imalat, inşaat, sağlık, ofis).

## İlkeler

- **Deterministik içerik:** sayısal hukuki bilgiler sabit katalogdadir; uygulanabilirlik
  ve güncellik avukatın kontrolündedir (sayfa altında uyarı metni).
- **Arama:** tüm sekmelerde istemci tarafı AND araması.
- **Bağlantı:** Hesap Araçları (kıdem/faiz), Ajanda (hatırlatma), Müvekkiler entegrasyonu.

## Faz 2 — UYGULANDI (müvekkil bazlı takip)

- **Tek katalog kaynağı:** `packages/shared/src/hepo-catalog.ts` (`@nomosos/shared`
  aracılığıyla) — web arayüzünü VE API tohumlamasını besler.
- **Şema:** `HepoObligation` (ortak katalog, tenantId'siz; slug kimliğiyle idempotent
  tohumlama) + `HepoClientObligation` (kiracıya ait atama/durum; `@@unique([clientId,
  obligationId])`; migration `20260903210000_hepo_yukumluluk_takibi`).
- **API:** `apps/api/src/hepo/` — `GET /hepo/obligations`, `GET /hepo/clients/:id/obligations`
  (vadesi geçmiş işaretli), `GET /hepo/clients/:id/summary`, `POST` atama ve `PATCH` durum
  (HUKUKI rol; denetim izi HEPO_ASSIGN/HEPO_UPDATE). Yollar `HEPO_ROUTES` kataloğunda.
- **Web:** HEPO sayfasına "Müvekkil Takibi" sekmesi — müvekkil seçimi, durum kırılımı,
  atama (vade + not), "Yapıldı / Uygun değil / İhlal / Açık" durum düğmeleri.
- **Test:** `hepo.service.test.ts` (7): kiracı izolasyonu, mükerrer atama yasağı, durum
  kümesi doğrulaması, idempotent tohumlama, denetim izi.

## Faz 3 — UYGULANDI (vade hatırlatmaları)

- **İş:** `apps/api/src/scheduler/jobs/hepo-reminder.job.ts` (`hepo-reminder-daily`,
  varsayılan cron `0 7 * * *`) — açılışta kendiliğinden `ScheduledJob` tanımı üretilir
  (kayıt defteri: `job-registry.service.ts`).
- **Pencereler:** 30/7/1 gün kala `SURE_YAKLASIYOR`; vadesi geçenler için vade başına
  tek seferlik `SURE_GECTI` (30 gün geriye bakış). UYGUN durumundaki kayıtlar hatırlatılmaz.
- **Idempotentlik:** `hepoReminderKey`/`hepoOverdueKey` (`dedupe-key.ts`) — anahtar satır +
  pencere + alıcı + VADE GÜNÜ taşır; `HEPO:<satırId>` ad alanı Deadline kimlikleriyle
  çakışmaz. Bildirim türü bilinçli olarak süre türleridir (HEPO vadesi hukuken süredir).
- **Alıcı:** atamayı yapan kullanıcı; pasifse büro yönetimine (ADMIN/PARTNER) düşer;
  yönetici yoksa `alicisiz` olarak raporlanır (DeadlineReminderJob ile aynı çözümleme).
- **Test:** `hepo-reminder.job.test.ts` (7) — UYGUN hariç tutma, ikinci koşuda ATLANDI,
  vade düzelince yeni anahtar, yönetime düşme, alıcısız, tek seferlik SURE_GECTI.

## Faz 4 — UYGULANDI (uyum raporu)

- **Rapor:** `hepo-uyum` (`apps/api/src/reports/builders/hepo-uyum.report.ts`) — katalog ve
  kayıt defterine eklendi; `GET /reports/catalog` rol süzgecinden geçirdiği için rapor
  arayüzünde kendiliğinden görünür.
- **Kapsam:** müvekkil kırılımı (uyumlu/açık/uygun değil/ihlal/vadesi geçen/uyum oranı),
  konu kırılımı (İSG/Çevre/Sağlık), vadesi geçen yükümlülükler detayı (gecikme günüyle).
- **Dönem yorumu:** ANLIK FOTOĞRAF — referans an dönemin SON GÜNÜ; durum geçmişi
  tutulmadığı için dönem içi değişim üretilmez (notlar alanında beyan edilir).
- **Ölçüler:** toplam, uyumlu, vadesi geçen (kritik), ihlal (kritik) — tamamen
  deterministik; AI yalnız yorum katmanında (rapor yorumlama ucu) yer alır.
- **Erişim:** REPORT_ACCESS.OPERASYON (STAJYER dâhil — para içermez); `muvekkilId`
  daraltması ve satır sınırı desteklenir.
- **Test:** `hepo-uyum.report.test.ts` (5) — UYGUN hariç tutma, uyum oranı paydası,
  gecikme günü, kiracı/müvekkil süzgeci, boş havuz.

## Faz 5 — UYGULANDI (risk motoru entegrasyonu)

- **Sinyal:** `HEPO_CLIENT_OVERDUE` (`risk.rules.ts` → HUKUKİ boyutu) — müvekkilin vadesi
  geçmiş ve UYGUN işaretlenmemiş İSG/çevre/sağlık yükümlülüğü başına 10 puan (azami 20).
  İş kazası, meslek hastalığı ve İSG/çevre ceza davalarında müvekkilin uyum ihlali, hukuki
  konumu doğrudan zayıflatan bir ispat gerçeğidir.
- **Hiç atanmamış ≠ uyumlu:** müvekkile hiç yükümlülük atanmamışsa sinyal puan ÜRETMEZ;
  değer "atanmış yükümlülük yok" olarak görünür (kural yalnız VAROLAN veriden türer).
- **Veri kaynağı:** `RiskService.loadSnapshot` müvekkil başına iki sayım yapar (toplam ve
  vadesi geçmiş açık); gece risk işi aynı anlık görüntüyü kullanır.
- **Test:** `risk.rules.test.ts` (3 yeni) — puan merdiveni ve tavan, uyumlu/atanmamış
  müvekkilde 0 puan, açıklamanın kaynak beyanı.

## Sonuç

Modül uçtan uca tamam: statik bilgi katmanı (paylaşılan katalog) → DB destekli müvekkil
takibi → otomatik vade hatırlatmaları → deterministik uyum raporu → risk motoru sinyali.
