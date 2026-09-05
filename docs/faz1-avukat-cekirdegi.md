# Faz 1 — Avukat Çekirdeği (5 Eylül 2026)

Üç persona boşluk analizinin (firma sahibi / yazılımcı+sistem yöneticisi / avukat+büro)
"avukatı en çok yakan" maddelerinden ilk paket. Plan: `~/.claude/plans/wiggly-giggling-lighthouse.md`.

## 1. OCR — taranmış belge artık görünür

- **Karar:** `tesseract.js` sunucu içi (veri büro dışına çıkmaz; ek servis yok). Dil verisi
  `tur+eng`; çevrimdışı kurulumda `OCR_LANG_PATH` (`tur.traineddata.gz`, `eng.traineddata.gz`),
  aksi hâlde ilk kullanımda indirilip `OCR_CACHE_PATH`'e yazılır.
- **Taranmış PDF:** sayfa render edilmez (canvas/pdfjs alpine'de kırılgan). Tarayıcı PDF'leri
  sayfa başına bir JPEG (`/DCTDecode`) taşır; `apps/api/src/pipeline/ocr.ts`
  `extractJpegStreamsFromPdf` bunları doğrudan baytlardan ayıklar. CCITT/JBIG2 taramalar
  → dürüstçe BASARISIZ + açık not. **Metin uydurulmaz.**
- **Görsel (JPEG/PNG):** doğrudan OCR. Paylaşımlı worker (dil bir kez yüklenir), sayfa
  başına `OCR_TIMEOUT_MS`, belge başına `OCR_MAX_PAGES`. `OCR_ENABLED=false` ile kapatılır.
- **Hat:** `text-extract.ts` → OCR → `Document.ocrText` → sınıflandırma, süre tespiti, RAG.
  Kuyruk (Redis) yoksa hat artık HTTP isteğinin **dışında** koşar (`ARKA_PLAN`).

## 2. Duruşma

- **HEARING_PREP canlı:** `POST /hearings/:id/prep` → dosya bağlamı + RAG parçaları →
  9 sabit bölümlü paket (output-guard) → `Hearing.prepJson` + `preparedAt`. Kaynaksız
  bölümler yanıtta uyarı; ekranda "Teyitsiz" rozeti. Kredi: `HEARING_PREP` (üst kayıt HEARING).
- **Sorumlu avukat:** `Hearing.attendeeUserId`; liste `?attendeeUserId=` süzgeci; web'de
  "yalnız benim duruşmalarım".
- **Çakışma:** aynı avukat ±2 saat → 409; `force: true` ile bilinçli geçiş (web: "çakışmaya
  rağmen kaydet").
- **Sonuç disiplini:** `GET /hearings/pending-results` — tarihi geçmiş, sonucu girilmemiş.

## 3. ICS takvim aboneliği

`POST /agenda/feed-token` kişisel 365 günlük imzalı token (ayrı audience `agenda-ics`,
API oturumu açmaz) → `GET /agenda/feed.ics?token=` (@Public). Duruşma/randevu saatli,
süre/görev tüm gün; UID kararlı; RFC 5545 kaçış + 75 oktet katlama (`agenda/ics.ts`).
Google/Outlook/Apple "URL ile abone ol". Tek yönlü (NomosOS → takvim).

## 4. Süre kural paketi (30 → 52) + tatiller 2032

Eklenen aileler: AYM bireysel başvuru (30 g, adli tatilde işler), AİHM (4 ay), İYUK savunma /
istinaf / temyiz / YD itiraz (m.8/3 uzaması), İİK **m.106 satış isteme** (haczin düşmesi),
128/a, 142, 265, 39, 68, 272; CMK m.268 itiraz, m.41 eski hâle getirme; KVKK m.13/2, m.14/2;
TMK m.606; TTK m.749; SMK m.18; HMK m.377; İş K. m.20/1 arabulucu başvurusu. Her kuralın
`legalBasis` "— N birim" biçimi sözleşme testiyle süreyle karşılaştırılır.
Tatiller 2028-2032 `projectedYearHolidays` ile (dinî bayramlar ÖNGÖRÜ, uyarı üretir).
`DEADLINE_RULES_VERSION` (`2026.09`) her kural hesabında `Deadline.rulesVersion`'a yazılır.

## 5. Kaynak belge + bildirim tercihleri + vekaletname

- AI süre önerisi `Deadline.sourceDocumentId` taşır; Süreler ekranında "Kaynak belgeyi oku"
  (ReadingModal) — avukat tebliğ tarihini belgeden teyit ederek onaylar.
- `NotificationOutboxService.preferredChannels` (inApp/email/push) tek yerden okunur;
  Faz 2 kanal dağıtıcısı bunu kullanır.
- Dosya detayında vekaletname durumu kartı (`GET /cases/:id/poa-status`): geçerli vekalet yok
  ya da 30 gün içinde dolacaksa uyarı.

## 6. Kapsam dışı / sonraki fazlara
Duruşma takvimi çift yönlü senkron (Faz 7), CCITT/JBIG2 taramalar için render tabanlı OCR
(gerekirse ayrı OCR servisi), e-posta/push gerçek gönderim (Faz 2).
