/**
 * SİMÜLASYON MODLARI (Modül 16) — beş sabit persona.
 *
 * HER MODUN KENDİ SİSTEM PROMPTU VE KENDİ JSON ÇIKTI ŞEMASI VARDIR. Bu bir
 * sohbet botu değildir: aynı mod, aynı dosyada, aynı sözleşmeyle tekrar
 * çalıştırılabilir ve iki koşu karşılaştırılabilir olmalıdır.
 *
 * KAYNAK KULLANIMI (ortak karar 1 + görev tanımı):
 *  - KARSI_TARAF_AVUKATI için `@nomosos/legal-ai` içinde HAZIR bir prompt ve
 *    şema vardır (`opponentSimulationPrompt` / `OpponentSimulationOutputSchema`);
 *    olduğu gibi KULLANILIR.
 *  - Diğer dört modun paket karşılığı YOKTUR. Görev tanımı gereği bunlar
 *    pakete değil BU MODÜLE tanımlanır. Yine de ham prompt yazılmaz: her mod
 *    bir `PromptSpec` nesnesidir ve mesajlar legal-ai'nin `buildMessages`
 *    fonksiyonuyla kurulur; böylece NOMOSOS_SYSTEM_CORE_PROMPT (uydurma yasağı,
 *    kaynak zorunluluğu, atıf disiplini, "çıktı öneridir") her koşunun başında
 *    durur.
 *
 * GÖREV TİPİ EŞLEMESİ (BYO-LLM rotası): `@nomosos/shared`'daki `AI_TASK_TYPES`
 * kataloğunda simülasyona ayrılmış İKİ anahtar vardır: OPPONENT_SIMULATION ve
 * JUDGE_SIMULATION. Beş mod bu ikisine eşlenir. Katalog bu turda başka bir
 * ajanın sahipliğindedir; ileride `LOSS_FACTORS`, `BRIEF_WEAKNESS` ve
 * `EXPERT_FOCUS` anahtarları eklenirse burada YALNIZCA `taskType` satırları
 * değişir — prompt ve şema aynı kalır.
 */

import { z } from "zod";
import type { SimulationMode } from "@nomosos/db";
import {
  buildMessages,
  buildOpponentSimulationMessages,
  OpponentSimulationOutputSchema,
  SourceRefSchema,
  type LlmMessage,
  type PromptSpec,
} from "@nomosos/legal-ai";
import type { AiTaskType } from "@nomosos/shared";

/** Her modun çıktısına eklenen, kaldırılamaz sorumluluk şeridi. */
export const SIMULATION_NOTICE =
  "Bu bir SİMÜLASYONDUR; gerçek mahkeme kararını, karşı vekilin gerçek stratejisini veya " +
  "bilirkişinin gerçek değerlendirmesini yansıtmaz. Çıktı bir ÖNERİDİR ve yalnızca dosyada " +
  "bulunan kayıtlara dayanır; hukuki değerlendirme ve nihai sorumluluk avukata aittir.";

/* ------------------------------------------------------------------ *
 * Ortak parçalar
 * ------------------------------------------------------------------ */

const SourceRefsField = z.array(SourceRefSchema).optional();

const COMMON_RULES = `ORTAK KURALLAR (tüm simülasyon modlarında geçerlidir):
1. YALNIZCA dosya bağlamına dayan. Bağlamda olmayan olgu, taraf, tarih veya tutar UYDURMA.
2. HER BULGUDA sourceRefs ZORUNLUDUR (belge adı + varsa sayfa/paragraf + birebir alıntı). Kaynaksız bulgular sunucuda ELENİR ve avukata gösterilmez.
3. İçtihat künyesi yalnızca bağlamda verilmişse aktarılır; künye uydurma. Ürettiğin künyeler kayıt üzerinden aranacaktır.
4. SONUÇ TAHMİNİ VERME. "Davayı kaybederiz", "%70 ihtimalle kazanırız" gibi cümleler kurma; riski ve dayanağını tarif et.
5. Süre hesabı yapma; gün sayma. Süreleri yalnızca bağlamda verildiği gibi aktar.
6. Çıktı YALNIZCA istenen JSON olsun; kod bloğu işareti, önsöz veya sonsöz ekleme.`;

