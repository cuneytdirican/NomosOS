# Kullanıcı Tanımlı Model Eğitimi — Kavram Netleştirme ve Uygulama Planı

## Mevcut Durum (tespitler)

- `FineTuneJob` (packages/db/prisma/schema.prisma:2381) platform düzeyindedir; `provider`/`baseModel` **serbest metin** alanlardır — model kataloğuna bağlı değildir.
- Admin `/egitim` ekranı (apps/admin/src/app/(panel)/egitim/page.tsx) serbest metin girişi kullanır ("OpenAI"/"gpt-4o-mini" varsayılan).
- Kiracı modelleri: `AiProviderConfig` + `AiTaskRoute` (tenantId kapsamlı; apps/web `/app/ayarlar/ai-saglayici`). Platform modelleri: `PlatformAiProvider` (apps/admin `/ai-saglayicilar`).
- LLM tanımlama lisansı: `PlanTier.featuresJson.allowBYOLLM` (yoksa İZİNLİ); kapılar `PlatformAiService.tenantCanDefineOwnLlm` (apps/api/src/ai/platform-ai.service.ts:90) ve `ai.service.ts` D1.3 BYO PLAN KAPISI.
- Örnek havuzu: `AiTrainingSample` (kiracı bazlı, `exportStatus` şeridi). DİKKAT: `FineTuneService.poolSnapshot`/`manifest` (fine-tune.service.ts:143-185) onaylı örnekleri **kiracı süzmesi olmadan** toplar.
- Sözleşme testleri dalga5-contract.test.ts, schema/controller/endpoints içeriklerini metin bazlı doğrular — değişikliklerle birlikte güncellenmelidir.

## Terminoloji Kararı

"AI Eğitim İşleri" → **"Model Eğitim İşleri"**; genel "AI" ifadeleri ilgili ekranlarda **"kullanıcı tanımlı model"** olarak netlenir. Etkilenen: apps/admin/src/lib/nav.ts:27, /egitim page başlık-açıklamaları, apps/web nav, docs/moduller/25-sistem-yonetim-paneli.md, docs/test-ortami.md.

---

## Gereksinim 1 — Yalnızca kendi tanımladıkları modeller seçilebilsin

### Veri modeli (packages/db/prisma/schema.prisma)
- `FineTuneJob` alanları:
  - `tenantId String?` + `Tenant` ilişkisi (null = platform işi)
  - `providerConfigId String?` → `AiProviderConfig` (kiracı işi)
  - `platformAiProviderId String?` → `PlatformAiProvider` (platform işi)
  - `provider`/`baseModel` kalır, yalnızca **anlık görüntü (denormalize)** olarak yazılır.
- Servis katmanı kuralı: tam olarak biri küme olmalı (tenantId+providerConfigId ya da platformAiProviderId); `tenantId` ↔ `providerConfig.tenantId` eşleşmesi zorunlu.
- Prisma migration + `packages/db` client üretimi (`npx prisma migrate dev` + generate).

### API (apps/api/src/platform/fine-tune/)
- `fineTuneCreateSchema` (fine-tune.schemas.ts): `provider`/`baseModel` serbest metni kaldır; `platformAiProviderId` (platform işleri) zorunlu. Sağlayıcı adı + `defaultModel` sunucuda katalogdan çözülür ve anlık görüntüye yazılır.
- `FineTuneService.create`: gönderilen `platformAiProviderId`'nin `PlatformAiProvider` içinde AKTİF olduğunu doğrula; yoksa 400.

### Ekran (apps/admin /egitim)
- "Sağlayıcı"/"Temel model" serbest metin `Input`'ları kaldır; tek bir **"Model"** `select` — seçenekler aktif `PlatformAiProvider` kayıtları (`{name} · {defaultModel}` etiketi). Liste `/admin/v1/ai-providers` mevcut ucundan alınır.
- Açıklama metinlerinde "AI" → "kullanıcı tanımlı model" dili.

### Yetkilendirme
Değişiklik yok: okuma `aiProvider.view`, yazma `aiProvider.manage`.

---

## Gereksinim 2 — Lisanslı kullanıcılar kendi LLM sunucularını / RAG yapılarını eğitir

**Lisans** = `allowBYOLLM` (PlanTier.featuresJson); kapı `PlatformAiService.tenantCanDefineOwnLlm` üzerinden yeniden kullanılır.

### Veri modeli
- Gereksinim 1'deki `tenantId`/`providerConfigId` alanları kiracı işlerini taşır (ayrı tablo YOK).
- RAG "eğitimi" yeni tablo gerektirmez: yeniden indeksleme mevcut `AssistantChunk.embedding/embeddingModel` hattı üzerinden yürür.

### API — kiracı tarafı (yeni TenantFineTuneController, apps/api, `/ai-training/fine-tune-jobs` altında, tenant JWT guard)
- `GET /ai-training/fine-tune-jobs` — yalnız kendi kiracısının işleri (`where: { tenantId }`).
- `POST /ai-training/fine-tune-jobs` — gövde `{ name, providerConfigId, note? }`; sunucu `providerConfig.tenantId === user.tenantId` değilse 403; `allowBYOLLM` kapısı kapalıysa 403 ("Planınız kendi model eğitimini kapsamıyor").
- `GET .../:id/manifest` — **yalnız kendi kiracısının** `AiTrainingSample`'ları (`exportStatus: ONAYLANMI`, `tenantId` süzgesi — bu düzeltme platform `manifest` ucuna da eklenmeli mi aşağıda "Açık nokta"da).
- `POST .../:id/status` — Gereksinim 1'deki şeritle aynı (`FINE_TUNE_TRANSITIONS`).
- Kiracı işleri için havuz anlık görüntüsü `poolSnapshot`'ın kiracı süzgeçli varyantı.
- RAG: `POST /assistant/cases/:caseId/reindex` (yeni) — mevcut `IndexingService`'i yeniden koşturur; `allowBYOLLM` + ADMIN rolü zorunlu.
- Denetim: tenant tarafı `PlatformAuditService` yerine mevcut kiracı denetim mekanizması (AiUsageLog değil — `audit` modülündeki kayıt deseni ne ise uyum sağlanır); en azından audit log kaydı eklenir.

