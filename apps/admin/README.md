# @nomosos/admin — Platform Yönetim Paneli

NomosOS'u **işleten şirketin** operasyon panelidir. Tenant uygulamasından (`apps/web`) tamamen ayrı
bir Next.js 15 uygulamasıdır: ayrı port, ayrı origin, ayrı JWT, ayrı localStorage anahtarı.

> Kaynak spec: `docs/moduller/25-sistem-yonetim-paneli.md`

| | Tenant uygulaması (`apps/web`) | Platform paneli (`apps/admin`) |
|---|---|---|
| Port | 3000 | **3002** |
| API öneki | `/api/v1` | **`/api/admin/v1`** |
| Token anahtarı | `nomosos_token` | **`nomosos_admin_token`** |
| Kimlik | `User` (tenant) | **`PlatformUser`** (FK yok, ayrı e-posta uzayı) |
| JWT audience | tenant | **`aud: "platform"`** (payload `{ sub, role, aud }`, `tenantId` YOK) |
| Tema | açık zemin · lacivert/altın | **koyu çelik gri · mor-indigo** |

Temanın farklı olması bilinçlidir: operatör hangi uygulamada olduğunu bir bakışta ayırt etmelidir.
Platform token'ı `/api/v1`'de, tenant token'ı `/api/admin/v1`'de **asla** geçerli değildir
(`aud` kontrolü `PlatformJwtGuard`'ın işidir).

## Çalıştırma

```bash
pnpm install                              # kök dizinde (bir kez)
pnpm --filter @nomosos/admin dev          # http://localhost:3002
pnpm --filter @nomosos/admin build
pnpm --filter @nomosos/admin typecheck
```

Ortam değişkeni:

```
NEXT_PUBLIC_ADMIN_API_URL=http://localhost:3001   # varsayılan
```

Panel `${NEXT_PUBLIC_ADMIN_API_URL}/api/admin/v1/...` uçlarını çağırır.

### Temsili veri YOKTUR

Panel gerçek API'ye bağlıdır. Bir uç **ağ hatası / 404 / 501–504** verirse ekranda
**“Bu uç henüz hazır değil”** bilgilendirmesi çıkar; uydurma sayı gösterilmez ve gerçek veriyle
karıştırılmaz. 403'te “yetkiniz yok” denir — yetkisiz veri hiçbir koşulda üretilmez.
Boş yanıt ayrıca “kayıt yok” olarak gösterilir.

### Giriş akışı (iki adımlı)

`POST /api/admin/v1/auth/login`

1. `{ email, password }`
   - `{ token, user }` → giriş tamam
   - `{ twoFactorRequired: true }` **veya** 401/403/428 + gövdede `TOTP`/`2FA` ipucu → 2. adım
2. `{ email, password, totp }` → `{ token, user }`

Token `localStorage("nomosos_admin_token")`'a, profil `nomosos_admin_user`'a yazılır. Açılışta
`GET /auth/me` ile rol sunucudan tazelenir; 401'de oturum düşer ve `/giris`'e yönlendirilir.

## Sayfalar ve bağlandıkları uçlar

| Yol | Ekran | Gerekli yetki (`rbac.ts`) | Tükettiği uçlar |
|---|---|---|---|
| `/giris` | Personel girişi (şifre → gerekirse TOTP) | — | `POST /auth/login` |
| `/` | Genel Bakış: KPI'lar, 30 günlük AI serisi, sağlık, bekleyen onaylar, kritik denetim kayıtları | `metrics.overview.view` | `/metrics/overview`, `/health`, `/approvals?status=BEKLIYOR`, `/audit`, `/metrics/usage` |
| `/` (ANALYST) | **Yatırımcı Görünümü** — bu rolün tek ekranı | `board_report.view` | `/metrics/investor` |
| `/tenantlar` | Liste: `?q=&status=&plan=` (sunucu tarafı filtre), CSV | `tenant.view` | `/tenants` |
| `/tenantlar/[id]` | Genel · Kullanım · Destek Erişimi · Denetim İzi | `tenant.view` | `/tenants/:id`, `/tenants/:id/suspend`, `/tenants/:id/activate`, `/metrics/usage`, `/metrics/ai`, `/support-access`, `/tenants/:id/support-access`, `DELETE /support-access/:id`, `/audit` |
| `/abonelikler` | Durum makinesi, plan/koltuk/durum düzenleme, iptal, CSV | `subscription.view` | `/subscriptions`, `PATCH /subscriptions/:id`, `POST /subscriptions/:id/cancel` |
| `/odemeler` | Ödeme kayıtları · başarısız kuyruğu · iade akışı, CSV | `payment.view` | `/payments?status=`, `/payments/failed`, `POST /payments/:id/refund` |
| `/kullanim` | AI/token analitiği: `groupBy` = tenant / görev tipi / sağlayıcı / model + CSS-SVG grafikler + CSV | `ai.analytics.platform` | `/metrics/ai?groupBy=`, `/metrics/usage?from=&to=` |
| `/onaylar` | Dört-göz onay kuyruğu (payload özeti, onayla/reddet) | `approval.view` | `/approvals?status=`, `POST /approvals/:id/approve|reject` |
| `/sistem` | Ayarlar · feature flags · duyurular · sağlık | `system.settings` | `/settings`, `PUT /settings`, `/feature-flags` (+`POST`/`PATCH`), `/announcements` (+`POST`/`PATCH`/`DELETE`), `/health` |
| `/yoneticiler` | Platform personeli + kodlanmış yetki matrisi | `platform_user.view` (SUPER_ADMIN) | `/platform-users` (+`POST`/`PATCH`/`DELETE`) |
| `/denetim` | PlatformAuditLog görüntüleyici (filtreli, CSV) | `audit.view` | `/audit` |

Menü rol bazlıdır: yetkisi olmayan rol o girişi **hiç görmez** (`src/lib/nav.ts` + `can()`).

### İstemci sözleşmeleri (sunucu tarafının bilmesi gerekenler)

- **Liste uçları** düz dizi ya da `{ data | items | results | rows }` sarmalayıcısı döndürebilir.
- **Decimal** alanlar string (`"40000.00"`) ya da sayı gelebilir; panel yalnız *gösterir*,
  aritmetik yapmaz. **BigInt** (`storageBytes`) string gelebilir.
- **Dört-göz** akışına düşen yazma uçları `{ approvalRequestId }` (veya `{ requiresApproval: true }`)
  döndürürse panel “Onay talebi oluşturuldu, işlem UYGULANMADI” mesajını gösterir.
- `PUT /settings` gövdesi: `{ key, valueJson, reason }`.
- `GET /health` hem `{ checks: [...] }` hem Nest Terminus (`{ status, info, details, error }`)
  biçimini kabul eder.
- Enum değerleri `packages/db` şemasıyla birebirdir: `SubscriptionStatus`, `PlatformPaymentStatus`,
  `ApprovalStatus` (**`SURESI_DOLDU`**), `SupportScope` (`SADECE_USTVERI` / `YAPILANDIRMA` /
  `ICERIK_MASKELI`), `AnnouncementSeverity` (`BILGI` / `UYARI` / `KRITIK`), `AnnouncementAudience`
  (`TUM` / `PLAN_BAZLI` / `TENANT_BAZLI`).

## Rol matrisi (özet)

`src/lib/rbac.ts` spec tablosunun bire bir kodlanmış hâlidir. Seviyeler:
`full` ✅ · `read` 👁 · `masked` 🔒 · `four_eyes` 4️⃣ · `none` ❌

| İşlem | SUPER_ADMIN | OPS_ADMIN | BILLING_ADMIN | SUPPORT_AGENT | ANALYST_READONLY |
|---|---|---|---|---|---|
| Tenant listesi/detayı | ✅ | ✅ | ✅ | ✅ | 🔒 (plan/durum agregatı) |
| Tenant askıya al / aktifleştir | ✅ | 4️⃣ | 4️⃣ | ❌ | ❌ |
| Plan değiştir / özel fiyat | ✅ / ✅ | ❌ | ✅ / 4️⃣ | ❌ | ❌ |
| İade | 4️⃣ | ❌ | 4️⃣ | ❌ | ❌ |
| Ödeme detayı | ✅ | ❌ | ✅ | 👁 (ödendi/ödenmedi) | 🔒 (yalnız yatırımcı özeti) |
| Sistem ayarı / flag | ✅ | ✅ (tam kilit ve global flag 4️⃣) | ❌ | ❌ | ❌ |
| Duyuru yayınla | ✅ | ✅ | ❌ | ❌ | ❌ |
| Sistem sağlığı | ✅ | ✅ | ❌ | 👁 | ❌ |
| AI analitiği (platform / tenant) | ✅ / ✅ | ✅ / ✅ | 👁 / 👁 | 👁 / 👁 | 🔒 / ❌ |
| Destek erişimi | 4️⃣ | ❌ | ❌ | 4️⃣ | ❌ **asla** |
| AiProviderConfig üstverisi | ✅ | 👁 | ❌ | 👁 | ❌ |
| Platform kullanıcısı / rol | ✅ (SUPER ataması 4️⃣) | ❌ | ❌ | ❌ | ❌ |
| PlatformAuditLog görüntüle / dışa aktar | ✅ / 4️⃣ | 👁 | 👁 | 👁 | ❌ |
| Yatırımcı görünümü | ✅ | ❌ | ✅ | ❌ | 👁 |

Kod tarafındaki API:

```ts
can(role, action)              // herhangi bir görünürlük var mı? (menü/düğme)
canMutate(role, action)        // yazma yetkisi (full | four_eyes); ANALYST için her zaman false
requiresApproval(role, action) // dört-göz gerekiyor mu?
isMasked(role, action)         // 🔒 maskeli (takma adlı) gösterim mi?
levelOf(role, action)          // ham seviye
canApproveRequest(role, userId, requestedById) // talep eden ≠ onaylayan
```

Bileşenler: `<RoleGate action=… mutation>` (yetkisize düğmeyi hiç render etmez),
`<PageGate action=…>` (tam sayfa “yetkiniz yok”), `<ApprovalBadge>` / `<ApprovalNotice>` /
`<ApprovalStatusBadge>`, `<ResourceView>` (yükleniyor / uç yok / 403 / hata / boş).

**UI'da gizleme yalnız ergonomidir.** Yaptırım API katmanındadır: `PlatformRoleGuard` aynı matrisi
kullanmalı, `ANALYST_READONLY` için tüm mutasyon uçları koşulsuz 403 dönmelidir.

### ANALYST_READONLY (yatırımcı) görünümündeki farklar

- Menüde **yalnız** “Yatırımcı Görünümü” vardır; diğer bağlantılar render edilmez.
- Üst çubukta `SALT-OKUR` rozeti görünür.
- Hiçbir ekranda yazma düğmesi yoktur (`canMutate` her zaman `false`).
- Tenant listesi maskelidir (plan/durum agregatı); tenant detayı “müvekkil/dosya verisi
  görüntülenemez” açıklamasıyla kapalıdır.
- Ödemeler ekranı tekil kayıt göstermez, yatırımcı görünümüne yönlendirir.
- AI kullanımında tenant kimliği yerine oturum kapsamlı takma ad kullanılır.

## KVKK / güvenlik ilkeleri (arayüze işlenmiş hâli)

- **Impersonation yoktur** ve yazılmayacaktır. Tenant verisine tek kapı süreli
  `SupportAccessGrant`'tir: gerekçe zorunlu + kapsam (`SADECE_USTVERI` / `YAPILANDIRMA` /
  `ICERIK_MASKELI`) + süre (varsayılan 4 sa, **azami 24 sa**) + dört-göz, **salt-okur**, PII maskeli.
  Kayıt hem `PlatformAuditLog`'a hem tenant'ın kendi `AuditLog`'una yazılır.
