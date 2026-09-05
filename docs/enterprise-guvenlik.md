# Enterprise++ Güvenlik ve Yönetişim Paketi

> 5 Eylül 2026. İki gözle yapılan boşluk analizinin ("NomosOS sistem yöneticisi" ve
> "avukat / hukuk bürosu") kodla kapatılan ilk paketi. Belgede söz verilip kodda
> olmayan güvenlik/yönetişim katmanı: kiracı 2FA, büro güvenlik politikası, büro
> denetim izi ekranı, bildirim tercihleri.

## 1. Neden bu paket?

Derin analiz envanteri: Q4 gelişim planındaki dalgaların tamamı (D1-D8) ve
FINAL raporundaki İ- bulgularının büyük çoğunluğu kapanmıştı. Kalan gerçek
boşluklar **kurumsal güvenlik ve yönetişim** sınıfındaydı:

| Boşluk | Kanıt (önce) | Sonra |
|---|---|---|
| Avukat hesabında 2FA yok (platform panelinde vardı) | `User` modelinde `twoFactorSecret` yok; `/auth` yalnız parola | TOTP 2FA (kurulum/doğrulama/kapatma), yönetici sıfırlama |
| Büro düzeyinde güvenlik politikası yok | `Tenant`'ta yalnız `aiPolicy` | `require2fa` + `sessionMaxHours` (1-24 sa), yalnız ADMIN |
| Büro sahibi kendi denetim izini göremiyor | `AuditLog` yazılıyor ama kiracı ucu/ekranı yok | `/security/audit` + CSV + `/app/ayarlar/denetim` |
| Bildirim tercihleri yok | Tür × kanal seçimi yok | `NotificationPreference` + `/app/ayarlar/bildirimler` |
| Parola değiştirme ekranı yok (uç vardı) | `/auth/change-password` UI'sız | `/app/ayarlar/guvenlik` |

## 2. Kiracı iki adımlı doğrulama (TOTP)

- **Model:** `User.twoFactorSecret` (AES-256-GCM, `MASTER_ENCRYPTION_KEY`) ve
  `User.lastTotpCounter` (tekrar oynatma koruması). Anahtar düz metin ASLA
  saklanmaz; yalnız kurulum anındaki `manualEntryKey` yanıtı taşır.
- **Akış:** `POST /auth/login` → 2FA kuruluysa `{ twoFactorRequired, challengeToken }`
  (oturum ve çerez üretilmez) → `POST /auth/2fa/verify { challengeToken, code }` →
  oturum (httpOnly çerez + accessToken). Challenge 10 dk ömürlü, `aud: tenant-2fa`,
  challenge başına 5 hatalı kod → iptal; hesap kilidi sayacı (K-03) da işler.