### Ekran (apps/web, yeni `/app/ayarlar/model-egitimi`)
- İş listesi + "Eğitim İşi Aç" modalı: model seçimi **yalnız kiracının `AiProviderConfig` kayıtlarından** select ile (serbest metin yok).
- RAG bölümü: dosya bazında "Yeniden indeksle (RAG'ı yeniden eğit)" düğmesi; embedding sağlayıcısı yoksa bilgilendirme (mevcut `retrieval.service.ts` mesaj deseni).
- `allowBYOLLM` kapalıysa ekran "Planınız kendi model tanımlama/eğitim lisansı içermiyor" bilgi kutusu gösterir ve formlar kilitli olur (istemci; asıl yaptırım API'de).
- nav: apps/web/src/app/app/layout.tsx menüsüne "Model Eğitimi" eklenir (role: ADMIN/PARTNER).

---

## Gereksinim 3 — Dışarıdan eğitilmiş model kaydını içe aktarma

**Karar (kullanıcı onaylı):** içe aktarma = eğitilmiş model KAYDI (kimlik/baseUrl); ağırlık dosyası sisteme girmez.

### Veri modeli
- `AiProviderConfig` ve `PlatformAiProvider`'a: `origin String @default("TANIMLI")` (`TANIMLI` | `IMPORTED`) + `@@index([origin])`. İçe aktarılan kayıt normal bir sağlayıcı olarak `AiTaskRoute`/görev rotasına hemen bağlanabilir — yeni katalog tablosu gerekmez.

### API
- Kiracı: `POST /ai/providers/import` — gövde `{ name, type, externalModelId, baseUrl?, encryptedApiKey?, headersJson?, mappingJson? }`; `AiProviderConfig` oluşturur (`origin: "IMPORTED"`, `defaultModel: externalModelId`); `allowBYOLLM` kapısı + şifreleme mevcut `crypto.ts` AES-256-GCM hattıyla.
- Platform: `POST /admin/v1/ai-providers/import` — `PlatformAiProvider` oluşturur; `@WritePermission("aiProvider.manage")`.
- Her iki uç denetim izine yazar (`MODEL_IMPORT`).

### Ekran
- apps/web `/app/ayarlar/ai-saglayici`: "Eğitilmiş Model İçe Aktar" modalı; kayıt listede `İçe aktarıldı` rozetiyle ayrıştırılır.
- apps/admin `/ai-saglayicilar`: aynı modal (platform kataloğuna).
- İçe aktarılan model, Gereksinim 2'deki eğitim işi açma select'inde ve görev rotalarında otomatik seçilebilir.

---

## Uygulama Sırası

1. Terminoloji güncellemesi (nav, başlıklar, docs) — davranış değişikliği yok.
2. Prisma şeması (FineTuneJob alanları, origin alanları) + migration + client generate.
3. Platform fine-tune API + admin `/egitim` ekranı (Gereksinim 1).
4. Kiracı fine-tune controller + web `/app/ayarlar/model-egitimi` ekranı + allowBYOLLM kapısı (Gereksinim 2).
5. RAG yeniden indeksleme ucu (Gereksinim 2, RAG bölümü).
6. İçe aktarma uçları + modallar (Gereksinim 3).
7. Sözleşme testlerini güncelle: `dalga5-contract.test.ts` (schema/controller/endpoints içerikleri), yeni kiracı uçları için testler, `provider-secrets.test.ts` desenini izleyen içe aktarma güvenlik testi.

## Doğrulama

- `pnpm turbo run typecheck` (repo kökü) ve lint.
- Birim/sözleşme testleri: `pnpm turbo run test --filter api`.
- El senaryoları: (a) allowBYOLLM kapalı kiracı 403 alır; (b) kiracı A, kiracı B'nin providerConfig'iyle iş açamaz; (c) manifest yalnız kendi örneklerini içerir; (d) içe aktarılan model rotaya atanabilir; (e) yetkisiz platform rolü menüde `/egitim` görmez ve API 403 döner.

## Açık Noktalar / Riskler

- **Platform `manifest` ucu** bugün tüm kiracıların onaylı örneklerini global olarak veriyor. Platform işlerinde bu bilinçli tasarım olabilir (kiracı opt-in zaten örnekte saklanıyor); kiracı ucu kesinlikle süzgeçli olacak. Platform ucu davranışı korunan bir karar olarak işaretlendi — değiştirilmesi istenirse ayrı iş.
- `FineTuneJob` tablosunun tek tablo + nullable FK tasarımı; iki ayrı tablo alternatifi (TenantFineTuneJob) servis tekrarını azaltmak için tercih edildi.
- Sözleşme testleri metin bazlıdır; şema/controller metinleri değiştiğinde aynı test dosyalarında güncelleme zorunludur.
