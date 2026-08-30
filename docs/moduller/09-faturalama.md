# Modül 09 — Faturalama, e-Fatura / e-Arşiv

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 10 `[P2, 8/10]`

## Amaç

Büronun ücret sözleşmelerini (sabit ücret, başarı primi, saatlik, dosya bazlı, aylık
danışmanlık), zaman kayıtlarını (timesheet) ve fatura sürecini yönetmek. Tahakkuk
verisi Finans modülünden (Modül 08) gelir; bu modül tahakkuku faturaya dönüştürür,
GİB'e uygun e-Fatura/e-Arşiv belgesi olarak gönderir ve ödeme takibini yapar. Bu katman
ürünü "AI uygulaması"ndan "hukuk bürosu işletim sistemi"ne taşıyan katmandır.

e-Fatura/e-Arşiv entegrasyonu **GİB özel entegratör** yaklaşımıyla kurulur: NomosOS
doğrudan GİB'e bağlanmaz; her tenant kendi özel entegratör hesabını (örn. Logo,
Foriba/Sovos, Uyumsoft, Paraşüt tarzı sağlayıcılar) bağlar. Kod tarafında tek bir
**sağlayıcı-bağımsız `EInvoiceAdapter` arayüzü** tanımlanır; her sağlayıcı bu arayüzün
bir implementasyonudur. Böylece yeni sağlayıcı eklemek çekirdek koda dokunmadan
mümkün olur (AiProviderConfig'in BYO-LLM desenine paraleldir).

Saatlik çalışan bürolar için timesheet birinci sınıf vatandaştır: her `TimeEntry` bir
dosyaya ve kullanıcıya bağlanır, onaylanır, faturalanabilir işaretlenir ve fatura
satırına dönüşür. Fatura kesildikten sonra zaman kaydı kilitlenir.

## Kullanıcı Hikâyeleri

1. **Partner olarak**, müvekkille yapılan ücret sözleşmesini tipiyle (sabit/saatlik/
   başarı primi/dosya bazlı/aylık danışmanlık) kaydetmek istiyorum ki faturalama
   kuralları sözleşmeden otomatik türesin.
2. **Avukat olarak**, gün içinde çalıştığım dosyalara süre girmek istiyorum ki saatlik
   sözleşmeli müvekkillere eksiksiz fatura kesilebilsin.
3. **Avukat olarak**, zaman kaydını zamanlayıcı (start/stop) ile tutmak istiyorum ki
   akşam hafızadan süre uydurmak zorunda kalmayayım.
4. **Partner olarak**, ay sonunda onaylanmamış zaman kayıtlarını toplu inceleyip
   onaylamak istiyorum ki faturaya yalnızca kontrol edilmiş süre girsin.
5. **Sekreter olarak**, seçtiğim tahakkuk ve zaman kayıtlarından taslak fatura
   oluşturmak istiyorum ki fatura hazırlığı dakikalar sürsün.
6. **Partner olarak**, taslak faturayı onaylayıp tek tıkla e-Fatura/e-Arşiv olarak
   göndermek istiyorum ki GİB portalına ayrıca girmeyeyim.
7. **Admin olarak**, büronun özel entegratör hesabını (API anahtarı, test/canlı ortam)
   tenant ayarlarından bağlamak istiyorum ki sağlayıcı değişse bile modül aynı çalışsın.
8. **Partner olarak**, vadesi geçen faturaları ve kısmi ödemeleri listelemek istiyorum
   ki tahsilat aksiyonlarını planlayayım.
9. **Avukat olarak**, başarı primli sözleşmede dava sonucunu girince prim tahakkukunun
   otomatik hesaplanmasını istiyorum ki sözleşme hükmü unutulmasın.
10. **Sekreter olarak**, ödemesi gelen faturayı ödeme kaydıyla kapatmak istiyorum ki
    Finans modülündeki bakiye anında güncellensin.

## Ekranlar ve UX

### 1. Faturalar — `/app/billing/invoices`
Bileşenler: durum sekmeleri (Taslak, Gönderildi, Ödendi, Vadesi Geçti, İptal),
fatura tablosu (no, müvekkil, tutar, KDV, durum, GİB durumu), "Yeni Fatura" sihirbazı.

### 2. Fatura Detayı — `/app/billing/invoices/:invoiceId`

```
┌──────────────────────────────────────────────────────────────┐
│ Fatura #NMS2026000123   ABC Holding A.Ş.    [Gönder] [PDF]   │
│ Tip: e-Fatura  ·  GİB Durumu: ✅ Kabul  ·  Vade: 15.09.2026  │
├──────────────────────────────────────────────────────────────┤
│ Satır                          Miktar  Birim     KDV   Tutar │
│ Danışmanlık ücreti (Ağustos)     1     150.000   %20 180.000 │
│ Av. C.D. — dilekçe hazırlığı    6,5 sa   5.000   %20  39.000 │
│ Masraf yansıtma (2026/145 harç)  1       4.250   %0    4.250 │
├──────────────────────────────────────────────────────────────┤
│ Ara Toplam: 196.750  KDV: 37.800  Stopaj: -    TOPLAM 223.250│
│ Ödemeler: 100.000 (05.09)  ·  Kalan: 123.250                 │
└──────────────────────────────────────────────────────────────┘
```

### 3. Zaman Kayıtları — `/app/billing/time`
Bileşenler: haftalık timesheet ızgarası (satır: dosya, sütun: gün), zamanlayıcı
widget'ı (global header'da), onay kuyruğu (PARTNER görünümü), faturalandı rozeti.

