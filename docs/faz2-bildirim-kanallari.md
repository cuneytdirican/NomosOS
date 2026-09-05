# Faz 2 — Bildirim Gerçek Kanallar (5 Eylül 2026)

Üç persona boşluk analizinin "hiçbir dış bildirim gitmiyor" bulgusunu kapatan paket.
Plan: `~/.claude/plans/wiggly-giggling-lighthouse.md` (Faz 2). Karar: **SMTP tam çalışır**;
SMS/WhatsApp **adaptör + fixture sözleşme testi** (sağlayıcı hesabı sözleşme sonrası).

## 1. E-posta — `MailService` (tek boğum noktası)

- `apps/api/src/mail/mail.service.ts` (`@Global MailModule`). Yapılandırma: `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_FROM` (zorunlu), `SMTP_USER/SMTP_PASSWORD`, `SMTP_SECURE` (465 otomatik).
- Tanımsızsa `configured=false`; `send()` `{ sent:false, reason }` döner — kimse sessizce yutmaz
  (kanal sağlayıcısı hata fırlatır, işler kırılımda "atlandı" yazar, parola sıfırlama günlüğe uyarı).
- Kullananlar: `SmtpChannelProvider` (müvekkil e-postası, `communication/external-providers.ts`),
  `BildirimDagitimiJob`, `PasswordResetService`, `DemoTalepService`.
- Test yığını: **Mailpit** (`docker-compose.test.yml`; arayüz `http://localhost:8025`) — API
  `SMTP_HOST=mailpit`, `SMTP_PORT=1025`. Üretim: `docker-compose.prod.env.example` SMTP_* satırları.

## 2. SMS (Netgsm) + WhatsApp (Meta Cloud API)

- `NetgsmSmsProvider`: `POST {SMS_PROVIDER_BASE_URL}/sms/rest/v2/send`, Basic auth
  (`SMS_PROVIDER_API_KEY` = `kullanici:sifre`), `msgheader=SMS_SENDER_TITLE`, İYS filtresi.
  JSON `code:"00"` → `jobid`; eski düz metin `00 <jobid>` de anlaşılır; hata kodu fırlatır.
- `WhatsAppCloudProvider`: `POST graph.facebook.com/{v20.0}/{PHONE_NUMBER_ID}/messages`, Bearer.
  `templateKey` varsa onaylı şablon (tr), yoksa 24 saat penceresi metni.
- Kayıt kararı ortam değişkenleriyle (`ChannelProviderRegistry` ctor); tanımsız kanal Noop kalır ve
  `status()` ayarlar ekranına "yapılandırılmamış" der. MSISDN normalizasyonu `normalizeTrMsisdn`.
- Sözleşme testleri: `communication/external-providers.test.ts` (kayıtlı HTTP fixture'ları).

## 3. Push — Expo

- `scheduler/push/expo-push.provider.ts`: `PUSH_PROVIDER=expo` → `ExpoPushProvider`
  (`exp.host/--/api/v2/push/send`, 100'lük parça, isteğe bağlı `EXPO_ACCESS_TOKEN`). Yalnız
  `ExponentPushToken[...]` biçimli jetonlara gönderir; `DeviceNotRegistered` → jeton pasifleştirilir.
  Metin `buildPushPayload` (kaynak sızdırmaz).
- Mobil `src/api/push-token.ts`: `expo-notifications` + `expo-device`; izin iste →
  `getExpoPushTokenAsync({ projectId })` (EAS projectId `app.json extra.eas`); simülatörde `null`.
  `app.json` plugin `expo-notifications`. Ayarlar ekranı değişmedi (jeton kaynağı değişti).

## 4. Dağıtım + budama işleri

- `bildirim-dagitimi-5dk` (`BildirimDagitimiJob`): `NotificationOutbox` satırları
  (`dispatchedAt IS NULL`, zamanı gelmiş, kullanıcılı) → `preferredChannels` → e-posta (aktif
  kullanıcı) ve/veya push (aktif cihaz jetonları). Her satır **bir kez** damgalanır
  (`dispatchedAt`; teslim varsa `sentAt`). Kırılım: `islenen/eposta/push/smtpTanimli/pushSaglayici`.
- `bildirim-temizligi-gunluk`: okunmuş/iptal 90 gün, diğerleri 180 gün sonra silinir.
- Migration `20260925100000_faz2_bildirim_kanallari`: `NotificationOutbox.dispatchedAt` + indeks,
  `PasswordResetToken` tablosu.

## 5. Büro parola sıfırlama

- `POST /auth/forgot-password` `{email}` → jenerik yanıt; kullanıcı aktifse `PasswordResetToken`
  (SHA-256 özet, 30 dk, tek kullanımlık; eski bekleyenler tüketilir) + e-posta
  `{WEB_ORIGIN}/sifre-sifirla?token=…`. Denetim: `PASSWORD_RESET_REQUESTED`.
- `POST /auth/reset-password` `{token,newPassword}` → parola, `sessionsValidFrom` (tüm oturumlar
  düşer), kilit temizlenir, jeton tüketilir. Denetim: `PASSWORD_RESET`. Her iki uç
  `LoginThrottleGuard` altında.
- Web: `/sifre-unuttum`, `/sifre-sifirla`; giriş sayfasında "Parolamı unuttum".
- Geliştirme: `AUTH_DEV_ECHO_RESET_TOKEN=true` jetonu yanıtta döndürür (üretimde etkisiz).

## 6. Demo talebi → satış e-postası; duyurular → kiracı

- `DemoTalepService.create` sonrası `PLATFORM_NOTIFY_EMAIL`'e e-posta (reply-to = talep sahibi).
  Gönderim başarısız olsa da kayıt durur; admin paneli tek doğru kaynaktır.
- `GET /notifications/announcements`: yayınlanmış + süresi dolmamış + hedefi bu büroyu kapsayan
  (TUM / PLAN_BAZLI `planKeys` / TENANT_BAZLI `tenantIds`) duyurular. Web: `AnnouncementBanner`
  `<main>` üstünde; kapatma yerel (localStorage), KRITIK her oturumda görünür.

## 7. Doğrulama

- Birim/sözleşme: `mail.service`, `external-providers` (9), `expo-push.provider`,
  `bildirim-dagitimi.job`, `password-reset.service`, `announcements`, `faz2-…contract`.
- Canlı (Docker test yığını + Mailpit): parola sıfırlama e-postası Mailpit'te → bağlantı → yeni
  parola ile giriş; demo talebi e-postası; duyuru ucu; dağıtım işi elle tetik → e-posta.