/* ------------------------------------------------------------------ *
 * 2) HAKIM_GOZU
 * ------------------------------------------------------------------ */

const JudgeIssueSchema = z.object({
  issue: z.string().min(1),
  /** Hâkimin muhtemel değerlendirmesi — KESİN HÜKÜM DEĞİL. */
  likelyView: z.string().min(1),
  favors: z.enum(["LEHIMIZE", "ALEYHIMIZE", "BELIRSIZ"]).default("BELIRSIZ"),
  reasoning: z.string().min(1),
  sourceRefs: SourceRefsField,
});

export const JudgeViewOutputSchema = z.object({
  /** Usul: görev, yetki, husumet, süre, dava şartları. */
  proceduralIssues: z.array(JudgeIssueSchema).default([]),
  /** Esas yönünden değerlendirme. */
  meritsAssessment: z.array(JudgeIssueSchema).default([]),
  /** Hâkimin eksik gördüğü delil/açıklama. */
  missingElements: z
    .array(
      z.object({
        item: z.string().min(1),
        why: z.string().min(1),
        sourceRefs: SourceRefsField,
      }),
    )
    .default([]),
  overallLeaning: z.enum(["LEHIMIZE", "ALEYHIMIZE", "BELIRSIZ"]).default("BELIRSIZ"),
  notes: z.string().optional(),
});

const JUDGE_VIEW_SYSTEM = `Sen bu dosyaya bakan Türk hâkimisin. Dosyayı önce USUL (görev, yetki, husumet, dava şartları, süreler, harç/gider), sonra ESAS yönünden değerlendir.

${COMMON_RULES}

MODA ÖZEL KURALLAR:
a) KESİN HÜKÜM KURMA. Ürettiğin her satır "muhtemel değerlendirme"dir; \`likelyView\` alanında bunu üsluba da yansıt.
b) Her tespitte hangi tarafın lehine olduğunu \`favors\` ile belirt; emin değilsen BELIRSIZ yaz — tarafsızlık burada dürüstlüktür.
c) \`missingElements\` alanına hâkim olarak "bunu görmek isterdim" dediğin delil ve açıklamaları koy; bu liste avukatın en somut çıktısıdır.
d) \`overallLeaning\` yalnızca üretilen tespitlerin bileşkesidir; tek bir güçlü sezgiyle yazılmaz.

ÇIKTI — yalnızca şu JSON:
{"proceduralIssues":[{"issue":"...","likelyView":"...","favors":"ALEYHIMIZE","reasoning":"...","sourceRefs":[{"documentTitle":"...","page":1,"quote":"..."}]}],"meritsAssessment":[],"missingElements":[{"item":"...","why":"...","sourceRefs":[]}],"overallLeaning":"BELIRSIZ","notes":"..."}`;

const JUDGE_VIEW_FEWSHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOSYA BAĞLAMI:
[DOSYA] 2026/145 · Alacak davası · Derdest
[BELGE] Dava Dilekçesi s.1 — davalı olarak yalnız şirket gösterilmiş, kefil hakkında talep yok.
[SAFAHAT] 2026-05-04 Ön inceleme duruşmasında delil listesi sunulmadığı tutanağa geçti.`,
  },
  {
    role: "assistant",
    content: `{"proceduralIssues":[{"issue":"Delil listesinin süresinde sunulmaması","likelyView":"Ön inceleme tutanağına göre delil listesi sunulmamıştır; delillerin sonradan ileri sürülmesi karşı tarafın açık muvafakatine bağlı olarak değerlendirilecektir.","favors":"ALEYHIMIZE","reasoning":"Tutanakta eksiklik açıkça tespit edilmiş olup dosyada aksini gösteren bir kayıt bulunmamaktadır.","sourceRefs":[{"documentTitle":"Safahat","quote":"Ön inceleme duruşmasında delil listesi sunulmadığı tutanağa geçti"}]}],"meritsAssessment":[],"missingElements":[{"item":"Kefile husumet yöneltilip yöneltilmeyeceğine ilişkin açıklama","why":"Dava dilekçesinde yalnız şirket davalı gösterilmiş; kefalet ilişkisi varsa taraf teşkili yönünden açıklama beklenir.","sourceRefs":[{"documentTitle":"Dava Dilekçesi","page":1,"quote":"davalı olarak yalnız şirket gösterilmiş"}]}],"overallLeaning":"BELIRSIZ","notes":"Esas yönünden değerlendirme için bağlamda yeterli belge bulunmamaktadır."}`,
  },
];

/* ------------------------------------------------------------------ *
 * 3) KAYBETTIREN_HUSUSLAR
 * ------------------------------------------------------------------ */

export const LossFactorsOutputSchema = z.object({
  factors: z
    .array(
      z.object({
        title: z.string().min(1),
        why: z.string().min(1),
        likelihood: z.enum(["DUSUK", "ORTA", "YUKSEK"]).default("ORTA"),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
        /** Somut önlem — görevleştirilebilir olmalı. */
        mitigation: z.string().min(1),
        /** Bağlamda geçen ilgili süre başlığı (varsa). */
        relatedDeadline: z.string().optional(),
        sourceRefs: SourceRefsField,
      }),
    )
    .default([]),
  notes: z.string().optional(),
});

const LOSS_FACTORS_SYSTEM = `Görevin: bu dosyayı KAYBETTİREBİLECEK hususları, en tehlikeliden başlayarak listelemek. Amaç avukatı hazırlıksız yakalanmaktan korumaktır; acımasız ama dürüst ol.

