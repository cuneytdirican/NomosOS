# Modül 26 — AI Kota ve Kredi Sistemi

> İlgili modüller: [09-faturalama](09-faturalama.md), [21-ai-agents](21-ai-agents.md),
> [25-sistem-yonetim-paneli](25-sistem-yonetim-paneli.md), [03-ai-katmani-byo-llm](../03-ai-katmani-byo-llm.md).
> Faz: **3.5** — Faz 3 (faturalama) bittikten sonra, ticari açılıştan önce zorunlu.

## Amaç

NomosOS'ta AI iki farklı ekonomiyle çalışır:

| Mod | AI maliyeti | Sınır |
|-----|-------------|-------|
| **BYO-LLM** — büro kendi API anahtarını bağlar | Büroda | Yok (kendi sağlayıcısı sınırlar) |
| **Yönetilen AI** — NomosOS sağlar | **NomosOS'ta** | **Zorunlu** |

İkinci modda her çağrı NomosOS'un maliyetidir; ölçülmeden ve sınırlanmadan sunulamaz.
Bu modül, o ölçüm ve sınırlama katmanını tanımlar.

**Temel tasarım kararı: kullanıcıya token değil KREDİ satılır.** Avukat token'ın ne
olduğunu bilmez; ham token satmak (a) öngörülemez fatura yaratır, (b) model
değiştiğinde kullanıcının deneyimini bozar, (c) "token yakıyor muyum" kaygısıyla
kullanımı bastırır — oysa bu üründe kullanım = değer = yenileme. Kredi, fiyatı model
seçiminden bağımsızlaştırır: arkada model değişse de fiyat listesi sabit kalır.

## Kullanıcı Hikâyeleri

1. **Büro sahibi olarak** ay içinde ne kadar AI hakkım kaldığını tek bakışta görmek istiyorum ki sürpriz yaşamayayım.
2. **Avukat olarak** bir işlemi başlatmadan önce kaç kredi tüketeceğini görmek istiyorum.
3. **Avukat olarak** kredi bittiğinde dosya/duruşma/süre yönetiminin çalışmaya devam etmesini istiyorum — sadece AI işlerinin durmasını.
4. **Büro sahibi olarak** kredi biterse tek tıkla ek paket almak istiyorum.
5. **Büro sahibi olarak** kendi API anahtarımı bağlayarak limitlerden tamamen kurtulmak ve daha ucuz abonelik ödemek istiyorum.
6. **Partner olarak** hangi avukatın/hangi işlemin ne kadar kredi tükettiğini görmek istiyorum.
7. **Platform yöneticisi olarak** her tenant'ın gerçek AI maliyetini ve marjımı görmek istiyorum.
8. **Platform yöneticisi olarak** anormal kredi tüketimini (kötüye kullanım, döngüye giren süreç) erkenden yakalamak istiyorum.
9. **Avukat olarak** tek bir dev belgenin aylık bütçemi yakmasını engelleyen bir korumanın olmasını istiyorum.
10. **Muhasebe olarak** satın alınan ek kredilerin faturalandırılmasını istiyorum.

## Kredi Fiyat Listesi

### Ücretsiz — kredi tüketmez

Yüksek hacimli, ürünün can damarındaki işler sayaç dışıdır. **Belge sınıflandırmayı
krediye bağlarsak büro belge yüklemekten kaçınır ve belge→otomatik aksiyon hattı ölür.**

| İşlem | Neden ücretsiz |
|---|---|
| Süre hesabı (`computeDeadline`) | Deterministik motor, AI değil |
| Atıf doğrulama (`CITATION_VERIFY`) | Kayıt araması, LLM değil |
| Belge sınıflandırma (`DOCUMENT_CLASSIFY`) | Yüksek hacim, değer döngüsünün girişi |
| Belgeden veri çıkarma + süre tespiti (pipeline) | Aynı gerekçe — hat bütün olarak ücretsiz |
| Gömme / RAG indeksleme (`embedTexts`) | Yüksek hacim, ucuz model yeterli |
| Conflict check | Ağırlıklı deterministik |

