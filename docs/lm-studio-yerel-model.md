# LM Studio ile Yerel Model (BYO-LLM) — Kurulum ve Kullanım

Tarih: 05.09.2026 · Kapsam: `apps/api/src/ai`, `apps/api/src/assistant`, `packages/ai`

NomosOS'un "Türk hukukuna göre eğitimi" **RAG + bilgi havuzu** mimarisiyle yapılır
(`docs/ai-egitim-stratejisi.md` §1). Bu belge, büronun kendi makinesinde çalışan
**LM Studio** sunucusunu NomosOS'a bağlayıp dosya asistanını (RAG) bu modelle
çalıştırmanın doğrulanmış adımlarını verir. Model ağırlıkları eğitilmez; model
büronun belgelerini gömme (embedding) ve sohbet üzerinden **kullanır**.

## 1. LM Studio tarafı

| Ayar | Değer | Neden |
|---|---|---|
| Sunucu | `lms server start --port 1234 --bind 0.0.0.0` | Docker'daki API, ana makineye VPN/LAN adresinden ulaşır; `127.0.0.1` bağlaması konteynerden görünmez. |
| API anahtarı | LM Studio → Developer → "Require API key" (`sk-lm-…`) | Anahtarsız istek 401 döner; NomosOS anahtarı AES-256-GCM şifreli saklar. |
| Sohbet modeli | ör. `gemma4-coding-agent` (Gemma 4 E4B Instruct, Q4_K_M) | OpenAI-uyumlu `/v1/chat/completions`. |
| Gömme modeli | `text-embedding-nomic-embed-text-v1.5` | `/v1/embeddings`; ilk çağrıda LM Studio modeli JIT yükler (birkaç sn). |
| Taban adres | `http://<makine-ip>:1234/v1` | **`/v1`** — OpenAI-uyumlu yüzey. `/api/v1` LM Studio'nun kendi REST'idir; NomosOS onu kullanmaz. |

## 2. NomosOS tarafı (Ayarlar → AI Sağlayıcı, ADMIN/PARTNER)

1. **Sağlayıcı ekle:** tür `OPENAI_COMPAT`, ad ASCII tut (örn. "LM Studio (Gemma 4, yerel)"),
   taban adres `http://<ip>:1234/v1`, API anahtarı, varsayılan model `gemma4-coding-agent`.
   "Bağlantıyı sına" → "2 model erişilebilir".
2. **Görev eşlemesi:** tüm görev tiplerini bu sağlayıcıya, **EMBEDDING** görevini
   `text-embedding-nomic-embed-text-v1.5` modeline yönlendir (33 görev tipi;
   `packages/shared/src/ai-task-types.ts`).
3. **KVKK notu:** adres RFC1918 dışıysa (VPN adresi gibi) kayıt "hedef=DIŞ" işaretlenir;
   `SADECE_YEREL` politikası bu adresi reddeder. Kendi makinenizse bilinçli olarak `SERBEST`
   politikada kalın ya da LAN adresi (192.168.x) kullanın.
4. **RAG indeksleme:** Dosya → Asistan → "Dizini oluştur" (`POST /assistant/index/:caseId
   {force:true}`). Yanıtta `retrievalMode: "EMBEDDING"` ve `embeddingModel` görünmeli.
   `KEYWORD` görünüyorsa `notice` alanı nedeni yazar.

## 3. Düzeltilen hatalar (bu entegrasyonda bulundu)

1. **Gömme rotası okunmuyordu** — aşağıda (§3.1).
2. **Platform sağlayıcısıyla kullanım kaydı FK ihlali:** büronun kendi sağlayıcısı yokken
   sohbet/analiz platform sağlayıcısına (D1.3) gidiyor, yanıt üretiliyor, ardından
   `AiUsageLog.providerConfigId`'ye sentetik `platform:<id>` yazıldığı için koşu 500 ile
   düşüyordu. Yeni sütun `AiUsageLog.platformAiProviderId` + `usageProviderRef()`
   (`common/ai-usage-provider.ts`); dört yürütücü de bunu kullanır (sözleşme testi).
   **Sonuç:** kendi LLM sunucusu olmayan avukat/büro, sistemde tanımlı sunucuyu
   kesintisiz kullanır — gömme yolu dâhil (platform yedeği `resolveEmbedding`'e eklendi;
   gömme modeli `AI_EMBEDDING_MODEL_OPENAI_COMPAT` ortam değişkeninden).
