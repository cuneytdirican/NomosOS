# Faz 3 — Gelir Hattı (6 Eylül 2026)

Firma sahibi personasının "para toplayamayan SaaS" bulgularını kapatan paket. Plan:
`~/.claude/plans/wiggly-giggling-lighthouse.md` (Faz 3). Kararlar: iyzico **adaptör + sözleşme
testi** (canlı doğrulama sandbox anahtarıyla), SIMULASYON test yığınında uçtan uca; sağlayıcı
yoksa **dürüst 503 + havale/EFT + panelden "ödendi işaretle"**.

## 1. Veri modeli (migration `20260926100000_faz3_gelir_hatti`)

- `InvoiceRecord`: `type` (ABONELIK / KREDI_PAKETI / PLAN_FARKI), `description`, `periodStart/End`,
  `discountAmount`, `couponCode`, `dueDate`, `paidAt`, `metaJson`; **`@@unique([tenantId, type,
  periodStart])`** → dönem faturası çift üretilemez (P2002 → "zaten var").
- `PaymentRecord`: `invoiceRecordId`, `checkoutToken` (unique; sağlayıcı `conversationId`),
  `providerPayload`.
- `Subscription`: `billingInterval` (AYLIK/YILLIK), `couponCode`. `PlanTier.annualPricePerUser`.
- `Coupon` (YUZDE/SABIT; kapsam TUM/ABONELIK/KREDI; tarih aralığı; kullanım sınırı; sayaç ödeme anında).
- `EInvoiceSettings` (tenant başına entegratör; kimlik bilgisi AES-256-GCM).
- `NotificationKind` += ODEME_GECIKTI, DENEME_BITIYOR, FATURA_KESILDI.

## 2. Fiyatlandırma — `billing/subscription-pricing.ts` (saf)

- Aylık: fiyat × koltuk. Yıllık: `annualPricePerUser × koltuk`; tanımsızsa 12 × aylık × (1 − %15).
- **BYO-LLM %30** (pazarlama vaadi): büro aktif kendi AI sağlayıcısına sahipse abonelik
  faturasına otomatik; kuponla birleşmez, büyük olan uygulanır. KDV %20.
- **Pro-rata**: dönem ortasında yükseltmede kalan gün oranında `PLAN_FARKI` faturası; düşürmede
  fark yok (executor `issueProRataInvoice`).

## 3. Dönem faturası + dunning — `subscription-renewal-daily`

- Dönem sonuna **7 gün kala** `SubscriptionInvoiceService.issueForPeriod` (numaralı, GONDERILDI,
  vade = dönem başı + 7 gün) + yöneticilere `FATURA_KESILDI` (Faz 2 dağıtım işi e-postalar).
- Dönem sonu geçen ACTIVE → PAST_DUE (mevcut). PAST_DUE **1/3/7. gün** `ODEME_GECIKTI`
  (dedupe `ODEME_GECIKTI:{sub}:{dönem}:g{gün}:{user}`), 14. gün Faz 0 guard'ı 402'ye çeker.
  TRIAL bitişine 3 gün kala `DENEME_BITIYOR`.

## 4. Checkout + kesinleştirme — `platform-billing/platform-checkout.service.ts`

- `POST /credits/purchase {packageKey, couponCode?}` → fatura (KREDI_PAKETI) + `PaymentRecord`
  BEKLIYOR → sağlayıcı. **Krediler ödeme kesinleşince yüklenir** (`CreditService.loadPaidPackage`,
  transaction içinde). Eski "anında yükle, taslak fatura" gelir kaçağı kapandı.
- `POST /subscription/invoices/:id/pay` aynı akış; ABONELIK ödenince `currentPeriodStart/End`
  ilerler, durum ACTIVE, `trialEndsAt` temizlenir.
