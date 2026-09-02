# AI KATMANI AUDIT RAPORU — 02.09.2026 (2. tur — satır satır)

Yöntem: 103 dokunuş dosyası makineyle haritalandı; 5 sağlayıcı adaptörü, 4 LLM
yürütme motoru, kredi interceptor'u + koşu bağlamı, output-guard, PII/SSRF
katmanı, gömme katmanı, hız sınırı, ajan izi ve TÜM runTask/ai.run çağıranı
İçinde satır satır okundu. Önceki turdaki tablo taraması iki yanlış pozitif
içeriyordu; bu turda okuyarak düzeltildi.

## Okunan dosyalar (satır satır)

| Katman | Dosya |
|---|---|
| Sağlayıcılar | openai-compat, anthropic, gemini, ollama, custom, factory, http, types |
| KVKK/PII | pii.ts (420), embeddings.ts (183), crypto.ts |
| Motor 1 | assistant-llm.service.ts (392) |
| Motor 2 | caselaw/ai-runner.service.ts (458) |
| Motor 3 | pipeline/agent-runner.service.ts (343) |
| Motor 4 | ai/ai.service.ts chat akışı (618) |
| Kredi | credits.interceptor.ts (195), credit-context.ts (96), credit.service fiyat kapısı |
| Guard | output-guard.ts (372, tamamı) |
| İz | agents/agent-run.service.ts (157) |
| Hız sınırı | ai-rate-limit.guard.ts (210) |
| Çağıranlar | 19 servisin runTask/ai.run + findingPaths envanteri (makine + gözle doğrulama) |

## Doğrulanan değişmezler (hepsi satır satır onaylı)

- **KVKK fail-closed** × 4 motor: scanPii taraması hata verirse çağrı YAPILMAZ;
  dışsallık ADRESE bakar (CUSTOM/OLLAMA buluta bakabilir); 409 gövdesi yalnız
  PII taşıyan parçaları döner.
- **preScanned delik kapatılmış** (Ö-23): kapamalar outboundTexts DIŞINDA
  metin ekleyebilir — runner nihai mesajları YENİDEN tarar, kalan PII'de
  çağrıyı yapmaz.
- **Kalıpsız PII** (ad/unvan): requireExternalConsent kapısı + sözlük maskesi
  (maskTerms, ticaret unvanı ekleri sökülerek varyant üretimi).
- **Kredi**: rezerv→settle→release; record() yalnız guard SONRASI; guard reddinde
  discard (İ-13); degraded akışlarda (risk) açık discard; bilinmeyen taskType
  fiyatı → ücretsiz + bildirim (bilinçli fail-open).
- **findingPaths envanteri** (önceki turun iki yanlış pozitifi düzeltildi):
  - CASE_CHAT/OFFICE_QUERY/FINANS/RAPOR/MESSAGE_DRAFT/MESSAGE_CASE_MATCH = []
    → TASARIM: anlatı/sınıflandırma görevleri, kaynak dizisi taşımaz.
  - CASE_FULL_ANALYSIS(strengths/weaknesses/…), SMART_NOTE, RISK adjustments,
    simülasyon 6 mod (spec), POA presentPowers/missingPowers, EVIDENCE
    suggestions/gaps, STRATEGY nodes, COPILOT findings, CONFLICT matches,
    CONTRACT riskyClauses → hepsi kaynak zorunlu.
  - EXPERT_REPORT_DIFF fp yok → bilinçli: quoteBase/quoteCompare üzerinden
    İKİ alanlı katı elision kendi yapıyor (guard'ın "herhangi biri dolu"
    kuralı bu ajan için zayıf kalırdı — kodda gerekçeli).
- **Atıf zinciri**: guard çıkarımı → CITATION_VERIFY → enforceCitationLookups
  (VERIFIED yalnız deterministik eşleşmeyle; uyumsuzsa AMBIGUOUS'a düşer).
- **SSRF** (İ-19): Gemini anahtarı başlıkta; metadata adresleri reddedilir;
  IPv4-mapped IPv6 delikleri kapatılmış.
- **Anahtar şifreleme**: AES-256-GCM + biçim algılama (K-08 göçü).
- **Hız sınırı** (Ö-09/Ö-10): 4 kovalı (kullanıcı/dk, kullanıcı/gün, büro/dk,
  büro/gün), Redis destekli, reddedilen istek kotadan yemez.

## Bu turda bulunan ve düzeltilen hata

### A1 — GÖMME KULLANIMI GÖRÜNMEZDİ (orta)

`embedTexts` sağlayıcının bildirdiği `usage.prompt_tokens`'ı okumuyordu ve gömme
çağrıları **AiUsageLog'a hiç yazılmıyordu**. Belge indeksleme (belge başına
onlarca parça) ve her soru gömmesi kullanım raporlarında görünmez; platform
yönetimli sağlayıcıda görünmez maliyet demekti.

**Düzeltme** (üç katman):
1. `embedTexts` → `EmbedCallResult { vectors, inputTokens? }`: OpenAI-uyumlu
   sağlayıcının GERÇEK token sayısı okunur (Ollama bildirmez → undefined).
2. `AssistantLlmService.embed` tek boğum noktası: her gömme çağrısı
   AiUsageLog'a yazılır (taskType=EMBEDDING, piiMasked=true — gömülen metin
   sözleşme gereği maskeli). Kayıt hatası ana akışı bozmaz.
3. İki çağıran (indexing.service, retrieval.service) kiracı bağlamını iletir.

Sözleşme testi: `embedding-usage.contract.test.ts` (4 test).

## Doğrulama

- Tüm paketler yeşil: api 70 test dosyası (yeni 4 gömme sözleşme testi dahil),
  web 88, legal-ai 79, e-imza 37, udf 44, uyap 35, legal-core 90 · lint 0 uyarı.

## Notlar (hata değil, kayıt altına alındı)

- Boru hattı (pipeline) kredisizdir — bilinçli ürün kararı (belge işleme sistem
  özelliği; ai-runner kodunda belgeli). Kullanımı AiUsageLog'da görünür.
- maxTokens varsayılanları motor bazında farklı (2048/3072/4096) — her biri
  kendi görev profiline göre belgeli; tekil değer zorlamak yanlış olurdu.
