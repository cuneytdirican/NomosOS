# Modül 25 — Sistem Yönetim Paneli (Platform Admin)

## Amaç

NomosOS'un modül 01–24'ü **tenant'ların (hukuk bürolarının) kullandığı uygulamayı** tanımlar. Bu modül farklıdır: NomosOS'u **işleten şirketin** platform operasyon panelini tanımlar. Panel; tenant yaşam döngüsü (onboarding, askıya alma, kapatma), abonelik ve ödeme yönetimi, platform geneli AI/token analitiği, sistem sağlığı, feature flag/duyuru yönetimi ve yatırımcı/ortak raporlaması için tek yüzeydir.

Temel ilke: **iki ayrı dünya.** Panel kimliği (`PlatformUser`) tenant `User` tablosundan tamamen bağımsızdır; ayrı uygulama (`apps/admin`), ayrı JWT audience, ayrı login yolu kullanır. Panel, tenant'ların hukuki içeriğine (müvekkil, dosya, belge, prompt) **normal akışta hiç erişmez** — yalnızca sayaç, metadata ve toplulaştırma görür. Tenant verisine tek istisnai kapı, süreli ve izinli destek erişimidir (bkz. Güvenlik ve KVKK). "Tenant kullanıcısı gibi giriş yap" (impersonation) bilinçli olarak **kapsam dışıdır ve yapılmayacaktır**.

## Kullanıcı Hikâyeleri

1. **SUPER_ADMIN olarak**, yeni operasyon sorumlusuna `OPS_ADMIN` rolü atamak istiyorum ki tenant operasyonlarını devretsin ama finans ve rol yönetimine dokunamasın. *(Atama PlatformAuditLog'a yazılır; 2FA kurulumu tamamlanmadan hesap aktifleşmez.)*
2. **SUPER_ADMIN olarak**, bir Enterprise adayına özel fiyat tanımlamak istiyorum ki standart plan tablosunun dışına çıkabilelim. *(Gerekçe zorunlu, ikinci onay gerekir; abonelik listesinde "özel" rozetiyle görünür.)*
3. **SUPER_ADMIN olarak**, kapatma talep eden bir tenant için veri ihracı üretip yasal saklama süresi sonunda kalıcı silme planlamak istiyorum ki KVKK yükümlülükleri karşılansın. *(Dört-göz onayı; ihraç bağlantısı süreli; silme tarihi tenant kaydında görünür.)*
4. **OPS_ADMIN olarak**, sözleşme ihlali bildirilen bir tenant'ı gerekçe girerek askıya almak istiyorum ki erişim dursun ama veri korunsun. *(Askıdaki tenant kullanıcıları girişte Türkçe açıklama görür; işlem geri alınabilir.)*
5. **OPS_ADMIN olarak**, `strategy-engine` flag'ini önce 5 pilot tenant'a açmak istiyorum ki genel yayına çıkmadan geri bildirim toplayalım. *(Tenant allowlist modu; değişiklik geçmişinde kim/ne zaman görünür.)*
6. **OPS_ADMIN olarak**, pazar gecesi için bakım penceresi planlayıp 72 saat önceden duyuru yayınlamak istiyorum ki bürolar duruşma hazırlıklarını aksatmasın. *(Zamanlanmış banner; tam kilit ancak dört-göz onayıyla.)*
7. **BILLING_ADMIN olarak**, 3 günden eski başarısız ödemeleri tek kuyrukta görüp dunning adımını tetiklemek istiyorum ki tahsilat kaybı büyümeden müdahale edeyim. *(Kuyrukta hata kodu ve deneme sayısı görünür; askıya alma yalnız dunning zincirinin son adımıdır.)*
8. **BILLING_ADMIN olarak**, yanlış tahsil edilen yıllık ücret için iade başlatmak istiyorum; onayın başka bir yetkiliden gelmesini bekliyorum ki tek kişilik hata/istismar mümkün olmasın. *(İade `BEKLIYOR` durumunda kalır; açan kişi kendi talebini onaylayamaz.)*
9. **SUPPORT_AGENT olarak**, "belge yüklenmiyor" diyen büro için tenant ADMIN'inden onaylı 4 saatlik `METADATA` kapsamlı erişim açmak istiyorum ki hata loglarını incelerken müvekkil verisi görmeyeyim. *(Grant süresi dolunca kendiliğinden kapanır; her sayfa görüntüleme hem PlatformAuditLog'a hem tenant'ın AuditLog'una yazılır.)*
10. **SUPPORT_AGENT olarak**, AI çağrıları hata veren tenant'ın `AiProviderConfig` metadata'sını (tip, model, `hasApiKey`) görmek istiyorum ki sorunun anahtar mı endpoint mi kaynaklı olduğunu söyleyebileyim — anahtarın kendisini asla görmeden.
11. **ANALYST_READONLY (yatırımcı/ortak) olarak**, MRR, tenant büyümesi, churn ve AI kullanım trendini aylık görmek istiyorum ki yatırımın gidişatını izleyeyim — tekil büro adı ve müvekkil verisi görmeden. *(Tüm mutasyon butonları render edilmez VE API'de 403; tenant kırılımı en fazla plan/segment seviyesindedir.)*
12. **ANALYST_READONLY olarak**, Kurul Raporu sekmesini CSV olarak dışa aktarmak istiyorum ki ortaklar toplantısına götüreyim. *(Dışa aktarım yalnız toplulaştırılmış veri içerir; `ANALYST_EXPORT` olarak loglanır.)*

## Roller ve Yetki Matrisi

Panel rolleri (tenant rolleri PARTNER/AVUKAT/… ile ilişkisiz, ayrı enum):

| Rol | Kim | Özet |
|-----|-----|------|
| `SUPER_ADMIN` | Kurucular (2–3 kişi) | Tam yetki + platform kullanıcı/rol yönetimi + dört-göz onaylarının nihai mercii |
| `OPS_ADMIN` | Operasyon/platform mühendisi | Tenant yaşam döngüsü, sistem ayarları, flag/duyuru; ödeme/iade yapamaz |
| `BILLING_ADMIN` | Finans sorumlusu | Plan, abonelik, ödeme, fatura, iade; sistem ayarına ve tenant silmeye dokunamaz |
| `SUPPORT_AGENT` | Destek personeli | KVKK-sınırlı, süreli, salt-okur tenant incelemesi; hiçbir yıkıcı işlem yapamaz |
| `ANALYST_READONLY` | Yatırımcı, ortak, danışman | **Sıfır yazma**; yalnız toplulaştırılmış/anonim Kurul Raporu görünümü |

Hiyerarşi düz değil, **alan ayrımlıdır** (segregation of duties): operasyonu yöneten iade yapamaz, parayı yöneten tenant silemez. Varsayılan davranış read-only'dir: bir işlem matriste açıkça verilmedikçe yasaktır ve mutasyon uçları `ANALYST_READONLY` için her koşulda API katmanında 403 döner (UI'da gizleme yalnız ergonomidir).

