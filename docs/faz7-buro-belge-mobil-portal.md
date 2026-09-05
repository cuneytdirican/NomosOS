# Faz 7 — Büro Yönetimi + Belge + Mobil/Portal (6 Eylül 2026)

Üç persona planının 7. fazı; yedi alt dilimde kodlandı ve Docker test yığınında canlı doğrulandı.

## 7A — Belge: sürüm, klasör, süreli paylaşım, e-posta ile giriş (IMAP)

- **Şema** (`20260929100000_faz7a_belge_surum_klasor_paylasim`): `Document.folderPath` (sanal yol, klasör
  tablosu yok), `versionNo`/`rootDocumentId`/`supersededAt` (sürüm zinciri; hiçbir sürüm silinmez, eski
  sürüm listede varsayılan gizlenir, `?versions=all`), `DocumentShareLink` (jeton **yalnız SHA-256**),
  `MailIngestConfig` (parola AES-GCM mühürlü).
- **Uçlar:** `GET /documents/folders`, `POST /documents/:id/versions` (normal yükleme hattı → zincir; aynı
  hash → sürüm açılmaz), `GET /documents/:id/versions`, `POST /documents/:id/move`, `POST /documents/:id/share`
  (1–168 sa, en çok N indirme), `GET /documents/:id/shares`, `DELETE /documents/shares/:id`,
  **`GET /public/paylasim/:token`** (@Public, 302 → 5 dk imzalı depo adresi; her erişim AuditLog).
- **IMAP:** `settings/mail-ingest` (GET/PUT/DELETE/test/run), `imapflow` + `mailparser` adaptörü
  (`ImapClient` arayüzü DI ile sahtelenir), iş `eposta-belge-girisi-5dk`. Eşleme deterministik: konu/gövdede
  `2026/145` → tek dosya; çakışan numara → **triyaj** (varsayılan dosya olsa bile); eşleşme yok → varsayılan
  dosya → triyaj. Ekler `validateUpload` süzgecinden geçer; kaynak `EPOSTA`, klasör `/E-posta`.
- **Web:** belge sekmesinde klasör süzgeci/yükleme klasörü, "Yeni sürüm", "Sürümler", "Paylaş", "Taşı";
  Ayarlar → Entegrasyonlar'da IMAP kartı.

## 7B — Global arama (Ctrl+K) + Türkçe sıralama

- **Göç** (`…_faz7b_arama_tr_collation`): `Case.title`, `Client.name`, `Task.title`, `Document.name`,
  `Deadline.title` → `COLLATE "tr-TR-x-icu"` (ICU yoksa göç DURUR); pg_trgm GIN dizinleri (Case/Client/Task/
  Deadline/Petition). 7C göçü collation sürümünü toleranslı tazeler (`REFRESH VERSION`).
- **`GET /search?q=`**: dosya, müvekkil, belge, görev, süre, duruşma, dilekçe; her grup kendi görünürlük
  kuralıyla (görünürlük OR'u ile arama OR'u **AND altında ayrı**), İ/ı varyantları, grup başına 5–10, href'li.
- **Web:** `CommandPalette` (Ctrl/⌘+K ve başlıkta "Ara"): menü kısayolları + sunucu araması, ↑↓/↵/Esc.
  Not: Chrome'da Ctrl+K adres çubuğuna gider; düğme ile de açılır.

## 7C — İş akışı şablonları, rol matrisi, toplu görev, kuyruk/iş yükü

- **Şablonlar:** sistem şablonları kodda (`SYS_DAVA_ACILIS`, `SYS_ICRA_TAKIP`, `SYS_ARABULUCULUK`,
  `SYS_CEZA_SORUSTURMA`, `SYS_DOSYA_KAPANIS`), büro şablonu DB'de (`WorkflowTemplate`, aynı anahtar sistemi
  gölgeler). `POST /workflow-templates/:key/apply` → görev zinciri (son tarih = başlangıç + offsetDays,
  atama: verilen → dosya sorumlusu → uygulayan; tür uyuşmazlığı 400; `Task.workflowKey`).
- **Rol matrisi:** `User.extraPermissions` (HUKUKI/ONAY/OPERASYON/FINANS) — `hasRole`/`assertRole` ROLE_SETS
  kümelerinde ek yetkiyi tanır; finans kapıları (`canFinance`) FINANS'ı AVUKAT düzeyi sayar (yönetim kapıları
  hariç). Guard kullanıcı önbelleği yetki değişiminde **anında** düşürülür (`invalidateUserCache`).
- **Görevler:** `POST /tasks/bulk` (döngü; durum makinesi/rol kapıları korunur, kısmi başarı raporu),
  `GET /tasks/review-queue`, `GET /tasks/workload`. Web: toplu seçim çubuğu, kuyruk/iş yükü kartları,
  dosya → "Şablondan görev zinciri" modalı, Kullanıcılar → ek yetki rozetleri.

## 7D — Büro dilekçe şablonu + eklenti UDF köprüsü

- `POST/PATCH/DELETE /petition-templates` (büro şablonu; sistem şablonu silinemez), `POST /petition-templates/import`
  (UDF/.txt → bölüm iskeleti; **deterministik başlık sezgisi**, mahkeme hitabı ve taraf/TCKN satırları atılır).
