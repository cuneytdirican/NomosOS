# Modül 20 — Sözleşme Yaşam Döngüsü + E-imza

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 21 `[P2, 8/10]`

## Amaç

Bu modül, büronun hem **müvekkil sözleşmelerini** (vekalet ücret sözleşmesi, danışmanlık sözleşmesi) hem de **müvekkil adına yönetilen ticari sözleşmeleri** (kira, tedarik, hizmet, ortaklık vb.) tam yaşam döngüsüyle yönetir: **Taslak → Müzakere → Versiyon → İmza → Yürürlük → Yenileme/Fesih.** Her aşama bir durum makinesiyle modellenir; müzakere sırasındaki her karşı öneri yeni bir `ContractVersion` olarak saklanır ve versiyonlar arası fark görüntülenebilir.

E-imza katmanı **sağlayıcı-bağımsız** bir adaptör spec'idir: sistem çekirdeği yalnız `SignatureRequest` soyutlamasını bilir; her sağlayıcı (5070 sayılı Elektronik İmza Kanunu kapsamındaki NES sağlayıcıları, mobil imza operatörleri veya ıslak imza + tarama akışı) `ISignatureProvider` arayüzünü uygular. Böylece yeni sağlayıcı eklemek çekirdeğe dokunmaz. Yenileme/fesih tarihleri Süre Motoru'na `Deadline` olarak yazılır: "ABC kira sözleşmesi 60 gün sonra kendiliğinden yenileniyor, fesih ihbar süresi 30 gün" uyarısı standart süre altyapısından akar.

AI katmanı sözleşme incelemesidir (`CONTRACT_REVIEW`): yüklenen/taslak sözleşmede **riskli maddeler** (tek taraflı fesih, sınırsız cezai şart, aleyhe yetki şartı), **eksik hükümler** (uyuşmazlık çözümü, gizlilik, mücbir sebep, KVKK aydınlatma) ve önerilen düzeltmeler madde referanslı olarak raporlanır. Çıktı her zaman öneridir; sözleşme metnine işlemek avukat kararıdır.

## Kullanıcı Hikâyeleri

1. **Avukat** olarak, müvekkil için hazırladığım sözleşme taslağını sisteme alıp müzakere turlarındaki her versiyonu karşılaştırmalı görmek isterim; "karşı taraf 4. maddede neyi değiştirdi?" tek tıkla cevaplansın.
2. **Avukat** olarak, nihai metni e-imza sürecine gönderip imzacıların durumunu (bekliyor/imzaladı/reddetti) tek ekrandan izlemek isterim.
3. **Partner** olarak, büronun tüm sözleşmelerinin yürürlük/yenileme takvimini görmek isterim; kendiliğinden yenilenen sözleşme sürpriz olmasın.
4. **Avukat** olarak, karşı taraftan gelen sözleşme taslağına `CONTRACT_REVIEW` çalıştırıp riskli ve eksik maddeleri madde numarasıyla görmek isterim; müzakere notlarımı bunun üstüne kurarım.
5. **Sekreter** olarak, imza süreci tamamlanan sözleşmenin imzalı nüshasını sisteme bağlamak ve yürürlük tarihini işlemek isterim.
6. **Avukat** olarak, fesih ihbar süresi olan sözleşmelerde "son ihbar günü"nün otomatik `Deadline` olarak açılmasını isterim; süre kaçırma riskini sistem taşısın.
7. **Admin** olarak, e-imza sağlayıcısını tenant ayarlarından seçmek/değiştirmek isterim; sözleşme verisi sağlayıcıdan bağımsız kalsın.
8. **Müvekkil** olarak (portal), imzamı bekleyen sözleşmeyi görüp sağlayıcının imza akışına yönlenmek isterim.

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Sözleşme Listesi | `/app/contracts` | Durum/tip/müvekkil filtreli tablo, yenileme takvimi görünümü |
| Sözleşme Detayı | `/app/contracts/:id` | Durum makinesi şeridi, versiyon listesi, imza durumu, bağlı deadline'lar, AI inceleme sekmesi |
| Versiyon Karşılaştırma | `/app/contracts/:id/versions/compare?a=&b=` | Madde bazlı metin diff'i |
| İmza Süreci | `/app/contracts/:id/signature` | İmzacı listesi + durumları, hatırlatma gönder, süreç iptali |
| E-imza Ayarları | `/app/settings/e-signature` | Sağlayıcı seçimi + kimlik bilgileri (ADMIN) |

ASCII wireframe — Sözleşme Detayı:

```
┌─ ABC Holding — Depo Kira Sözleşmesi                    #CTR-2026-041 ┐
│ [Taslak]→[Müzakere]→[İmzada]→●YÜRÜRLÜKTE→[Yenileme]     Durum: 🟢    │
├──────────────────────────────────────────────────────────────────────┤
│ Yürürlük: 01.09.2025 → 31.08.2026   Kendiliğinden yenileme: VAR      │
│ ⚠ Fesih ihbarı son günü: 01.08.2026 (Deadline #D-9812'ye bağlı)      │
├───────────────────────────┬──────────────────────────────────────────┤
│ VERSİYONLAR               │ AI İNCELEME (v4 üzerinde, 12.06.2026)    │
│ v4 nihai   10.06  [imzalı]│ 🔴 m.7 Cezai şart karşılıksız ve sınırsız│
│ v3 k.taraf 02.06  [diff]  │ 🟡 m.12 Yetki: yalnız karşı taraf merkezi│
│ v2 bizim   25.05  [diff]  │ ⬜ Eksik: mücbir sebep hükmü yok         │
│ v1 taslak  20.05          │ ⬜ Eksik: KVKK/gizlilik hükmü yok        │
│                           │ [Rapor] [Müzakere notu oluştur]          │
├───────────────────────────┴──────────────────────────────────────────┤
│ İMZA: ABC Holding ✔ 10.06  ·  Müvekkil ✔ 10.06  ·  Sağlayıcı: NES-X  │
└──────────────────────────────────────────────────────────────────────┘
```

## Veri Modeli

**Contract**

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | uuid | |
| client_id | uuid FK→Client | İlgili müvekkil |
| case_id | uuid FK→Case null | Dosyayla ilişkiliyse |
| title / contract_type | text / enum(VEKALET_UCRET, DANISMANLIK, KIRA, HIZMET, TEDARIK, GIZLILIK, DIGER) | |
| counterparty | jsonb | {name, type, contact} — karşı taraf |
| status | enum(DRAFT, NEGOTIATION, SIGNING, EXECUTED, ACTIVE, RENEWAL_DUE, TERMINATED, EXPIRED) | Durum makinesi |
| current_version_id | uuid FK→ContractVersion | |
| effective_from / effective_to | date | Yürürlük aralığı |
| auto_renewal | bool | Kendiliğinden yenileme hükmü var mı |
| renewal_notice_days | int null | Fesih ihbar süresi (gün) |
| renewal_deadline_id | uuid FK→Deadline null | Süre Motoru'na açılan kayıt |
| signed_document_id | uuid FK→Document null | İmzalı nüsha |
| created_by / created_at / updated_at | uuid / timestamptz | |

**ContractVersion**

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id / contract_id | uuid | |
| version_no | int | Sözleşme içinde artan, benzersiz |
| source | enum(OUR_DRAFT, COUNTERPARTY, FINAL) | Turu kim attı |
| document_id | uuid FK→Document | Versiyonun dosyası (docx/pdf) |
| body_text | text | Diff ve AI için çıkarılmış düz metin |
| notes | text | Müzakere notu |
| review_id | uuid FK→ContractReview null | Bu versiyona yapılan AI inceleme |
| created_by / created_at | uuid / timestamptz | |

**SignatureRequest** (sağlayıcı-bağımsız)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id / contract_id | uuid | |
| version_id | uuid FK→ContractVersion | İmzalanan metin (FINAL) |
| provider | text | Adaptör anahtarı (örn. "nes-x", "mobil-imza-y", "wet-ink") |
| provider_ref | text | Sağlayıcıdaki süreç id'si |
| signers | jsonb | [{name, email/phone, order, status: PENDING\|SIGNED\|REJECTED, signed_at}] |
| status | enum(CREATED, SENT, PARTIALLY_SIGNED, COMPLETED, REJECTED, CANCELLED, EXPIRED) | |
| evidence | jsonb | Sağlayıcı imza kanıt paketi referansı (zaman damgası vb.) |
| created_by / created_at / completed_at | uuid / timestamptz | |

**ContractReview** (AI inceleme sonucu)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id / version_id | uuid | |
| risky_clauses | jsonb | [{clause_ref, quote, risk_type, severity, explanation, suggestion}] |
| missing_clauses | jsonb | [{topic, why_needed, suggested_text}] |
| overall_note | text | |
| ai_usage_log_id | uuid FK→AiUsageLog | |
| created_at | timestamptz | |

