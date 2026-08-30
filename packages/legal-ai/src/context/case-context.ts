/**
 * Dosya bağlamı kurucu.
 *
 * Dosya + taraflar + son N safahat + yaklaşan süreler + belge özetlerinden
 * LLM'e verilecek bağlam METNİNİ üretir. İki ilke:
 *
 *  1. TOKEN BÜTÇESİ — çağıran zorunlu bir bütçe verir; üretilen metin bu
 *     bütçeyi ASLA aşmaz. Sığmayan içerik kırpılır: en yeni ve en ilgili
 *     kayıtlar önce yazılır, kırpılanların sayısı raporlanır.
 *  2. VERİ MİNİMİZASYONU (KVKK) — görev neyi gerektiriyorsa yalnız o bölüm
 *     eklenir. Süre tespiti için müvekkil finans verisi, müvekkil özeti için
 *     karşı taraf kimlik verisi bağlama girmez.
 *
 * Not: PII maskeleme bu katmanın işi DEĞİLDİR; metinler buraya
 * @nomosos/ai'nin scanPii hattından geçmiş olarak gelir. Bu beklenti artık yalnız
 * yorumla değil TİPLE de zorlanır: `CaseContextInput.piiScanned` ZORUNLU bir alandır
 * ve `false` verilirse bağlam kurulmaz (hukuki/KVKK denetimi, bulgu 19). Çağıran
 * unutursa derleme hatası alır; kasten `false` geçerse Türkçe hata alır.
 */

import type { AiTaskType } from "@nomosos/shared";

export type CaseContextSection =
  | "case"
  | "parties"
  | "timeline"
  | "deadlines"
  | "documents"
  | "evidence"
  | "strategy"
  | "hearing";

export interface CaseContextCase {
  caseNumber: string;
  courtName?: string;
  caseType?: string;
  status?: string;
  subject?: string;
  openedAt?: string;
  /** Müvekkilin görünen adı (maskeleme hattından geçmiş). */
  clientLabel?: string;
}

export interface CaseContextParty {
  role: string;
  name: string;
  isClient?: boolean;
  counselName?: string;
}

export interface CaseContextTimelineEvent {
  /** ISO tarih (YYYY-MM-DD). */
  date: string;
  type?: string;
  description: string;
  documentTitle?: string;
}

export interface CaseContextDeadline {
  title: string;
  /** ISO tarih. */
  dueDate: string;
  status?: string;
  ruleKey?: string;
}

export interface CaseContextDocument {
  documentId?: string;
  title: string;
  documentClass?: string;
  /** ISO tarih. */
  date?: string;
  summary: string;
  page?: number;
}

export interface CaseContextHearing {
  scheduledAt: string;
  courtName?: string;
  type?: string;
  purpose?: string;
}

export interface CaseContextInput {
  /**
   * ZORUNLU BİLDİRİM: bu girdideki metinler @nomosos/ai `scanPii` hattından geçirilmiş
   * (maskelenmiş veya iç sağlayıcı için bilinçli olarak muaf tutulmuş) mi?
   *
   * `true` dışında bir değer bağlam kurulmasını engeller. Amaç, "sistem seviyesinde
   * çözülür" vaadinin bu katmanda da teknik bir dayanağı olmasıdır: çağıran maskelemeyi
   * unutursa sessizce dış LLM'e ham TCKN/IBAN gitmez.
   */
  piiScanned: true;
  case: CaseContextCase;
  parties?: readonly CaseContextParty[];
  timeline?: readonly CaseContextTimelineEvent[];
  deadlines?: readonly CaseContextDeadline[];
  documents?: readonly CaseContextDocument[];
  /** Eksik/sunulmamış deliller — serbest metin satırları. */
  evidenceGaps?: readonly string[];
  strategySummary?: string;
  hearing?: CaseContextHearing;
}

