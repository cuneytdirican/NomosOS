# Faz 8 — Büyüme (self-signup HARİÇ)

Üç persona planının son fazı. Amaç: satış vitrini, sözleşme seti, destek/SLA, veri kaynağı genişlemesi ve
büro göçü. Self-signup bilinçli olarak **dışarıda** (kullanıcı kararı: demo talebi → manuel açılış).

## 8A — Vitrin ve SEO

| Parça | Uygulama |
|---|---|
| Kamusal uçlar | `GET /api/v1/public/plans` (PlanTier'dan; aylık/yıllık/aya bölünmüş yıllık, KDV hariç %20 notu, BYO-LLM %30 indirim bilgisi) ve `GET /api/v1/public/status` (readiness bileşenleri + TUM duyuruları). `@Public()`, `Cache-Control`, kiracı verisi yok. |
| Fiyatlandırma | `/fiyatlandirma` sunucu tarafında `public/plans` okur (5 dk revalidate); API yoksa dipnotla düşer. Seed: `annualPricePerUser = aylık × 10`. |
| Sayfalar | `/hakkimizda`, `/iletisim`, `/eklenti` (UYAP köprüsü indirme + SHA-256), `/durum` (30 sn'de bir yenilenen durum panosu), `/blog` + `/blog/[slug]` (3 yazı, sınırlı Markdown; ürün kapsamıyla birebir — UYAP'a gönderim vaadi yok). |
| SEO | `sitemap.ts` (statik + blog + sözleşmeler), `robots.ts` (`/app`, `/giris`, `/demo-giris`, `/sifre-*`, `/api/` kapalı), `opengraph-image.tsx`, `metadataBase`. |

## 8B — Sözleşme seti + TermsAcceptance

- Dört metin tek kaynakta: `packages/shared/src/legal-docs.ts` (Hizmet/EULA, Veri İşleme Protokolü, Hizmet
  Seviyesi, Mesafeli Satış). Her metin `version`, `updatedAt`, `required` ve **taslak uyarısı** taşır:
  metinler avukat onayından geçmeden bağlayıcı sayılmaz (dış bağımlılık tablosundaki "Hukuk metinleri").
- Kamusal sayfalar: `/sozlesmeler` (dizin) ve `/sozlesmeler/[slug]`; footer "Veri İşleme Protokolü" artık gerçek sayfa.
- Kabul kaydı: `TermsAcceptance` (ekleme-yalnız; `docKey`, `version`, `textHash` = kanonik metnin SHA-256'sı,
  IP, user-agent). Metin değişince özet değişir → "güncel değil" → yeniden kabul istenir.
- API: `GET /terms/docs`, `GET /terms` (durum + `missingRequired`), `POST /terms/accept` (ONAY rolü: ADMIN/PARTNER;
  sürüm uyuşmazlığı 400). Platform: `GET /api/admin/v1/tenants/:id/terms` (`tenant.view`, üstveri).
- Web: Ayarlar → Sözleşmeler (oku / büro adına kabul / geçmiş) + uygulama şeridi (`TermsBanner`) zorunlu metin
  eksikse — işi durdurmaz. Admin: tenant detayında "Sözleşmeler" kartı.

## 8C — Destek talepleri + SLA sayacı + /durum

- `SupportTicket` + `SupportTicketMessage`. SLA yalnız **ilk platform yanıtını** ölçer, takvim saatiyle:
  Kritik 2 sa · Yüksek 8 sa · Normal 24 sa · Düşük 72 sa (`packages/shared/src/support.ts`, tek kaynak).
- Kiracı: `GET/POST /support/tickets`, `GET /support/tickets/:id`, `POST :id/messages`, `POST :id/close`
  (kapatma: açan ya da ONAY rolü). İç notlar (`internal=true`) kiracıya **dönmez**.
- Platform: `GET /api/admin/v1/support-tickets` (kuyruk + `acik/slaIhlal/yanitBekleyen`), `GET :id`,
  `POST :id/messages` (`internal` ile iç not — SLA'yı durdurmaz), `PATCH :id` (durum/öncelik/atama; öncelik
  değişince hedef açılış anına göre yeniden hesaplanır). Yetkiler `support.tickets.view/update`
  (SUPPORT_AGENT dahil; iki matris birebir — sözleşme testi).
- Admin `/destek` sayfası (kuyruk, SLA rozeti, yanıt/iç not, durum/öncelik/üstlen); web Ayarlar → Destek.
- `/durum` (8A) readiness'e dayanır; destek SLA metni sözleşme setindeki Hizmet Seviyesi belgesiyle uyumludur.

## 8D — Danıştay, telemetri, gelir metrikleri

- **Danıştay canlı kaynağı:** `YargitayLiveAdapter` üçüncü yapılandırmayla (`DANISTAY_LIVE_CONFIG`,
  `karararama.danistay.gov.tr`): aynı `/aramalist` + `/getDokuman` zarfı, arama gövdesi anahtar kelime
  **dizileriyle** (`andKelimeler`), `/arama` ön-adımı yok. İçtihat araması artık **üç kaynağı paralel** çalıştırır
  (Yargıtay + Emsal/UYAP + Danıştay); bir kaynağın hatası diğerini düşürmez, hepsi düşerse `liveError`.
  Web rozeti "DANIŞTAY CANLI"; `GET /caselaw/live/:id?source=DANISTAY_CANLI`.
  **Canlı doğrulandı (Docker test yığını, 5 Eylül 2026):** "idari para cezası" araması üç kaynaktan 15 sonuç
  (DANISTAY_CANLI dahil); Danıştay karar metni okunuyor. İki canlı bulgu koda işlendi: (1) Danıştay
  `getDokuman` ucu `arananKelime` parametresi olmadan 400 döner → `documentQuery` ile eklenir; (2) geçersiz
  kimlikte 200 + HTML hata sayfası ("Hata! ...") döner → metin diye gösterilmez, 502'ye çevrilir; zarf
  `<style>/<script>` blokları taşır → temizleyici düşürür. Kaynak hataları artık 500 değil 502 (`BadGatewayException`).
- **Telemetri:** `usage-snapshot-daily` işi zaten kayıtlı (UsageSnapshotService.collectDaily, 02:00);
  8D'de doğrulandı ve belgelendi.
- **Gelir:** MRR artık yıllık aboneliği aya böler (`annualPricePerUser / 12`; yoksa aylık fiyat) — ARR = MRR×12
  tutarlı. Yatırımcı raporuna `revenueChurnRate30d` (iptal edilen aya normalize gelir / (MRR + iptal)) ve
  `churnedMrr30d` eklendi; logo churn korunur.
- **Mevzuat/AAÜT seed:** UYDURMA rakam girilmez (kullanıcı kararı). AAÜT tarifesi platform tarafından
  `/yargi/aaut` ekranından girilir; mevzuat havuzu RG izleyicisi + onay masasıyla dolar. Bu fazda seed'e
  sayı eklenmedi; belgelendi.

## 8E — Veri göçü sihirbazı

- `packages/shared/src/import.ts`: kolon sözleşmesi (Türkçe/İngilizce takma adlar, aksan/büyük-küçük bağımsız),
  şablon CSV üretimi, rotalar, tavanlar (2000 satır, ZIP'te 300 belge / 200 MB).
- API `apps/api/src/import/`: bağımlılıksız CSV ayrıştırıcı (ayırıcı otomatik `;` `,` sekme; RFC 4180 tırnak; BOM),
  `GET /import/template/:kind`, `POST /import/preview` (**dry-run — hiçbir şey yazmaz**; satır başına
  EKLE/ATLA/HATA + not), `POST /import/run` (ONAY rolü), `POST /import/zip?dryRun=1|0`.
  - Dosyalar: müvekkil adıyla eşleme (yoksa gerçek kişi olarak oluşturulur), mevcut esas no → ATLA,
    sorumlu avukat e-postayla.
  - Duruşmalar: esas no ya da başlıkla dosya eşleme; tarih `GG.AA.YYYY [SS:DD]`/ISO; geçmiş tarih + durum boş
    → YAPILDI; aynı dosyada aynı gün mevcut celse → ATLA (HearingsService kuralıyla aynı; geçmiş tarih
    reddi göçte uygulanmaz, doğrudan yazılır).
  - Belgeler: ZIP + isteğe bağlı `belgeler.csv`; klasör adı esas no olabilir. Her dosya `DocumentsService.upload`
    hattından geçer (tür/boyut kapısı, disk kotası, kopya → ATLA, otomatik aksiyon hattı).
- Web: Ayarlar → Veri Göçü (tür seç → şablon indir → CSV/ZIP → önizle → çalıştır; sonuç tablosu).
- Denetim: `DATA_IMPORT` kaydı (tür, satır, eklenen, atlanan, hata).

## Göçler

| Göç | İçerik |
|---|---|
| `20260929150000_faz8b_sozlesme_kabul` | `TermsAcceptance` |
| `20260929160000_faz8c_destek_talebi` | `SupportTicket`, `SupportTicketMessage` |

## Testler

- `faz8-contract.test.ts` (8A–8E), `terms.service.test.ts` (3), `support-tickets.service.test.ts` (3 + SLA),
  `danistay-live.adapter.test.ts` (3), `import.service.test.ts` (6). API toplam 1500+, web 100, admin 3, lint 0.

## Canlı doğrulama

`scratchpad/smoke_faz8.sh` (kamusal uçlar, sözleşme kabulü, destek + SLA, üç kaynaklı arama, göç önizleme/çalıştırma,
ZIP) ve Playwright `pw/faz8-web.js` (vitrin sayfaları, Ayarlar → Sözleşmeler/Destek/Veri Göçü, admin /destek).

## Dış bağımlılıklar (değişmedi)

Hukuk metinleri avukat onayı; Danıştay canlı doğrulama; lisanslı içtihat verisi; AAÜT/tarife girişleri platform
tarafından.