Bunlar yerine **belge hattı aylık belge adediyle** sınırlanır (aşağıdaki plan tablosu).

> Bu liste, kendi donanımımızda küçük model çalıştırma kararıyla doğrudan ilişkilidir:
> sınıflandırma ve gömme, yerelde çalıştırmaya en uygun işlerdir. Yerele alındığında
> hem maliyetsiz sunulur hem de "belge içeriği hiç dışarı çıkmıyor" KVKK argümanı doğar.

### Kredili işlemler

Muhakeme gerektiren, tek seferde yüksek değer üreten işler:

| İşlem | AI görev tipi | Kredi |
|---|---|---|
| Dosya sohbeti (bir soru-cevap) | `CASE_CHAT` | 2 |
| Büro geneli sorgu | `OFFICE_QUERY` | 3 |
| Müvekkil durum özeti | `CLIENT_STATUS_SUMMARY` | 5 |
| İçtihat AI arama + özet | `CASELAW_SEARCH` + `CASELAW_SUMMARIZE` | 5 |
| Akıllı not önerisi | `SMART_NOTE` | 3 |
| Dilekçe bölümü yeniden yazımı | `PETITION_SECTION_REWRITE` | 5 |
| İcra Copilot komutu | `ENFORCEMENT_ANALYSIS` | 10 |
| Tahsilat ihtimali | `COLLECTION_LIKELIHOOD` | 15 |
| Duruşma hazırlık paketi | `HEARING_PREP` | 15 |
| Risk değerlendirmesi (Faz 4) | `RISK_ASSESS` | 15 |
| Tam dosya analizi | `CASE_FULL_ANALYSIS` | 20 |
| Simülasyon (karşı taraf / hakim) (Faz 4) | `OPPONENT_SIMULATION` | 20 |
| Dilekçe taslağı (tam) | `PETITION_DRAFT` | 25 |
| Strateji oluşturma (Faz 4) | `STRATEGY_BUILD` | 30 |
| Bilirkişi raporu karşılaştırma (Faz 4) | `EXPERT_REPORT_DIFF` | 20 |
| Sözleşme incelemesi (Faz 5) | `CONTRACT_REVIEW` | 20 |

Fiyatlar `AiTaskCost` tablosunda tutulur ve **platform panelinden değiştirilebilir** —
kod dağıtımı gerektirmez.

### İç muhasebe (kullanıcıya gösterilmez)

Kredi fiyatları, gerçek maliyetin **yaklaşık 3 katı** olacak şekilde belirlenmiştir.
Bu marj payı şunları karşılar: model fiyat artışları, başarısız/yeniden denenen çağrılar,
beklenenden uzun bağlamlar, altyapı gideri.

Gerçek maliyet `ModelPrice` tablosundan hesaplanır:
`maliyet = (girdiToken/1M × girdiFiyat) + (çıktıToken/1M × çıktıFiyat)`
Her `AiUsageLog` kaydına gerçek maliyet yazılır; platform paneli tenant başına
**maliyet, tahsil edilen kredi karşılığı ve marj** gösterir.

> Not: Modül 25 bugün "panel token sayar, fiyatlamaz" ilkesiyle yazılmıştır — bu, saf
> BYO-LLM varsayımıydı. Yönetilen AI modunda o ilke YALNIZCA BYO-LLM tenant'ları için
> geçerlidir; yönetilen tenant'larda gerçek maliyet ve marj görünür olmalıdır.

## Plan Kotaları

| Plan | Aylık kredi | Aylık belge (hat) | Notlar |
|---|---|---|---|
| **Solo** | 500 | 200 | Tek avukat |
| **Büro** | Kullanıcı başına 400 (havuzlanmış) | Kullanıcı başına 250 | 3+ kullanıcı; havuz büro genelinde ortaktır |
| **Enterprise** | Sözleşmeye bağlı | Sözleşmeye bağlı | BYO-LLM veya Private AI önerilir |
| **BYO-LLM (her planda)** | **Sınırsız** | Sınırsız | AI maliyeti bürodadır; abonelikte **%30 indirim** |

Ek kredi paketleri: **500 · 2.000 · 10.000 kredi**.