### 4. Ücret Sözleşmeleri — `/app/billing/fee-agreements`
Bileşenler: müvekkil bazlı sözleşme listesi, tip'e göre dinamik form (saatlik→tarife
tablosu; başarı primi→oran + baz; danışmanlık→aylık bedel + gün).

### 5. e-Fatura Ayarları — `/app/settings/e-invoice`
Bileşenler: sağlayıcı seçimi (adaptör listesi), kimlik bilgileri, test/canlı anahtarı,
"Bağlantıyı Sına" butonu, mükellef e-Fatura kayıt sorgusu.

## Veri Modeli

### FeeAgreement (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| client_id | UUID FK→Client | |
| case_id | UUID FK→Case NULL | Dosya bazlı sözleşmede dolu |
| agreement_type | ENUM | FIXED, SUCCESS_FEE, HOURLY, PER_CASE, MONTHLY_RETAINER |
| fixed_amount | DECIMAL(18,2) NULL | FIXED / PER_CASE / MONTHLY_RETAINER bedeli |
| success_fee_percent | DECIMAL(5,2) NULL | Başarı primi oranı |
| success_fee_base | ENUM NULL | JUDGMENT_AMOUNT, COLLECTED_AMOUNT |
| currency | CHAR(3) | Varsayılan TRY |
| vat_rate | DECIMAL(4,2) | Varsayılan 20.00 |
| withholding_rate | DECIMAL(4,2) NULL | Stopaj (serbest meslek makbuzu senaryosu için not alanı) |
| billing_day | INT NULL | Danışmanlıkta tahakkuk günü |
| start_date / end_date | DATE | end_date NULL = süresiz |
| status | ENUM | ACTIVE, EXPIRED, TERMINATED |
| document_id | UUID FK→Document NULL | Islak/e-imzalı sözleşme |

### FeeAgreementRate (yeni — saatlik tarife)

| Alan | Tip | Açıklama |
|---|---|---|
| id / fee_agreement_id | UUID | |
| role | ENUM | PARTNER, LAWYER, TRAINEE — rol bazlı tarife |
| user_id | UUID FK→User NULL | Kişiye özel tarife rolü ezer |
| hourly_rate | DECIMAL(18,2) | |

### TimeEntry (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| user_id | UUID FK→User | Çalışan |
| case_id | UUID FK→Case NULL | client_id ile en az biri zorunlu |
| client_id | UUID FK→Client | |
| activity_date | DATE | |
| duration_minutes | INT | 6 dk (0,1 saat) hassasiyete yuvarlanır |
| description | TEXT | Fatura satırına taşınır |
| billable | BOOLEAN | |
| status | ENUM | DRAFT, SUBMITTED, APPROVED, BILLED |
| invoice_line_id | UUID FK→InvoiceLine NULL | |

### Invoice / InvoiceLine / Payment (yeni)

