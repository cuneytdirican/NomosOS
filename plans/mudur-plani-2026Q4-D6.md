# NomosOS — Dalga 6: Müvekkil Yönetimi Kapanışı (2026-09-03)

Durum: **TAMAM** — M1+M2+M3+M4 canlı doğrulandı.

Amaç: avukatın/büronun KENDİ müvekkilini tam yönetmesi. Modüller satır satır
okundu; aşağıdakiler KANITLI durum tespitidir (docs/moduller/01 karşılaştırması).

## 0. Mevcut durum (kanıtlı)

| Yetenek | Durum | Kanıt |
|---|---|---|
| Müvekkil CRUD + içe aktarma + pasifleştirme | VAR | `clients.controller.ts` (11 uç) |
| TCKN maskeli gösterim (KVKK) | VAR | `GET :id/tckn` + HUKUKI kapısı |
| KVKK veri öznesi dışa aktarımı | VAR | `GET :id/export` |
| Yetkililer (ClientContact), birincil işareti | VAR | contacts uçları |
| Vekaletname süresi uyarıları (deterministik) | VAR | `poa-warnings.service.ts` (SURE_YAKLASIYOR/SURESI_DOLDU) |
| Müvekkil kartı sekmeleri (dosya/finans/ücret sözleşmesi/iletişim/sözleşme) | VAR | `muvekkiller/[id]/page.tsx` |
| İletişim geçmişi | VAR (karşılanmış) | CommunicationLog (Modül 19) clientId bağlı |
| Portal + faturalama + tahsilat | VAR | Modül 10/08/09 |
| **Mükerrer kayıt birleştirme (merge)** | **YOK** | Modül 01 kural 10 + ClientMergeLog TASARLANMIŞ, kodda yok |
| **Birleştirme öngörüsü (taşınacak kayıt sayıları)** | **YOK** | Kural 10: "onay diyaloğunda taşınacak kayıt sayıları gösterilir" |

## 1. Yapılacaklar

### M1. ClientMergeLog modeli + migration — kural 10'un veri ayağı
Alanlar: survivingClientId, mergedClientId, countsJson (taşınan kayıt sayıları),
mergedByUserId, createdAt. Kalan kart SILİNMEZ — PASSIVE olur; birleştirme geri
alınAMAZ (kural 10).

### M2. Birleştirme uçları (rol: ROLE_SETS.ONAY = ADMIN/PARTNER — kural 10)
- `GET /clients/:id/merge-preview?source=` — taşınacak kayıt sayıları (onay
  diyaloğunun verisi; kural 10 gereği sayılar kullanıcıya GÖSTERİLİR).
- `POST /clients/:id/merge { sourceClientId }` — TEK İŞLEMDE: 16 ilişkinin
  clientId'si karta taşınır (cases, powerOfAttorneys, contacts, financialEntries,
  feeAgreements, randevular, timeEntries, invoices, payments, portalUsers,
  portalInvites, portalPublications, communicationLogs, outboundMessages,
  inboundMessages, contracts), kaynak kart PASSIVE olur, ClientMergeLog +
  AuditLog yazılır. PortalUser e-posta çakışması işlemi İPTAL EDER (net hata).

### M3. Web — müvekkil kartında «Birleştir» eylemi
Detay sayfasında yöneticiye görünür; modal: kaynak müvekkil seçimi → öngörü
sayıları → iki adımlı onay.

### M4. Test + canlı doğrulama
Sözleşme testleri + canlı akış (öngörü → birleştirme → kayıtlar taşındı →
kaynak pasif → geri alınamaz).

## 2. Bilinçli yapılmayacaklar
- Müvekkil SİLME yoktur (KVKK saklama süresi; pasifleştirme + dışa aktarım var).
- ~~Otomatik mükerrer TESPİTİ (fuzzy match) bu dalgada yok~~ — **D6-B olarak
  TAMAMLANDI** (aşağıda).

## 3. D6-B — otomatik mükerrer tespiti (TAMAM)

**Motor** (`client-similarity.ts`, deterministik — AI YOKTUR):
- Türkçe normalizasyon + hukuki ek ayıklama (A.Ş., Ltd., Şti., Holding…)
- Jaro-Winkler benzerliği; eşik **0.90 — AMPİRİK ölçüldü**: yanlış pozitifler
  ("Deniz Tekstil"×"Deniz Lojistik" = 0.890, "Kaya İnşaat"×"Kaya Ticaret" =
  0.841) eşiğin altında; yazım hataları ve ek farkları 0.94–1.00 üstünde.
- 16 birim testi (normalizasyon, literatür değerleri MARTHA/MARHTA ≈0.961 ve
  DIXON/DICKSONX ≈0.813, karar sınırları).

**Uç:** `POST /clients/duplicate-check` (OPERASYON rolü) — tam kimlik
(VKN/TCKN/e-posta/telefon) + ad benzerliği; aday havuzu aktif kartlar
(tavan 5000, belgeli); en yakın 10 şüpheli + gerekçeler; **kaydı ENGELLEMEZ**
— tam TCKN/VKN engellemesi create'te 409 olarak kalır; karar avukatındır.

**Web:** yeni müvekkil formunda canlı uyarı (çatışma taramasıyla aynı desen:
600 ms debounce, sessiz hata) — şüpheli kartlar bağlantıyla açılır, kayda
devam edilebilir (sonradan birleştirme D6 ile).

Canlı doğrulandı: "ABC Holding A.S." → 1 şüpheli (skor 1); farklı ad → 0;
e-posta/telefon eşleşmeleri tespit; kısa ad 400; STAJYER 403; determinizm
(iki sorgu birebir aynı).