- Eklenti: `GET /uyap/petitions/ready`, `POST /uyap/petitions/:id/udf` (UyapTokenGuard; rol DB'den). Popup'ta
  "UYAP'a gönderilecek dilekçeler" → **UDF indir** (`optional_permissions: ["downloads"]`, kullanıcı hareketiyle;
  UYAP'a yükleme, e-imza ve gönderim kullanıcının eylemidir — eklenti göndermez).
- Web: Dilekçe Stüdyosu → "Şablon kütüphanesi" kartı (bölüm listesinden oluştur / UDF içe aktar / sil).

## 7E — Mobil: kamera ile belge yükleme, uygulama içi görüntüleme, EAS

- `expo-image-picker` (kamera/galeri), `expo-document-picker`, `expo-web-browser`; `app.json` izin metinleri
  (kamera/galeri) + `android.permission.CAMERA`; `eas.json` (development/preview/production, `EXPO_PUBLIC_API_URL`).
- `app/belge/yukle.tsx` (çoklu seçim, 50 MB ön kontrol, multipart `apiUpload`, kaynak MANUEL, klasör `/Mobil`);
  dosya ekranında "Kamera / yükle" ve belge açma `WebBrowser.openBrowserAsync` (düşüş: sistem tarayıcısı).
  `endpoints.ts` yazma envanteri: 7. yazma.

## 7F — Portal: yapılacaklar, müvekkil yüklemesi, rıza kayıtları, müvekkil durum özeti

- **`PortalTodo`**: büro ister (`POST /portal-admin/todos`), müvekkil görür/tamamlar (`GET /portal/todos`,
  `POST /portal/todos/:id/complete`); yayınlanmamış dosyaya bağlı istek müvekkile görünmez.
- **Müvekkil belge yüklemesi:** `POST /portal/documents` (multipart; dosya portalda yayında olmalı; 25 MB;
  büro hattından geçer, kaynak `PORTAL`, klasör `/Müvekkil`; belge müvekkile otomatik yayınlanır —
  `ownershipVerified`; denetim satırı müvekkil kimliğini taşır).
- **`PortalConsent`** (ekleme-yalnız; `textHash`, IP, tarayıcı): KVKK aydınlatma (okudum beyanı, geri çekilmez),
  açık rıza, e-posta/SMS izinleri (**İYS hazırlığı**). Metinler sürümlü yer tutucu (v1) — büro/avukat onayı
  gerektirir. Portal `/rizalar`, pano şeridi; büro tarafı `GET /portal-admin/consents` (geçmiş).
- **`POST /outbound-messages/client-status-summary`** (CLIENT_STATUS_SUMMARY, kredi düşer): dosya için sade
  dilli TASLAK; mesaj kaydı açmaz. Web: dosya başlığında "Müvekkil özeti (AI)".

## 7G — Dosya detayı sekmeleri + kapanış kontrol listesi

- **Tanıklar:** TANIK delili + `Evidence.witnessInfoJson` (iletişim, yakınlık, celp durumu, beyan özeti).
- **Harçlar:** legal-core `calculateDavaHarci` + platform tarifesi (`/finance/harc-tarifesi/:yil`) + HARC giderleri;
  "gider olarak kaydet" (CaseExpense). **Vekaletname:** `poa-status` kartı + müvekkil vekâletleri (PoaTab).
  **Finans:** `/finance/cases/:id/summary` (tahakkuk/tahsilat/bakiye/zaman/son hareketler).
- **Kapanış:** `GET/PUT /cases/:id/closing-checklist` — sistem kalemleri (açık süre/görev, ödenmemiş fatura
  [finans hareketi → fatura], faturalanmamış onaylı zaman, açık müvekkil isteği, iadesi bekleyen avans, vekâlet
  bilgisi) + manuel kalemler (belge iadesi, azil/istifa, müvekkil bilgilendirme, karşı vekâlet ücreti, arşiv +
  `archiveBoxNo`); `readyToClose`. Kapatma kararı yine "Durum Değiştir" akışıdır.

## Testler ve canlı doğrulama

- API: `faz7-contract.test.ts` (7A–7G), `document-extras`, `mail-ingest`, `search`, `roles.permissions` (+finans
  matrisi), `workflow`, `petition-template-import`, `portal-todo-consent`, `case-closing`. Eklenti 38, web 100,
  portal 4, mobil `tsc`.
- Canlı duman: `smoke_faz7ab.sh`, `smoke_faz7c.sh`, `smoke_faz7d.sh`, `smoke_faz7f.sh`, `smoke_faz7g.sh`;
  Playwright `pw/faz7-web.js`, `pw/faz7g-web.js`.

## Açık noktalar

- Rıza metinleri v1 yer tutucudur; avukat onaylı metin platformdan sürümlenerek yayınlanmalı (Faz 8.2 ile).
- IMAP: gerçek posta kutusuyla uçtan uca deneme (Mailpit IMAP sunmaz); UID imleci klasör değişince sıfırlanır.
- Eklenti UDF indirme: HAZIR statüsünde dilekçe seed'de yok; birim + sözleşme testleriyle kapatıldı.