**`ISignatureProvider` adaptör arayüzü** (uygulama sözleşmesi): `createProcess(version, signers) → provider_ref` · `getStatus(provider_ref) → status+signers` · `cancel(provider_ref)` · `downloadSignedFile(provider_ref) → file` · `handleWebhook(payload) → durum güncellemesi` (imza doğrulamalı, idempotent). Adaptörler plugin olarak kaydedilir; çekirdek yalnız bu beş metodu çağırır.

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı |
|---|---|
| `CONTRACT_REVIEW` | Versiyon düz metni + sözleşme tipi + tarafımız (hangi taraf müvekkil) → ContractReview şeması |
| `CONTRACT_DIFF_SUMMARY` | İki versiyonun metni → madde bazlı değişiklik özeti ("m.7 cezai şart 100.000→250.000 TL çıkarıldı") |
| `CONTRACT_KEYDATA_EXTRACT` | Yüklenen imzalı sözleşme → {taraflar, yürürlük aralığı, auto_renewal, renewal_notice_days, bedel} alan önerileri |

`CONTRACT_REVIEW` sistem prompt taslağı:

```
Sen sözleşmeler hukukunda uzman bir Türk avukatısın. Sana bir sözleşme metni,
sözleşme tipi ve MÜVEKKİLİMİZİN hangi taraf olduğu verildi. Görevin müvekkil
lehine inceleme yapmak: (1) RİSKLİ MADDELER: müvekkil aleyhine dengesiz hükümleri
madde numarası ve birebir alıntıyla işaretle; risk tipini (CEZAI_SART, TEK_TARAFLI_
FESIH, YETKI_SARTI, SORUMLULUK, SURE, BEDEL, DIGER) ve önerilen düzeltme metnini yaz.
(2) EKSİK HÜKÜMLER: bu sözleşme tipinde bulunması beklenip metinde olmayanları
(uyuşmazlık çözümü, gizlilik, mücbir sebep, KVKK, fesih usulü...) gerekçesiyle listele.
KURALLAR: Metinde olmayan maddeye atıf yapma; alıntılar birebir olsun; TBK/TTK
atıflarında madde numarası ver; çıktı yalnızca verilen JSON şemasında olsun.
```

**KVKK notu**: Sözleşme metinleri kişisel veri içerir (taraf kimlikleri, adresler, IBAN); AI'a gönderim öncesi maskeleme hattı çalışır, madde alıntıları maskelenmiş haliyle saklanıp UI'da yetkili kullanıcıya orijinal metinden gösterilir. E-imza sağlayıcısına yalnız imza süreci için zorunlu imzacı bilgisi gider. Tüm çağrılar `AiUsageLog`'a yazılır.

## İş Kuralları

1. Durum geçişleri yalnız şu yollarla olur: DRAFT→NEGOTIATION→SIGNING→EXECUTED→ACTIVE→(RENEWAL_DUE→ACTIVE | TERMINATED | EXPIRED); geriye geçiş yalnız SIGNING→NEGOTIATION (imza süreci iptalinde). Geçersiz geçiş 409.
2. `CONTRACT_REVIEW` ve `CONTRACT_KEYDATA_EXTRACT` çıktıları **öneridir**: alan önerileri (yürürlük tarihi, yenileme süresi) avukat onayı olmadan Contract kaydına yazılmaz.
3. SIGNING durumuna geçiş için FINAL işaretli bir versiyon zorunludur; imza sürecindeyken yeni versiyon eklenemez (önce süreç iptal edilir).
4. `SignatureRequest` COMPLETED olduğunda imzalı dosya indirilir, `Document` olarak kaydedilir, `signed_document_id` bağlanır ve sözleşme EXECUTED olur — bu zincir atomiktir, yarım kalırsa süreç uyarı üretir.
5. `auto_renewal=true` ve `renewal_notice_days` dolu sözleşme ACTIVE olduğunda sistem otomatik `Deadline` açar: son ihbar günü = effective_to − renewal_notice_days (resmi tatil hesabı Süre Motoru kuralıyla). Sözleşme güncellenirse deadline yeniden hesaplanır.
6. effective_to − 60 gün kala sözleşme RENEWAL_DUE'ya çekilir ve sorumluya görev açılır.
7. Versiyonlar ve imza kanıt paketleri silinemez; sözleşme yalnız TERMINATED/EXPIRED sonrası arşivlenebilir (AuditLog izli).
8. E-imza sağlayıcı webhook'ları imza doğrulamalı ve idempotenttir; doğrulanamayan çağrı 401 + güvenlik logu.
9. Sağlayıcı değişimi mevcut süreçleri etkilemez: açık `SignatureRequest` kayıtları eski adaptörle tamamlanır/iptal edilir.
10. STAJYER sözleşme okuyabilir, versiyon yükleyebilir; SIGNING başlatma ve durum geçişleri AVUKAT ve üstü.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET/POST | `/api/v1/contracts` | Liste (filtreli) / oluştur |
| GET/PATCH | `/api/v1/contracts/:id` | Detay / alan güncelle |
| POST | `/api/v1/contracts/:id/transition` | body: {to_status} — durum makinesi geçişi |
| GET/POST | `/api/v1/contracts/:id/versions` | Versiyon listesi / yeni versiyon yükle |
| GET | `/api/v1/contracts/:id/versions/compare?a=&b=` | Diff (+ `CONTRACT_DIFF_SUMMARY` opsiyonel) |
| POST | `/api/v1/contracts/:id/versions/:vid/review` | `CONTRACT_REVIEW` başlat (async) |
| POST | `/api/v1/contracts/:id/signature-requests` | body: {provider, signers} — imza süreci başlat |
| GET | `/api/v1/signature-requests/:id` | İmza durumu |
| POST | `/api/v1/signature-requests/:id/cancel` · `/remind` | İptal / imzacıya hatırlatma |
| POST | `/api/v1/webhooks/esignature/:provider` | Sağlayıcı webhook'u |
| GET | `/api/v1/contracts/renewals?days=90` | Yaklaşan yenileme/fesih takvimi |