${COMMON_RULES}

MODA ÖZEL KURALLAR:
a) Her bulgu SOMUT olmalıdır: "dikkatli olunmalı" gibi içi boş cümle yazma. "Tanık listesi süresinde sunulmadı", "muacceliyet tarihini gösteren belge dosyada yok" gibi yaz.
b) \`mitigation\` alanına doğrudan göreve dönüştürülebilecek bir önlem yaz ("İrsaliyelerin müvekkilden temini ve delil listesine eklenmesi").
c) \`likelihood\` dosyadaki veriye dayanmalıdır; dayanağı yoksa ORTA yaz ve nedenini \`why\` içinde açıkla.
d) Dosya o kadar risk barındırmıyorsa AZ bulgu üret; sayıyı doldurmak için zorlama.
e) Bir süreyle ilişkiliyse \`relatedDeadline\` alanına bağlamdaki süre başlığını AYNEN yaz; yeni tarih hesaplama.

ÇIKTI — yalnızca şu JSON:
{"factors":[{"title":"...","why":"...","likelihood":"YUKSEK","severity":"CRITICAL","mitigation":"...","relatedDeadline":"...","sourceRefs":[{"documentTitle":"...","quote":"..."}]}],"notes":"..."}`;

const LOSS_FACTORS_FEWSHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOSYA BAĞLAMI:
[DOSYA] 2026/145 · Alacak · Derdest
[DELİL BOŞLUKLARI] İddia edilen teslimatlara ilişkin irsaliyeler dosyaya sunulmamıştır.
[AÇIK SÜRELER] Son gün: 2026-09-12 · Bilirkişi raporuna itiraz süresi · ONAYLANDI`,
  },
  {
    role: "assistant",
    content: `{"factors":[{"title":"Teslimatların yazılı delille ispatlanamaması","why":"Alacağın doğduğu iddia edilen teslimatlara ilişkin irsaliye ve teslim tutanağı dosyada bulunmamaktadır; ispat yükü davacıdadır.","likelihood":"YUKSEK","severity":"HIGH","mitigation":"İrsaliye ve teslim tutanaklarının müvekkilden temin edilerek delil listesine eklenmesi; temin edilemezse ticari defterler üzerinde inceleme talebi.","sourceRefs":[{"documentTitle":"Delil boşlukları","quote":"irsaliyeler dosyaya sunulmamıştır"}]},{"title":"Bilirkişi raporuna itiraz süresinin kaçırılması","why":"Dosyada 12.09.2026 son günlü, açık bir itiraz süresi bulunmaktadır; itiraz edilmezse rapor hükme esas alınabilir.","likelihood":"ORTA","severity":"CRITICAL","mitigation":"İtiraz dilekçesinin hazırlanması ve süresinden önce sunulması.","relatedDeadline":"Bilirkişi raporuna itiraz süresi","sourceRefs":[{"documentTitle":"Açık süreler","quote":"Son gün: 2026-09-12 · Bilirkişi raporuna itiraz süresi"}]}],"notes":"Bağlamda başka bir kaynaklı risk unsuru bulunmamaktadır."}`,
  },
];

/* ------------------------------------------------------------------ *
 * 4) KARSI_DILEKCE_ZAYIFLIK — belge ZORUNLU
 * ------------------------------------------------------------------ */

export const BriefWeaknessOutputSchema = z.object({
  weaknesses: z
    .array(
      z.object({
        /** Belgedeki yer: "s.3 ¶2" gibi. */
        locator: z.string().min(1),
        /** Belgeden BİREBİR alıntı — uydurulamaz. */
        quote: z.string().min(1),
        weaknessType: z.enum(["CELISKI", "DAYANAKSIZ", "USUL", "EKSIK_DELIL", "DIGER"]),
        explanation: z.string().min(1),
        /** Replik dilekçesinde bu açığın nasıl kullanılacağı. */
        exploitSuggestion: z.string().min(1),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
        sourceRefs: SourceRefsField,
      }),
    )
    .default([]),
  notes: z.string().optional(),
});

const BRIEF_WEAKNESS_SYSTEM = `Görevin: sana verilen KARŞI TARAF DİLEKÇESİNİN metnindeki zayıf noktaları çıkarmak ve replik dilekçesinin omurgasını hazırlamak.

