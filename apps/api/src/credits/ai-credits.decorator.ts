/**
 * `@AiCredits('TASK_TYPE')` — kredili AI ucu işaretleyicisi.
 *
 * TASARIM: mevcut AI modülleri KİRLETİLMEZ. Bir controller metodu tek satır
 * dekoratör alır; rezervasyon, 50 kredi tavanı, 402 ve mahsuplaşma
 * `CreditsInterceptor` içinde kalır. Servislerin gövdesinde kredi kodu YOKTUR.
 *
 * Dekoratörü OLMAYAN uç kredi kapısından geçmez. Bu, ücretsiz hattı (belge
 * sınıflandırma, çıkarma, süre tespiti, atıf doğrulama, gömme) kazayla
 * ücretlendirme riskini sıfırlar: onlara dokunulmaz, dolayısıyla ücretsiz
 * kalırlar. Ücretli/ücretsiz ayrımının ASIL kaynağı yine de `AiTaskCost.isFree`
 * alanıdır — dekoratörlü bir uç bile o satır `isFree` ise kredi tüketmez
 * (iş kuralı 3).
 */

import { SetMetadata } from "@nestjs/common";
import type { AiTaskType } from "@nomosos/shared";

export const AI_CREDITS_KEY = "ai-credits";

export interface AiCreditsMeta {
  /** `AiTaskCost.taskType` — fiyat listesindeki anahtar (varsayılan). */
  taskType: AiTaskType;
  /**
   * Görev tipi gövdeye göre değişiyorsa (ör. simülasyon modu → karşı taraf mı
   * hakim mi) burada çözülür. `undefined` dönerse `taskType` kullanılır.
   */
  taskTypeFrom?: (body: unknown) => AiTaskType | undefined;
  /**
   * Kredi kapısı yalnızca bu koşulda çalışsın.
   *
   * Bazı uçlar AI'ı ŞARTA BAĞLI çağırır (`risk/compute` `useAi:false` ile
   * tamamen deterministik çalışır, `conflict-check` varsayılan olarak AI'sızdır).
   * Böyle bir istekte bakiye yetersizliği yüzünden 402 dönmek yanlış olurdu:
   * çağrı zaten yapılmayacaktı.
   *
   * DİKKAT: interceptor pipe'lardan ÖNCE çalışır; buraya gelen gövde HAM
   * gövdedir, Zod varsayılanları HENÜZ UYGULANMAMIŞTIR.
   */
  when?: (body: unknown) => boolean;
  /**
   * Uzun bağlam tahmini için karakter sayısı. Varsayılan: gövdenin JSON
   * uzunluğu. Kapı, dosya bağlamının gerçek uzunluğunu göremez (o, çağrı
   * anında `case-context` katmanında oluşur); bu yüzden tahmin ALT SINIRDIR
   * ve mahsupta tahsil rezerveyi aşamaz.
   */
  contextChars?: (body: unknown) => number;
  /** `CreditTransaction.caseId` için istek parametresi adı (izlenebilirlik). */
  caseIdParam?: string;
  /**
   * Dosya kimliği GÖVDEDE duruyorsa (ör. `POST /assistant/chat {caseId}`).
   *
   * DİKKAT: interceptor pipe'lardan ÖNCE çalışır; buraya gelen gövde HAMDIR.
   * Değer geçersizse kapı sessizce taban fiyata düşer — geçersiz kimliğin
   * hata mesajı işin kendi servisinden gelmelidir.
   */
  caseIdFrom?: (body: unknown) => string | undefined;
  /**
   * DOSYA KİMLİĞİ ÜST KAYIT ÜZERİNDEN ÇÖZÜLÜR.
   *
   * `caseIdParam` yalnız yolunda doğrudan `:caseId` taşıyan uçlarda işe yarar.
   * Pahalı işlerin çoğunda ise yolda BAŞKA bir kaydın kimliği durur:
   * `strategy/:id/build`, `petitions/:id/generate`, `enforcement/:id/copilot`,
   * `expert-reports/compare` (gövdede iki rapor kimliği). Bu uçlarda bağlam
   * uzunluğu istek GÖVDESİNDEN tahmin ediliyordu; gövdeler onlarca bayttır.
   *
   * SONUÇ İKİ KATLIYDI: (a) `required` daima taban fiyata eşit kaldığı için
   * 50 kredi tavanı (kabul kriteri 7) HİÇ tetiklenmiyordu; (b) mahsup
   * `min(rezerve, hesaplanan)` ile sınırlandığından uzun bağlam çarpanı da hiç
   * tahsil edilmiyordu — 400 belge parçalı bir dosyanın strateji koşusu da 30
   * kredi ediyordu.
   *
   * Çözüm: üst kaydın türü + kimliğin nereden okunacağı bildirilir; kredi
   * motoru tenant süzgeçli TEK sorguyla `caseId`'yi bulur ve dosya bağlamını
   * ölçüme katar. Kayıt bulunamazsa kapı sessizce taban fiyata düşer —
   * geçersiz kimliğin hata mesajını KREDİ KAPISI değil, işin kendi servisi
   * vermelidir.
   */
  parentCaseId?: {
    kind: ParentCaseKind;
    /** Kimliğin okunacağı yol parametresi (örn. "id"). */
    param?: string;
    /** Kimlik(ler) gövdede duruyorsa. Birden çoksa hepsinin bağlamı toplanır. */
    from?: (body: unknown) => string | string[] | undefined;
  };
  /**
   * SÖZLEŞME ANALİZİ — PARÇA BAZLI FİYATLAMA (map-reduce).
   *
   * Analiz koşusu sözleşme metnini PARÇALARA bölüp her parça için AYRI AI
   * çağrısı yapar; tahmini maliyet = PARÇA SAYISI × PARÇA FİYATI. Metin
   * veritabanında durur (ContractVersion.contentText) ve kapı onu gövdede
   * GÖREMEZ — `parentCaseId` deseninde olduğu gibi üst kayıttan ölçülür:
   * kapı sürüm metnini okur, aynı chunker hesabıyla parça sayısını çıkarır
   * ve rezervasyonu parça sayısıyla çarpar. Kayıt çözülemezse tahmin taban
   * fiyata düşer; geçersiz kimliğin hatasını kredi kapısı değil, işin kendi
   * servisi verir.
   */
  parentContract?: {
    /** Sözleşme kimliğinin yol parametresi (örn. "id"). */
    param?: string;
    /** Sürüm kimliği gövdede duruyorsa (boşsa sözleşmenin güncel sürümü). */
    versionIdFrom?: (body: unknown) => string | undefined;
  };
}

/** `parentCaseId` ile çözülebilen üst kayıt türleri. */
export type ParentCaseKind =
  | "HEARING"
  | "STRATEGY"
  | "PETITION"
  | "ENFORCEMENT"
  | "EXPERT_REPORT"
  | "CLAIM"
  | "EVIDENCE";

export const AiCredits = (
  /**
   * `AiTaskCost.taskType`. TİPLİDİR: düz `string` iken `@AiCredits("STRATEJI_BUILD")`
   * gibi tek harflik bir yazım hatası derlemeyi kırmaz, testi kırmaz ve
   * "fiyat satırı yok → ücretsiz" (fail-open) davranışıyla BEDAVA AI olarak
   * yayına çıkardı; hatayı yalnız günlüğe bakan biri görebilirdi.
   */
  taskType: AiTaskType,
  options: Omit<AiCreditsMeta, "taskType"> = {},
) => SetMetadata<string, AiCreditsMeta>(AI_CREDITS_KEY, { taskType, ...options });