> **Fiyatlandırma (TL) bir iş kararıdır ve bu dokümanda sabitlenmemiştir.** Belirlenirken
> uyulacak kural: paket birim fiyatı, dahil kotanın örtük birim fiyatından **en az %20
> yüksek** olmalı (dahil kota, aboneliğin değer önerisi olarak kalsın; ek paket
> "aşım" fiyatı olsun).

Kural: **dahil kota devretmez** (kullan veya kaybet, dönem sonunda sıfırlanır);
**satın alınan krediler devreder ve süresi dolmaz.** Tüketim sırası: önce dahil kota,
sonra satın alınan krediler.

## Limit Davranışı (kademeli — sert kesme yok)

| Eşik | Davranış |
|---|---|
| %80 | Panelde uyarı şeridi + büro sahibine e-posta |
| %100 | **Yalnızca kredili AI işlemleri durur.** Dosya/müvekkil/duruşma/süre/görev/belge yönetimi, süre hesabı, belge hattı ÇALIŞMAYA DEVAM EDER |
| %100 + otomatik yükleme açık | Tanımlı paket otomatik satın alınır (varsayılan **kapalı**, açıkça onay gerekir) |
| Her durumda | "Kendi API anahtarınızı bağlayın, limit kalksın" yönlendirmesi gösterilir |

**Asla engellenmeyecekler:** kimlik doğrulama, dosya/müvekkil CRUD, duruşma ve süre
takibi, görev yönetimi, belge yükleme ve sınıflandırma, atıf doğrulama, dışa aktarım.
Avukatın süre kaçırmasına yol açabilecek hiçbir şey krediye bağlanmaz.

### İstek başına üst sınır

Tek bir çağrı **50 krediyi** aşamaz. Aşacaksa çağrı yapılmadan reddedilir ve kullanıcıya
kapsamı daraltması önerilir ("Bu belge çok uzun; belirli bölümleri seçerek deneyin").
Tek bir dev belgenin aylık bütçeyi yakması böyle engellenir.

## Veri Modeli

### CreditWallet — tenant kredi cüzdanı
| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid | |
| tenantId | uuid, unique | |
| periodStart / periodEnd | date | Abonelik dönemi |
| includedCredits | int | Dönem başında tahsis edilen |
| includedConsumed | int | Dahil kotadan tüketilen |
| purchasedCredits | int | Satın alınan bakiye (devreder) |
| reservedCredits | int | Devam eden çağrılar için rezerve |
| autoTopUpPackageKey | string? | Otomatik yükleme (null = kapalı) |
| documentQuota / documentUsed | int | Belge hattı kotası |
| updatedAt | datetime | |

`kullanılabilir = (includedCredits − includedConsumed) + purchasedCredits − reservedCredits`

### CreditTransaction — hareket defteri (append-only)
| Alan | Tip | Açıklama |
|---|---|---|
| tenantId, userId? | uuid | |
| type | enum | `TAHSIS · TUKETIM · SATIN_ALMA · IADE · DUZELTME · SURESI_DOLDU` |
| amount | int | Tüketimde negatif |
| taskType | string? | Hangi AI görevi |
| caseId? / aiUsageLogId? | uuid | İzlenebilirlik |
| balanceAfter | int | Denetim için |
| note | string? | |
| createdAt | datetime | |

### AiTaskCost — fiyat listesi (panelden düzenlenebilir)
`taskType (unique) · credits · isFree · description · updatedBy · updatedAt`

### ModelPrice — iç maliyet tablosu
`providerType · model · inputPricePer1M · outputPricePer1M · currency · effectiveFrom`
(unique: provider+model+effectiveFrom; geçmiş fiyatlar korunur)

### CreditPackage
`key (unique) · credits · price · currency · isActive`

### AiUsageLog'a eklenecek alanlar
`creditsCharged int? · estimatedCost Decimal(12,4)? · costCurrency String?`

## Çağrı Akışı — rezervasyon ve mahsuplaşma

Mevcut `AiUsageLog` çağrıdan **sonra** kayıt tutuyor; kredi sistemi için çağrıdan
**önce** kontrol gerekir:

