# F2 Durum Kaydı — 31 Ağustos 2026 (Tur 1, ilk oturum)

> Bu dosya, tam epic dosyası yazılmayan ancak KAPANMIŞ kesitlerin kaydıdır.
> Her satır kanıtını (test dosyası, commit) taşır. Tam epic dosyaları:
> [A4](A4-sure-kurali-tamamlama.md) · [E6](E6-delil-bag-yonu.md) ·
> [E2](E2-gece-risk-skorlama.md) · [B2](B2-belge-metin-cikarma.md) ·
> [E1](E1-ajan-gozlemlenebilirlik.md)

## Kapanan kesitler

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
| A1 | KVKK veri özne hakları: politika matrisi, `POST /tenants/:id/export`, müvekkil bazlı dışa aktarma, `PoaScopeItem` entity'ye terfi | L(65) — politika matrisi ilk iş |
| B1 | BullMQ asenkron altyapı (DLQ, geri basınç, kısmi başarısızlık) | L(55) |
| B2 | OCR kesiti | Ürün kararı S1 (kendi barındırılan OCR) |
| A3a | UETS tedarik + PTT yazılı görüşü | Takvim bizde değil — GÜN 1 başlamalı |
| E3/E4/E5, B3–B6, C1–C5, D1–D6, F2–F6 | Yol haritası tur dağılımına göre | T1'den sonra |
