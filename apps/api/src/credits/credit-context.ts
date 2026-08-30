/**
 * KREDİ KOŞU BAĞLAMI — istek ömrü boyunca yaşayan, DI'sız taşıyıcı.
 *
 * SORUN: Kredi kapısı (rezervasyon) istekten ÖNCE, mahsuplaşma ise istekten
 * SONRA çalışır; ama gerçek token sayısı ne kapıda ne de controller'da bilinir.
 * O sayı, üç ayrı LLM yürütücüsünün (AiRunnerService, AssistantLlmService,
 * AiService.chat) içinde, `AiUsageLog` yazılırken doğar.
 *
 * NEDEN AsyncLocalStorage, NEDEN Nest provider DEĞİL:
 *   - Yürütücüler `CreditsModule`'ü tanımıyor; DI ile bağlansalardı üç AI
 *     modülünün `imports` satırı değişir, `CaselawModule ↔ CreditsModule`
 *     çift yönlü bağımlılığı doğardı (kredi motoru da AiTaskCost okur).
 *   - Request-scoped provider kullanmak `AiRunnerService`i ve ona bağlı ALTI
 *     modülü request-scoped'a çevirirdi (Nest'te scope yukarı doğru bulaşır).
 *   - Bu dosya hiçbir şeye bağımlı değildir; yürütücülere eklenen kanca TEK
 *     SATIRDIR ve bağlam yoksa (pipeline, ücretsiz görev, BYO-LLM) sessizce
 *     hiçbir şey yapmaz.
 *
 * FAIL-OPEN, BİLİNÇLİ OLARAK: `record()` bağlam yoksa sessizce döner. Kredi
 * kapısı devrede olmadığında AI çağrısının çalışmaya devam etmesi gerekir —
 * kredi muhasebesi, avukatın işini durduracak bir şey değildir.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Tek bir sağlayıcı çağrısının mahsuplaşmaya giden özeti. */
export interface CreditCallRecord {
  /** AiUsageLog.id — mahsup sonrası `creditsCharged`/`estimatedCost` buraya yazılır. */
  aiUsageLogId?: string;
  taskType: string;
  model: string;
  /** AiProviderType — ModelPrice araması bunu kullanır. */
  providerType: string;
  /** Sağlayıcı token bilgisi dönmeyebilir (OLLAMA/CUSTOM): undefined ≠ 0. */
  inputTokens?: number;
  outputTokens?: number;
}

export interface CreditRunStore {
  tenantId: string;
  /** Kapının rezerve ettiği görev tipi (tek kalem fiyatlandırmanın anahtarı). */
  taskType: string;
  /** Bu istek içinde GERÇEKTEN yapılan sağlayıcı çağrıları. */
  calls: CreditCallRecord[];
}

const storage = new AsyncLocalStorage<CreditRunStore>();

export const creditRunContext = {
  /** Kapı, handler'ı bu bağlamın içinde çalıştırır. */
  run<T>(store: CreditRunStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** Mahsuplaşma için biriken çağrılar. */
  current(): CreditRunStore | undefined {
    return storage.getStore();
  },

  /**
   * Yürütücülerin çağırdığı TEK kanca. Bağlam yoksa hiçbir şey yapmaz.
   *
   * ÇAĞRI ANI — ÇIKTI DOĞRULAMASINDAN SONRA (iş kuralı 4): sağlayıcıya
   * gidilmiş olması ücretlendirme için YETMEZ; çıktı `guardOutput`'tan
   * geçmediyse sonuç KULLANILMAZ ve kullanılmayan sonuçtan kredi alınmaz.
   * `AiUsageLog` yazımı bunun ÖNCESİNDE kalır — kullanım kaydı tutulur,
   * ücret kaydı tutulmaz.
   */
  record(call: CreditCallRecord): void {
    storage.getStore()?.calls.push(call);
  },

  /**
   * Kaydedilmiş bir çağrıyı ücretlendirmeden DÜŞÜRÜR.
   *
   * NEDEN GEREKLİ: bazı servisler (risk, çatışma) sağlayıcı/çıktı hatasını
   * bilerek YUTAR ve HTTP 200 + `degraded: true` döner — deterministik sonuç
   * zaten üretilmiştir, avukatın işi durmamalıdır. Interceptor bu yanıtı
   * BAŞARI görür ve `settle()` çalışır; kayıt düşürülmezse "AI çalışmadı"
   * diyen bir yanıt için tam ücret tahsil edilirdi.
   *
   * `aiUsageLogId` verilirse yalnız o kayıt, verilmezse bu koşudaki TÜM
   * kayıtlar düşer. `AiUsageLog` satırına dokunulmaz: çağrı gerçekten
   * yapılmıştır ve iç maliyet muhasebesinde görünmelidir.
   */
  discard(aiUsageLogId?: string): void {
    const store = storage.getStore();
    if (!store) return;
    if (aiUsageLogId === undefined) {
      store.calls.length = 0;
      return;
    }
    const index = store.calls.findIndex((c) => c.aiUsageLogId === aiUsageLogId);
    if (index >= 0) store.calls.splice(index, 1);
  },
};
