# F2 Durum Kaydı — 31 Ağustos 2026 (Tur 1, ikinci oturum)

> Bu dosya, tam epic dosyası yazılmayan ancak KAPANMIŞ kesitlerin kaydıdır.
> Her satır kanıtını (test dosyası, commit) taşır. Tam epic dosyaları:
> [A4](A4-sure-kurali-tamamlama.md) · [E6](E6-delil-bag-yonu.md) ·
> [E2](E2-gece-risk-skorlama.md) · [B2](B2-belge-metin-cikarma.md) ·
> [E1](E1-ajan-gozlemlenebilirlik.md)

## İkinci oturumda kapananlar (otonom kararlar)

| Epic | Kesit | Kanıt (test) | Not |
|---|---|---|---|
| E6 kalanı | `Evidence.offeredBy` (BIZ/KARSI_TARAF/ORTAK) + **KK6 422 kapısı** + arayüzde "Kim sundu" seçicisi ve taraf rozeti | `evidence-matrix.test.ts` (13) | Migration `20260915090000_f2_e6_delil_tarf` |
| A1 | **Politika matrisi** (şema-güdümlü, 9 kategori × 9 kural kümesi; Avukatlık K. m.39 ↔ KVKK m.7 çelişkisinin çözümü) | `docs/kvkk-politika-matrisi.md` | A1'in "ilk task kod değil" gereğinin karşılığı |
| A1 | **Müvekkil bazlı tam dışa aktarma**: `GET /clients/:id/export` (K1-K7 tek JSON; rol kapısı + denetim izi) + arayüzde indirme düğmesi | tip denetimi + canlı duman (aşağıda) | KVKK m.11 erişim hakkı yanıtı |
| B1 ilk kesit | **Asenkron belge hattı**: BullMQ kuyruğu + 3 deneme üstel geri çekilme + DLQ (takılan koşum BASARISIZ'a çekilir) + **yumuşak düşüş** (Redis yoksa senkron — yükleme Redise sert bağımlı değil) | `pipeline-queue.test.ts` (8) | Yükleme VE reprocess yollarının ikisi de kuyruğa gider |
| Web | **Ajan koşu izleri paneli** (Ayarlar → AI Kullanımı): ajan, görev, durum, süre, model, PII maskesi; durum süzgeci | Web build + canlı 200 | E1'in "iz görünümü" çıkış kriteri |

## İkinci oturumda verilen otonom kararlar (uygulama bekleyen)

| Karar | İçerik | Nereye |
|---|---|---|
| **B2 OCR** | Kendi barındırılan OCR (tesseract.js, imaja paketli dil verisi, %90 güven kapısı, kuyrukta, ücretsiz); bulut OCR REDDEDİLDİ | [B2 dosyasında şartname](B2-belge-metin-cikarma.md) |
| **A1 PoaScopeItem** | JSON→entity terfisi ertelendi; expand-contract planı: (1) entity + geri-doldurma göçü, (2) çift yazım, (3) okuma yollarının geçişi, (4) JSON'un düşürülmesi. Üç servisi (poa/poa-scope/poa-warnings) birden değiştirmek tek oturumda kalite riski taşıdığı için bilinçli olarak sonraki tura bırakıldı | Sonraki kesit |
| **A1 POST /tenants + hard-purge→soft-delete** | Platform kiracı oluşturma ve `DELETE /tenants/:id`'nin Modül 25 "soft-delete + anonimleştirme kuyruğu"na dönüşümü A1'in kalan ayağı — platform onay akışıyla (dört-göz) birlikte tasarlanmalı | Sonraki kesit |
| **A3a UETS** | Tedarik süreç izleme dosyası: PTT'ye yazılı görüş talebi gönderilmedi — bu tarafınca başlatılamaz (takvim üçüncü tarafta); istek şablonu hazırlanmalı | Süreç (kod değil) |

## Kapanan kesitler (birinci oturum)

| Epic | Kesit | Kanıt (test) | Not |
|---|---|---|---|
| A0 | Vaat hizalaması — tamamı | `apps/web/src/lib/vaat-kisitlari.test.ts` (13 test) | Ö-24/25/26 kısıtları pazarlama + yükleme ekranı + yol haritası notu |
| A2 | Üretim kapatıcıları — tamamı (önceki oturum) | K-12: `portal-poa-liveness.test.ts` · PlatformUser FK: `platform-audit-fk.test.ts` · İ-31: migration `20260911090000` | `docs/DENETIM-RAPORU.md` "Kapatıcılar Turu Sonucu" |
| A2 | Regresyon test paketi | +36 test (K-01/03/05/08/09/13) | Denetim "test borcu" maddesi |
| A5 | İ-01 TOTP tekrar oynatma | `totp-replay.test.ts` (10) | `lastTotpCounter` + migration `20260912090000` |
| A5 | İ-02 bcrypt 12 (panel+portal) | `platform-2fa-key.test.ts`, şema taraması | Kiracı tarafı zaten 12'ydi |
| A5 | İ-19 Gemini anahtar başlıkta | `packages/ai` derlemesi + kod incelemesi | `x-goog-api-key` başlığı |
| A5 | İ-25 demo formu hız sınırı | `route.ts` içinde süreç-içi sayaç (3/10dk) | 429 yanıtı |
| F1 | İ-27 rota kataloğu 3 → 27 modül | `api-route-catalog.test.ts` (4) | Çift yönlü sözleşme testi |
| F7 | İ-21 kontrast AA | `kontrast.test.ts` (6) | slate-400→500 (159 kullanım, 50 dosya) + portal ink-faint koyulaştırma |
| F7 | İ-26 tabpanel yardımcısı | `tabPanelProps()` (ui.tsx) | Yayınlanan aria-controls'un paneli vardır |
| F7 | İ-20 ham enum basımı | `USER_ROLE_LABELS` | Düzen kenarı Türkçe rol etiketi basar |
| A4 | Yedi yeni süre kuralı | `deadline-engine.test.ts` (79) | [A4 dosyası](A4-sure-kurali-tamamlama.md) |
| E6 | Delil bağı yönü | `evidence-matrix.test.ts` (8) | [E6 dosyası](E6-delil-bag-yonu.md) |
| E2 | Gece risk + panel fotoğrafı | `risk-nightly.test.ts` (8) | [E2 dosyası](E2-gece-risk-skorlama.md) |
| B2 | DOCX + UDF metin çıkarma | `text-extract.test.ts` (9) | [B2 dosyası](B2-belge-metin-cikarma.md) |
| E1 | Ajan gözlemlenebilirliği | `agent-run.test.ts` (10) | [E1 dosyası](E1-ajan-gozlemlenebilirlik.md) |
| — | Lint borcu kapatıldı | `pnpm lint` → 0 hata / 0 uyarı | 10 uyarının 10'u giderildi |

## Açık kesitler (sıradaki oturumlar)

| Epic | Açık iş | Engel |
|---|---|---|
| A1 | `PoaScopeItem` JSON→entity terfisi (expand-contract planı yukarıda) | M — üç servisin birden geçişi |
| A1 | `POST /tenants` (platform kiracı oluşturma) + `DELETE /tenants/:id`'nin soft-delete + anonimleştirme kuyruğuna dönüşümü | M — dört-göz onay akışıyla tasarlanmalı |
| B1 | Kuyruk kalanı: toplu yeniden deneme ucu, geri basınç, korpus ingest ve UYAP senkronun kuyruğa bağlanması | L |
| B2 | OCR uygulama kesiti (karar verildi, şartname B2 dosyasında) | M — tesseract.js + paketli dil verisi |
| A3a | UETS tedarik + PTT yazılı görüşü | Takvim bizde değil — GÜN 1 başlamalı |
| E3/E4/E5, B3–B6, C1–C5, D1–D6, F2–F6 | Yol haritası tur dağılımına göre | T1'den sonra |
