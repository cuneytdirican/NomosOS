# E2 — Gece Risk Skorlama + Panel Fotoğrafı

> ⬅ [F2 Yol Haritas](../00-yol-haritasi.md) · **Blok E — Spec borcu**
> Modül spec'i: [17-risk-motoru](../../moduller/17-risk-motoru.md) · Denetim: —
> İlerleme: **7/7** atomic (%100) · Durum: `✅ BİTTİ`

## Künye

| Alan | Değer |
|---|---|
| Kimlik | `E2` |
| Blok | E — Spec borcu |
| Öncelik | P1 |
| T-shirt boyut | S (15-30p) |
| Atomic puan toplamı | 16 |
| Engelleyen (blocked-by) | `—` |
| Engellediği | `E4` (partner dashboard fotoğrafı okur) |
| Modül spec'i | `docs/moduller/17-risk-motoru.md` — KK5 |
| Ürün fazı borcu | Risk skoru yalnız dosya AÇILDIĞINDA hesaplanıyordu |
| Denetim bulguları | — |
| Dokunulan paketler | `apps/api`, `packages/db` |
| Şema değişikliği | Var → migration `20260913090000_f2_e2_gece_risk_dashboard` |

## Neden

### Problem
RiskScore yalnız bir avukat dosyayı AÇIP hesaplattığında güncelleniyordu; panel günlerce bayat skor gösterebiliyordu ve panel her açılışta yüzlerce satırı canlı topluyordu.

### Bugün ne oluyor
`RiskService.compute()` kullanıcı tetiklemelidir; gece işi yoktur. `RiskScore.computedBy`
şemasında "gece hesabında null" yorumu VARDIR ama yazan hiçbir kod yoktur.
`docs/faz2/00-yol-haritasi.md` E2'yi "en ucuz epic" sayar: desenler hazırdır.

### Kapanınca ne değişer
Gece 02:30'da aktif dosyaların DETERMİNİSTİK tabanı tazelenir (`computedBy: null`);
kiracı günlük `DashboardSnapshot` satırı yazılır; panel açılışı tek satırdan okur.

## Kapsam

- `DashboardSnapshot` modelini ve migration'ı ekle
- `RiskNightlyService`'i yaz (AI çağırmaz, önceki AI düzeltmesini korur)
- Zamanlayıcı işi sarmalayıcısını ve kayıt defteri girişini ekle
- Fotoğraf toplama katmanını saf fonksiyon olarak ayır
- Regresyon testleri yaz

## Kapsam Dışı

| Yapılmayacak | Neden | Nereye ait |
|---|---|---|
| Panelde fotoğrafın GÖSTERİMİ | E4 (partner dashboard) işidir; bu epic yalnız YAZAR | `E4` |
| RiskOverride tablosunda değişiklik | Override okuma anında uygulanır; gece işi dokunmaz | Hiç yapılmayacak |
| Kapanmış dosyaların skorlanması | Kapanmış dosyanın riski değişmez | Hiç yapılmayacak |

## Veri Modeli Değişikliği

| Model | Alanlar |
|---|---|
| `DashboardSnapshot` (yeni) | `id`, `tenantId`, `date` (TR günü, ISO), `caseCount`, `highRiskCount`, `avgGenelScore?`, `bandDistributionJson`, `topCasesJson`, `recomputedCount`, `createdAt` |

`@@unique([tenantId, date])` — aynı gün yeniden koşulursa fotoğraf GÜNCELLENİR (idempotent).

## Kırılım

### E2-T01 · Model + gece hizmeti + zamanlayıcı  ✅

| Alan | Değer |
|---|---|
| Engelleyen | `—` |
| Engellediği | `E4` |
| Puan | 16 |

#### E2-T01-S01 · Şema ve migration  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E2-T01-S01-A01` | `DashboardSnapshot` modelini ekle ve migration üret | `packages/db/prisma/schema.prisma`<br>`packages/db/prisma/migrations/20260913090000_f2_e2_gece_risk_dashboard/migration.sql` (yeni) | `prisma migrate status` temiz; `(tenantId, date)` unique | 2 | ✅ |

