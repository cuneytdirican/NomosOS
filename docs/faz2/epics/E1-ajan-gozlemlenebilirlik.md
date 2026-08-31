# E1 — AI Ajan Gözlemlenebilirliği

> ⬅ [F2 Yol Haritas](../00-yol-haritasi.md) · **Blok E — Spec borcu**
> Modül spec'i: [26-kurumsal-raporlama](../../moduller/26-kurumsal-raporlama.md) · Denetim: —
> İlerleme: **9/9** atomic (%100) · Durum: `✅ BİTTİ`

## Künye

| Alan | Değer |
|---|---|
| Kimlik | `E1` |
| Blok | E — Spec borcu |
| Öncelik | P1 (sonraki her AI epic'ini enstrümante eder) |
| T-shirt boyut | M (30-60p) |
| Atomic puan toplamı | 19 |
| Engelleyen (blocked-by) | `—` |
| Engellediği | `C5`, `D5` (enstrümantasyon altyapısı) |
| Modül spec'i | — (yeni yetenek) |
| Ürün fazı borcu | T1 çıkış kriteri: "Her AI çağrısı izlenebilir" |
| Denetim bulguları | — |
| Dokunulan paketler | `packages/db`, `packages/shared`, `apps/api` |
| Şema değişikliği | Var → migration `20260914090000_f2_e1_agent_run` |

## Neden

### Problem
LLM çağrılarının iç muhasebesi (AiUsageLog: token/kredi) vardı; İZ yoktu: hangi ajan, hangi girdiyle, neden başarısız kaldı sorusunun cevabı yoktu.

### Bugün ne oluyor
Çıktı guard'ının elediği çağrılar günlükte yalnız istisna olarak görünür; sağlayıcı arızası ile
şema reddi ayrılmaz; "hangi modül AI'ı ne için kullandı" raporu üretilemez.

### Kapanınça ne değişer
Her LLM koşusu `AgentRun` satırı yazar (BASARILI / BASARISIZ / REDDEDILDI);
`GET /ai/agent-runs` kiracı iz görünümü döndürür; iki yürütücü (AiRunnerService,
AssistantLlmService) varsayılan olarak izler.

## Kapsam

- `AgentDefinition` + `AgentRun` modellerini ve migration'ı ekle
- Ajan kataloğunu ortak pakete yaz (her görev tipinin bir sahibi)
- `AgentRunService` yaz (best-effort, KVKK özet sözleşmesi)
- İki LLM yürütücüsünü enstrümante et (üç durum)
- `GET /ai/agent-runs` iz görünümü ucu + rota kataloğu girişi
- Seed'e AgentDefinition tohumunu bağla
- Regresyon testleri yaz

## Kapsam Dışı

| Yapılmayacak | Neden | Nereye ait |
|---|---|---|
| İzlerin arayüz PANOSU | Bu epic API katmanını teslim eder; pano ayrı kesittir | Sonraki tur |
| AgentRun'a TAM metin yazmak | KVKK: maskeleme öncesi metin kayda girmez | Hiç yapılmayacak |
| Ajan devre dışı bırakma akışı | Tanım tablosu tohumlanır; yönetim akışı ayrı epic'tir | Sonraki tur |

## Veri Modeli Değişikliği

| Model | Alanlar |
|---|---|
| `AgentDefinition` (yeni) | `id`, `agentKey` (unique), `taskType`, `name`, `description`, `active`, `createdAt` |
| `AgentRun` (yeni) | `id`, `tenantId`, `agentKey`, `taskType`, `status`, `userId?`, `entity?`, `entityId?`, `model?`, `providerType?`, `inputTokens?`, `outputTokens?`, `durationMs?`, `piiMasked`, `inputSummaryJson?`, `outputSummaryJson?`, `errorMessage?`, `createdAt` + 3 bileşik indeks |

## Kırılım

### E1-T01 · Modeller, katalog, izleyici  ✅

| Alan | Değer |
|---|---|
| Engelleyen | `—` |
| Engellediği | `C5` |
| Puan | 19 |

#### E1-T01-S01 · Şema ve katalog  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E1-T01-S01-A01` | `AgentDefinition` + `AgentRun` modellerini ekle ve migration üret | `packages/db/prisma/schema.prisma`<br>`packages/db/prisma/migrations/20260914090000_f2_e1_agent_run/migration.sql` (yeni) | `prisma migrate status` temiz; `agentKey` unique; üç `(tenantId, …, createdAt)` indeksi var | 3 | ✅ |
| `E1-T01-S01-A02` | Ajan kataloğunu ortak pakete yaz | `packages/shared/src/agent-catalog.ts` (yeni)<br>`packages/shared/src/index.ts` | Her `AI_TASK_TYPES` değeri en çok BİR ajanın listesinde; sahipsiz görev tipi `GENEL`'e düşer | 3 | ✅ |

#### E1-T01-S02 · İzleyici ve uç  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E1-T01-S02-A01` | `AgentRunService` yaz: best-effort record + özet sözleşmesi | `apps/api/src/agents/agent-run.service.ts` (yeni) | Yazım hatası throw etmez; özet alıntısı ≤160 karakter ve MASKELENMİŞTİR | 3 | ✅ |
| `E1-T01-S02-A02` | `GET /ai/agent-runs` ucunu ve modülünü yaz | `apps/api/src/agents/agent-runs.controller.ts` (yeni)<br>`apps/api/src/agents/agents.module.ts` (yeni) | Uç tenant süzgeçli liste döner; modül @Global (yürütücüler import etmeden alır) | 2 | ✅ |
| `E1-T01-S02-A03` | Ucu ortak kataloğa kaydet | `packages/shared/src/api-routes.ts` | `AI_ROUTES.agentRuns` = `/ai/agent-runs`; sözleşme testi geçer | 1 | ✅ |

#### E1-T01-S03 · Enstrümantasyon ve testler  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E1-T01-S03-A01` | AiRunnerService'i üç durumla enstrümante et | `apps/api/src/caselaw/ai-runner.service.ts` | BASARISIZ (sağlayıcı), REDDEDILDI (guard), BASARILI yollarının her biri `agentRuns.record` çağırır | 3 | ✅ |
| `E1-T01-S03-A02` | AssistantLlmService'i enstrümante et | `apps/api/src/assistant/assistant-llm.service.ts` | Aynı üç durum; gövde metinleri özete verilir | 2 | ✅ |
| `E1-T01-S03-A03` | Seed'e ajan tanımlarını bağla | `packages/db/src/seed.ts` | `agentCatalogForSeed()` tohumlar; katalogdan çıkan ajan `active: false` olur | 2 | ✅ |
| `E1-T01-S03-A04` | Regresyon testleri yaz | `apps/api/src/agents/agent-run.test.ts` (yeni) | On test: katalog tek sahiplik, özet KVKK sözleşmesi, iki yürütücü taahhüdü, uç kaydı, seed bağlantısı | 3 | ✅ |

## Kabul Kriterleri

1. `agentForTask("CASELAW_SUMMARIZE").agentKey` → `ICTIHAT_ARASTIRMA`. (`E1-T01`)
2. Bir görev tipi iki ajana ait olamaz (test doğrular). (`E1-T01`)
3. Özet alıntısı 160 karakteri geçmez ve geçerli bir TCKN kalıbı maskelenmiş döner. (`E1-T01`)
4. Sağlayıcı arızasında `status: "BASARISIZ"`, guard reddinde `"REDDEDILDI"` yazılır. (`E1-T01`)
5. `AgentRunService.record` hiçbir koşulda throw etmez. (`E1-T01`)
6. İzlemeyi kaldıran değişiklikte `agent-run.test.ts` kırmızıya döner (kaynak taahhüdü). (`E1-T01`)
7. Tanımsız görev tipinin koşusu `GENEL` ajanı altında kaybolmaz. (`E1-T01`)

## Test Yükümlülüğü

| Ne | Nerede | Neyi korur |
|---|---|---|
| `agent-run.test.ts` | `apps/api/src/agents/` (yeni) | Katalog tek sahipliği, KVKK özet sözleşmesi, iki yürütücünün izleme taahhüdü |

## Riskler ve Açık Sorular

### Riskler
| Risk | Etki | Önlem |
|---|---|---|
| İz yazımı ana akışı yavaşlatır | İstek gecikmesi | Best-effort + tek satır insert; hata günlüğe düşer, akış sürer |

### Açık sorular
| # | Soru | Kime | Karar verilmezse |
|---|---|---|---|
| S1 | İz görünümü büro panelinde nerede gösterilir? | Ürün | Uç kullanılmaz kalır, veri birikir |

## Vaat Kısıtı

> **Bu epic kapanana kadar arayüzde ve tanıtım sitesinde SÖYLENEMEZ:**
>
> - "Her AI çağrısının içeriğini görebilirsiniz" (içerik değil ÖZET saklanır)
>
> **Bunun yerine söylenecek:** "Her AI çağrısının izi tutulur: ajan, süre, durum ve maskelenmiş girdi özeti"
>
> **Bugün nerede yazıyor (temizlendi):** — (kısıt bilgi amaçlı; hiçbir yerde aksi yazmıyordu)

## Değişiklik Günlüğü

| Tarih | Ne değişti | Kim |
|---|---|---|
| 31.08.2026 | Oluşturuldu ve tamamlandı (9 atomic, 19 puan) | Aeon (F2 turu) |