## Diğer Modüllerle İlişkiler

- **Süre Motoru**: yenileme/fesih ihbar deadline'ları oraya yazılır; uyarı ve eskalasyon standart akıştan.
- **Müvekkil CRM**: sözleşmeler müvekkil kartının sekmesi; vekalet ücret sözleşmeleri Finans tahakkuklarına temel.
- **Belge Yönetimi**: versiyon dosyaları ve imzalı nüsha `Document` altyapısında (OCR + tam metin arama dahil).
- **Finans/Faturalama**: sözleşme bedeli ve ödeme planı `FinancialEntry` tahakkuklarını besler.
- **Vekaletname Yönetimi**: vekalet ücret sözleşmesi ↔ vekaletname kapsam kontrolü çapraz bağlantılıdır.
- **Partner Dashboard (18)**: RENEWAL_DUE sözleşmeler öncelik adayıdır.
- **AI Agents (21)**: inceleme görevleri BYO-LLM eşlemesiyle koşar; mevzuat atıfları Teyit Ajanı'ndan geçer.

## Kabul Kriterleri

1. DRAFT→ACTIVE tam yol, tanımlı geçişlerle yürür; DRAFT→SIGNING gibi atlama denemesi 409 döner.
2. Karşı taraf versiyonu yüklendiğinde compare ucu madde bazlı diff döner; `CONTRACT_DIFF_SUMMARY` özeti değişen maddeleri numarasıyla anar.
3. `CONTRACT_REVIEW` çıktısındaki her riskli madde alıntısı, versiyon metninde birebir bulunur (sunucu doğrulaması; bulunamayan alıntı elenir ve loglanır).
4. Mock sağlayıcı adaptörüyle imza süreci: createProcess→webhook(SIGNED×2)→COMPLETED zinciri sonunda sözleşme EXECUTED, imzalı nüsha `Document`'ta ve `signed_document_id` doludur.
5. auto_renewal'lı sözleşme ACTIVE olduğunda son ihbar günü deadline'ı otomatik açılır; effective_to değişince deadline yeniden hesaplanır.
6. effective_to'ya 60 gün kala gece koşusu sözleşmeyi RENEWAL_DUE yapar ve sorumluya görev açar.
7. İmza sürecindeyken versiyon yükleme 409; süreç iptalinden sonra 201 döner.
8. Geçersiz imzalı webhook 401 döner ve süreç durumu değişmez; aynı webhook iki kez gelirse durum tek kez işlenir.
9. `CONTRACT_KEYDATA_EXTRACT` önerileri onay ekranında gösterilir; onaysız hiçbir alan Contract'a yazılmaz.
10. Farklı tenant'ın sözleşmesine erişim 404; STAJYER token'ı transition ucunda 403 alır.

## Faz

**Faz 5.** Alt sıra: 5.1 Contract + versiyonlama + durum makinesi + yenileme deadline'ları → 5.2 e-imza adaptör çerçevesi + ilk sağlayıcı + webhook → 5.3 `CONTRACT_REVIEW` / `CONTRACT_DIFF_SUMMARY` / `CONTRACT_KEYDATA_EXTRACT` AI katmanı ve portal imza görünümü.