#### E2-T01-S02 · Gece hizmeti  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E2-T01-S02-A01` | `buildSnapshotRow` saf toplama fonksiyonunu yaz | `apps/api/src/risk/risk-nightly.service.ts` (yeni) | Bant dağılımı, ortalama, top-5 hesabı saf; tek dosya testlenebilir | 2 | ✅ |
| `E2-T01-S02-A02` | `RiskNightlyService.runNightly` yaz: deterministik taban + AI düzeltme koruması | `apps/api/src/risk/risk-nightly.service.ts` (yeni) | Aktif dosyalar `RiskScore`'a `computedBy: null` ile upsert; `aiAdjustment` önceki koşudan korunur | 3 | ✅ |
| `E2-T01-S02-A03` | `loadSnapshot` görünürlüğünü public yap | `apps/api/src/risk/risk.service.ts` | Gece hizmeti anlık görüntüyü KOPYALAMADAN kullanır | 1 | ✅ |

#### E2-T01-S03 · Zamanlayıcı ve testler  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E2-T01-S03-A01` | `risk-nightly.job.ts` sarmalayıcısı + kayıt defteri + modül kaydı | `apps/api/src/scheduler/jobs/risk-nightly.job.ts` (yeni)<br>`apps/api/src/scheduler/job-registry.service.ts`<br>`apps/api/src/scheduler/scheduler.constants.ts`<br>`apps/api/src/scheduler/scheduler.module.ts` | `JOB_KEYS.RISK_NIGHTLY = "risk-nightly"` kayıt defterinde; cron `30 2 * * *` | 2 | ✅ |
| `E2-T01-S03-A02` | Regresyon testleri yaz | `apps/api/src/risk/risk-nightly.test.ts` (yeni) | Sekiz test: toplama katmanı, kayıt defteri, AI-yok taahhüdü, computedBy-null, aktif filtre, kural kaynaklı hesap | 3 | ✅ |

## Kabul Kriterleri

1. `JOB_KEYS.RISK_NIGHTLY` iş kayıt defterinde kayıtlıdır; iş zamanlayıcıdan tetiklenebilir. (`E2-T01`)
2. Gece hizmeti dosyasında AI koşusu ithal edilmez (kaynak taraması). (`E2-T01`)
3. Gece hesabında yazılan `RiskScore.computedBy` null'dır. (`E2-T01`)
4. `NIGHTLY_ACTIVE_CASE_STATUSES` KAPANDI/ARSIV/KESINLESTI içermez. (`E2-T01`)
5. Boş büro için fotoğraf `caseCount: 0`, `avgGenelScore: null` yazar. (`E2-T01`)
6. Top-5 listesi en yüksek GENEL skorla başlar ve `DASHBOARD_TOP_CASES` ile sınırlıdır. (`E2-T01`)

## Test Yükümlülüğü

| Ne | Nerede | Neyi korur |
|---|---|---|
| `risk-nightly.test.ts` | `apps/api/src/risk/` (yeni) | Fotoğraf toplama katmanı, ürün ilkesi (AI çağrılmaz), kayıt defteri, aktif dosya filtresi |

## Riskler ve Açık Sorular

### Riskler
| Risk | Etki | Önlem |
|---|---|---|
| Büyük büroda gece koşusunun uzun sürmesi | 02:30 işi 03:00+ biter | Dosya başına try/catch; tek dosya arızası geceyi düşürmez; telemetri `recomputedCount` taşır |

### Açık sorular
| # | Soru | Kime | Karar verilmezse |
|---|---|---|---|
| S1 | Fotoğraf panelde nerede gösterilir? | Ürün | E4 fotoğrafı okuyamaz, canlı sorguya döner |

## Vaat Kısıtı

> **Bu epic kapanana kadar arayüzde ve tanıtım sitesinde SÖYLENEMEZ:**
>
> - "Risk skoru her gece güncellenir" ifadesi panelde gösterilmeden tam söylenemez
>
> **Bunun yerine söylenecek:** "Risk skorlarının deterministik tabanı her gece tazelenir; paneller günlük fotoğraftan okur"
>
> **Bugün nerede yazıyor (temizlendi):** — (hiçbir yerde yazmıyordu; kısıt bilgi amaçlı)

## Değişiklik Günlüğü

| Tarih | Ne değişti | Kim |
|---|---|---|
| 31.08.2026 | Oluşturuldu ve tamamlandı (7 atomic, 16 puan) | Aeon (F2 turu) |