Gösterim: ✅ tam · 👁 salt-okur · 🔒 maskeli/agregat salt-okur · 4️⃣ dört-göz onayıyla · ❌ yok

| İşlem | SUPER_ADMIN | OPS_ADMIN | BILLING_ADMIN | SUPPORT_AGENT | ANALYST_READONLY |
|---|---|---|---|---|---|
| Tenant listesi/detayı görüntüle | ✅ | ✅ | ✅ (finans odaklı) | ✅ | 🔒 (yalnız plan/segment agregatı) |
| Tenant oluştur (manuel onboarding) | 4️⃣ | 4️⃣ | ❌ | ❌ | ❌ |
| Tenant askıya al / aktifleştir | ✅ | 4️⃣ | 4️⃣ (yalnız ödeme temerrüdü) | ❌ | ❌ |
| Tenant kalıcı sil / veri imhası | 4️⃣ | ❌ | ❌ | ❌ | ❌ |
| Plan değiştir / özel fiyat | ✅ / ✅ | ❌ | ✅ / 4️⃣ | ❌ | ❌ |
| İade (refund) | 4️⃣ | ❌ | 4️⃣ | ❌ | ❌ |
| Ödeme/fatura detayı görüntüle | ✅ | ❌ | ✅ | 👁 (yalnız ödendi/ödenmedi) | 🔒 (yalnız MRR/churn özetleri) |
| Sistem ayarı, bakım modu, feature flag | ✅ | ✅ (bakım tam kilidi 4️⃣) | ❌ | ❌ | ❌ |
| Duyuru yayınla | ✅ | ✅ | ❌ | ❌ | ❌ |
| Sistem sağlık panosu | ✅ | ✅ | ❌ | 👁 | ❌ (yalnız uptime satırı) |
| AI analitiği — platform toplamı | ✅ | ✅ | 👁 | 👁 | 🔒 (anonim) |
| AI analitiği — tenant detayı | ✅ | ✅ | 👁 (hacim) | 👁 (destek bağlamında) | ❌ |
| Tenant içeriği görüntüle (destek erişimi) | 4️⃣ + süreli grant | ❌ | ❌ | 4️⃣ + süreli grant, PII maskeli | ❌ **asla** |
| `AiProviderConfig` metadata (anahtar asla) | ✅ | 👁 | ❌ | 👁 | ❌ |
| Platform kullanıcısı oluştur / rol ata | ✅ (SUPER_ADMIN ataması 4️⃣) | ❌ | ❌ | ❌ | ❌ |
| PlatformAuditLog görüntüle / dışa aktar | ✅ / 4️⃣ | 👁 (kendi alanı) | 👁 (finans kayıtları) | 👁 (kendi işlemleri) | ❌ |
| Kurul Raporu (yatırımcı seti) | ✅ | ❌ | ✅ | ❌ | 👁 (bu rolün tek ekranı) |

**Dört-göz ilkesi (two-person rule)**: aşağıdaki işlemlerde "talep eden ≠ onaylayan" zorunludur; bekleyen işlem `PlatformApprovalRequest` kaydı olarak durur (`BEKLIYOR · ONAYLANDI · REDDEDILDI · ZAMAN_ASIMI`, zaman aşımı 72 saat) ve her iki kimlik loglanır:

1. Tenant kalıcı silme / veri imhası (iki SUPER_ADMIN).
2. Tenant askıya alma (talep: OPS/BILLING_ADMIN → onay: SUPER_ADMIN veya farklı OPS_ADMIN).
3. İade — eşik üstü (varsayılan > 5.000 TL, `SystemSetting`) ve her toplu iade; her iadede açan ≠ onaylayan.
4. Özel fiyat / manuel indirim.
5. Destek erişim penceresi açma (+ tenant ADMIN onayı; yasal zorunluluk istisnası ayrıca loglanır).
6. Bakım modu tam kilidi ve platform geneli flag/rate-limit değişikliği.
7. Yeni SUPER_ADMIN atama / mevcut SUPER_ADMIN'i düşürme (iki SUPER_ADMIN).
8. PlatformAuditLog dışa aktarımı.
9. **Tenant AÇMA (D5 — `TENANT_CREATE`)**: talep ≠ onay; ilk yöneticinin parolası
   talep anında hash'lenir, ikinci imzada tenant + ADMIN kullanıcı + TRIAL abonelik
   tek işlemde kurulur.

Sistemde her an **en az iki aktif SUPER_ADMIN** bulunmalıdır; tek kalınırsa dört-göz işlemleri kilitlenir (tasarım kararı, kurtarma prosedürü operasyon el kitabında).

## Ekranlar ve UX