- **Kurulum:** `POST /auth/2fa/setup { currentPassword }` (açık oturum; çalınmış
  oturum 2FA'yı kendisi kuramaz) ya da `POST /auth/2fa/setup-with-challenge`
  (büro politikası zorunluyken girişte). Anahtar DB'ye değil 10 dk'lık şifreli
  kurulum token'ına yazılır; ilk doğru kodda kalıcılaşır (yarım kurulum hesabı kilitlemez).
- **Kapatma:** `POST /auth/2fa/disable { currentPassword, code }`. Büro politikası
  zorunluysa 403 — yalnız yönetici sıfırlar: `POST /users/:id/reset-2fa`
  (anahtar silinir, tüm oturumlar düşer; girişte yeniden kurulum).
- **Ekranlar:** web giriş sayfasında kod adımı ve zorunlu kurulum (QR + elle anahtar);
  `/app/ayarlar/guvenlik`; `/app/ayarlar/kullanicilar` → "2FA açık/yok" rozeti +
  "2FA Sıfırla". Mobil: kod adımı (`TwoFactorRequiredError` → `verifyTwoFactor`);
  zorunlu KURULUM mobilde yapılmaz — bir kez web'den, sonra mobil kodla giriş.
- **Oturum tek kapı:** `SessionService.issue` — audience damgası, büro oturum ömrü
  (`Tenant.sessionMaxHours`, JWT `expiresIn` + çerez `maxAge`), `LOGIN_SUCCESS`
  denetim kaydı (giriş yolu: parola / parola+2fa).

## 3. Büro güvenlik politikası

`GET /security/policy` (ADMIN/PARTNER okur; 2FA yaygınlığı: N/M aktif kullanıcı)
· `PATCH /security/policy { require2fa?, sessionMaxHours? }` (yalnız ADMIN; denetim
izi `SECURITY_POLICY_UPDATE`). `require2fa` açıldığında 2FA'sız kullanıcılar bir
sonraki girişte kuruluma zorlanır; mevcut oturumlar ömürleri dolana kadar sürer
(oturumları hemen düşürmek için Kullanıcılar → "Oturumları Düşür").

## 4. Büro denetim izi

`GET /security/audit?action=&userId=&from=&to=&q=&page=&limit=` (ADMIN/PARTNER;
her sorgu `tenantId` taşır; kullanıcı adları eklenir) · `GET /security/audit/actions`
(süzgeç) · `GET /security/audit/export.csv` (en çok 5.000 satır; UTF-8 BOM;
hücreler formül enjeksiyonuna karşı `'` ile nötrlenir; dışa aktarım `AUDIT_EXPORT`
olarak iz bırakır). Ekran: `/app/ayarlar/denetim`.

## 5. Bildirim tercihleri

`NotificationPreference (tenantId, userId, kind) → inApp/email/push`. Kayıt yoksa
tüm kanallar AÇIK. `NotificationOutboxService.enqueue` uygulama içi kanal kapalıysa
yazmaz ("atlandi"); tercih tablosu okunamazsa varsayılan uygulanır — süre uyarısı
tercih yüzünden kaybolmaz. E-posta/push tercihleri saklanır, ilgili sağlayıcı
bağlandığında uygulanır (ekran kanalın bağlı olmadığını açıkça gösterir).
`GET/PUT /notifications/preferences`; ekran `/app/ayarlar/bildirimler`.

## 6. Testler

`two-factor.service.test.ts` (kurulum→doğrulama→oturum, tekrar oynatma, deneme
sınırı, politika kapısı, yönetici sıfırlama), `security.service.test.ts` (CSV
formül koruması, kiracı süzgeci, rol kapıları, oturum ömrü aralığı),
`notification-preferences.test.ts`, `enterprise-guvenlik.contract.test.ts`
(şema/uçlar/ekranlar/menü/mobil).

## 7. Gizli dosya — dosya bazlı erişim kısıtı (ikinci paket)

- **Kural (tek yer, `common/case-visibility.ts`):** ADMIN/PARTNER tüm dosyaları görür;
  diğer roller `isConfidential=false` dosyalar + sorumlusu olduğu + `CaseMember` üyesi
  olduğu gizli dosyalar.
- **Global kapı `CaseAccessGuard`** (JwtAuthGuard → TenantStatusGuard → CaseAccessGuard):
  istek bir dosyaya işaret ediyorsa (`:caseId`, `/cases/:id`, `?caseId=`, gövde `caseId`)
  görünürlük doğrulanır; görünmeyen dosya **404** (403 değil — varlık sızmaz).
  ADMIN/PARTNER ve platform yolu için veritabanına gidilmez; diğerleri için istek
  başına en çok bir indeksli sorgu. 47 dosyadaki 51 `case` sorgusunu tek tek
  değiştirmek yerine kesişen nokta.
- **Liste süzgeçleri:** dosya listesi/detayı, duruşma, süre, görev, belge listeleri ve
  ajanda `relatedCaseVisibilityWhere` ile (her zaman `AND` altında; dosyasız kayıt
  serbest). Bilinçli sınır: dosyaya bağlı olmayan kayıtlar kısıta girmez.
- **Yönetim:** `PATCH /cases/:id { isConfidential }` ve `GET/PUT /cases/:id/members`
  (yalnız ADMIN/PARTNER ya da sorumlu avukat; büro dışı/pasif kullanıcı reddedilir;
  denetim izi `CASE_CONFIDENTIAL_ON/OFF`, `CASE_MEMBERS_SET`). Web: dosya detayında
  "Gizlilik ve erişim" kartı, listede "Gizli" rozeti.
- **Testler:** `case-visibility.test.ts` (kural, `extractCaseId`, guard 404/geçiş/DB'ye
  gitmeme), sözleşme testi.

## 8. KVKK saklama / imha politikası + veri öznesi talepleri (üçüncü paket)

Hukuki karar `docs/kvkk-politika-matrisi.md`'den alındı: Av. K. m.39 saklama (kapanış +
10 yıl varsayılan), KVKK m.7 saklama istisnasıyla gerekçeli ret, m.13/2 30 gün yanıt.