export interface BuildCaseContextOptions {
  /** Bağlamın hangi görev için kurulduğu — veri minimizasyonu politikasını seçer. */
  taskType?: AiTaskType;
  /** ZORUNLU: üretilen metnin aşamayacağı tahmini token sayısı. */
  tokenBudget: number;
  /** Bağlama alınacak en fazla safahat kaydı (varsayılan 20). */
  maxTimelineEvents?: number;
  /** Bağlama alınacak en fazla belge özeti (varsayılan 15). */
  maxDocuments?: number;
  /** Token başına ortalama karakter — Türkçe için varsayılan 3.2. */
  charsPerToken?: number;
  /** Politika üstü açık dahil/hariç kararı. */
  include?: Partial<Record<CaseContextSection, boolean>>;
}

export interface BuiltCaseContext {
  text: string;
  estimatedTokens: number;
  tokenBudget: number;
  /** Bütçe nedeniyle içerik kırpıldı mı? */
  truncated: boolean;
  includedSections: CaseContextSection[];
  /** Politika veya bütçe nedeniyle dışarıda kalan bölümler. */
  omittedSections: CaseContextSection[];
  /**
   * Veri minimizasyonu politikasının DIŞINA çıkılarak (`include: { x: true }`) bağlama
   * eklenen bölümler.
   *
   * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 18): politika üstü ekleme kaydı hiçbir yerde
   * tutulmuyordu; ör. CLIENT_STATUS_SUMMARY için bilinçli olarak dışarıda bırakılan karşı
   * taraf kimlik verisi denetim izi bırakmadan LLM'e gidebiliyordu. apps/api bu alanı
   * AiUsageLog/AuditLog'a YAZMALIDIR (docs/04 — amaç sınırlılığı).
   */
  policyOverrides: CaseContextSection[];
  /** Bütçe nedeniyle bağlama alınamayan kayıt sayısı. */
  droppedItemCount: number;
}

const DEFAULT_CHARS_PER_TOKEN = 3.2;

/** Görev tipi → bağlama girmesine izin verilen bölümler (öncelik sırasıyla). */
export const TASK_CONTEXT_POLICY: Partial<Record<AiTaskType, readonly CaseContextSection[]>> = {
  // Sınıflandırma dosya eşleştirmesi için asgari bilgiyle çalışır.
  DOCUMENT_CLASSIFY: ["case", "parties"],
  // Süre tespiti belgeye bakar; dosyadan yalnız tip ve açık süreler gerekir.
  DEADLINE_DETECT: ["case", "deadlines"],
  HEARING_PREP: [
    "case",
    "hearing",
    "timeline",
    "documents",
    "deadlines",
    "evidence",
    "parties",
    "strategy",
  ],
  CASE_CHAT: ["case", "parties", "timeline", "deadlines", "documents"],
  CASE_FULL_ANALYSIS: [
    "case",
    "parties",
    "timeline",
    "documents",
    "deadlines",
    "evidence",
    "strategy",
  ],
  PETITION_DRAFT: ["case", "parties", "timeline", "documents", "evidence", "strategy"],
  OPPONENT_SIMULATION: ["case", "parties", "timeline", "documents", "evidence", "strategy"],
  JUDGE_SIMULATION: ["case", "parties", "timeline", "documents", "evidence"],
  STRATEGY_BUILD: ["case", "parties", "timeline", "documents", "evidence", "strategy"],
  RISK_ASSESS: ["case", "timeline", "deadlines", "evidence", "documents"],
  ENFORCEMENT_ANALYSIS: ["case", "parties", "timeline", "deadlines", "documents"],
  // Müvekkil özetinde karşı taraf kimlik bilgisi ve delil detayı işe yaramaz.
  CLIENT_STATUS_SUMMARY: ["case", "timeline", "hearing"],
  CONFLICT_INFERENCE: ["case", "parties"],
  CITATION_VERIFY: ["case"],
};

const DEFAULT_SECTIONS: readonly CaseContextSection[] = [
  "case",
  "parties",
  "timeline",
  "deadlines",
  "documents",
  "evidence",
  "strategy",
  "hearing",
];

const SECTION_HEADERS: Record<CaseContextSection, string> = {
  case: "[DOSYA]",
  parties: "[TARAFLAR]",
  timeline: "[SAFAHAT — en yeniden eskiye]",
  deadlines: "[AÇIK SÜRELER — en yakından uzağa]",
  documents: "[BELGE ÖZETLERİ — en yeniden eskiye]",
  evidence: "[DELİL BOŞLUKLARI]",
  strategy: "[STRATEJİ ÖZETİ]",
  hearing: "[DURUŞMA]",
};