```
1. TAHMİN    estimateCredits(taskType, bağlamUzunluğu)
             → taban fiyat + uzun bağlam çarpanı (karakter sayısından kaba tahmin)
2. SINIR     tahmin > 50 kredi  → 400, kapsamı daraltma önerisi
3. KONTROL   kullanılabilir < tahmin → 402 Payment Required
             { kalanKredi, gerekenKredi, paketler[], byoLlmOnerisi }
4. REZERVE   reservedCredits += tahmin   (eşzamanlı çağrıların bakiyeyi aşmasını önler)
5. ÇAĞRI     provider.chat(...) — KVKK maskeleme hattından sonra
6. MAHSUP    gerçek token → gerçek maliyet → CreditTransaction(TUKETIM, gerçek kredi)
             rezervasyon serbest bırakılır; başarısız çağrıda kredi DÜŞÜLMEZ
```

Başarısız veya boş yanıt dönen çağrılardan **kredi alınmaz** (rezervasyon iade edilir).
Kullanıcı hatasından kaynaklanmayan yeniden denemeler ücretsizdir.

## API Uçları

| Metot | Yol | Rol | Açıklama |
|---|---|---|---|
| GET | `/api/v1/credits/wallet` | Tümü | Bakiye, dönem, kullanım yüzdesi |
| GET | `/api/v1/credits/transactions` | PARTNER, ADMIN | Hareket dökümü (filtreli) |
| GET | `/api/v1/credits/costs` | Tümü | Görev başına kredi fiyat listesi |
| POST | `/api/v1/credits/estimate` | Tümü | `{taskType, caseId?}` → tahmini kredi |
| GET | `/api/v1/credits/packages` | PARTNER, ADMIN | Satın alınabilir paketler |
| POST | `/api/v1/credits/purchase` | PARTNER, ADMIN | Ek paket satın alma → Invoice üretir |
| PATCH | `/api/v1/credits/auto-topup` | PARTNER, ADMIN | Otomatik yükleme aç/kapat |
| GET | `/api/admin/v1/credits/tenants` | OPS, BILLING, SUPER | Tenant başına kota/tüketim |
| PATCH | `/api/admin/v1/credits/tenants/:id` | BILLING, SUPER (**dört-göz**) | Manuel kredi tahsisi/düzeltme |
| GET/PATCH | `/api/admin/v1/credits/costs` | SUPER | Fiyat listesi yönetimi |
| GET/PATCH | `/api/admin/v1/model-prices` | SUPER | Model fiyat tablosu |
| GET | `/api/admin/v1/credits/margin` | BILLING, SUPER, ANALYST(salt-okur) | Maliyet / gelir / marj raporu |

## Arayüz

- **Panel** (`/app`): sağ üstte kredi göstergesi (kalan / toplam, %80'de amber, %100'de kırmızı); tıklanınca kullanım dökümü.
- **AI işlemi öncesi**: düğmede kredi maliyeti görünür ("Tam Dosya Analizi · 20 kredi"). Bakiye yetersizse düğme pasif + "Ek paket al" / "Kendi anahtarını bağla" yönlendirmesi.
- **402 yanıtında**: engelleyici değil, açıklayıcı bir kart — kalan kredi, gereken kredi, paket seçenekleri, BYO-LLM önerisi.
- **Ayarlar → AI Kullanımı** (yeni): dönemsel tüketim grafiği, görev tipine ve kullanıcıya göre kırılım, hareket dökümü, ek paket satın alma, otomatik yükleme anahtarı.
- **AI Sağlayıcı ayarları**: kendi anahtarını bağlayan büroya "Limitsiz mod aktif — abonelikte %30 indirim uygulanıyor" rozeti.
- **Admin paneli** (`/kullanim`): tenant başına maliyet/gelir/marj, anormal tüketim uyarıları, fiyat listesi ve model fiyat tablosu yönetimi.

## İş Kuralları