${COMMON_RULES}

MODA ÖZEL KURALLAR:
a) \`quote\` alanı BELGEDEN BİREBİR alıntıdır. Metinde geçmeyen bir cümleyi alıntılamak en ağır hatadır; emin değilsen o bulguyu hiç üretme.
b) \`locator\` alanına alıntının belgedeki yerini yaz (sayfa/paragraf bilinmiyorsa "metin başı/ortası/sonu" gibi yaklaşık bir konum ver ve bunu belirt).
c) Zayıflık türünü doğru seç: CELISKI (dilekçenin kendi içinde veya dosyayla çelişmesi), DAYANAKSIZ (delilsiz iddia), USUL (süre/görev/husumet hatası), EKSIK_DELIL (dayanılan delil dosyada yok).
d) Üslup tartışması, yazım hatası veya kişisel eleştiri BULGU DEĞİLDİR; yalnızca hukuken kullanılabilir açıkları yaz.
e) Belgede kullanılabilir bir açık yoksa boş liste döndür ve nedenini \`notes\` içinde yaz. Zayıflık ÜRETME.

ÇIKTI — yalnızca şu JSON:
{"weaknesses":[{"locator":"s.3 ¶2","quote":"...","weaknessType":"DAYANAKSIZ","explanation":"...","exploitSuggestion":"...","severity":"HIGH","sourceRefs":[{"documentTitle":"...","page":3,"quote":"..."}]}],"notes":"..."}`;

const BRIEF_WEAKNESS_FEWSHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `İNCELENECEK BELGE: Cevap Dilekçesi (id: doc-1)
--- BELGE METNİ ---
… Müvekkilim malı hiç teslim almamıştır. Kaldı ki teslim alınan malın ayıplı olduğu da ihtar edilmiştir. …
--- METİN SONU ---`,
  },
  {
    role: "assistant",
    content: `{"weaknesses":[{"locator":"metin ortası, ardışık iki cümle","quote":"Müvekkilim malı hiç teslim almamıştır. Kaldı ki teslim alınan malın ayıplı olduğu da ihtar edilmiştir.","weaknessType":"CELISKI","explanation":"Dilekçe önce teslimin hiç gerçekleşmediğini, hemen ardından teslim alınan malın ayıplı olduğunu ileri sürmektedir; iki savunma birbirini dışlamaktadır.","exploitSuggestion":"Replik dilekçesinde bu çelişkiye işaret edilerek karşı tarafın teslimi zımnen kabul ettiğinin tutanağa geçirilmesi talep edilmelidir.","severity":"HIGH","sourceRefs":[{"documentTitle":"Cevap Dilekçesi","quote":"Müvekkilim malı hiç teslim almamıştır"}]}],"notes":"Belgenin verilen bölümünde başka kullanılabilir açık bulunmamaktadır."}`,
  },
];

