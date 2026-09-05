# Değişiklik Günlüğü

Biçim: [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/); sürümler [SemVer](https://semver.org/lang/tr/).
Etiket (`vX.Y.Z`) atıldığında `.github/workflows/deploy.yml` imajları GHCR'ye gönderir ve sunucuyu günceller.

## [Yayımlanmamış]

### Eklendi — Faz 4 (operasyon/SRE)
- `GET /health/ready`: PostgreSQL / Redis / S3 gerçek yoklama; biri düşükse 503.
- JSON günlük (`LOG_FORMAT=json`, pino uyumlu) ve `x-request-id` korelasyonu; hata yanıtındaki `ref` = istek kimliği.
- `GET /metrics`: prom-client kayıt defteri, 12 iş/altyapı metriği; `prometheus/alerts.yml` uyarı kuralları.
- Global oran sınırı (IP 300/dk, kullanıcı 600/dk; Redis ya da süreç-içi sayaç).
- Parola gücü (zxcvbn ≥ 3, hesap bilgisi parçası yasak) — kullanıcı oluşturma, değiştirme, sıfırlama, portal.
- `MASTER_ENCRYPTION_KEY` rotasyon betiği (`pnpm --filter @nomosos/api key:rotate`, `--dry-run`).
- Yedek konteynerleri (`backup`, `backup-minio`) + `scripts/prod-restore.sh` + tatbikat runbook'u.
- CD: `deploy.yml` (etiket → GHCR → SSH pull/migrate/up → readiness dumanı); `IMAGE_REGISTRY`.
- Caddy ters vekil (`deploy/Caddyfile`, `--profile edge`, panel IP kısıtı, HSTS).
- OpenAPI (`/api/docs`, yalnız geliştirme/test), prettier + husky + lint-staged, CONTRIBUTING.

### Eklendi — Faz 3 (gelir hattı)
- Dönem faturası (7 gün önce, tekil dönem), dunning 1/3/7. gün, deneme bitiş uyarısı.
- Checkout/kesinleştirme: SIMULASYON / iyzico (Checkout Form, webhook v3); krediler ödeme kesinleşince yüklenir.
- Kupon, BYO-LLM %30 otomatik indirim, yıllık fiyat, pro-rata plan farkı, `@RequiresModule` plan kapısı.
- Fatura PDF (pdfkit + DejaVu), tenant başına e-Fatura entegratör ayarı (şifreli), Abonelik ekranı; admin Kuponlar + Platform Faturaları.

### Eklendi — Faz 2 (bildirim kanalları)
- SMTP (nodemailer, Mailpit ile e2e), Netgsm SMS ve WhatsApp Cloud API adaptörleri, Expo push.
- Bildirim dağıtım ve temizlik işleri; büro parola sıfırlama; demo talebi e-postası; duyuru şeridi.

### Eklendi — Faz 1 (avukat çekirdeği)
- tesseract.js OCR (görsel + taranmış PDF), `POST /hearings/:id/prep`, sorumlu avukat + çakışma, ICS beslemesi, 52 süre kuralı, 2028-2032 tatiller.

### Eklendi — Faz 0 (gelir kaçağı + güvenlik)
- Kiracı açılışında kredi cüzdanı, koltuk sınırı, süresi dolan deneme / gecikmiş ödeme 402, sohbet eki boyut/tür denetimi, seed üretim kapısı.

## Önceki
Faz 0-6 çekirdek ürün, Enterprise++ güvenlik paketi, mevzuat/içtihat besleme hattı, kullanıcı tanımlı model eğitimi — bkz. `docs/FINAL-COMPLETION-REPORT.md`, `docs/enterprise-guvenlik.md`.
