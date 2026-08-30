# @nomosos/admin — Platform Yönetim Paneli

NomosOS'u **işleten şirketin** operasyon panelidir. Tenant uygulamasından (`apps/web`) tamamen ayrı
bir Next.js 15 uygulamasıdır: ayrı port, ayrı origin, ayrı JWT, ayrı localStorage anahtarı.

> Kaynak spec: `docs/moduller/25-sistem-yonetim-paneli.md`

| | Tenant uygulaması (`apps/web`) | Platform paneli (`apps/admin`) |
|---|---|---|
| Port | 3000 | **3002** |
| API öneki | `/api/v1` | **`/api/v1/admin`** |
| Token anahtarı | `nomosos_token` | **`nomosos_admin_token`** |
| Kimlik | `User` (tenant) | **`PlatformUser`** (FK yok, ayrı uzay) |
| JWT audience | `nomosos` | **`nomosos-admin`** (farklı imza anahtarı, `tenantId` alanı yok) |
| Tema | açık zemin · lacivert/altın | **koyu çelik gri · mor-indigo** |

Temanın farklı olması bilinçlidir: operatör hangi uygulamada olduğunu bir bakışta ayırt etmelidir.

## Çalıştırma

```bash
pnpm install                 # kök dizinde (bir kez)
pnpm --filter @nomosos/admin dev        # http://localhost:3002
pnpm --filter @nomosos/admin build
pnpm --filter @nomosos/admin typecheck
```

Ortam değişkeni:

```
NEXT_PUBLIC_ADMIN_API_URL=http://localhost:3001   # varsayılan
```

Panel `${NEXT_PUBLIC_ADMIN_API_URL}/api/v1/admin/...` uçlarını çağırır.

> **Önek kararı (denetim bulgusu):** önceki değer `/api/admin/v1` idi; `apps/api` TEK bir
> global önek kullandığı için (`setGlobalPrefix("api/v1")`) bu önek ancak ayrı bir Nest
> uygulaması ya da `exclude` listesi ile mümkündü ve API tarafında yazılı bir karşılığı
> yoktu. Panel uçları mevcut uygulamada `@Controller("admin/...")` altında yayınlanır.
> Ayrım kimlik düzeyinde korunur: ayrı JWT, ayrı localStorage anahtarı, ayrı port ve origin.

### API henüz yokken

`/api/v1/admin` uçlarının hiçbiri yazılmadı. Her ekran ucu çağırır; **ağ hatası / 404 / 501**
durumunda ekranın üstünde “Bu uç Faz N'te uygulanacak” bilgilendirme kutusu ve yanında
**temsili (mock) veriyle** dolu arayüz gösterilir. Mock veri her yerde `TEMSİLİ VERİ` rozetiyle
işaretlidir (`src/lib/mock.ts`).

Giriş ekranındaki **“Temsili oturum başlat”** düğmesiyle rol seçip paneli gezebilirsiniz; temsili
oturumda hiçbir gerçek API çağrısı yapılmaz (`demo::` ön ekli token). 403 dönen bir uçta mock
gösterilmez — yetkisiz veri hiçbir koşulda uydurulmaz.

## Sayfalar

| Yol | Ekran | Gerekli yetki (`rbac.ts`) | Tükettiği uçlar |
|---|---|---|---|
| `/giris` | Personel girişi (e-posta + şifre → TOTP) | — | `POST /auth/login`, `POST /auth/2fa/verify` |
| `/` | Genel Bakış: KPI'lar, sağlık şeridi, dikkat gerektirenler, son kritik olaylar, bekleyen onaylar | `metrics.overview.view` | `/metrics/overview`, `/metrics/system` |
| `/` (ANALYST) | **Kurul Raporu** görünümü — analistin tek ekranı | `board_report.view` | `/metrics/board-report` |
| `/tenantlar` | Liste: arama, plan/durum filtresi, sayaçlar | `tenant.view` | `/tenants` |
| `/tenantlar/[id]` | Detay sekmeleri: Genel · Kullanıcılar · Abonelik · Kullanım · Destek Erişimi · Denetim İzi | `tenant.view` | `/tenants/:id`, `/tenants/:id/users`, `/tenants/:id/usage`, `/support-grants`, `/audit-logs` |
| `/abonelikler` | Durum makinesi rozetleri, durum geçişi, plan değişikliği | `subscription.view` | `/subscriptions`, `/subscriptions/:id/transition`, `/subscriptions/:id/change-plan` |
| `/odemeler` | Ödeme kayıtları · başarısız/dunning kuyruğu · faturalar · iade akışı | `payment.view` | `/payments`, `/payments/:id/refund`, `/invoices` |
| `/kullanim` | AI/token analitiği: tenant × görev tipi × sağlayıcı × model pivotu + CSS/SVG grafikler | `ai.analytics.platform` | `/metrics/ai` |
| `/sistem` | Ayarlar · bakım modu · feature flags · duyurular | `system.settings` | `/settings`, `/flags`, `/announcements`, `/metrics/system` |
| `/yoneticiler` | Platform personeli, roller + kodlanmış yetki matrisi tablosu | `platform_user.view` (yalnız SUPER_ADMIN) | `/platform-users` |
| `/denetim` | PlatformAuditLog görüntüleyici (filtreli, CSV dışa aktarım dört-göz) | `audit.view` | `/audit-logs` |
| `/onaylar` | Dört-göz onay kuyruğu (onayla/reddet + step-up 2FA) | `approval.view` | `/approvals`, `/approvals/:id` |