/** Kaba token tahmini. Gerçek tokenizer sağlayıcıya göre değişir; bilinçli olarak temkinli. */
export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}

function compareDateDesc(a: string | undefined, b: string | undefined): number {
  return (b ?? "").localeCompare(a ?? "");
}

function compareDateAsc(a: string | undefined, b: string | undefined): number {
  return (a ?? "").localeCompare(b ?? "");
}

function joinNonEmpty(parts: Array<string | undefined>, sep = " · "): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

interface SectionBlock {
  section: CaseContextSection;
  lines: string[];
}

function buildSectionBlocks(
  input: CaseContextInput,
  sections: readonly CaseContextSection[],
  maxTimelineEvents: number,
  maxDocuments: number,
): SectionBlock[] {
  const blocks: SectionBlock[] = [];

  for (const section of sections) {
    switch (section) {
      case "case": {
        const c = input.case;
        const line = joinNonEmpty([
          c.caseNumber,
          c.courtName,
          c.caseType,
          c.status,
          c.subject,
          c.clientLabel ? `Müvekkil: ${c.clientLabel}` : undefined,
          c.openedAt ? `Açılış: ${c.openedAt}` : undefined,
        ]);
        if (line) blocks.push({ section, lines: [line] });
        break;
      }
      case "parties": {
        const parties = input.parties ?? [];
        if (parties.length === 0) break;
        blocks.push({
          section,
          lines: parties.map((p) =>
            joinNonEmpty([
              `${p.role}: ${p.name}`,
              p.isClient ? "(müvekkil)" : undefined,
              p.counselName ? `Vekil: ${p.counselName}` : undefined,
            ]),
          ),
        });
        break;
      }
      case "timeline": {
        const events = [...(input.timeline ?? [])]
          .sort((a, b) => compareDateDesc(a.date, b.date))
          .slice(0, maxTimelineEvents);
        if (events.length === 0) break;
        blocks.push({
          section,
          lines: events.map((e) =>
            joinNonEmpty([
              e.date,
              e.type,
              e.description,
              e.documentTitle ? `Belge: ${e.documentTitle}` : undefined,
            ]),
          ),
        });
        break;
      }
      case "deadlines": {
        const items = [...(input.deadlines ?? [])].sort((a, b) =>
          compareDateAsc(a.dueDate, b.dueDate),
        );
        if (items.length === 0) break;
        blocks.push({
          section,
          lines: items.map((d) =>
            joinNonEmpty([`Son gün: ${d.dueDate}`, d.title, d.status, d.ruleKey]),
          ),
        });
        break;
      }
      case "documents": {
        const docs = [...(input.documents ?? [])]
          .sort((a, b) => compareDateDesc(a.date, b.date))
          .slice(0, maxDocuments);
        if (docs.length === 0) break;
        blocks.push({
          section,
          lines: docs.map((d) =>
            joinNonEmpty([
              d.title,
              d.documentClass,
              d.date,
              d.documentId ? `id: ${d.documentId}` : undefined,
              d.summary,
            ]),
          ),
        });
        break;
      }
      case "evidence": {
        const gaps = input.evidenceGaps ?? [];
        if (gaps.length === 0) break;
        blocks.push({ section, lines: [...gaps] });
        break;
      }
      case "strategy": {
        if (!input.strategySummary) break;
        blocks.push({ section, lines: [input.strategySummary] });
        break;
      }
      case "hearing": {
        const h = input.hearing;
        if (!h) break;
        blocks.push({
          section,
          lines: [joinNonEmpty([h.scheduledAt, h.courtName, h.type, h.purpose])],
        });
        break;
      }
    }
  }

  return blocks;
}

/**
 * Dosya bağlam metnini kurar ve token bütçesine sığdırır.
 *
 * Bütçe garantisi: dönen `estimatedTokens` her zaman `tokenBudget`'a eşit veya
 * ondan küçüktür. Bir satır sığmıyorsa o satır (ve gerekirse bölüm başlığı)
 * yazılmaz; kaç kaydın dışarıda kaldığı `droppedItemCount` ile raporlanır.
 */
