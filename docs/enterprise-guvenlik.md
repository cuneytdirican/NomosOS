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

## 7. Sonraki Enterprise++ adayları (kodlanmadı — karar/kapsam ister)

- **Dosya bazlı erişim kısıtı** (gizli dosya: yalnız atanan avukatlar) — her dosya
  sorgusuna dokunur; ayrı plan.
- **Veri saklama/imha politikası** (KVKK) — saklama sürelerinin hukuki kararı gerekir.
- **API anahtarları / webhook'lar** (büro entegrasyonları) — yeni kimlik yüzeyi.
- **SSO (OIDC/SAML)** — kurumsal kimlik sağlayıcı bağlantısı.
- **Oturum listesi (cihaz bazlı iptal)** — bugün "tümünü düşür" var.