### 1. Genel Bakış — `/admin`
KPI kartları (aktif tenant, MRR, deneme→ücretli dönüşüm, churn, DAU), 90 günlük büyüme grafiği, AI token tüketimi (sağlayıcı tipi kırılımı), sistem sağlık şeridi, "dikkat gerektirenler" (başarısız ödemeler, biten denemeler, anomali rozetli tenant'lar), son kritik PlatformAuditLog kayıtları. Herkese salt-okur; `ANALYST_READONLY` bu ekran yerine Kurul Raporu'na yönlendirilir.

```
┌─ NomosOS Admin ────────────────────────────────────────── ⚙ ops@… ▾ ─┐
│ ◉ Genel Bakış  Tenants  Abonelik  Ödeme  AI  Sistem  Destek  Denetim │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─Aktif Tenant─┐ ┌─MRR────────┐ ┌─Deneme→Ücretli┐ ┌─Aylık Churn───┐  │
│ │    312       │ │ ₺1.84M     │ │   %31         │ │   %2.1        │  │
│ │ ▲ +14 bu ay  │ │ ▲ +%6      │ │ ▼ -%3         │ │ ▲ +%0.4  ⚠    │  │
│ └──────────────┘ └────────────┘ └───────────────┘ └───────────────┘  │
│ ┌─Büyüme (90g)──────────────────┐ ┌─AI Token Tüketimi (30g)───────┐  │
│ │        ▁▂▂▃▃▄▅▅▆▇▇█           │ │ ANTHROPIC ▇▇▇▇▇▇ 41%          │  │
│ │ tenant ───  kullanıcı ─ ─     │ │ OPENAI_C. ▇▇▇▇ 28%            │  │
│ │                               │ │ OLLAMA    ▇▇▇ 19%  (yerel)    │  │
│ └───────────────────────────────┘ └───────────────────────────────┘  │
│ ┌─Sistem Sağlığı────────────────────────────────────────────────┐    │
│ │ API p95: 240ms ● | Kuyruk: 12 iş ● | DB pool: 34/100 ● | S3 ● │    │
│ └───────────────────────────────────────────────────────────────┘    │
│ ┌─Dikkat Gerektirenler──────────────┐ ┌─Son Yönetici İşlemleri────┐  │
│ │ ⚠ 4 başarısız ödeme (3 gün+)      │ │ 14:02 OPS  tenant askıya  │  │
│ │ ⚠ 7 deneme 48 saat içinde bitiyor │ │ 13:40 BIL  iade onayı     │  │
│ │ 🔴 Tenant #A3F2 hata oranı ↑      │ │ 11:15 SUP  destek erişimi │  │
│ └───────────────────────────────────┘ └───────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. Tenant Yönetimi — `/admin/tenants` · `/admin/tenants/:id`
Liste: arama (büro adı, e-posta, vergi no), filtre (plan, durum, il/baro, AI sağlayıcı tipi); kolonlar: büro adı, plan/durum/deneme bitişi, kullanıcı sayısı, dosya/belge/depolama sayaçları, son 30 gün AI çağrısı, son aktivite, MRR katkısı, açık bakiye. Detay sekmeleri: Özet · Kullanıcılar (metadata: rol, son giriş — içerik değil) · Abonelik & Ödemeler · Kullanım (UsageSnapshot trendleri) · AI Yapılandırması (**yalnız metadata**: tip, model, `hasApiKey`) · Notlar (`TenantNote`) · Denetim (o tenant'a yapılan platform işlemleri). Aksiyonlar: askıya al/aktifleştir (gerekçe zorunlu), plan değiştir, deneme uzat, kota override, destek erişimi başlat, kapatma/veri ihracı (dört-göz).

**D5 güncellemesi — kiracı AÇMA (dört-göz `TENANT_CREATE`):** liste ekranında
«Yeni Kiracı» düğmesi. Talep: büro adı + plan + koltuk sayısı + ilk yönetici
(ad, e-posta, ilk parola — talep anında bcrypt ile hash'lenir, payload düz parola
taşımaz) + gerekçe. Doğrulamalar: tekil e-posta/ad, AKTİF plan, plan koltuk tavanı.
İkinci imzada executor TEK İŞLEMDE tenant + ilk ADMIN kullanıcı + 14 gün TRIAL
abonelik + denetim izi kurar; yürütme anında doğrulamalar yeniden çalışır (talep ile
onay arası yarış korunur). **Askıda/iptalli büro girişi kapalıdır:** tenant girişi
abonelik durumunu denetler, SUSPENDED/CANCELED → 403 (denetim izine yazılır; veri
silinmez). Yalnız SUPER_ADMIN ve OPS_ADMIN (matris: `tenant.create` dört-göz).

**D5 güncellemesi — AI Eğitim İşleri (`/egitim`):** ONAYLANMIŞ AI eğitim örneği
havuzundan fine-tuning işi yönetimi. İş açılışı havuzun ANLIK GÖRÜNTÜSÜNÜ alır
(sayı + görev tipi kırılımı); manifest (JSONL) yalnız HAZIRLANDI/GONDERILDI
durumunda iner; durum geçişleri şerit denetimlidir:
`HAZIRLANDI → GONDERILDI → EGITILIYOR → TAMAMLANDI` (+BASARISIZ/IPTAL yan yolları),
TAMAMLANDI için sonuç model adı ZORUNLU. **Dürüstlük ilkesi:** sağlayıcıya otomatik
gönderim YOKTUR — manifesti sağlayıcıya operatör ELLE yükler; kod ve panelde
açıkça yazılıdır. Tüm adımlar PlatformAuditLog'a düşer (`FINE_TUNE_*` eylemleri).

### 3. Abonelik — `/admin/subscriptions` · plan kataloğu `/admin/subscriptions/plans`
Plan kademeleri: `TRIAL · SOLO · BURO · ENTERPRISE` (Private AI / Türkiye veri bölgesi opsiyonları Faz 5+ ile uyumlu). Abonelik tablosu (durum makinesiyle), yaklaşan yenilemeler, biten denemeler, iptal kuyruğu, kohort dönüşüm mini raporu. Aksiyonlar: yükselt/düşür (proration önizlemesi), deneme uzat, dondur, iptal (dönem sonunda/anında), özel fiyat (dört-göz).

### 4. Ödeme — `/admin/payments` (+ `/failed`, `/refunds`, `/invoices`, `/providers`)
Ödeme geçmişi, başarısız ödeme/dunning kuyruğu (hata kodu, deneme sayısı, adım: e-posta → uyarı → askıya alma), iade akışı (talep → gerekçe → farklı kişiden onay → sağlayıcıya iletim), platform faturaları (tenant'ların müvekkil faturaları DEĞİL), iyzico/Stripe webhook sağlığı ve maskeli anahtar durumu.

### 5. AI Analitiği — `/admin/ai`
Token trendi (input/output ayrı), `taskType` × `providerType` × model pivotu, en çok tüketen 20 tenant, `piiMasked` oranı, anomali paneli, plan bazlı AI çağrı kotaları ve tenant override listesi. Prompt/yanıt içeriği hiçbir ekranda yoktur.

### 6. Destek Erişimi — `/admin/support` (aktif grant'ler) · `/admin/support/grants` (geçmiş)
Aktif `SupportAccessGrant` listesi (tenant, kapsam, kalan süre, erken iptal), grant açma sihirbazı (gerekçe + kapsam + süre + onay durumu), geçmiş erişimlerin denetim dökümü.

### 7. Sistem — `/admin/system` (+ `/maintenance`, `/announcements`, `/flags`, `/limits`, `/staff`)
Bakım penceresi (banner / tam kilit), duyuru yönetimi (hedef: tümü/plan/tenant listesi; taslak→yayın), feature flag'ler (kapalı/yüzdesel/tenant allowlist + değişiklik geçmişi), varsayılan limitler ve gerekçeli tenant override'ları, platform personeli yönetimi (yalnız SUPER_ADMIN; davet-temelli, self-signup yok).

### 8. Sağlık — `/admin/health`
API hacim/gecikme/hata oranı, BullMQ kuyruk metrikleri, PostgreSQL/Redis/MinIO kartları, dış bağımlılık durumu, aktif alarm listesi, her kartta Grafana derin linki (bkz. Analitik).

### 9. Denetim — `/admin/audit`
PlatformAuditLog filtreli tablosu (kullanıcı, aksiyon, tenant, tarih), kritik aksiyon vurgusu, CSV dışa aktarım (dört-göz).

### 10. Kurul Raporu — `/admin/board-report`
`ANALYST_READONLY` rolünün tek ekranı (diğer roller de görebilir): aylık MRR/ARR ve hareket kırılımı, tenant/churn/NRR, plan dağılımı, aktivasyon hunisi, toplam AI hacmi, Private AI benimseme %, uptime. Tenant kimliği taşıyan hiçbir kolon içermez; CSV/PDF dışa aktarımı filigranlıdır (kullanıcı + tarih).

## Veri Modeli

Platform tabloları tenant veri düzleminden mantıksal olarak ayrıdır: hiçbiri `tenantId` ile *süzülmez*, tenant'lara yukarıdan bakar. `schema.prisma` sonuna "Platform katmanı" bölümü olarak eklenir; Faz 5 ayrık-DB senaryosunda merkez DB'de kalır.

### PlatformUser — tenant `User`'dan TAMAMEN ayrı
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid PK | |
| email | text unique | Kurumsal domain zorunlu; tenant `User.email`'den bağımsız uzay, FK yok |
| password_hash | text | argon2id |
| full_name | text | |
| role | enum(SUPER_ADMIN, OPS_ADMIN, BILLING_ADMIN, SUPPORT_AGENT, ANALYST_READONLY) | Kullanıcı başına tek rol |
| totp_secret | text nullable, şifreli | **2FA zorunlu**; kurulmadan hiçbir sayfaya erişilemez |
| status | enum(AKTIF, DEVRE_DISI, KILITLI) | DEVRE_DISI anında tüm oturumları düşürür (token_version) |
| ip_allowlist | text[] nullable | CIDR; boşsa global panel politikası |
| token_version | int | Toplu oturum iptali |
| invited_by_id | uuid FK→PlatformUser nullable | Davet izi |
| last_login_at / last_login_ip | | |

### PlanTier
| Alan | Tip | Açıklama |
|------|-----|----------|
| id, code unique | uuid, text | `TRIAL · SOLO · BURO · ENTERPRISE` |
| monthly_price_try / yearly_price_try | decimal(18,2) | KDV hariç |
| max_users / max_cases / max_storage_mb | int nullable | null = sınırsız |
| max_ai_calls_per_month | int nullable | BYO-LLM gereği token maliyeti tenant'ta; bu limit platform işlem yükü kotasıdır |
| features_json | jsonb | Plan bayrakları; feature flag referansları |
| trial_days, is_active, sort_order | | Pasif plan satıştan kalkar, mevcut aboneler kalır |

### Subscription — tenant başına tek aktif kayıt
| Alan | Tip | Açıklama |
|------|-----|----------|
| id, tenant_id unique FK→Tenant, plan_tier_id FK | | |
| status | enum(TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELED) | Durum makinesi aşağıda |
| billing_cycle | enum(MONTHLY, YEARLY) | |
| trial_ends_at, current_period_start/end | timestamptz | |
| cancel_at_period_end | bool | |
| suspended_at, canceled_at, suspend_reason | | |
| external_ref | text nullable | iyzico/Stripe abonelik id |

Durum makinesi (geçişler API guard'ında; her geçiş `PlatformAuditLog("SUBSCRIPTION_TRANSITION")` yazar):
```
TRIAL ──ödeme──▶ ACTIVE          TRIAL ──süre doldu──▶ SUSPENDED
ACTIVE ──ödeme başarısız──▶ PAST_DUE ──grace gün──▶ SUSPENDED
PAST_DUE ──ödeme──▶ ACTIVE       SUSPENDED ──ödeme/manuel──▶ ACTIVE
ACTIVE|PAST_DUE|SUSPENDED ──iptal──▶ CANCELED (terminal)
```

### PaymentRecord · InvoiceRecord
Tenant tarafındaki Faz 3 `Invoice`/`Payment` (müvekkile kesilen) ile ad çakışmasın diye platform tarafı `PaymentRecord`/`InvoiceRecord` adlarını kullanır. PaymentRecord: tenant_id, subscription_id, amount/currency, status(PENDING, SUCCEEDED, FAILED, REFUNDED, PARTIAL_REFUND), method(CARD, TRANSFER, OTHER), provider, provider_ref, failure_reason, paid_at. InvoiceRecord: number unique (`NOM-2026-000123`), dönem, subtotal/vat/total, status(DRAFT, ISSUED, PAID, VOID), e_invoice_ref (Faz 6), pdf_storage_key.

### SupportAccessGrant
| Alan | Tip | Açıklama |
|------|-----|----------|
| id, tenant_id FK, platform_user_id FK | | |
| reason | text | Zorunlu gerekçe |
| scope | enum(METADATA, BELGE_LISTESI, TAM_OKUMA) | Varsayılan METADATA; TAM_OKUMA yalnız tenant onayıyla |
| approved_by_id | uuid FK→PlatformUser nullable | Dört-göz onaylayanı |
| tenant_approved | bool | Tenant ADMIN'in uygulama içi onayı (yasal zorunluluk istisnası ayrıca işaretlenir) |
| starts_at / expires_at / revoked_at | timestamptz | Varsayılan 4 saat, azami 24 saat; otomatik düşer |

### FineTuneJob — fine-tuning iş kaydı (D5 / M4)
| Alan | Tip | Açıklama |
|------|-----|----------|
| id, name, provider, base_model | | İşin kimliği ve hedefi (sağlayıcı serbest metin) |
| status | enum benzeri | HAZIRLANDI → GONDERILDI → EGITILIYOR → TAMAMLANDI; BASARISIZ/IPTAL terminal |
| sample_count, task_types_json | | AÇILIŞ ANINDAKİ ONAYLANMIŞ havuz anlık görüntüsü (sayı + kırılım) |
| result_model_name | text nullable | TAMAMLANDI'da ZORUNLU — sağlayıcının döndürdüğü model kimliği |
| requested_by_id | FK→PlatformUser | Talebi açan operatör |

Sağlayıcıya otomatik gönderim YOKTUR: kayıt anlık görüntü + manifest (JSONL) üretir;
yüklemeyi operatör elle yapar, durumu elle ilerletir. Her adım `PlatformAuditLog`'a
düşer (`FINE_TUNE_JOB_CREATE / FINE_TUNE_JOB_STATUS / FINE_TUNE_MANIFEST_EXPORT`).

### PlatformAuditLog — tenant `AuditLog`'unun platform ikizi, ayrı tablo
`id, platform_user_id FK, role, action ("TENANT_SUSPEND", "PLAN_CHANGE", "REFUND_APPROVE", "SETTING_UPDATE", "FLAG_TOGGLE", "SUPPORT_VIEW", "ANALYST_EXPORT", "ADMIN_LOGIN_FAILED"…), target_tenant_id?, entity?, entity_id?, detail (jsonb: eski→yeni, PII maskeli), approval_request_id?, ip, user_agent, created_at`. **Append-only**: uygulama DB rolünde UPDATE/DELETE yetkisi yoktur; kayıtlar zincirlenmiş hash veya periyodik WORM (S3 Object Lock) kopya ile korunur. Endeksler: `(created_at)`, `(target_tenant_id, created_at)`, `(platform_user_id, created_at)`.

### Diğer platform tabloları
- **PlatformApprovalRequest**: dört-göz işlemleri için `action, payload, requested_by, approved_by?, status, expires_at`.
- **SystemSetting**: tipli key-value (`past_due_grace_days`, `maintenance_mode`, `default_trial_days`, `refund_four_eyes_threshold`…); secret'lar buraya KONMAZ, `.env`'de kalır.
- **FeatureFlag** + **FeatureFlagOverride** (`(flag_id, tenant_id)` unique): global varsayılan, yüzdesel rollout, tenant allowlist; api tarafı etkin flag setini Redis'te önbellekler.
- **Announcement**: başlık, markdown gövde, severity(INFO, WARNING, CRITICAL), audience(ALL, PLAN, TENANTS), yayın penceresi. Tenant tarafı `GET /api/v1/announcements` ile salt okur.
- **TenantNote**: platform ekibinin tenant hakkındaki iç notları (yazar, etiket: satış/risk/destek).
- **PlatformAlert**: anomali kayıtları (tenant_id, tip, tetiklenme değeri, durum: ACIK/INCELENDI/KAPANDI).
- **UsageSnapshot**: bkz. Analitik.

### Mevcut tablolara dokunuşlar
- **Tenant** eklenen alanlar: `status` (Subscription.status'un denormalize aynası — tenant auth guard'ı her istekte okur, Redis cache'li, tek yazıcı subscription servisi), `suspended_at`, `billing_email`, `city`, `bar_association`, `onboarded_at`.
- **AiUsageLog**: şema değişikliği gerekmez; öneri (Faz 2): `provider_type` (çağrı anında denormalize), `status(OK, PROVIDER_ERROR, TIMEOUT, PII_BLOCKED, CONFIG_ERROR)`, `error_code`, `latency_ms` — hata oranı analitiği için. Prompt/yanıt saklanmama ilkesi korunur.
- **User**: değişiklik yok; panel tenant kullanıcılarını salt okur (sayı, rol dağılımı, son giriş).

## Analitik ve Gözlemlenebilirlik

### Sistem yükü — panel bir APM değildir
Derin analiz Prometheus + Grafana + Alertmanager'dadır; panel **özet + derin link** verir. `apps/api` Prometheus-uyumlu `/metrics` ucu (yalnız iç ağdan) sunar; admin API son değerleri Prometheus HTTP API'sinden çekip Redis'te (TTL 60 sn) önbellekler — tarayıcı Prometheus'a doğrudan bağlanmaz. Gösterilen kartlar: API (req/dk, p50/p95 — AI uçları ayrı, hata oranı, 409 PII-onay oranı ayrı sayılır), PostgreSQL (havuz doluluğu, disk, yavaş sorgu), Redis, BullMQ (kuyruk başına derinlik, başarısız iş, en yaşlı bekleyen işin yaşı — belge→aksiyon hattı sağlığı), MinIO (kapasite, ilk 10 tüketici). Hiçbir kart 5 dakikadan eski veri göstermez (staleness damgası görünür).

### AI/token analitiği
Kaynak: `AiUsageLog` (yalnız metrik kolonları). Ana pivot: **tenant × taskType × providerType × model**; metrikler: çağrı, input/output token, ort./p95 süre, hata oranı, `piiMasked` oranı. **Panel token SAYAR, fiyatlamaz**: BYO-LLM gereği maliyet büronun kendi sağlayıcı hesabındadır, "AI maliyeti (TL)" kolonu yoktur. OLLAMA/CUSTOM çağrılarında token bilgisi dönmeyebilir — bu kayıtlar "token bilgisi yok" olarak ayrı sayılır, sıfır varsayılmaz. Anomali sinyalleri (gece işi hesaplar, eşikler SystemSetting'den): ani token artışı (>14 günlük ort. × 3 VE mutlak taban), yüksek hata oranı (>%20 VE ≥20 çağrı), sıfıra düşüş (churn öncüsü), PII engel yoğunluğu (>%30 → eğitim ihtiyacı), gecikme sapması.

### İş metrikleri
MRR/ARR ve hareket kırılımı (new/expansion/contraction/churn), logo ve gelir churn %, NRR, plan dağılımı, tahsilat (dunning/açık fatura). Aktivasyon hunisi: kayıt → 2. kullanıcı → ilk Client → ilk Case → AI sağlayıcı bağlama → ilk AI çağrısı → alışkanlık (7 günde ≥3 gün kullanım); kohort tablosu + medyan geçiş süreleri; takılan tenant'lar onboarding listesine düşer. Etkileşim: DAU/WAU/MAU, tenant sağlık skoru (0–100; churn riski sıralaması), modül benimseme yüzdeleri.

### UsageSnapshot stratejisi
İki katman: **Redis gerçek zamanlı sayaçlar** (`usage:{tenantId}:{date}:{metric}`, TTL 48 saat — "bugün" kartları) + **gece toplu işi** (BullMQ repeatable `usage-snapshot`, 03:00 Europe/Istanbul): önceki günü tenant başına toplar (`@@unique([tenant_id, date, scope])`, idempotent upsert, geç kayıtlar için son 2 gün yeniden hesaplanır), anomali kurallarını çalıştırır, huni adımlarını günceller. Alanlar: activeUsers, totalUsers/Cases/Clients/Documents, storage, aiCalls/aiCallsFailed/aiCallsNoTokenInfo, input/outputTokens, byTaskType/byProvider/byModelJson, piiMaskedCalls, apiRequests. Panel tarihsel grafikleri snapshot'tan okur → tenant operasyonel DB'sine analitik yük binmez. Saklama: Redis 48s · AiUsageLog ham 13 ay (sonra soğuk arşiv) · Snapshot DAILY 25 ay · MONTHLY süresiz · PlatformAuditLog min. 10 yıl · CSV ihraç dosyaları 7 gün (MinIO lifecycle).

### Yatırımcı rapor seti ve zamanlanmış özetler
Kurul Raporu metrikleri (aylık, son 12 ay): MRR/ARR + hareket kırılımı, ARPA; ödeyen/yeni/churn tenant, logo-gelir churn %, NRR; plan dağılımı, deneme→ödeme dönüşüm %; toplam koltuk, DAU/WAU/MAU, huni dönüşümleri (tenant adsız), toplam AI çağrı/token, Private AI kullanan tenant %; uptime % ve açık kritik olay sayısı. Zamanlanmış e-postalar (`report-mail` kuyruğu; içerik alıcı rolünün görme yetkisini aşamaz): günlük operasyon özeti (07:00, SUPER/OPS), haftalık büyüme (Pzt 08:00, SUPER/BILLING), aylık kurul raporu (ayın 1'i, + ANALYST_READONLY), anomali bildirimi (saatte en fazla 1 birleşik, OPS).

## Güvenlik ve KVKK

1. **Kimlik ayrımı**: `PlatformUser` ↔ tenant `User` arasında FK yok, ortak havuz yok. Ayrı JWT: panel token `{sub: platformUserId, role, aud: "nomosos-admin", tv}` — **farklı imza anahtarı**, içinde `tenantId` alanı yoktur; tenant guard'ları yapısal olarak da reddeder. Tenant JWT `/api/admin/*`'a, panel JWT `/api/v1/*`'a asla geçmez.
2. **Zorunlu 2FA (TOTP)**: istisnasız her rol; kurulum tamamlanmadan yalnız 2FA kurulum ucu erişilebilir. SUPER_ADMIN için FIDO2 donanım anahtarı önerilir; dört-göz onay ekranları öncesi step-up doğrulama (2FA yeniden istenir).
3. **Oturum**: access token 15 dk, oturum mutlak 8 saat, 30 dk hareketsizlikte düşer. Login IP başına 5/dk rate limit; 5 başarısız denemede hesap kilitlenir (kilidi başka SUPER_ADMIN açar). Parola: min. 14 karakter, argon2id, sızmış-parola kontrolü. `DEVRE_DISI` statüsü tüm refresh token'ları anında iptal eder.
4. **Yüzey ayrımı**: panel ayrı subdomain'de (`admin.nomosos.com`), tenant uygulamasıyla origin/cookie paylaşmaz; IP allowlist (ofis/VPN CIDR) SUPER_ADMIN ve OPS_ADMIN için şiddetle önerilir; panel internete hiç açılmayabilir (VPN-only).
5. **Impersonation YASAK**: "tenant kullanıcısı gibi giriş" yoktur ve yapılmayacaktır — KVKK'da veri işleyen sıfatıyla erişim minimizasyonu + tenant AuditLog'unda işlemin gerçek faile atfı bozulur. Yerine **destek erişim penceresi**: tenant ADMIN onayı (veya yasal zorunluluk istisnası) + dört-göz → süreli (varsayılan 4 saat, azami 24) → kapsam sınırlı (`METADATA`/`BELGE_LISTESI`/`TAM_OKUMA`) → **salt-okur** (hiçbir mutasyon ucu çalışmaz; düzeltme gerekiyorsa öneri kaydı açılır, işlemi tenant kullanıcısı yapar) → PII her kapsamda maskeli (`Client.tckn`, telefon, IBAN — tenant arayüzündeki maskeleme aynen, kaldırılamaz) → belge indirme kapalı.
6. **Şeffaflık**: grant altındaki her sayfa görüntüleme `PlatformAuditLog`'a satır satır; pencerenin açılış/kapanışı tenant'ın kendi `AuditLog`'una `PLATFORM_DESTEK_ERISIMI` olarak yazılır — büro kendisine kimin ne zaman baktığını kendi denetim izinde görür (VERBİS uyumu için dışa aktarılabilir erişim raporu).
7. **AI sırları**: `AiProviderConfig.encryptedApiKey` hiçbir panel rolüne hiçbir biçimde (maskeli dahi) gösterilmez — yalnız `hasApiKey: boolean` + tip/model/baseUrl metadata. `MASTER_ENCRYPTION_KEY` panel servisinin ortam değişkenlerinde **bulunmaz** (ayrı process, ayrı env). Panel `AiUsageLog`'dan yalnız metrik kolonlarını SELECT eder; prompt/yanıt gövdesi sorguda dahi yer almaz.
8. **PlatformAuditLog**: her mutasyon VE her hassas okuma (destek penceresi görüntülemeleri, ödeme detayı açma, tenant-detay AI raporu, her dışa aktarım) loglanır; append-only, min. 10 yıl.
9. **ANALYST_READONLY sözleşmesi**: tenant/büro adı, kullanıcı e-postası, TCKN/telefon/IBAN türü her PII, tekil ödeme detayı, AiProviderConfig, PlatformAuditLog **asla** görünmez; tenant gösterimi gerektiğinde takma ad ("Tenant #A3F2") veya segment; dışa aktarım kolon bazlı **allowlist** ile sınırlıdır (blocklist değil) ve filigranlıdır.

## API Uçları

Prefix: `/api/admin/v1`. Guard zinciri: `PlatformJwtGuard → PlatformRoleGuard(matris) → (gerekirse) FourEyesGuard → PlatformAuditInterceptor`; yetki matrisi tek kaynaktan (`platform-permissions.ts`) tanımlanır, UI ve API aynı tanımı kullanır. Hata gövdesi mevcut sözleşmeyle aynı (`{statusCode, message(TR), error}`); liste uçları `?page&pageSize&sort`; Zod şemaları `@nomosos/shared/admin`. Rate limit: `/auth/*` IP başına 5/dk, genel 120/dk/kullanıcı.

Roller: **S**=SUPER_ADMIN, **O**=OPS_ADMIN, **B**=BILLING_ADMIN, **D**=SUPPORT_AGENT, **A**=ANALYST_READONLY. Tüm mutasyonlar A için her koşulda 403.

| Metod | Yol | Açıklama | Roller |
|-------|-----|----------|--------|
| POST | /auth/login | e-posta+şifre → 2FA challenge | anon |
| POST | /auth/2fa/verify | TOTP → platform JWT | anon |
| GET | /auth/me | Profil + rol | S O B D A |
| GET/POST | /platform-users | Personel listesi / davet (rolle) | S |
| PATCH/DELETE | /platform-users/:id | Rol/durum değiştir / pasifleştir (hard delete yok; son SUPER_ADMIN korunur) | S |
| GET | /tenants | Liste + filtre (durum, plan, il, arama) | S O B D |
| GET | /tenants/:id | Detay (sayaçlar, abonelik, snapshot'lar) | S O B D |
| POST | /tenants | Manuel tenant açılışı — D5: dört-göz `TENANT_CREATE` talebi; tenant+kullanıcı+TRIAL abonelik ikinci imzada kurulur | S O (4️⃣) |
| PATCH | /tenants/:id | Metadata (billing_email, city, kota override) | S O |
| POST | /tenants/:id/suspend · /reactivate | Askıya al (gerekçe zorunlu, dört-göz) / çıkar | S O B* |
| DELETE | /tenants/:id | Soft-delete + anonimleştirme kuyruğu (dört-göz) | S |
| GET | /tenants/:id/usage | UsageSnapshot serisi | S O B D |
| GET/POST/PATCH | /judicial/bodies · /notaries · /tax-offices (+ /:id) | REFERANS KATALOĞU yönetimi: mahkeme/icra dairesi, noterlik, vergi dairesi (D7) — SEED→SYNC→MANUAL; bureau formlarındaki seçim listeleri | S O (yazma: judicial.manage) |
| GET/PUT | /judicial/sync/settings + /sync + /sync/logs | Katalog senkron kaynağı ve günlüğü | S O |
| GET | /fine-tune-jobs | Fine-tune işleri + ONAYLANMIŞ havuz anlık görüntüsü (D5) | S O D A |
| POST | /fine-tune-jobs | İş açma — anlık görüntü alır; sağlayıcıya otomatik gönderim YOK | S O |
| GET | /fine-tune-jobs/:id/manifest | Manifest (JSONL, yalnız ONAYLANMIŞ örnekler; HAZIRLANDI/GONDERILDI) | S O |
| POST | /fine-tune-jobs/:id/status | Şerit denetimli durum geçişi; TAMAMLANDI'da model adı zorunlu | S O |
| GET/POST | /tenants/:id/notes | TenantNote | S O B D |
| GET · POST/PATCH | /plans | PlanTier kataloğu / tanımı (fiyat değişikliği mevcut aboneyi dönem sonuna dek etkilemez) | GET: S O B D A · yazma: S B |
| GET | /subscriptions | Liste + durum filtresi (PAST_DUE kuyruğu) | S O B |
| POST | /subscriptions/:id/transition | Durum geçişi `{to, reason}` — makine kuralları guard'da | S O B |
| POST | /subscriptions/:id/change-plan | Plan değişikliği (proration notu detail'e) | S B |
| GET | /payments | PaymentRecord listesi/filtre | S B |
| POST | /payments/webhook/:provider | Ödeme sağlayıcı webhook (imza doğrulamalı, JWT'siz) | imza |
| POST | /payments/:id/refund | İade talebi (dört-göz: onay ayrı uçtan, ayrı kişiden) | S B |
| GET · POST | /invoices · /invoices/:id/issue | InvoiceRecord listesi / DRAFT→ISSUED | S B |
| GET/POST/PATCH | /support-grants · /:id/revoke | SupportAccessGrant yaşam döngüsü | D O S |
| GET · PUT | /settings · /settings/:key | SystemSetting listesi / güncelleme | GET: S O · PUT: S |
| GET · POST/PATCH · PUT | /flags · /flags/:id · /flags/:id/overrides | FeatureFlag + tenant override | GET: S O · yazma: S O |
| GET/POST/PATCH/DELETE | /announcements | Duyuru CRUD | GET: S O B D · yazma: S O |
| GET/POST · PATCH | /approvals · /approvals/:id | Dört-göz talep listesi / onay-red (talep eden onaylayamaz) | ilgili roller |
| GET | /metrics/overview | Platform KPI (tenant, MRR, churn, dönüşüm, AI toplamları) | S O B D |
| GET | /metrics/ai | taskType × providerType × gün pivotu; top-20 tenant; PII oranı | S O B D |
| GET | /metrics/growth | Aktivasyon hunisi, il/baro dağılımı, kohortlar | S O B |
| GET | /metrics/system | Canlı sağlık (Prometheus proxy, Redis cache) | S O D |
| GET | /metrics/board-report | Kurul Raporu veri seti (kolon allowlist'li) | S B A |
| GET | /audit-logs | PlatformAuditLog arama/filtre; export dört-göz | S · O/B/D (kendi alanı) |

*B yalnız ödeme temerrüdü gerekçesiyle suspend talep edebilir.

## Uygulama Yerleşimi

**Net öneri: ayrı `apps/admin` (`@nomosos/admin`, Next.js, port 3002; `admin.nomosos.com`).** `apps/web` içinde `/admin` bölgesi REDDEDİLİR. Gerekçe:

1. **Fiziksel kimlik ayrımı en ucuz güvenlik sınırıdır**: ayrı origin, ayrı cookie scope, ayrı bundle — middleware hatası tenant kullanıcısına admin yüzeyi sızdıramaz; iki auth sistemi tek app'te karışmaz.
2. **Ağ kontrolü**: IP allowlist/VPN yalnız bu app'e uygulanır; panel internete hiç açılmayabilir. Tenant UX'i etkilenmez.
3. **Deploy izolasyonu**: panel deploy'u tenant uygulamasını riske atmaz (ve tersi).
4. **KVKK denetim cevabı**: "platform personeli tenant uygulamasına hangi yoldan erişebilir?" → "hiçbir yoldan — ayrı uygulama, ayrı kimlik."
5. Monorepo'da `packages/shared` ortak olduğundan ek maliyet sınırlıdır.

API tarafında başlangıçta aynı NestJS süreci içinde ayrı modül yeterlidir (`apps/api/src/admin/**`, `/api/admin/v1` prefix, guard izolasyonu + ayrı JWT secret; hiçbir middleware tenant zinciriyle paylaşılmaz); trafik büyüyünce ayrı servise çıkarılabilir.

## İş Kuralları

1. Panel kimliği tenant kimliğinden ayrıdır: `PlatformUser` ↔ `User` arasında FK yoktur; tenant JWT'si panel uçlarında, panel JWT'si tenant uçlarında 401 döner (aud + ayrı secret).
2. 2FA kurulumu tamamlanmamış `PlatformUser` yalnız 2FA kurulum ucuna erişebilir; platform girişi 2FA'sız kabul edilmez.
3. Varsayılan read-only: matriste açıkça verilmeyen her işlem yasaktır; `ANALYST_READONLY` için tüm mutasyon uçları API katmanında 403 döner — UI'da gizleme yeterli sayılmaz.
4. Dört-göz listesindeki işlemler (Roller bölümü, 1–8) tek kişiyle tamamlanamaz; talep eden ≠ onaylayan; onay bekleyen kayıt 72 saatte zaman aşımına düşer.
5. Sistemde her an en az iki aktif SUPER_ADMIN bulunur; son SUPER_ADMIN silinemez/düşürülemez/pasifleştirilemez; kendi rolünü kimse düşüremez.
6. Her mutasyon gerekçe alanıyla `PlatformAuditLog`'a yazılır; log append-only'dir (DB rolünde UPDATE/DELETE yok), min. 10 yıl saklanır; hassas okumalar da (destek görüntüleme, ödeme detayı, dışa aktarım) loglanır.
7. Panel tenant içeriği görmez: `AiUsageLog`'dan yalnız metrik kolonları okunur; `encryptedApiKey` hiçbir yanıtta dönmez (yalnız `hasApiKey`); tenant ham verisine tek kapı aktif `SupportAccessGrant`'tir.
8. Destek erişimi salt-okur, süreli (varsayılan 4 saat, azami 24), kapsam sınırlı ve çift taraflı logludur (PlatformAuditLog + tenant AuditLog); PII her kapsamda maskeli kalır; süre dolunca erişim kendiliğinden kapanır. Impersonation ucu hiç yazılmaz.
9. Abonelik durum geçişleri yalnız durum makinesi kurallarına uyar; `SUSPENDED/CANCELED` tenant'ta kullanıcı girişleri "Aboneliğiniz askıda" (403, Türkçe) ile kesilir; veri silinmez, `CANCELED` + saklama süresi sonrası anonimleştirme kuyruğa alınır.
10. Askıya alma dunning zincirinin son adımıdır (e-posta → uyarı → askı); `PAST_DUE → SUSPENDED` geçişi `past_due_grace_days` ayarına bağlı otomatik cron'dur.
11. İadeyi açan kişi onaylayamaz; eşik üstü ve toplu iadelerde onay SUPER_ADMIN'dendir.
12. Plan fiyat değişikliği mevcut aboneleri cari dönem sonuna kadar etkilemez; satıştan kaldırılan plan pasife çekilir, mevcut aboneler korunur.
13. Panel token sayar, fiyatlamaz: AI maliyet kolonu yoktur (BYO-LLM); token bilgisi olmayan çağrılar ayrı sayılır, sıfır varsayılmaz.
14. Kurul Raporu veri seti kolon bazlı allowlist ile tanımlıdır; tenant kimliği taşıyan alan bu kümeye eklenemez; tüm dışa aktarımlar sunucu tarafında rol filtresinden geçer ve filigranlıdır.
15. Platform personeli davet-temelli oluşturulur; self-signup ucu hiç yazılmaz; `DEVRE_DISI` statüsü tüm aktif oturumları anında düşürür.

## Diğer Modüllerle İlişkiler

- **docs/01-mimari.md**: multi-tenant izolasyon ve JWT modelinin platform-tarafı ikizi; `Tenant.status` guard'ı tenant auth zincirine eklenir.
- **docs/03-ai-katmani-byo-llm.md**: AI analitiği `AiUsageLog`/`AiProviderConfig` metadata'sını okur; BYO-LLM maliyet ilkesi panelin "token sayar, fiyatlamaz" kuralının kaynağıdır.
- **Modül 06 (Belge→Aksiyon)** ve BullMQ altyapısı: kuyruk sağlık kartı bu hattın omurgasını izler; `usage-snapshot` cron'u aynı kuyruk altyapısını kullanır.
- **Modül 09 (Faturalama)**: tenant'ın müvekkile kestiği `Invoice` ile platformun tenant'a kestiği `InvoiceRecord` ayrı dünyalardır; adlandırma bilinçli ayrıştırılmıştır.
- **Modül 18 (Partner Dashboard)**: tenant-içi metriklerin büro görünümü; bu modül aynı fikrin platform-ötesi (cross-tenant) karşılığıdır.
- **Duyurular**: tenant uygulaması `GET /api/v1/announcements` ile aktif duyuruları gösterir (tek yönlü).
- **docs/02-veri-modeli.md**: platform tabloları şemanın "Platform katmanı" bölümü olarak eklenir ve bu doküman veri modelinin ikizi olarak güncel tutulur.

## Kabul Kriterleri

1. Tenant JWT ile `/api/admin/v1/*` çağrısı 401; panel JWT ile `/api/v1/*` çağrısı 401 dönüyor (negatif test).
2. 2FA kurulmamış PlatformUser hiçbir panel sayfasına/ucuna erişemiyor; 2FA'sız login tamamlanmıyor.
3. `ANALYST_READONLY` ile herhangi bir POST/PATCH/DELETE 403 dönüyor; Kurul Raporu yanıtında tenant adı/e-posta/PII kolonu bulunmadığı şema testiyle kanıtlı.
4. Tenant askıya alma tek OPS_ADMIN ile tamamlanamıyor (onaysız istek `BEKLIYOR`'da kalıyor); onaylanan askıda tenant kullanıcısı girişte Türkçe açıklamalı 403 alıyor; veri silinmiyor.
5. İadeyi açan BILLING_ADMIN kendi talebini onaylamaya çalıştığında 403 alıyor; farklı yetkilinin onayıyla iade sağlayıcıya iletiliyor.
6. Süresi dolan `SupportAccessGrant` ile tenant verisi isteği 403 dönüyor; aktif grant altındaki her görüntüleme hem PlatformAuditLog'da hem tenant AuditLog'unda (`PLATFORM_DESTEK_ERISIMI`) görünüyor; TCKN/IBAN alanları her kapsamda maskeli geliyor.
7. Hiçbir `/api/admin/v1` yanıtında `encryptedApiKey` alanı bulunmuyor (sözleşme testi); AiProviderConfig yanıtı yalnız tip/model/`hasApiKey` içeriyor.
8. `PAST_DUE` aboneliği `past_due_grace_days` sonunda cron ile `SUSPENDED`'a geçiyor; geçersiz durum geçişi (örn. `CANCELED → ACTIVE`) 422 dönüyor; her geçiş PlatformAuditLog'da.
9. PlatformAuditLog'a UPDATE/DELETE denemesi DB seviyesinde reddediliyor; panel her mutasyondan sonra ilgili log satırını üretiyor (interceptor testi).
10. Gece `usage-snapshot` işi idempotent: aynı gün için ikinci çalıştırma mükerrer satır üretmiyor; "bugün" kartları Redis sayaçlarından, tarihsel grafikler snapshot'tan geliyor.
11. Son SUPER_ADMIN'i pasifleştirme/silme/rol düşürme istekleri 422 dönüyor.
12. Anomali kuralı (günlük token > 14 günlük ort. × 3) test verisiyle tetikleniyor ve `PlatformAlert` kaydı + panelde rozet üretiyor.
13. Feature flag tenant allowlist modunda yalnız listedeki tenant'larda aktif; değişiklik geçmişi kim/ne zaman bilgisiyle listeleniyor.
14. Tüm CSV dışa aktarımları sunucu tarafı rol filtresinden geçiyor ve audit kaydı üretiyor; ANALYST_READONLY ihracında tenant kimliği kolonu bulunmuyor.

## Faz

Mevcut yol haritasına (docs/06) **kesit olarak eklemlenir**; ayrı bir "Faz 7" açılmaz:

| Faz | Platform paneli işi |
|-----|---------------------|
| **Faz 1 (eklenti)** | Şema: PlatformUser, PlanTier, Subscription, Tenant.status alanları, PlatformAuditLog, PlatformApprovalRequest, SystemSetting. API: auth (2FA), tenants (liste/detay/suspend), platform-users, settings. `apps/admin` iskeleti. Tenant auth guard'ına `Tenant.status` kontrolü. Rol guard'ları + negatif testler (tenant-ötesi test disipliniyle aynı çıta) |
| **Faz 2** | UsageSnapshot + gece BullMQ cron'u (kuyruk altyapısı bu fazda zaten geliyor). FeatureFlag/Override, Announcement, SupportAccessGrant + destek erişim akışı. `/metrics/overview`, `/metrics/ai`, `/metrics/system` (Prometheus proxy). AiUsageLog'a status/providerType alanları |
| **Faz 3** | PaymentRecord, InvoiceRecord, iyzico/Stripe webhook, dunning + `PAST_DUE→SUSPENDED` otomasyonu, iade dört-göz akışı, BILLING_ADMIN ekranları. (Tenant tarafı aynı fazda müvekkil Invoice/Payment yapıyor — adlar bilinçli ayrık) |
| **Faz 4** | Analitik derinleşme: `/metrics/growth`, kohort/churn, tenant sağlık skoru, anomali motoru (PlatformAlert), Kurul Raporu + zamanlanmış e-posta özetleri, ANALYST_READONLY rolünün devreye alınması |
| **Faz 5** | Enterprise operasyonu: `Tenant.dataRegion` işaretleme, plan-bazlı feature setleri, özel fiyat akışı |
| **Faz 6** | e-Fatura/e-Arşiv (`InvoiceRecord.eInvoiceRef`), `CANCELED` tenant anonimleştirme kuyruğu, gerekirse scope-tabanlı ince yetki modeli |