| Entity | Önemli alanlar |
|---|---|
| Invoice | id, tenant_id, client_id, invoice_no (tenant içinde seri+sıra), invoice_type ENUM(E_FATURA, E_ARSIV), issue_date, due_date, subtotal, vat_total, grand_total, currency, status ENUM(DRAFT, APPROVED, SENT, ACCEPTED, REJECTED, PAID, PARTIALLY_PAID, CANCELLED), gib_uuid, gib_status, provider_ref, sent_at |
| InvoiceLine | id, invoice_id, line_type ENUM(FEE, TIME, EXPENSE_REFLECTION, RETAINER, SUCCESS_FEE), description, quantity DECIMAL(10,2), unit_price, vat_rate, line_total, financial_entry_id FK→FinancialEntry NULL, case_id NULL |
| Payment | id, tenant_id, invoice_id, amount, currency, payment_date, method ENUM(BANK_TRANSFER, CREDIT_CARD, CASH, OTHER), bank_ref, financial_entry_id FK→FinancialEntry (otomatik COLLECTION kaydı) |

### EInvoiceProviderConfig (yeni — tenant başına)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | Tenant başına bir aktif kayıt |
| provider_key | VARCHAR | Adaptör anahtarı (örn. `sovos`, `logo`, `uyumsoft`, `mock`) |
| credentials | JSONB (şifreli) | API anahtarı/kullanıcı — at-rest şifreli, log'a yazılmaz |
| environment | ENUM | TEST, PRODUCTION |
| default_serial | VARCHAR | Fatura seri ön eki (örn. NMS) |
| is_active | BOOLEAN | |

### EInvoiceAdapter arayüzü (kod sözleşmesi)

```
interface EInvoiceAdapter {
  checkTaxpayer(vkn: string): Promise<{isEInvoiceUser: boolean; alias?: string}>
  sendInvoice(invoice: UblInvoiceDto): Promise<{providerRef: string; gibUuid: string}>
  getStatus(providerRef: string): Promise<GibStatus>   // SENT|ACCEPTED|REJECTED|CANCELLED
  cancelInvoice(providerRef: string, reason: string): Promise<void>
  downloadPdf(providerRef: string): Promise<Buffer>
}
```

## AI Yetenekleri

### TIME_ENTRY_SUGGESTION
- **Girdi:** Kullanıcının o günkü sistem aktiviteleri (açtığı dosyalar, ürettiği belgeler, tamamladığı görevler — yalnızca meta veri).
- **Çıktı:** Taslak zaman kaydı önerileri (dosya, tahmini süre, açıklama). Kullanıcı onaylamadan kayıt oluşmaz.
- **KVKK:** Belge içeriği gönderilmez; yalnızca başlık ve dosya no gider.

### INVOICE_DESCRIPTION_DRAFT
- **Girdi:** Seçilen tahakkuk + zaman kayıtları.
- **Çıktı:** Müvekkile anlaşılır, profesyonel Türkçe fatura satır açıklamaları.
- **KVKK:** Karşı taraf gerçek kişi adları maskeleme hattından geçer; tutarları AI değiştiremez.

## İş Kuralları

