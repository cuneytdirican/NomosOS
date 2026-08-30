# NomosOS — AI Katmanı ve BYO-LLM (Kendi LLM'ini Bağla)

NomosOS'un ayırt edici teknik gereksinimi: **her büro kendi LLM'ini bağlar.**
Kod: `packages/ai`. Bu doküman katmanın sözleşmesini ve kullanım kurallarını tanımlar.

## Neden BYO-LLM?

1. **KVKK / Private AI**: Ollama veya büro-içi özel endpoint seçildiğinde veri
   büro ağından çıkmaz — enterprise satışının kilit argümanı (Gereksinim 20).
2. **Maliyet**: AI kullanım maliyeti büronun kendi API hesabına yazılır; NomosOS
   abonelik fiyatına AI token maliyeti dahil değildir.
3. **Bağımsızlık**: model/sağlayıcı kilidi yok; büro istediği an değiştirir.

## Sağlayıcı Türleri

| Tür | Adaptör | Not |
|-----|---------|-----|
| ANTHROPIC | `providers/anthropic.ts` | Claude API (`/v1/messages`) |
| OPENAI_COMPAT | `providers/openai-compat.ts` | OpenAI + Azure OpenAI, OpenRouter, Groq, vLLM, LM Studio… — tek fark `baseUrl` (+ gerekirse ek header) |
| OLLAMA | `providers/ollama.ts` | Yerel modeller; varsayılan `http://localhost:11434`; **veri dışarı çıkmaz** |
| GEMINI | `providers/gemini.ts` | Google `generateContent` |
| CUSTOM | `providers/custom.ts` | Hiçbir standarda uymayan şirket-içi modeller: kullanıcı tanımlı endpoint URL + ek header'lar + istek/yanıt **alan eşlemesi** |

### CUSTOM alan eşlemesi

Kullanıcı üç yol tanımlar (nokta ayraçlı):

```json
{
  "requestMessagesField": "messages",
  "requestModelField": "model",
  "responseTextField": "choices.0.message.content"
}
```

İstek gövdesi bu yollara göre kurulur; yanıt metni `responseTextField` yolundan
okunur. Yol bulunamazsa anlaşılır Türkçe hata döner ("Alan eşlemesini kontrol edin").

## Ortak Arayüz (`src/types.ts`)

```ts
interface LlmProvider {
  readonly type: AiProviderType;
  chat(options: { model, messages, maxTokens?, temperature? }): Promise<{ content, inputTokens?, outputTokens? }>;
  listModels(): Promise<string[]>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
```

- Adaptörler **fetch tabanlıdır**, harici SDK bağımlılığı yoktur.
- Yeni sağlayıcı eklemek = arayüzü uygulayan sınıf + `factory.ts`'e bir `case`.
- Streaming: Faz 2'de `stream(): AsyncIterable<string>` opsiyonel metodu eklenir
  (SSE; sohbet arayüzünde kademeli yanıt).

## Anahtar Güvenliği (`src/crypto.ts`)

- API anahtarları veritabanında **AES-256-GCM** ile şifreli saklanır
  (`AiProviderConfig.encryptedApiKey`, biçim: `base64(iv).base64(tag).base64(ct)`).
- Master anahtar: `.env` → `MASTER_ENCRYPTION_KEY` (32 bayt hex; `openssl rand -hex 32`).
- API yanıtlarında anahtar asla dönmez; yalnızca `hasApiKey: boolean`.
- Anahtar rotasyonu (Faz 3): yeni master key ile yeniden şifreleme komutu.

## Görev Tipi → Model Eşlemesi

- Katalog: `@nomosos/shared` `AI_TASK_TYPES` (CASE_CHAT, DOCUMENT_CLASSIFY,
  HEARING_PREP, PETITION_DRAFT, CITATION_VERIFY, RISK_ASSESS …) + Türkçe etiketler.
- `AiTaskRoute (tenantId, taskType) → (providerConfig, model)`; ayarlar ekranından
  yönetilir. Örnek strateji: sınıflandırma gibi ucuz görevler küçük/yerel modele,
  strateji ve dilekçe gibi ağır görevler en güçlü modele.
- Eşleme yoksa: tenant'ın ilk aktif sağlayıcısı + `defaultModel`.
- Hiç sağlayıcı yoksa AI uçları 400 döner: "Önce Ayarlar → AI Sağlayıcı'dan bir
  sağlayıcı ekleyin."

## Çağrı Hattı (apps/api → packages/ai)

```
İstek (örn. POST /ai/chat)
  → Bağlam kurulumu (dosya özeti, taraflar, safahat, süreler)
  → KVKK PII taraması (scanPii) — dış sağlayıcı + PII + onay yok → 409 (bkz. docs/04)
  → AiTaskRoute çözümü → createProvider(config)
  → provider.chat(...)
  → AiUsageLog (taskType, model, tokenlar, piiMasked) + AuditLog("AI_CHAT")
  → Yanıt: { content, model, usage }
```

Sistem mesajı standardı (her AI görevi için ortak çekirdek):
- "Sen NomosOS hukuk asistanısın. Türk hukuku bağlamında çalışırsın."
- "Kaynak göster; emin olmadığında belirt; içtihat/madde numarası uydurma."
- "Çıktın bir öneridir; nihai karar ve sorumluluk avukata aittir."

## Maliyet ve Kullanım Takibi

- Her çağrı `AiUsageLog`'a yazılır; ayarlar ekranında aylık kullanım özeti
  (görev tipine ve modele göre token toplamları) gösterilir (Faz 1 sonu).
- Token→maliyet dönüşümü sağlayıcı fiyatlarına bağlı olduğundan NomosOS yalnızca
  token sayar; maliyet hesaplama Faz 3'te sağlayıcı fiyat tablosu ile eklenir.

## Test Stratejisi

- Birim: `custom.ts` alan eşlemesi (`getPath`/`setPath`), `crypto.ts` gidiş-dönüş,
  `pii.ts` TCKN algoritması ve maskeleme.
- Entegrasyon (manuel, Faz 0): Ayarlar → sağlayıcı ekle → "Bağlantıyı Test Et";
  Ollama ile tam yerel duman testi (anahtar gerektirmez).