Menü rol bazlıdır: yetkisi olmayan rol o girişi **hiç görmez** (`src/lib/nav.ts` + `can()`).

## Rol matrisi (özet)

`src/lib/rbac.ts` spec tablosunun bire bir kodlanmış hâlidir. Seviyeler:
`full` ✅ · `read` 👁 · `masked` 🔒 · `four_eyes` 4️⃣ · `none` ❌

| İşlem | SUPER_ADMIN | OPS_ADMIN | BILLING_ADMIN | SUPPORT_AGENT | ANALYST_READONLY |
|---|---|---|---|---|---|
| Tenant listesi/detayı | ✅ | ✅ | ✅ | ✅ | 🔒 (plan/segment agregatı) |
| Tenant oluştur | ✅ | ✅ | ❌ | ❌ | ❌ |
| Tenant askıya al / aktifleştir | ✅ | 4️⃣ | 4️⃣ | ❌ | ❌ |
| Tenant kalıcı sil | 4️⃣ | ❌ | ❌ | ❌ | ❌ |
| Plan değiştir / özel fiyat | ✅ / ✅ | ❌ | ✅ / 4️⃣ | ❌ | ❌ |
| İade | 4️⃣ | ❌ | 4️⃣ | ❌ | ❌ |
| Ödeme/fatura detayı | ✅ | ❌ | ✅ | 👁 (ödendi/ödenmedi) | 🔒 (MRR/churn) |
| Sistem ayarı / flag | ✅ | ✅ (tam kilit 4️⃣) | ❌ | ❌ | ❌ |
| Duyuru yayınla | ✅ | ✅ | ❌ | ❌ | ❌ |
| Sistem sağlığı | ✅ | ✅ | ❌ | 👁 | ❌ (yalnız uptime) |
| AI analitiği (platform / tenant) | ✅ / ✅ | ✅ / ✅ | 👁 / 👁 | 👁 / 👁 | 🔒 / ❌ |
| Destek erişimiyle tenant içeriği | 4️⃣ + grant | ❌ | ❌ | 4️⃣ + grant | ❌ **asla** |
| AiProviderConfig metadata | ✅ | 👁 | ❌ | 👁 | ❌ |
| Platform kullanıcısı / rol | ✅ (SUPER ataması 4️⃣) | ❌ | ❌ | ❌ | ❌ |
| PlatformAuditLog görüntüle / dışa aktar | ✅ / 4️⃣ | 👁 | 👁 | 👁 | ❌ |
| Kurul Raporu | ✅ | ❌ | ✅ | ❌ | 👁 |

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
`<PageGate action=…>` (tam sayfa “yetkiniz yok” durumu), `<ApprovalBadge>` / `<ApprovalNotice>` /
`<ApprovalStatusBadge>` (dört-göz göstergeleri).

**UI'da gizleme yalnız ergonomidir.** Yaptırım API katmanındadır: `PlatformRoleGuard` aynı matrisi
kullanmalı, `ANALYST_READONLY` için tüm mutasyon uçları koşulsuz 403 dönmelidir.

## KVKK / güvenlik ilkeleri (arayüze işlenmiş hâli)

- **Impersonation yoktur** ve yazılmayacaktır. Tenant verisine tek kapı süreli
  `SupportAccessGrant`'tir: gerekçe zorunlu + kapsam (`METADATA` / `BELGE_LISTESI` / `TAM_OKUMA`) +
  süre (varsayılan 4 sa, azami 24 sa) + dört-göz + tenant ADMIN onayı, **salt-okur**, PII maskeli.
- `encryptedApiKey` hiçbir ekranda, maskeli dahi gösterilmez — yalnız `hasApiKey: boolean` + tip/model.
- Panel token **sayar**, fiyatlamaz: AI maliyet kolonu yoktur; token bilgisi dönmeyen çağrılar
  “token bilgisi yok” olarak ayrı sayılır, sıfır varsayılmaz.