1. Fatura tutarları deterministik hesaplanır (satır toplamı + KDV); AI hiçbir tutar alanına yazamaz.
2. `invoice_type` seçimi otomatiktir: alıcı VKN'si `checkTaxpayer` ile e-Fatura mükellefiyse E_FATURA, değilse E_ARSIV.
3. DRAFT dışındaki fatura satırları değiştirilemez; SENT sonrası düzeltme yalnızca `cancelInvoice` + yeni fatura ile yapılır.
4. Fatura numarası tenant + seri bazında ardışıktır ve APPROVED anında atanır (taslaklar numara tüketmez).
5. TimeEntry, APPROVED olmadan faturaya eklenemez; faturaya eklenince BILLED olur ve kilitlenir; fatura iptalinde APPROVED'a geri döner.
6. Onay yetkisi: TimeEntry onayı PARTNER (veya tenant ayarıyla yetkili AVUKAT); fatura APPROVED→SENT geçişi yalnızca PARTNER/ADMIN.
7. Payment kaydı oluşunca aynı transaction içinde `FinancialEntry(COLLECTION)` yazılır; toplam ödemeler grand_total'a ulaşınca fatura PAID olur.
8. SUCCESS_FEE tahakkuku, dosyaya sonuç (kazanılan/tahsil edilen tutar) girildiğinde `success_fee_percent × base` formülüyle önerilir; PARTNER onayıyla kesinleşir.
9. Sağlayıcı çağrıları idempotent anahtarla yapılır; `sendInvoice` zaman aşımında durum `getStatus` ile mutabakat edilmeden yeniden gönderilmez (çift fatura koruması).
10. `credentials` alanı API yanıtlarında asla dönmez; `AuditLog`'a yalnızca provider_key ve environment yazılır.
11. Vadesi geçen fatura (due_date < bugün, PAID değil) gecelik işle işaretlenir ve Görev modülünde tahsilat görevi önerilir.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET/POST | /api/v1/billing/fee-agreements | Sözleşme listele/oluştur |
| PATCH | /api/v1/billing/fee-agreements/:id | Güncelle / feshet |
| GET/POST | /api/v1/billing/time-entries | Timesheet listele/oluştur |
| POST | /api/v1/billing/time-entries/:id/submit | Onaya gönder |
| POST | /api/v1/billing/time-entries/approve | Toplu onay (id listesi) |
| POST | /api/v1/billing/invoices | Taslak fatura oluştur (kaynak: entry/time id'leri) |
| GET | /api/v1/billing/invoices/:id | Detay + GİB durumu |
| POST | /api/v1/billing/invoices/:id/approve | Onayla (numara atanır) |
| POST | /api/v1/billing/invoices/:id/send | e-Fatura/e-Arşiv gönder |
| POST | /api/v1/billing/invoices/:id/cancel | İptal |
| GET | /api/v1/billing/invoices/:id/pdf | PDF indir |
| POST | /api/v1/billing/invoices/:id/payments | Ödeme kaydet |
| GET/PUT | /api/v1/settings/e-invoice | Sağlayıcı yapılandırması |
| POST | /api/v1/settings/e-invoice/test | Bağlantı sınama |
| GET | /api/v1/billing/taxpayer-check?vkn= | Mükellef e-Fatura sorgusu |

## Diğer Modüllerle İlişkiler

- **Modül 08 Finans:** Tahakkuklar fatura kaynağıdır; ödemeler COLLECTION olarak geri yazılır. Fatura kesilen tahakkuk `invoice_id` ile bağlanır.
- **Modül 01 Müvekkil CRM:** VKN/vergi dairesi ve fatura adresi müvekkil kartından okunur.
- **Modül 10 Portal:** Müvekkil, Ödemeler ekranında fatura PDF'ini ve kalan bakiyeyi görür.
- **Görev Modülü:** Vadesi geçen fatura tahsilat görevi üretir.
- **Modül 21 Sözleşme:** Ücret sözleşmesi belgesi e-imza akışından gelebilir.

## Kabul Kriterleri

1. 5 sözleşme tipi de kaydedilebiliyor; saatlik tipte rol ve kişi bazlı tarife tanımlanabiliyor.
2. Zaman kaydı DRAFT→SUBMITTED→APPROVED→BILLED akışını izliyor; BILLED kayıt düzenleme denemesi 409 döndürüyor.
3. Taslak fatura, seçilen tahakkuk ve zaman kayıtlarından doğru satırlar ve doğru KDV toplamıyla oluşuyor (birim testli hesap servisi).
4. Mükellef sorgusu e-Fatura kullanıcısında E_FATURA, değilse E_ARSIV tipi atıyor (mock adaptörle test).
5. `mock` adaptörle uçtan uca akış çalışıyor: send→ACCEPTED durumu→PDF indirme; adaptör arayüzü ikinci bir sahte sağlayıcıyla da aynı testleri geçiyor.
6. Fatura numaraları tenant içinde ardışık ve boşluksuz; eşzamanlı iki onay isteğinde çakışma oluşmuyor.
7. Ödeme kaydı Finans modülünde COLLECTION oluşturuyor ve müvekkil bakiyesi düşüyor; kısmi ödemede fatura PARTIALLY_PAID oluyor.
8. SENT faturada satır PATCH denemesi 409; iptal sonrası bağlı zaman kayıtları yeniden faturalanabilir hale geliyor.
9. `credentials` hiçbir GET yanıtında ve log'da görünmüyor (güvenlik testi).
10. Başarı primi senaryosu: 1.000.000 TL tahsilat + %10 oran → 100.000 TL tahakkuk önerisi oluşuyor, PARTNER onayı olmadan kesinleşmiyor.

## Faz

**Faz 3.** Finans (Modül 08) ile aynı fazda, ondan sonra. e-Fatura canlı sağlayıcı
entegrasyonu Faz 3 sonunda tek sağlayıcıyla başlar; ek adaptörler Faz 4-5'te eklenir.
`mock` adaptör Faz 3'ün ilk gününden itibaren geliştirme/test ortamında bulunur.
