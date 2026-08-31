/**
 * AI görev tipleri — BYO-LLM katmanında "görev tipi → sağlayıcı + model" eşlemesinin anahtarıdır.
 * Her modül spec'i (docs/moduller/) kendi görev tiplerini bu katalogdan kullanır;
 * yeni görev tipi eklerken buraya da eklenmelidir.
 */
export const AI_TASK_TYPES = [
  // Modül 24 — AI Dosya Asistanı
  "CASE_CHAT",
  "CASE_FULL_ANALYSIS",
  "SMART_NOTE",
  "OFFICE_QUERY",
  // RAG indeksleme — gömme çağrısı (ücretsiz, yüksek hacim).
  "EMBEDDING",
  // Modül 06 — Belge → otomatik aksiyon
  "DOCUMENT_CLASSIFY",
  "DOCUMENT_EXTRACT",
  "DEADLINE_DETECT",
  // Modül 03 — Duruşma
  "HEARING_PREP",
  // Modül 05 — İcra
  "ENFORCEMENT_ANALYSIS",
  "COLLECTION_LIKELIHOOD",
  // Modül 22 — Dilekçe
  "PETITION_DRAFT",
  "PETITION_SECTION_REWRITE",
  // Modül 23 — İçtihat & Mevzuat
  "CASELAW_SEARCH",
  "CASELAW_SUMMARIZE",
  "CITATION_VERIFY",
  // Modül 10/19 — Müvekkil iletişimi
  "CLIENT_STATUS_SUMMARY",
  /**
   * Faz 5, Modül 19. `AiTaskCost` satırları seed'de ZATEN VARDI (5 ve 2 kredi);
   * katalogda karşılıkları olmadığı için `@AiCredits("MESSAGE_DRAFT")` derlenmiyor
   * ve kredi motoru "fiyat satırı yok" (fail-open) dalına düşüyordu.
   */
  "MESSAGE_DRAFT",
  "MESSAGE_CASE_MATCH",
  // Modül 11 — Conflict check
  "CONFLICT_INFERENCE",
  // Modül 12 — Vekaletname
  "POA_SCOPE_ANALYSIS",
  // Modül 13 — Bilirkişi
  "EXPERT_REPORT_DIFF",
  // Modül 14 — Delil yönetimi
  "EVIDENCE_MATRIX",
  "EVIDENCE_GAP",
  // Modül 15/16/17 — Strateji, simülasyon, risk
  "STRATEGY_BUILD",
  "OPPONENT_SIMULATION",
  "JUDGE_SIMULATION",
  "RISK_ASSESS",
  // Modül 18 — Dashboard
  "DAILY_PRIORITIZE",
  // Modül 08 — Finans
  "CLIENT_FINANCIAL_SUMMARY",
  // Modül 20 — Sözleşme
  "CONTRACT_REVIEW",
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

/** Görev tipi başına insan-okur açıklama (ayarlar ekranındaki eşleme tablosu için). */
export const AI_TASK_TYPE_LABELS: Record<AiTaskType, string> = {
  CASE_CHAT: "Dosya sohbeti (soru-cevap)",
  CASE_FULL_ANALYSIS: "Tam dosya analizi raporu",
  SMART_NOTE: "Akıllı not önerisi",
  OFFICE_QUERY: "Büro geneli sorgu (veri minimizasyonlu plan)",
  EMBEDDING: "Gömme / RAG indeksleme",
  DOCUMENT_CLASSIFY: "Belge sınıflandırma",
  DOCUMENT_EXTRACT: "Belgeden yapılandırılmış veri çıkarma",
  DEADLINE_DETECT: "Belgeden süre tespiti (öneri)",
  HEARING_PREP: "Duruşma hazırlık paketi",
  ENFORCEMENT_ANALYSIS: "İcra dosyası analizi",
  COLLECTION_LIKELIHOOD: "Tahsilat ihtimali değerlendirmesi",
  PETITION_DRAFT: "Dilekçe taslağı üretimi",
  PETITION_SECTION_REWRITE: "Dilekçe bölümü yeniden yazımı",
  CASELAW_SEARCH: "İçtihat arama sorgusu genişletme",
  CASELAW_SUMMARIZE: "Karar özeti",
  CITATION_VERIFY: "Atıf doğrulama (Teyit)",
  CLIENT_STATUS_SUMMARY: "Müvekkil durum özeti",
  MESSAGE_DRAFT: "Müvekkile mesaj taslağı",
  MESSAGE_CASE_MATCH: "Gelen mesajı dosyayla eşleştirme",
  CONFLICT_INFERENCE: "Çıkar çatışması çıkarımı",
  POA_SCOPE_ANALYSIS: "Vekaletname kapsam analizi",
  EXPERT_REPORT_DIFF: "Bilirkişi raporu karşılaştırma",
  EVIDENCE_MATRIX: "İddia × delil matrisi önerisi",
  EVIDENCE_GAP: "Delil boşluğu tespiti",
  STRATEGY_BUILD: "Dava stratejisi oluşturma",
  OPPONENT_SIMULATION: "Karşı taraf avukatı simülasyonu",
  JUDGE_SIMULATION: "Hakim gözüyle analiz",
  RISK_ASSESS: "Dosya risk değerlendirmesi",
  DAILY_PRIORITIZE: "Günlük öncelik listesi",
  CLIENT_FINANCIAL_SUMMARY: "Müvekkil finans özeti",
  CONTRACT_REVIEW: "Sözleşme incelemesi",
};
