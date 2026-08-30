# NomosOS — Sistem Mimarisi

## Genel Bakış

NomosOS, çok kiracılı (multi-tenant) bir SaaS'tır. Merkezde **dosya** (Case) vardır;
AI, tüm operasyonel verinin üzerinde çalışan bir zekâ katmanıdır (bkz. [00-vizyon.md](00-vizyon.md)).

```
┌───────────────────────────────────────────────────────────────┐
│  İstemciler                                                   │
│  apps/web (Next.js)  ·  apps/uyap-extension (Faz 2, MV3)      │
│  Müvekkil Portalı (Faz 5)  ·  Mobil (Faz 6, React Native)     │
└──────────────────────────┬────────────────────────────────────┘
                           │ HTTPS / JSON (REST /api/v1)
┌──────────────────────────▼────────────────────────────────────┐
│  apps/api (NestJS)                                            │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │ Legal Core  │ │ Workflow     │ │ AI Orkestrasyon        │  │
│  │ clients,    │ │ tasks,       │ │ ai/chat, providers,    │  │
│  │ cases,      │ │ deadlines,   │ │ task-routes, KVKK      │  │
│  │ hearings…   │ │ pipeline*    │ │ ön-filtre              │  │
│  └─────────────┘ └──────────────┘ └───────────┬────────────┘  │
└──────────┬───────────────┬────────────────────┼───────────────┘
           │               │                    │
┌──────────▼─────┐ ┌───────▼────────┐ ┌─────────▼──────────────┐
│ PostgreSQL     │ │ Redis          │ │ packages/ai (BYO-LLM)  │
│ (Prisma)       │ │ kuyruk/önbellek│ │ Anthropic · OpenAI-    │
│                │ │ (BullMQ, Faz 2)│ │ uyumlu · Ollama ·      │
│ MinIO/S3       │ │                │ │ Gemini · Custom        │
│ (belgeler)     │ │                │ └────────────────────────┘
└────────────────┘ └────────────────┘
* pipeline: belge→otomatik aksiyon hattı Faz 2'de Redis kuyruğuna taşınır
```

## Monorepo Yapısı

| Yol | Paket | Sorumluluk |
|-----|-------|-----------|
| `apps/web` | `@nomosos/web` | Next.js 15 — pazarlama sitesi + uygulama arayüzü |
| `apps/api` | `@nomosos/api` | NestJS — REST API, iş mantığı, AI orkestrasyonu |
| `apps/uyap-extension` | (Faz 2) | Chrome MV3 — UYAP senkronizasyonu |
| `packages/db` | `@nomosos/db` | Prisma şeması, migration, seed |
| `packages/ai` | `@nomosos/ai` | BYO-LLM sağlayıcı katmanı, şifreleme, PII taraması |
| `packages/shared` | `@nomosos/shared` | Zod şemaları, enum'lar, TR hukuk sabitleri, AI görev tipleri |

Bağımlılık yönü: `apps/* → packages/*`; `packages/ai → packages/shared`;
paketler arası döngü yasaktır.

## Multi-Tenancy

- Her iş kaydı `tenantId` taşır; tüm sorgular JWT'deki `tenantId` ile filtrelenir
  (satır seviyesi izolasyon, tek veritabanı).
- JWT payload: `{ sub: userId, tenantId, role }`. Rol: ADMIN/PARTNER/AVUKAT/STAJYER/SEKRETER.
- Tenant-ötesi erişim testleri her fazın çıkış kriteridir (negatif testler).
- Enterprise'da (Faz 5+) isteğe bağlı ayrık veritabanı / Türkiye veri bölgesi seçeneği
  değerlendirilir; şema bugünden buna engel değildir.

## Olay-Tabanlı Otomatik Aksiyon Hattı (Faz 2'nin omurgası)

"Belge geldi → sistem ne yapılacağını kendisi çıkardı" paradigması (Gereksinim 7):

```
Belge kaynağı (yükleme / UYAP extension)
  → belge.olusturuldu olayı (Redis kuyruğu, BullMQ)
    → DOCUMENT_CLASSIFY  (AI: belge sınıfı + güven skoru)
    → DOCUMENT_EXTRACT   (AI: tarihler, süre ifadeleri, talepler)
    → DEADLINE_DETECT    (AI önerisi → Deadline{source: AI_ONERISI, status: BEKLIYOR})
    → Görev üretimi      (kural: belge sınıfı → görev şablonu)
    → Bildirim           (sorumlu avukata)
```

İlkeler:
1. **AI çıktısı her zaman öneridir** — `Deadline.source=AI_ONERISI` kayıtları avukat
   onayı (`status=ONAYLANDI`) olmadan takvim ve kritik uyarılara girmez.
2. Kesin süre hesabı deterministiktir: kural motoru (Modül 04) tebliğ tarihi + yöntem +
   mevzuat kuralı + resmi tatil takvimi ile hesaplar; AI yalnızca "bu belgede süre
   başlatan bir olay var" tespiti yapar.
3. Her adım `AuditLog` + `AiUsageLog`'a iz bırakır.

İskelet aşamasında (Faz 0) kuyruk yoktur; `POST /ai/chat` senkron çalışır. Faz 2'de
BullMQ worker'ları eklenir.

## AI Orkestrasyonu

- Görev tipi kataloğu: `packages/shared/src/ai-task-types.ts` (`CASE_CHAT`,
  `DOCUMENT_CLASSIFY`, `HEARING_PREP` …).
- Eşleme: `AiTaskRoute (tenantId, taskType) → (AiProviderConfig, model)`.
  Eşleme yoksa tenant'ın ilk aktif sağlayıcısı + `defaultModel` kullanılır.
- Çağrı akışı: bağlam kur → KVKK PII taraması (bkz. [04-kvkk-veri-guvenligi.md](04-kvkk-veri-guvenligi.md))
  → `createProvider(config).chat()` → `AiUsageLog` kaydı → yanıt + kaynaklar.
- Ayrıntı: [03-ai-katmani-byo-llm.md](03-ai-katmani-byo-llm.md).

## API Sözleşme İlkeleri

- REST, prefix `/api/v1`, kaynak-adlı çoğul uçlar (`/clients`, `/cases`, `/ai/providers`).
- Girdi doğrulama: `@nomosos/shared` Zod şemaları (API ve web aynı şemayı paylaşır).
- Hata gövdesi: `{ statusCode, message (Türkçe), error }`.
- Özel durum: `POST /ai/chat` PII onayı gerektiğinde **409** döner
  (`{ requiresPiiApproval, findings, maskedText }`) — istemci onay akışını başlatır.

## Çalıştırma Topolojileri

1. **Geliştirme (önerilen)**: `docker compose up -d` (postgres+redis+minio) +
   `pnpm dev` (api 3001, web 3000).
2. **Tam Docker**: `docker compose --profile full up --build` — api ve web imajları dahil.
3. **Üretim (hedef)**: yönetilen PostgreSQL, S3, Redis; api/web konteynerleri;
   ayrıntı Faz 1 sonunda yazılacak `docs/uretim-dagitimi.md`'ye bırakıldı.