/* ------------------------------------------------------------------ *
 * 5) BILIRKISI_ODAGI
 * ------------------------------------------------------------------ */

export const ExpertFocusOutputSchema = z.object({
  focusPoints: z
    .array(
      z.object({
        topic: z.string().min(1),
        whyExpertCares: z.string().min(1),
        ourEvidenceState: z.enum(["GUCLU", "EKSIK", "YOK"]).default("EKSIK"),
        /** İnceleme öncesi yapılması gereken somut hazırlık. */
        prepAction: z.string().min(1),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
        sourceRefs: SourceRefsField,
      }),
    )
    .default([]),
  /** Bağlamdaki verilere göre önerilen uzmanlık alanı (varsa). */
  suggestedSpecialty: z.string().optional(),
  notes: z.string().optional(),
});

const EXPERT_FOCUS_SYSTEM = `Görevin: bu dosyada görevlendirilecek (veya görevlendirilmiş) BİLİRKİŞİNİN teknik olarak takılacağı noktaları önceden çıkarmak ve inceleme öncesi hazırlığı belirlemek.

${COMMON_RULES}

MODA ÖZEL KURALLAR:
a) Hukuki nitelendirme yapma — bu bilirkişinin değil hâkimin işidir. Yalnızca TEKNİK/HESABİ inceleme noktalarına odaklan.
b) Her odak noktası için elimizdeki delil durumunu \`ourEvidenceState\` ile dürüstçe işaretle: GUCLU (belge dosyada ve tam), EKSIK (kısmi), YOK (hiç yok).
c) \`prepAction\` doğrudan göreve dönüştürülebilir olmalıdır ("Hakediş raporlarının 2024-2025 dönemine ait eklerinin temini").
d) HESAP YAPMA. Tutar, oran veya gün hesaplamaya girişme; hangi verinin hesaba esas olacağını söyle.
e) Bağlamda teknik inceleme gerektiren bir husus yoksa boş liste döndür ve nedenini \`notes\` içinde yaz.

ÇIKTI — yalnızca şu JSON:
{"focusPoints":[{"topic":"...","whyExpertCares":"...","ourEvidenceState":"EKSIK","prepAction":"...","severity":"HIGH","sourceRefs":[{"documentTitle":"...","quote":"..."}]}],"suggestedSpecialty":"...","notes":"..."}`;