- `encryptedApiKey` hiçbir ekranda, maskeli dahi gösterilmez — yalnız `hasApiKey: boolean` + tip/model.
  `twoFactorSecret` de hiçbir yanıtta dönmez.
- Panel token **sayar**, fiyatlamaz: AI maliyet kolonu yoktur; token bilgisi dönmeyen çağrılar
  “token bilgisi yok” olarak ayrı sayılır, **sıfır varsayılmaz**.
- `ANALYST_READONLY` görünümlerinde tenant kimliği **oturum kapsamlı takma adla** (`Tenant #001`)
  gösterilir; takma ad gerçek kimlikten türetilmez. Asıl gereklilik sunucudadır:
  `/metrics/investor` yanıtı tenant kimliği taşıyan kolon içermemelidir.
- Her mutasyon **gerekçe** alanı ister; gerekçe PlatformAuditLog'a yazılır (append-only).
- Dört-göz: talep eden kendi talebini onaylayamaz — panel düğmeyi baştan pasifleştirir ve
  “Sizin talebiniz” rozetiyle açıklar; sunucu aksi denemeyi 403 ile reddeder. Onaylanmayan
  talep 72 saatte `SURESI_DOLDU` olur.

## Dizin yapısı

```
apps/admin/
├─ src/app/
│  ├─ layout.tsx              # html/body + globals.css
│  ├─ giris/page.tsx          # iki adımlı (şifre → TOTP) giriş
│  └─ (panel)/                # oturum gerektiren kabuk (rol bazlı menü)
│     ├─ layout.tsx
│     ├─ page.tsx             # Genel Bakış / Yatırımcı Görünümü
│     ├─ tenantlar/…          # liste + [id] detay sekmeleri
│     ├─ abonelikler/ odemeler/ kullanim/ onaylar/ sistem/ yoneticiler/ denetim/
├─ src/components/
│  ├─ ui.tsx                  # Button, Card, Badge, Table, Modal, StatCard, BarList,
│  │                          # ColumnChart, LineChart, StackedBar, ResourceView,
│  │                          # EndpointMissingNotice…
│  ├─ RoleGate.tsx            # RoleGate, PageGate, NoAccessInline, useCan/useCanMutate
│  └─ ApprovalBadge.tsx       # dört-göz rozet/uyarı/durum bileşenleri
└─ src/lib/
   ├─ api.ts                  # /api/admin/v1 istemcisi, 401 → /giris
   ├─ endpoints.ts            # EP.* — tüm uç yolları tek yerde
   ├─ types.ts                # API yanıt tipleri (şemadan türetilmiş)
   ├─ rbac.ts                 # 5 rol + yetki matrisi + can()/canMutate()/requiresApproval()
   ├─ session.tsx             # AdminSessionProvider + useAdminSession (+ /auth/me tazeleme)
   ├─ useResource.ts          # useResource / useListResource (mock YOK)
   ├─ useMutation.ts          # yazma işlemleri: 403 / uç yok / dört-göz mesajları
   ├─ useDebounced.ts         # arama kutuları
   ├─ health.ts               # /health yanıt normalizasyonu
   ├─ csv.ts                  # istemci tarafı CSV üretimi + indirme
   ├─ labels.ts               # Türkçe etiketler, rozet tonları, biçimlendirme
   └─ nav.ts                  # rol bazlı menü
```