1. Kredi kontrolü **sunucu tarafında** yapılır; istemcideki gösterim yalnızca bilgilendirmedir.
2. BYO-LLM tenant'larında kredi kontrolü **tamamen atlanır** (kota alanları yok sayılır), ancak `AiUsageLog` yine tutulur.
3. Ücretsiz listedeki görevler hiçbir koşulda kredi tüketmez; bu liste koda gömülmez, `AiTaskCost.isFree` alanından okunur.
4. Başarısız, iptal edilen veya boş dönen çağrılardan kredi alınmaz.
5. Tek çağrı 50 kredi sınırını aşamaz.
6. Kota dolduğunda **AI dışı hiçbir özellik** engellenmez; süre/duruşma/görev akışları her koşulda çalışır.
7. Dahil kota dönem sonunda sıfırlanır ve devretmez; satın alınan kredilerin süresi dolmaz.
8. Tüketim sırası: önce dahil kota, sonra satın alınan krediler.
9. Manuel kredi tahsisi (platform tarafında) **dört-göz onayına** tabidir ve `PlatformAuditLog`'a yazılır.
10. Fiyat listesi değişikliği geriye dönük uygulanmaz; yürürlük tarihi ile saklanır.
11. Anormal tüketim (saatlik ortalamanın 10 katı) otomatik uyarı üretir; kritik eşikte tenant geçici olarak yavaşlatılır (rate limit), kesilmez.
12. Otomatik yükleme varsayılan olarak **kapalıdır**; açılması açık kullanıcı onayı gerektirir.

## Diğer Modüllerle İlişkiler

- **[09-faturalama](09-faturalama.md)**: kredi paketi satın alımı `Invoice` üretir; e-Fatura akışına girer.
- **[25-sistem-yonetim-paneli](25-sistem-yonetim-paneli.md)**: maliyet/marj görünürlüğü, fiyat yönetimi, manuel tahsis, anormallik izleme.
- **[21-ai-agents](21-ai-agents.md)**: her ajan çağrısı kredi hattından geçer; ajan kataloğuna `creditCost` alanı eklenir.
- **[03-ai-katmani-byo-llm](../03-ai-katmani-byo-llm.md)**: BYO-LLM, limitten muafiyetin ve abonelik indiriminin dayanağıdır.

## Kabul Kriterleri

1. Yönetilen AI modunda, bakiye yetersizken kredili bir işlem çağrılırsa **402** döner ve LLM'e istek **gidilmez**.
2. Aynı anda gönderilen 10 eşzamanlı istek, rezervasyon mekanizması sayesinde bakiyeyi negatife düşüremez.
3. Sağlayıcı hatası alan bir çağrıdan kredi düşülmez (`CreditTransaction` oluşmaz).
4. Ücretsiz listedeki bir görev (ör. `DOCUMENT_CLASSIFY`) kota sıfırken de çalışır.
5. Kota sıfırken dosya oluşturma, duruşma ekleme, süre hesaplama ve belge yükleme sorunsuz çalışır.
6. BYO-LLM sağlayıcısı tanımlı tenant'ta kredi kontrolü hiç devreye girmez.
7. Tek çağrıda 50 kredi sınırı aşılırsa istek reddedilir ve LLM'e gidilmez.
8. Dönem yenilendiğinde dahil kota sıfırlanır, satın alınan bakiye korunur.
9. `CreditTransaction` toplamı ile `CreditWallet` bakiyesi her zaman tutarlıdır (mutabakat testi).
10. Platform panelinde bir tenant için maliyet, tahsil edilen kredi ve marj doğru hesaplanır.
11. Manuel kredi tahsisi dört-göz onayı olmadan uygulanmaz.
12. ANALYST_READONLY marj raporunu görebilir ama fiyat listesini değiştiremez.

## Faz

**Faz 3.5** — Faz 3 (finans/faturalama) tamamlandıktan hemen sonra, Faz 4'ten önce.
Gerekçe: ticari açılıştan önce zorunludur; yönetilen AI modu bu katman olmadan
sınırsız maliyet riski taşır. Faz 4'te eklenen AI görevleri (strateji, simülasyon, risk)
fiyat listesine doğrudan eklenir — bu modül önce kurulursa sonraki fazlar bedavaya gelir.