- `ANALYST_READONLY` görünümlerinde tenant kimliği **oturum kapsamlı takma adla** (`Tenant #001`)
  gösterilir. Takma ad gerçek tenant kodundan TÜRETİLMEZ (eski `Tenant #A3F2` biçimi kodun ilk
  dört karakteriydi ve tersine eşlenebiliyordu); bu bir anonimleştirme değil takma adlandırmadır
  ve Kurul Raporu veri setinde takma adın SUNUCUDA üretilmesi gerekir. E-posta,
  PII, tekil ödeme detayı ve denetim izi bu role kapalıdır.
- Her mutasyon gerekçe alanı ister; gerekçe PlatformAuditLog'a yazılır (append-only, min. 10 yıl).

## Beklenen (henüz yazılmamış) API uçları

Tam liste kod içinde tutulur: `src/lib/endpoints.ts` (`EXPECTED_ENDPOINTS`) — metod, yol, roller,
faz ve ucu tüketen ekran bilgisiyle.

**Faz 1** — `POST /auth/login`, `POST /auth/2fa/verify`, `GET /auth/me`,
`GET/POST /tenants`, `GET/PATCH/DELETE /tenants/:id`, `POST /tenants/:id/suspend|reactivate`,
`GET /tenants/:id/users`, `GET/POST /tenants/:id/notes`, `GET /plans`,
`GET /subscriptions`, `POST /subscriptions/:id/transition`,
`GET/POST /platform-users`, `PATCH/DELETE /platform-users/:id`,
`GET /settings`, `PUT /settings/:key`, `GET/POST /approvals`, `PATCH /approvals/:id`,
`GET /audit-logs`.

**Faz 2** — `GET /tenants/:id/usage`, `GET /tenants/:id/ai-config`,
`GET/POST /support-grants`, `PATCH /support-grants/:id/revoke`,
`GET /flags`, `POST/PATCH /flags/:id`, `PUT /flags/:id/overrides`,
`GET/POST/PATCH/DELETE /announcements`,
`GET /metrics/overview`, `GET /metrics/ai`, `GET /metrics/system`.

**Faz 3** — `GET /payments`, `GET /payments/failed`, `POST /payments/:id/refund`,
`POST /payments/webhook/:provider`, `GET /invoices`, `POST /invoices/:id/issue`,
`POST /subscriptions/:id/change-plan`, `POST/PATCH /plans`.

**Faz 4** — `GET /metrics/growth`, `GET /metrics/board-report`.

Uç sözleşmesi: hata gövdesi `{ statusCode, message (TR), error }`; liste uçları
`?page&pageSize&sort`; guard zinciri
`PlatformJwtGuard → PlatformRoleGuard → (gerekirse) FourEyesGuard → PlatformAuditInterceptor`.

## Dizin yapısı

```
apps/admin/
├─ src/app/
│  ├─ layout.tsx              # html/body + globals.css
│  ├─ giris/page.tsx          # 2FA'lı giriş + temsili oturum
│  └─ (panel)/                # oturum gerektiren kabuk (rol bazlı menü)
│     ├─ layout.tsx
│     ├─ page.tsx             # Genel Bakış / Kurul Raporu
│     ├─ tenantlar/…          # liste + [id] detay sekmeleri
│     ├─ abonelikler/ odemeler/ kullanim/ sistem/ yoneticiler/ denetim/ onaylar/
├─ src/components/
│  ├─ ui.tsx                  # Button, Card, Badge, Table, Modal, Input, Select, StatCard,
│  │                          # BarList, ColumnChart, StackedBar, PendingEndpointNotice…
│  ├─ RoleGate.tsx            # RoleGate, PageGate, NoAccessInline, useCan/useCanMutate
│  └─ ApprovalBadge.tsx       # dört-göz rozet/uyarı/durum bileşenleri
└─ src/lib/
   ├─ api.ts                  # /api/v1/admin istemcisi, 401 → /giris
   ├─ rbac.ts                 # 5 rol + yetki matrisi + can()/canMutate()/requiresApproval()
   ├─ session.tsx             # AdminSessionProvider + useAdminSession + temsili oturum
   ├─ useResource.ts          # uç yoksa mock'a düşen veri kancası
   ├─ labels.ts               # Türkçe etiketler, rozet tonları, biçimlendirme
   ├─ nav.ts                  # rol bazlı menü
   ├─ endpoints.ts            # beklenen API uçları kataloğu
   └─ mock.ts                 # temsili veri (TEMSİLİ rozetiyle gösterilir)
```