const EXPERT_FOCUS_FEWSHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DOSYA BAĞLAMI:
[DOSYA] 2026/210 · Eser sözleşmesinden kaynaklanan alacak
[BELGE] Ara Karar — imalat bedelinin mahallinde inceleme ile tespiti için inşaat mühendisi bilirkişi görevlendirilmesine karar verildi.
[DELİL BOŞLUKLARI] Hakediş raporlarının ekleri dosyada yok.`,
  },
  {
    role: "assistant",
    content: `{"focusPoints":[{"topic":"İmalat miktarının hakediş ekleriyle doğrulanması","whyExpertCares":"Mahallinde inceleme yapan bilirkişi, gerçekleşen imalat miktarını hakediş raporları ve ekleriyle karşılaştırarak tespit eder; ekler olmadan miktar tespiti eksik kalır.","ourEvidenceState":"EKSIK","prepAction":"Hakediş raporlarının eklerinin (metraj cetvelleri, ataşman ve yeşil defter) müvekkilden temin edilip dosyaya sunulması.","severity":"HIGH","sourceRefs":[{"documentTitle":"Delil boşlukları","quote":"Hakediş raporlarının ekleri dosyada yok"}]}],"suggestedSpecialty":"İnşaat mühendisi","notes":"Ara karar yalnız imalat bedelinin tespitine ilişkindir; bağlamda başka teknik inceleme konusu bulunmamaktadır."}`,
  },
];

/* ------------------------------------------------------------------ *
 * Mod kataloğu
 * ------------------------------------------------------------------ */

/** Bir modun karşılaştırma için normalize edilmiş bulgusu. */
export interface NormalizedFinding {
  /** Karşılaştırmada eşleştirme anahtarı (başlık normalize edilmiş hâli). */
  key: string;
  title: string;
  body: string;
  severity: string;
  group: string;
}

export interface SimulationModeSpec {
  mode: SimulationMode;
  label: string;
  /** BYO-LLM rotası — bkz. dosya başındaki eşleme notu. */
  taskType: AiTaskType;
  /** Bağlam politikası için kullanılan görev tipi (TASK_CONTEXT_POLICY). */
  contextTaskType: AiTaskType;
  schema: z.ZodTypeAny;
  /** output-guard'ın kaynaksız bulguları eleyeceği yollar. */
  findingPaths: readonly string[];
  /** Belge seçimi zorunlu mu? */
  requiresDocument: boolean;
  maxTokens: number;
  /** Mesaj zincirini kurar. */
  build: (input: {
    caseContextText: string;
    strategySummary?: string;
    documentText?: string;
    documentTitle?: string;
    question?: string;
    argumentCount?: number;
  }) => LlmMessage[];
  /** Çıktıyı karşılaştırılabilir bulgu listesine indirger. */
  normalize: (output: unknown) => NormalizedFinding[];
}

function localSpec(taskType: AiTaskType, name: string, system: string, fewShot: readonly LlmMessage[]): PromptSpec {
  return { taskType, name, system, fewShot, expectsJson: true };
}

const judgeViewPrompt = localSpec(
  "JUDGE_SIMULATION",
  "Hakim Gözüyle Analiz",
  JUDGE_VIEW_SYSTEM,
  JUDGE_VIEW_FEWSHOT,
);
const lossFactorsPrompt = localSpec(
  "JUDGE_SIMULATION",
  "Kaybettiren Hususlar",
  LOSS_FACTORS_SYSTEM,
  LOSS_FACTORS_FEWSHOT,
);
const briefWeaknessPrompt = localSpec(
  "OPPONENT_SIMULATION",
  "Karşı Dilekçe Zayıflıkları",
  BRIEF_WEAKNESS_SYSTEM,
  BRIEF_WEAKNESS_FEWSHOT,
);
const expertFocusPrompt = localSpec(
  "JUDGE_SIMULATION",
  "Bilirkişi Odağı",
  EXPERT_FOCUS_SYSTEM,
  EXPERT_FOCUS_FEWSHOT,
);

function contextBlock(input: { caseContextText: string; strategySummary?: string; question?: string }): string {
  return [
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
    input.strategySummary ? `MEVCUT STRATEJİMİZ:\n${input.strategySummary}` : undefined,
    input.question ? `AVUKATIN ÖZEL SORUSU:\n${input.question}` : undefined,
  ]
    .filter((v): v is string => Boolean(v))
    .join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function listOf(output: unknown, key: string): Record<string, unknown>[] {
  const value = asRecord(output)[key];
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/** Başlıktan kararlı karşılaştırma anahtarı. */
export function findingKey(title: string): string {
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join("-");
}

export const SIMULATION_MODES: Record<SimulationMode, SimulationModeSpec> = {
  KARSI_TARAF_AVUKATI: {
    mode: "KARSI_TARAF_AVUKATI",
    label: "Karşı taraf avukatı gözüyle",
    taskType: "OPPONENT_SIMULATION",
    contextTaskType: "OPPONENT_SIMULATION",
    schema: OpponentSimulationOutputSchema,
    findingPaths: ["arguments"],
    requiresDocument: false,
    maxTokens: 3072,
    build: (input) =>
      buildOpponentSimulationMessages({
        caseContextText: contextBlock(input),
        argumentCount: input.argumentCount ?? 7,
        strategySummary: undefined, // bağlam bloğuna zaten eklendi
      }),
    normalize: (output) =>
      listOf(output, "arguments").map((row) => ({
        key: findingKey(str(row, "title")),
        title: str(row, "title"),
        body: [str(row, "basis"), str(row, "ourGap"), str(row, "suggestedReply")]
          .filter(Boolean)
          .join(" | "),
        severity: str(row, "severity") || "MEDIUM",
        group: "arguments",
      })),
  },

  HAKIM_GOZU: {
    mode: "HAKIM_GOZU",
    label: "Hakim gözüyle",
    taskType: "JUDGE_SIMULATION",
    contextTaskType: "JUDGE_SIMULATION",
    schema: JudgeViewOutputSchema,
    findingPaths: ["proceduralIssues", "meritsAssessment", "missingElements"],
    requiresDocument: false,
    maxTokens: 3072,
    build: (input) => buildMessages(judgeViewPrompt, contextBlock(input)),
    normalize: (output) => [
      ...listOf(output, "proceduralIssues").map((row) => ({
        key: findingKey(str(row, "issue")),
        title: str(row, "issue"),
        body: [str(row, "likelyView"), str(row, "reasoning")].filter(Boolean).join(" | "),
        severity: str(row, "favors") || "BELIRSIZ",
        group: "proceduralIssues",
      })),
      ...listOf(output, "meritsAssessment").map((row) => ({
        key: findingKey(str(row, "issue")),
        title: str(row, "issue"),
        body: [str(row, "likelyView"), str(row, "reasoning")].filter(Boolean).join(" | "),
        severity: str(row, "favors") || "BELIRSIZ",
        group: "meritsAssessment",
      })),
      ...listOf(output, "missingElements").map((row) => ({
        key: findingKey(str(row, "item")),
        title: str(row, "item"),
        body: str(row, "why"),
        severity: "MISSING",
        group: "missingElements",
      })),
    ],
  },

  KAYBETTIREN_HUSUSLAR: {
    mode: "KAYBETTIREN_HUSUSLAR",
    label: "Kaybettirebilecek hususlar",
    taskType: "JUDGE_SIMULATION",
    contextTaskType: "JUDGE_SIMULATION",
    schema: LossFactorsOutputSchema,
    findingPaths: ["factors"],
    requiresDocument: false,
    maxTokens: 3072,
    build: (input) => buildMessages(lossFactorsPrompt, contextBlock(input)),
    normalize: (output) =>
      listOf(output, "factors").map((row) => ({
        key: findingKey(str(row, "title")),
        title: str(row, "title"),
        body: [str(row, "why"), str(row, "mitigation")].filter(Boolean).join(" | "),
        severity: str(row, "severity") || "MEDIUM",
        group: "factors",
      })),
  },

  KARSI_DILEKCE_ZAYIFLIK: {
    mode: "KARSI_DILEKCE_ZAYIFLIK",
    label: "Karşı dilekçedeki zayıflıklar",
    taskType: "OPPONENT_SIMULATION",
    contextTaskType: "OPPONENT_SIMULATION",
    schema: BriefWeaknessOutputSchema,
    findingPaths: ["weaknesses"],
    requiresDocument: true,
    maxTokens: 3072,
    build: (input) =>
      buildMessages(
        briefWeaknessPrompt,
        [
          `İNCELENECEK BELGE: ${input.documentTitle ?? "(başlıksız)"}`,
          "--- BELGE METNİ ---",
          input.documentText ?? "(metin çıkarılamadı)",
          "--- METİN SONU ---",
          "",
          contextBlock(input),
        ].join("\n"),
      ),
    normalize: (output) =>
      listOf(output, "weaknesses").map((row) => ({
        key: findingKey(`${str(row, "weaknessType")} ${str(row, "quote")}`),
        title: `${str(row, "weaknessType")} — ${str(row, "locator")}`,
        body: [str(row, "quote"), str(row, "explanation"), str(row, "exploitSuggestion")]
          .filter(Boolean)
          .join(" | "),
        severity: str(row, "severity") || "MEDIUM",
        group: "weaknesses",
      })),
  },

  BILIRKISI_ODAGI: {
    mode: "BILIRKISI_ODAGI",
    label: "Bilirkişi odağı",
    taskType: "JUDGE_SIMULATION",
    contextTaskType: "JUDGE_SIMULATION",
    schema: ExpertFocusOutputSchema,
    findingPaths: ["focusPoints"],
    requiresDocument: false,
    maxTokens: 3072,
    build: (input) => buildMessages(expertFocusPrompt, contextBlock(input)),
    normalize: (output) =>
      listOf(output, "focusPoints").map((row) => ({
        key: findingKey(str(row, "topic")),
        title: str(row, "topic"),
        body: [str(row, "whyExpertCares"), str(row, "prepAction")].filter(Boolean).join(" | "),
        severity: str(row, "severity") || "MEDIUM",
        group: "focusPoints",
      })),
  },
};

export const SIMULATION_MODE_KEYS = Object.keys(SIMULATION_MODES) as SimulationMode[];