- **Politika:** `Tenant.retentionYears` (10-30; `PATCH /security/policy`, yalnız ADMIN).
- **Otomatik silme YOK.** `GET /security/kvkk/retention` süresi dolan KAPANDI dosyaları
  imha ADAYI olarak listeler; `POST /security/kvkk/retention/cases/:id/anonymize { reason }`
  imhayı yalnız ADMIN, gerekçeyle, yalnız süresi dolmuş KAPANDI dosyada uygular:
  belgeler yumuşak silinir + S3 nesnesi silinmeye çalışılır (en iyi çaba, başarısızlar
  izde sayılır), RAG parçaları silinir, `Case.anonymizedAt` damgalanır; künye/safahat/
  denetim izi KALIR (`KVKK_IMHA`).
- **Veri öznesi talepleri:** `KvkkRequest` (ERISIM/SILME/DUZELTME/ITIRAZ/TASIMA;
  `dueAt = talep + 30 gün`); `GET/POST /security/kvkk/requests`,
  `POST /security/kvkk/requests/:id/respond { YANITLANDI | REDDEDILDI, decision ≥ 10 }` —
  gerekçe zorunlu, denetim izi `KVKK_REQUEST_*`.
- **Aylık iş `kvkk-saklama-aylik`:** aday ve süresi geçen talep sayısını ADMIN/PARTNER'a
  `KVKK_SAKLAMA` bildirimi olarak yazar (ay başına bir kez, dedupe); veri silmez.
- **Ekran:** `/app/ayarlar/kvkk` — politika, imha adayları (gerekçeli imha), talepler
  (kayıt + yanıt/ret).

## 9. API anahtarları + webhook'lar (dördüncü paket)

- **API anahtarı** (`ApiKey`): `nos_<prefix>_<gizli>`; yalnız SHA-256 özeti saklanır, düz
  anahtar bir kez gösterilir. `X-Api-Key` başlığı `JwtAuthGuard` içinde çözülür:
  **yalnız GET/HEAD**, yol anahtarın kapsam kümesinde olmalı (`cases:read` → `/api/v1/cases`
  …), iptal/süre dolumu anında düşer, kimlik `apikey:<id>` ve rol AVUKAT (gizli dosyalar
  görünmez). Uçlar: `GET/POST /integrations/api-keys`, `DELETE /integrations/api-keys/:id`.
- **Webhook** (`WebhookEndpoint` + `WebhookDelivery`): olay kaynağı DENETİM İZİ —
  `AuditService.subscribe` ile `WebhooksService.fanOut`; olaylar katalogdaki gerçek eylem
  adlarıdır (`webhook-events.ts`; sözleşme testi her birinin bir serviste yazıldığını
  doğrular). Kayıtta SSRF denetimi (`validateProviderBaseUrl`) + HTTPS zorunlu; sır
  AES-256-GCM şifreli, bir kez gösterilir. Dağıtım `webhook-dispatch-5dk`: HMAC-SHA256
  (`X-NomosOS-Signature: sha256=…`), 10 sn zaman aşımı, geri çekilme 1 dk → 5 dk →
  30 dk → 2 sa → 12 sa (5 yeniden deneme; sonuncusu da düşerse BASARISIZ); teslimat geçmişi ekranda.
- **Ekran:** `/app/ayarlar/entegrasyonlar` — anahtar oluştur (tek seferlik gösterim),
  iptal; webhook ekle/düzenle/pasifleştir/sil, test gönder, teslimatlar.

## 10. SSO / OIDC kurumsal giriş (beşinci paket)

- **Sağlayıcı:** OpenID Connect discovery destekleyen her IdP (Microsoft Entra ID, Google
  Workspace, Okta, Keycloak…). **SAML kapsam dışıdır** — sayılan sağlayıcıların tümü OIDC
  sunar; SAML ayrı bir paket olarak değerlendirilir.