- `settle()` idempotent; sağlayıcı tutarı ≠ fatura tutarı → ödeme BASARISIZ, fatura ödenmez (409).
- iyzico: `billing/iyzico.adapter.ts` (Checkout Form initialize/retrieve, IYZWSv2 imza, Webhook V3
  imza sabit zamanlı). `POST /billing/odeme/callback` (form `token`) → sonuç → web
  `/app/ayarlar/abonelik?odeme=…`; `POST /billing/odeme/webhook` imzalı.
- `ODEME_SAGLAYICI`: SIMULASYON (anında) / IYZICO / tanımsız (503).
- Panel: `POST /api/admin/v1/invoices/:id/mark-paid` (havale/EFT), `/coupons` CRUD,
  `/subscriptions/:id/issue-invoice` (dönem faturasını şimdi kes).

## 5. Plan modülü kapısı — `@RequiresModule` + `ModuleAccessGuard`

- `PlanTier.featuresJson.modules` zorlanır (60 sn önbellek): icra (`/enforcement*`, `/assets`),
  finans (`/finance`), faturalama (`/billing`), sso (`PUT/POST /security/sso*`). Abonelik/plan yoksa
  kısıt yok; 403 mesajı plan adını ve yükseltme yolunu söyler.

## 6. Fatura PDF + e-Fatura ayarı

- `billing/pdf/invoice-pdf.ts` (pdfkit + DejaVu Sans; Türkçe glifler). `GET /billing/invoices/:id/pdf`
  (büro → müvekkil), `GET /subscription/invoices/:id/pdf` (platform → büro). Belge "bilgi amaçlı
  döküm" ibaresi taşır; resmî e-belge entegratör üzerinden.
- `GET/PUT /billing/e-invoice/settings` (ADMIN/PARTNER): `providerKey` (noop | rest), `baseUrl`,
  `apiKey` (şifrelenir; yanıtta yok), `senderAlias`. `EInvoiceService.resolve(tenantId)` artık
  async; sıra: tenant ayarı → `EINVOICE_PROVIDER` → noop. `RestEInvoiceAdapter` köprü sözleşmesi
  (`/taxpayers/{vkn}`, `/invoices` + Idempotency-Key, `/invoices/{ref}/status|cancel|pdf`) —
  sözleşme yapılan entegratörün uçlarına eşlenir.

## 7. Arayüz

- Web **Ayarlar → Abonelik**: plan/durum/dönem/modüller, sonraki fatura önizlemesi (indirim
  gerekçesiyle), aralık (aylık/yıllık), kupon, fatura listesi (Öde / PDF). AI Kullanımı satın alma
  ödeme sayfasına yönlenir.
- Admin **Kuponlar** (oluştur/pasifleştir) ve **Platform Faturaları** (ödendi işaretle).

## 8. Doğrulama

- Birim/sözleşme: `subscription-pricing` (7), `iyzico.adapter` (6), `module-access.guard` (4),
  `platform-checkout.service` (6), `subscription-renewal.job` (4), `rest-e-invoice.adapter` (3),
  `invoice-pdf` (2), `faz3-gelir-hatti.contract` (8).
- Canlı (Docker test yığını, SIMULASYON): kredi paketi satın alma → fatura ODENDI + kredi; dönem
  faturası elle kesme → Öde → abonelik dönemi ilerler; PDF; kupon; modül kapısı (SOLO plana
  geçirilen büroda icra 403); panel kupon/ödendi işaretle.

**Canlı sonuç (5 Eylül 2026, test yığını, SIMULASYON):** kupon → önizleme %10; kredi paketi
satın alma → fatura ODENDI + cüzdan +500 (ödeme kesinleşince); dönem faturası kes (idempotent) →
Öde → dönem ilerledi, tekrar ödeme 409; havale ile "ödendi işaretle"; modül kapısı SOLO → icra 403,
BURO → 200; e-Fatura ayarı şifreli ve yanıta sızmıyor; PDF'ler Türkçe glifli (DejaVu). Web ve admin
ekranları Playwright ile doğrulandı. Not: eski akıştan kalan numarasız TASLAK kredi faturaları
"Öde" ile kapatılabilir (kredi zaten yüklenmişti; yalnız alacak kapanır).