export function buildCaseContext(
  input: CaseContextInput,
  options: BuildCaseContextOptions,
): BuiltCaseContext {
  const {
    taskType,
    tokenBudget,
    maxTimelineEvents = 20,
    maxDocuments = 15,
    charsPerToken = DEFAULT_CHARS_PER_TOKEN,
    include,
  } = options;

  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
    throw new Error("Bağlam kurulamadı: token bütçesi pozitif bir sayı olmalıdır.");
  }

  // KVKK kapısı (bulgu 19): maskeleme hattından geçmemiş metin bağlama alınmaz.
  if (input.piiScanned !== true) {
    throw new Error(
      "Bağlam kurulamadı: girdi metinlerinin KVKK PII taramasından (scanPii) geçtiği " +
        "bildirilmedi. Maskeleme hattını çalıştırıp `piiScanned: true` gönderin.",
    );
  }

  const policySections = (taskType && TASK_CONTEXT_POLICY[taskType]) || DEFAULT_SECTIONS;
  const allowed = policySections.filter((s) => include?.[s] !== false);
  const forced = (Object.keys(include ?? {}) as CaseContextSection[]).filter(
    (s) => include?.[s] === true && !allowed.includes(s),
  );
  const sections: CaseContextSection[] = [...allowed, ...forced];

  const blocks = buildSectionBlocks(input, sections, maxTimelineEvents, maxDocuments);

  const budgetChars = Math.floor(tokenBudget * charsPerToken);
  const lines: string[] = [];
  let usedChars = 0;
  const includedSections: CaseContextSection[] = [];
  let droppedItemCount = 0;
  let truncated = false;

  const costOf = (line: string): number => line.length + (lines.length > 0 ? 1 : 0);

  for (const block of blocks) {
    const header = SECTION_HEADERS[block.section];
    if (usedChars + costOf(header) > budgetChars) {
      // Başlığı bile sığmayan bölüm ATLANIR; sonraki (daha küçük) bölümler denenmeye
      // DEVAM EDER — bütçenin son kırıntısı boşa gitmesin diye. (Yorum ile kod çelişkisi
      // giderildi: kod denetimi bulgusu 23. Öncelik garantisi isteniyorsa `continue`
      // yerine `break` yazılmalıdır; bilinçli tercih atlamadır.)
      droppedItemCount += block.lines.length;
      truncated = true;
      continue;
    }

    const headerCost = costOf(header);
    let sectionLineCount = 0;
    const pendingLines: string[] = [];
    let pendingChars = headerCost;

    for (const raw of block.lines) {
      const line = `  ${raw}`;
      const cost = line.length + 1;
      if (usedChars + pendingChars + cost > budgetChars) {
        droppedItemCount += 1;
        truncated = true;
        continue;
      }
      pendingLines.push(line);
      pendingChars += cost;
      sectionLineCount += 1;
    }

    if (sectionLineCount === 0) {
      // Hiç satır sığmadıysa başlığı da yazma.
      continue;
    }

    if (lines.length > 0) usedChars += 1;
    lines.push(header);
    usedChars += header.length;
    for (const l of pendingLines) {
      usedChars += l.length + 1;
      lines.push(l);
    }
    includedSections.push(block.section);
  }

  const text = lines.join("\n");
  const estimatedTokens = estimateTokens(text, charsPerToken);
  // Politika gereği hiç denenmeyen (include:false) bölümler de "atlanan" sayılır.
  const considered = [...new Set<CaseContextSection>([...policySections, ...sections])];
  const omittedSections = considered.filter((s) => !includedSections.includes(s));

  return {
    text,
    estimatedTokens,
    tokenBudget,
    truncated,
    includedSections,
    omittedSections,
    // Politika dışına çıkılarak eklenen ve GERÇEKTEN bağlama giren bölümler.
    policyOverrides: forced.filter((section) => includedSections.includes(section)),
    droppedItemCount,
  };
}