3. **Küçük modelde JSON reddi:** `LlmChatOptions.responseFormat: "json"` → OpenAI-uyumlu
   adaptör `response_format` gönderir: `json_schema` (LM Studio) → `json_object` (eski
   sunucular) → ipucusuz; 400 dışı hata yinelenmez. Şema doğrulamalı asistan koşuları
   bunu ister; Gemma 4 ile "Model yanıtı geçerli JSON değil" reddi kalktı.
4. **Yavaş modelde başlık zaman aşımı:** akışsız istekte undici 300 sn içinde başlık
   gelmezse `UND_ERR_HEADERS_TIMEOUT` ile düşüyordu (Gemma tam analizde ilk baytı 5 dk'dan
   geç veriyor). OpenAI-uyumlu adaptör artık **akışlı (SSE)** çalışır: başlıklar anında,
   parçalar birleştirilir, kullanım `stream_options.include_usage` ile son parçadan; akışı
   reddeden sunucuda (400) akışsız yinelenir (`openai-compat-stream.test.ts`).
5. **Kendi sağlayıcısı olmayan büro görünürlüğü:** `GET /ai/platform-status` BYO izni olup
   sağlayıcısı olmayan büroda `fallback: true` + platform sağlayıcı bilgisini döner; web
   AI Sağlayıcı ekranı "Sistemde tanımlı sunucu kullanılıyor: …" şeridi gösterir.
6. **"fetch failed" nedeni gizliydi:** `fetchWithTimeout` artık `cause` kodunu mesaja ekler
   (ECONNREFUSED/ECONNRESET…), indeksleme bildirimi gerçek nedeni gösterir.

### 3.1 Gömme rotası

`AssistantLlmService.resolveEmbedding` EMBEDDING görev rotasını **okumuyordu**: en eski
`OPENAI_COMPAT` kaydını ve varsayılan `text-embedding-3-small` modelini seçiyor, ulaşılamayan
bir sunucuda "fetch failed" ile sessizce anahtar kelime yedeğine düşüyordu. Artık rota
önceliklidir; rota yoksa eski sezgi (OLLAMA > ilk OPENAI_COMPAT) korunur
(`apps/api/src/assistant/embedding-route.test.ts`).

## 4. Canlı doğrulama (demo büro, "İşe iade davası" dosyası)

- Üç metin belgesi (fesih bildirimi, iş sözleşmesi, arabuluculuk son tutanağı) yüklendi;
  7 parça üretildi, gömme LM Studio/nomic ile yazıldı.
- Dosya sohbeti (`POST /assistant/chat`) Gemma 4 ile: kıdem/ücret/arabuluculuk sorularına
  belge parçası atıflı, `verified: true` alıntılı yanıt. Süre ~100 sn (4 GB VRAM dizüstü
  GPU, Q4 model; `AI_TIMEOUT_MS=180000` yeterli, daha büyük modelde artırın).
- Yanıt üretimi yavaşsa: LM Studio'da GPU offload katman sayısını artırın, bağlam
  penceresini 8k'da tutun, `max_tokens`'ı görev promptları belirler.

## 5. Model bağlamı ve zaman aşımı (yerel dizüstü ölçeği)

- LM Studio varsayılan bağlam (4096) tam dosya analizinde `Context size has been exceeded`
  (HTTP 400) verir. Modeli daha geniş bağlamla yükleyin:
  `lms load gemma4-coding-agent --context-length 8192 --identifier gemma4-coding-agent`
  (4 GB VRAM'de 12288 KV önbelleği sığmadı; 8192 otomatik GPU paylaşımıyla çalışır).
- `AI_TIMEOUT_MS` test yığınında 600000 (üst sınır); Q4 4B model ~5-8 tok/sn üretir,
  dosya sohbeti ~100-130 sn, tam analiz daha uzun sürer.

## 6. Sınırlar

- LM Studio **fine-tuning sunmaz**; "Model Eğitimi" ekranındaki manifest (JSONL) yalnız
  dış bir eğitim aracında kullanılabilir. Bu makinede (RTX 3050 Ti 4 GB) 7,5B parametreli
  modelin LoRA eğitimi pratik değildir.
- Gemma 4 E4B Türkçe hukuk metninde tutarlı ama hesap adımlarında uzayabiliyor; kıdem/ihbar,
  faiz, harç ve süre hesapları zaten deterministik motorlardan (`packages/legal-core`) gelir,
  modele bırakılmaz.