- **Yapılandırma** (`Tenant.sso*`, `GET/PUT /security/sso`, yalnız ADMIN yazar; `POST
  /security/sso/test` discovery sınar): issuer (HTTPS + SSRF kapısı), client id, client
  secret (AES-256-GCM, bir kez girilir), e-posta alan adı, otomatik kullanıcı açma +
  varsayılan rol (ADMIN olamaz), **zorlama** (parola girişi kapalı — ADMIN hariç, IdP
  arızasında "cam kır"). IdP'ye kaydedilecek `redirect_uri`: `$API_PUBLIC_URL/api/v1/auth/sso/callback`.
- **Akış:** `POST /auth/sso/start {email}` → alan adından büro → imzalı `state` (JWT,
  10 dk, nonce) → IdP `authorization_endpoint`. `GET /auth/sso/callback` → state doğrulama
  → kod takası (`client_secret_post`) → ID token **back-channel** olduğundan imza yerine
  `iss/aud/nonce/exp` denetimi (OIDC Core §3.1.3.7/6) → e-posta (gerekirse userinfo) →
  alan adı denetimi → kullanıcı eşleme (`User.ssoSubject`; farklı `sub` reddedilir; yoksa
  ve otomatik açma açıksa rastgele parolayla açılır) → abonelik askı denetimi →
  `SessionService.issue(…, "sso")` (LOGIN_SUCCESS izi "sso"). Çerez yazılır, `/app`'e
  yönlendirilir; hatada `/giris?sso_error=…`.
- **2FA ilişkisi:** SSO girişi TOTP challenge'ını **atlar** — çok faktör IdP'nin
  sorumluluğudur. Büro `require2fa` politikası parola girişleri için geçerli kalır.
- **Ekran:** `/app/ayarlar/sso` (yapılandırma + bağlantı testi + geri dönüş adresi),
  giriş sayfasında "Kurumsal giriş (SSO)" düğmesi (e-posta alanına göre yönlendirir).

## 11. Cihaz bazlı oturum listesi (altıncı paket)

- **Kayıt:** her giriş (parola / parola+2fa / sso) `UserSession` satırı üretir; JWT `jti`
  taşır; User-Agent → okunur etiket (`user-agent.ts`: "Chrome · Windows", "Safari ·
  iPhone", "NomosOS mobil (Android)"), IP, giriş yolu, son etkinlik, bitiş.
- **Denetim:** `JwtAuthGuard.resolveSession` her istekte iptali denetler (30 sn önbellek —
  kullanıcı önbelleğiyle aynı gecikme), `lastSeenAt`'i en fazla 5 dk'da bir yazar; jti'siz
  eski token'lar geriye uyumlu. "Açık" = iptal yok + süre dolmamış + `sessionsValidFrom`
  sonrası (tümünü-düşür mekanizması korunur, satırlar tek tek işaretlenmez).
- **Uçlar:** `GET /auth/sessions` (bu cihaz işaretli), `DELETE /auth/sessions/:id` (bu cihaz
  dâhil), `DELETE /auth/sessions` (diğer cihazlar); yönetici `GET /users/:id/sessions`,
  `DELETE /users/:id/sessions/:sid` (ADMIN/PARTNER, kiracı sınırı). Denetim izi
  `SESSION_REVOKE`. Temizlik işi `oturum-temizligi-gunluk` (30 günü geçmiş süresi
  dolmuş/iptal kayıtlar; açık oturumlara dokunmaz).
- **Ekran:** Ayarlar → Güvenlik "Açık oturumlar" kartı (Kapat / Bu cihazdan çık / Diğer
  cihazları kapat); Kullanıcılar → "Oturumlar" penceresi (yönetici tek cihazı kapatır).

## 12. Enterprise++ aday listesi — TAMAMLANDI

Belgede söz verilen altı aday (2FA + politika + denetim + bildirim tercihleri; gizli
dosya; KVKK saklama/imha; API anahtarı/webhook; SSO/OIDC; cihaz bazlı oturum) kodlandı.
Kapsam dışı bırakılanlar, gerekçesiyle: **SAML** (§10), **IP kısıtı** (VPN/proxy arkasında
yanlış pozitif üretir; talep gelirse `Tenant.allowedCidrs` + guard olarak eklenir).

