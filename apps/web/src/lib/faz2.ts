/**
 * Faz 2 API istemcisi — belge hattı, öneri kuyruğu, asistan, dilekçe, içtihat.
 *
 * SÖZLEŞME SABİTLENDİ. Faz 2 uçları yayında olduğu için "yedek yol" zincirleri
 * (`firstOk`) KALDIRILDI. Zincirlerin iki zararı vardı:
 *   1. API'nin MEŞRU 404'leri ("Belge bulunamadı", "Dilekçe bulunamadı") yedek
 *      yollar denendikten sonra "Bu özellik henüz hazır değil" mesajına
 *      dönüşüyordu; silinmiş/yetkisiz bir kayıt, yayında olmayan bir modül gibi
 *      görünüyor ve hata teşhisi imkânsızlaşıyordu.
 *   2. Alan adı uyuşmazlıkları (`res.checks` yerine `res.results`) sessizce
 *      boş liste üretip kullanıcıya YANLIŞ güven gösteriyordu.
 *
 * KVKK: 409 `requiresPiiApproval` gövdesi `extractPii` ile ayrıştırılır.
 * TEYİT: 422 gövdesi `blocking` taşır; `extractFailedCitations` onu okur.
 */

import {
  API_BASE,
  ApiError,
  api,
  asList,
  clearToken,
  fetchPaged,
  type PagedResult,
} from "@/lib/api";
import type {
  ActionProposal,
  AnalysisReport,
  DeadlineRuleOption,
  ReadyGate,
  TenantUser,
  CaseLawDoc,
  CaseLawRef,
  ChatMessageItem,
  ChatResponse,
  ChatSessionInfo,
  Citation,
  CitationCheckItem,
  DocumentItem,
  PetitionDetail,
  PetitionSection,
  PetitionSummary,
  PetitionTemplateItem,
  PetitionVersionItem,
  PiiApprovalPayload,
  PipelineRun,
  PipelineStepInfo,
  SmartNoteItem,
} from "@/lib/types";

// ---------------------------------------------------------------- yardımcılar

/**
 * Uç henüz yayında değil mi? (modül kaydı yok / ağ yok)
 *
 * DİKKAT: Faz 2 uçları yayındadır. Bu yardımcı yalnızca ağ kopukluğu ve
 * gövdesiz 404'ler için doğrudur; "Belge bulunamadı." gibi Türkçe mesaj taşıyan
 * 404'ler GERÇEK hatadır ve olduğu gibi gösterilmelidir (bkz. isMissingEndpoint).
 */
export function isFeatureMissing(err: unknown): boolean {
  return isMissingEndpoint(err);
}

export const FEATURE_MISSING_TEXT =
  "Bu özellik henüz hazır değil. İlgili API ucu yayına alındığında bu ekran otomatik olarak çalışacak.";

/** Hata mesajını ekrana basılacak Türkçe metne çevirir. */
export function errText(err: unknown, fallback: string): string {
  if (isFeatureMissing(err)) return FEATURE_MISSING_TEXT;
  if (err instanceof ApiError) return err.message;
  return fallback;
}

/**
 * "Uç yok" hatası mı, yoksa GERÇEK bir 404 mü?
 *
 * API bulunamayan kayıtlar için Türkçe bir `message` döndürür ("Belge
 * bulunamadı."). Gövdesi boş ya da HTML olan 404 ise gerçekten yayında olmayan
 * bir uçtur. Ayrım burada yapılır ki kullanıcı "kayıt yok" ile "modül yok"u
 * karıştırmasın.
 */
export function isMissingEndpoint(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 0) return true;
  if (err.status !== 404 && err.status !== 405 && err.status !== 501) return false;
  const data = err.data;
  if (data && typeof data === "object") {
    const message = (data as Record<string, unknown>).message;
    // Türkçe iş mesajı varsa bu GERÇEK bir 404'tür (kayıt yok / yetki yok).
    if (typeof message === "string" && message.trim().length > 0) return false;
  }
  return true;
}

/** 409 KVKK onay gövdesini ayrıştırır; PII akışı değilse null döner. */
export interface PiiPrompt {
  maskedText: string;
  findings: NonNullable<PiiApprovalPayload["findings"]>;
}

export function extractPii(err: unknown): PiiPrompt | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const data = (err.data ?? {}) as PiiApprovalPayload;
  return {
    maskedText: data.maskedText ?? data.maskedMessage ?? "",
    findings: data.findings ?? [],
  };
}

/**
 * 422 teyit hatasında TAKILAN atıfları çıkarır.
 *
 * API sözleşmesi: gövde `blocking: [{ raw, kind, status, reason, remedy }]` ve
 * `readyGate` taşır. (Eskiden `failedCitations|citations|citationChecks|details`
 * aranıyordu; hiçbiri yoktu ve liste daima boş kalıyordu.)
 */
export function extractFailedCitations(err: unknown): CitationCheckItem[] {
  if (!(err instanceof ApiError) || err.status !== 422) return [];
  const data = (err.data ?? {}) as Record<string, unknown>;
  const gate = (data.readyGate ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(data.blocking)
    ? data.blocking
    : Array.isArray(gate.blocking)
      ? gate.blocking
      : [];

  return (raw as unknown[]).map((c): CitationCheckItem => {
    if (typeof c === "string") return { rawCitation: c, status: "BULUNAMADI" };
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      rawCitation: String(o.raw ?? o.rawCitation ?? o.citation ?? "Atıf"),
      status: (o.status as CitationCheckItem["status"]) ?? "BULUNAMADI",
      kind: typeof o.kind === "string" ? o.kind : null,
      reason: typeof o.reason === "string" ? o.reason : null,
      remedy: typeof o.remedy === "string" ? o.remedy : null,
      note: [o.reason, o.remedy].filter((x) => typeof x === "string").join(" ") || null,
    };
  });
}

/** 422 gövdesindeki, avukat beyanı bekleyen mevzuat atıfları. */
export function extractStatuteDeclarations(err: unknown): string[] {
  if (!(err instanceof ApiError) || err.status !== 422) return [];
  const data = (err.data ?? {}) as Record<string, unknown>;
  const gate = (data.readyGate ?? {}) as Record<string, unknown>;
  const list = data.statuteDeclarationsRequired ?? gate.statuteDeclarationsRequired;
  return Array.isArray(list) ? list.map(String) : [];
}

function firstUrl(payload: unknown): string | null {
  if (typeof payload === "string" && payload.startsWith("http")) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const key of ["url", "downloadUrl", "signedUrl", "presignedUrl", "href", "location"]) {
      const v = o[key];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return null;
}

// ------------------------------------------------------------------- belgeler

export function listCaseDocuments(caseId: string): Promise<DocumentItem[]> {
  return api<unknown>("/documents", { query: { caseId } }).then((p) => asList<DocumentItem>(p));
}

export function getDocument(documentId: string): Promise<DocumentItem> {
  return api<DocumentItem>(`/documents/${documentId}`);
}

export function updateDocumentClass(
  documentId: string,
  documentClass: string,
): Promise<DocumentItem> {
  return api<DocumentItem>(`/documents/${documentId}`, {
    method: "PATCH",
    body: { class: documentClass, classSource: "MANUEL" },
  });
}

export function deleteDocument(documentId: string): Promise<unknown> {
  return api<unknown>(`/documents/${documentId}`, { method: "DELETE" });
}

/**
 * Ön-imzalı indirme adresi.
 *
 * Uç MinIO'nun imzalı URL'ini döndürür; bu URL kimlik doğrulaması gerektirmediği
 * için yeni sekmede açılabilir. Uç yoksa doğrudan `/download` adresine düşmeyiz —
 * o adres Bearer başlığı ister ve yeni sekmede 401 verirdi; bunun yerine
 * kullanıcıya anlaşılır bir hata döneriz.
 */
export async function documentDownloadUrl(documentId: string): Promise<string> {
  const res = await api<unknown>(`/documents/${documentId}/download`);
  const url = firstUrl(res);
  if (url) return url;
  throw new ApiError(
    "İndirme bağlantısı alınamadı: sunucu ön-imzalı bir adres döndürmedi.",
    500,
    res,
  );
}

export interface UploadOptions {
  file: File;
  caseId?: string | null;
  documentClass?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Belge yükleme (multipart). `api()` JSON gövdesine göre yazıldığı ve ilerleme
 * göstergesi gerektiği için burada XHR kullanılır.
 */
export function uploadDocument(opts: UploadOptions): Promise<DocumentItem> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", opts.file, opts.file.name);
    if (opts.caseId) {
      form.append("caseId", opts.caseId);
      form.append("case_id", opts.caseId);
    }
    if (opts.documentClass) form.append("class", opts.documentClass);
    form.append("name", opts.file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/v1/documents`);
    // İ-46: kimlik httpOnly çerezle taşınır — çerez istekle birlikte gider.
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onerror = () =>
      reject(
        new ApiError(
          `API sunucusuna ulaşılamadı. Servisin çalıştığından emin olun (${API_BASE}).`,
          0,
          null,
        ),
      );
    xhr.onabort = () => reject(new ApiError("Yükleme iptal edildi.", 0, null));

    xhr.onload = () => {
      let data: unknown = null;
      if (xhr.responseText) {
        try {
          data = JSON.parse(xhr.responseText) as unknown;
        } catch {
          data = xhr.responseText;
        }
      }
      if (xhr.status === 401) {
        clearToken();
        if (typeof window !== "undefined") window.location.href = "/giris";
        reject(new ApiError("Oturum süresi doldu. Lütfen yeniden giriş yapın.", 401, null));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((data ?? {}) as DocumentItem);
        return;
      }
      let msg = `Yükleme başarısız oldu (HTTP ${xhr.status}).`;
      if (data && typeof data === "object") {
        const m = (data as Record<string, unknown>).message;
        if (typeof m === "string") msg = m;
        else if (Array.isArray(m)) msg = m.map(String).join(", ");
      }
      reject(new ApiError(msg, xhr.status, data));
    };

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** Belgenin işleme hattı durumu (senkron hat: yükleme sonrası hazır olur). */
export async function getPipelineRun(documentId: string): Promise<PipelineRun | null> {
  // Ayrı bir /pipeline ucu YOKTUR: hat senkron çalışır ve son koşumlar belge
  // detayının `pipeline` alanında döner.
  const doc = await api<Record<string, unknown>>(`/documents/${documentId}`);
  const res = doc.pipeline ?? null;
  const list = asList<PipelineRun>(res);
  if (list.length > 0) return list[0];
  if (res && typeof res === "object" && "status" in (res as Record<string, unknown>)) {
    return res as PipelineRun;
  }
  return null;
}

export function pipelineSteps(run: PipelineRun | null): PipelineStepInfo[] {
  if (!run) return [];
  const raw = run.steps ?? run.stepsJson;
  return Array.isArray(raw) ? raw : [];
}

// ------------------------------------------------------------------ öneriler

export interface ProposalQuery {
  status?: string;
  caseId?: string;
  documentId?: string;
  type?: string;
  limit?: number;
}

/**
 * Öneri listesi — SAYFALAMA ZARFIYLA (denetim bulgusu K-15).
 * `limit: 200` isteyip `total`'i atmak, 200'den fazla bekleyen önerisi olan
 * büroda önerilerin sessizce kaybolması demekti.
 */
export async function listProposalsPaged(
  query: ProposalQuery & { page?: number } = {},
): Promise<PagedResult<ActionProposal>> {
  const { page, limit, ...filters } = query;
  return fetchPaged<ActionProposal>("/proposals", { query: { ...filters }, page, limit });
}

export function listProposals(query: ProposalQuery = {}): Promise<ActionProposal[]> {
  return api<unknown>("/proposals", { query: { ...query } }).then((p) =>
    asList<ActionProposal>(p),
  );
}

/**
 * Sol menü rozeti — uç yoksa 0 döner, hata fırlatmaz.
 *
 * Önceden 200 kayıt çekip `list.length` sayıyordu: 200'den fazla bekleyen
 * öneri varsa rozet "200"de takılı kalıyordu (denetim bulgusu K-15). Artık
 * tek kayıt istenir ve zarftaki `total` okunur — hem doğru hem ucuz.
 */
export async function countPendingProposals(): Promise<number> {
  try {
    const res = await listProposalsPaged({ status: "BEKLIYOR", limit: 1 });
    return res.total;
  } catch {
    return 0;
  }
}

/**
 * Onay anında verilebilecek DÜZELTMELER.
 *
 * Bazı öneriler bu alanlar olmadan ONAYLANAMAZ (API 400 döner):
 *  - DOSYA_ESLESTIRME: birden çok aday varsa `caseId` ZORUNLU,
 *  - SURE: tespit belirsizse `ruleKey` (+ gerekirse `triggerDate`) ZORUNLU,
 *  - GOREV: dosyanın sorumlusu yoksa `assigneeId` ZORUNLU.
 */
export interface ApproveProposalBody {
  caseId?: string;
  assigneeId?: string;
  title?: string;
  dueDate?: string;
  ruleKey?: string;
  triggerDate?: string;
  serviceMethod?: string;
  hearingId?: string;
  note?: string;
}

export function approveProposal(
  id: string,
  body: ApproveProposalBody = {},
): Promise<ActionProposal> {
  // Boş alanlar gönderilmez: API zod ile doğrular ve "" değeri hata üretir.
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") clean[key] = value;
  }
  return api<ActionProposal>(`/proposals/${id}/approve`, { method: "POST", body: clean });
}

export function rejectProposal(id: string, reason: string): Promise<ActionProposal> {
  return api<ActionProposal>(`/proposals/${id}/reject`, { method: "POST", body: { reason } });
}

/** Büro kullanıcıları — GOREV önerisinde sorumlu seçimi için. */
export function listTenantUsers(): Promise<TenantUser[]> {
  return api<unknown>("/users").then((p) => asList<TenantUser>(p));
}

/** Süre kuralları — SURE önerisinde kural seçimi için. */
export function listDeadlineRules(): Promise<DeadlineRuleOption[]> {
  return api<unknown>("/deadline-rules").then((p) => asList<DeadlineRuleOption>(p));
}

/** Öneri payload'ından güvenli metin okuma (JSON alanları serbest biçimli). */
export function payloadOf(p: ActionProposal): Record<string, unknown> {
  const raw = p.payloadJson ?? p.payload;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function payloadStr(p: ActionProposal, ...keys: string[]): string | null {
  const payload = payloadOf(p);
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

// -------------------------------------------------------------------- asistan

export function listChatSessions(caseId?: string | null): Promise<ChatSessionInfo[]> {
  return api<unknown>("/assistant/sessions", { query: { caseId: caseId ?? undefined } }).then((p) =>
    asList<ChatSessionInfo>(p),
  );
}

/**
 * OTURUMU API AÇAR, BİZ DEĞİL.
 *
 * `POST /assistant/chat` ilk mesajda oturumu kendisi oluşturup `sessionId`
 * döndürür; ayrı bir "oturum aç" ucu BİLİNÇLİ OLARAK yoktur (boş oturum kaydı
 * üretmemek için). Bu yüzden `createChatSession` diye bir fonksiyon da yoktur:
 * çağıran oturumsuz gönderir ve cevaptan gelen `sessionId`'yi kullanır.
 */

export function listChatMessages(sessionId: string): Promise<ChatMessageItem[]> {
  // Oturum detayı mesajlarıyla birlikte döner; ayrı bir /messages ucu yoktur.
  return api<Record<string, unknown>>(`/assistant/sessions/${sessionId}`).then((s) =>
    asList<ChatMessageItem>(s.messages ?? []),
  );
}

export interface AssistantChatInput {
  caseId?: string | null;
  sessionId?: string | null;
  message: string;
  piiApproved?: boolean;
}

export function sendAssistantChat(input: AssistantChatInput): Promise<ChatResponse> {
  const body: Record<string, unknown> = { message: input.message };
  if (input.caseId) body.caseId = input.caseId;
  if (input.sessionId) body.sessionId = input.sessionId;
  if (input.piiApproved) body.piiApproved = true;
  return api<ChatResponse>("/assistant/chat", { method: "POST", body });
}

/**
 * Cevabın altına basılacak KAYNAK listesi.
 *
 * [KRİTİK DÜZELTME] API iki ayrı liste döner:
 *   `sources`   — kaynak kapısından geçmiş, her biri `verified` bayraklı küme,
 *   `citations` — modelin METNİNDEN regex ile çıkarılmış, HİÇ DOĞRULANMAMIŞ
 *                 ham künyeler (teyit hattının girdisi).
 * Anahtar sırası eskiden `["citations", ...]` olduğu için arayüz DAİMA
 * doğrulanmamış listeyi seçiyor ve modelin uydurduğu "Yargıtay 9. HD 2024/1234
 * E." künyesini avukata "Kaynaklar [1]" diye, teyit rozeti olmadan gösteriyordu.
 * Bu, ürünün en temel vaadinin (kaynak gösterme + uydurma yasağı) kullanıcıya
 * görünen yüzünde ters çalışmasıydı.
 *
 * Artık ÖNCE `sources` okunur. Geçmiş mesajlarda `citations` alanı, kaydedilmiş
 * `citationsJson` nesnesidir (`{ sources, extractedCitations, ... }`); onun da
 * içinden `sources` çıkarılır.
 */
export function citationsOf(
  res: ChatResponse | ChatMessageItem | null | undefined,
): Citation[] {
  if (!res) return [];
  const obj = res as Record<string, unknown>;

  if (Array.isArray(obj.sources)) return obj.sources as Citation[];

  // Kayıtlı mesaj: citations alanı { sources: [...] } nesnesidir.
  for (const key of ["citations", "citationsJson"]) {
    const raw = obj[key];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const inner = (raw as Record<string, unknown>).sources;
      if (Array.isArray(inner)) return inner as Citation[];
    }
  }

  // Son çare: doğrulanmamış ham künyeler — hepsi `verified:false` işaretlenir.
  for (const key of ["citations", "citationsJson"]) {
    const raw = obj[key];
    if (Array.isArray(raw)) {
      return (raw as Citation[]).map((c) => ({ ...c, verified: c.verified ?? false }));
    }
  }
  return [];
}

/** Kaynak DOĞRULANMIŞ mı? (CASELAW/STATUTE künyeleri varsayılan olarak DEĞİL) */
export function isVerifiedCitation(c: Citation): boolean {
  if (typeof c.verified === "boolean") return c.verified;
  const kind = (c.kind ?? "").toUpperCase();
  return kind !== "CASELAW" && kind !== "STATUTE";
}

/**
 * TEYİT AJANI — ham künyeleri deterministik olarak doğrular (LLM YOK).
 *
 * Sohbet/analiz cevabındaki doğrulanmamış içtihat künyeleri buraya gönderilir;
 * arayüz sonucu "DOĞRULANDI / BULUNAMADI / BELİRSİZ" olarak gösterir.
 */
export interface CitationVerifyResponse {
  results: Array<{
    raw: string;
    kind: "ICTIHAT" | "MEVZUAT" | "TANINMADI";
    status: CitationCheckItem["status"];
    isDemo?: boolean;
    note?: string;
  }>;
  summary: { total: number; verified: number; notFound: number; ambiguous: number; overall: string };
}

export function verifyCitations(
  citations: string[],
  source?: { sourceType: "PETITION" | "CHAT" | "ANALYSIS"; sourceId?: string },
): Promise<CitationVerifyResponse> {
  return api<CitationVerifyResponse>("/caselaw/verify", {
    method: "POST",
    body: {
      citations,
      ...(source?.sourceType ? { sourceType: source.sourceType } : {}),
      ...(source?.sourceId ? { sourceId: source.sourceId } : {}),
    },
  });
}

export function chatText(res: ChatResponse): string {
  return res.reply ?? res.content ?? res.answer ?? res.message ?? res.text ?? "(Boş yanıt)";
}

export function analyzeCase(caseId: string, piiApproved = false): Promise<AnalysisReport> {
  return api<AnalysisReport>(`/assistant/analyze/${caseId}`, {
    method: "POST",
    body: piiApproved ? { piiApproved: true } : {},
  });
}

/**
 * AI akıllı not ÖNERİSİ üretir.
 *
 * [DÜZELTME] API TEKİL bir nesne döndürür: `{ note, source, rationale, ... }`.
 * Eskiden `asList` ile dizi bekleniyordu; sonuç daima `[]` oluyor, panelde
 * hiçbir öneri belirmiyordu — oysa DB'de `SmartNote(source=AI, isApproved=false)`
 * yaratılmış ve LLM maliyeti ödenmiş oluyordu. Avukat onaylayamadığı için
 * öneriler kalıcı olarak yetim kalıyordu.
 */
export function suggestSmartNotes(
  caseId: string,
  kind = "GENEL",
  instruction?: string,
  piiApproved = false,
): Promise<SmartNoteItem[]> {
  const body: Record<string, unknown> = { caseId, kind };
  if (instruction?.trim()) body.instruction = instruction.trim();
  if (piiApproved) body.piiApproved = true;
  return api<Record<string, unknown>>("/assistant/notes", { method: "POST", body }).then((res) => {
    const note = res.note as SmartNoteItem | undefined;
    return note ? [note] : [];
  });
}

export function listSmartNotes(caseId: string): Promise<SmartNoteItem[]> {
  return api<unknown>("/assistant/notes", { query: { caseId } }).then((p) =>
    asList<SmartNoteItem>(p),
  );
}

/**
 * Akıllı not kararı. ONAY ve RED ayrı uçlardır: onaylanmamış bir AI önerisi
 * reddedildiğinde kayıt SİLİNİR (onaylanmış not silinemez — denetim izi).
 */
export function decideSmartNote(id: string, isApproved: boolean): Promise<SmartNoteItem> {
  return isApproved
    ? api<SmartNoteItem>(`/assistant/notes/${id}/approve`, { method: "PATCH" })
    : api<SmartNoteItem>(`/assistant/notes/${id}`, { method: "DELETE" });
}

// -------------------------------------------------------------------- dilekçe

export function listPetitionTemplates(): Promise<PetitionTemplateItem[]> {
  return api<unknown>("/petition-templates").then((p) => asList<PetitionTemplateItem>(p));
}

export function listPetitions(caseId: string): Promise<PetitionSummary[]> {
  return api<unknown>(`/cases/${caseId}/petitions`).then((p) => asList<PetitionSummary>(p));
}

export function createPetition(
  caseId: string,
  body: { type: string; title: string; templateId?: string | null },
): Promise<PetitionSummary> {
  return api<PetitionSummary>("/petitions", {
    method: "POST",
    body: { ...body, caseId, templateId: body.templateId ?? undefined },
  });
}

export function getPetition(id: string): Promise<PetitionDetail> {
  return api<PetitionDetail>(`/petitions/${id}`);
}

export function deletePetition(id: string): Promise<unknown> {
  return api<unknown>(`/petitions/${id}`, { method: "DELETE" });
}

export function listPetitionVersions(id: string): Promise<PetitionVersionItem[]> {
  // Sürüm listesi dilekçe detayının `versions` alanında gelir
  // (POST /petitions/:id/versions yeni sürüm YAZAR, GET karşılığı yoktur).
  return api<Record<string, unknown>>(`/petitions/${id}`).then((d) =>
    asList<PetitionVersionItem>(d.versions ?? []),
  );
}

export function savePetitionVersion(
  id: string,
  sections: PetitionSection[],
  note?: string,
): Promise<PetitionVersionItem> {
  return api<PetitionVersionItem>(`/petitions/${id}/versions`, {
    method: "POST",
    body: { sections, sectionsJson: sections, note: note?.trim() || undefined },
  });
}

/**
 * Statü geçişi. HAZIR isteğinde teyit kapısı 422 döndürebilir; çağıran
 * `extractFailedCitations` ile takılan atıfları listeler.
 *
 * `confirmedStatuteCitations`: avukatın "bu mevzuat atıflarını yürürlükteki
 * metinden teyit ettim" beyanı — İÇTİHAT atıfları için böyle bir yol YOKTUR.
 */
export function updatePetitionStatus(
  id: string,
  status: string,
  confirmedStatuteCitations?: string[],
): Promise<PetitionDetail> {
  const body: Record<string, unknown> = { status };
  if (confirmedStatuteCitations?.length) {
    body.confirmedStatuteCitations = confirmedStatuteCitations;
  }
  return api<PetitionDetail>(`/petitions/${id}/status`, { method: "PATCH", body });
}

/**
 * PETITION_DRAFT — AI taslağı.
 *
 * DİKKAT: Bu çağrı SUNUCUDA YENİ BİR SÜRÜM OLUŞTURUR (appendVersion) ve dilekçe
 * statüsünü TEYIT_EDILIYOR'a düşürür. Arayüz "kaydetmeden sürüm oluşmaz"
 * DEMEMELİDİR; sürüm numarası yanıttaki `versionNo` alanındadır.
 *
 * `styleNote` kullanıcının serbest metnidir ve API tarafında ayrıca KVKK
 * kapısından geçer (409 requiresPiiApproval dönebilir).
 */
export interface PetitionDraftResponse {
  petitionId: string;
  versionId: string;
  versionNo: number;
  sections: PetitionSection[];
  precedentSuggestions?: string[];
  missingContextNotes?: string[];
  excludedDemoPrecedents?: string[];
  verification?: CitationCheckItem[];
  readyGate?: ReadyGate;
  model?: string;
}

export function aiDraftPetition(
  id: string,
  instruction: string,
  piiApproved = false,
): Promise<PetitionDraftResponse> {
  const body: Record<string, unknown> = {};
  // API tarafında alan adı `styleNote` (şablonun üslup notunu ezen ek talimat).
  if (instruction.trim()) body.styleNote = instruction.trim();
  if (piiApproved) body.piiApproved = true;
  return api<PetitionDraftResponse>(`/petitions/${id}/generate`, { method: "POST", body });
}

const TR_FOLD: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u",
};

/**
 * Bölüm anahtarı — API'deki `sectionKey()` ile BİREBİR aynı kuralı uygular
 * ("SONUÇ VE İSTEM" → "sonuc_ve_istem"). İki taraf ayrışırsa yeniden yazma
 * yanlış bölümü hedefler, bu yüzden kural burada da deterministiktir.
 */
export function sectionKeyOf(title: string): string {
  let out = "";
  for (const ch of title.toLocaleLowerCase("tr-TR")) out += TR_FOLD[ch] ?? ch;
  return (
    out
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "bolum"
  );
}

/**
 * PETITION_SECTION_REWRITE yanıtı.
 *
 * [DÜZELTME] API alanı `newBody`dir. Eskiden `body|content|text|section`
 * aranıyordu; hiçbiri gelmediği için arayüz "AI boş içerik döndürdü" diyordu —
 * oysa sunucuda `appendVersion` çalışmış, YENİ SÜRÜM oluşmuş ve statü
 * TEYIT_EDILIYOR'a düşmüştü. Her denemede sürüm numarası artıyordu.
 */
export interface RewriteSectionResponse {
  petitionId: string;
  versionId: string;
  versionNo: number;
  sectionKey: string;
  sectionTitle: string;
  previousBody: string;
  newBody: string;
  changeSummary?: string;
  warnings?: string[];
  verification?: CitationCheckItem[];
  readyGate?: ReadyGate;
}

export function aiRewriteSection(
  id: string,
  sectionTitle: string,
  instruction: string,
  piiApproved = false,
  sectionKey?: string,
): Promise<RewriteSectionResponse> {
  const key = sectionKey?.trim() || sectionKeyOf(sectionTitle);
  return api<RewriteSectionResponse>(
    `/petitions/${id}/sections/${encodeURIComponent(key)}/rewrite`,
    {
      method: "POST",
      body: { instruction: instruction.trim(), ...(piiApproved ? { piiApproved: true } : {}) },
    },
  );
}

/**
 * POST /petitions/:id/verify yanıtı.
 *
 * API SÖZLEŞMESİ: `{ petitionId, versionId, results, summary, readyGate }`.
 * Satır alanı `raw`dır (`rawCitation` değil).
 */
export interface VerifyResult {
  petitionId?: string;
  versionId?: string;
  results?: Array<{
    raw: string;
    kind?: string;
    status: CitationCheckItem["status"];
    isDemo?: boolean;
    note?: string;
  }>;
  summary?: {
    total: number;
    verified: number;
    notFound: number;
    ambiguous: number;
    overall: "PASSED" | "PARTIAL" | "FAILED";
  };
  readyGate?: ReadyGate;
}

export function verifyPetition(id: string): Promise<VerifyResult> {
  return api<VerifyResult>(`/petitions/${id}/verify`, { method: "POST", body: {} });
}

/**
 * Teyit satırlarını arayüz tipine çevirir.
 *
 * [KRİTİK DÜZELTME] Eskiden `res.checks ?? res.citationChecks ?? res.citations`
 * okunuyordu; API `results` döndürdüğü için liste DAİMA boş kalıyor ve sayfa
 * "Teyit tamam: 0 atıfın tamamı doğrulandı" YEŞİL bildirimi basıyordu — oysa
 * BULUNAMADI/BELİRSİZ atıflar olabiliyordu. Ürünün en kritik güven göstergesi
 * kullanıcıyı yanlış yönlendiriyordu.
 */
export function verifyChecks(res: VerifyResult | null | undefined): CitationCheckItem[] {
  if (!res || !Array.isArray(res.results)) return [];
  return res.results.map((r) => ({
    rawCitation: r.raw,
    status: r.status,
    kind: r.kind ?? null,
    isDemo: r.isDemo,
    note: r.note ?? null,
  }));
}

/** Dilekçe detayındaki teyit satırları (API alanı `verification`). */
export function detailChecks(detail: PetitionDetail | null | undefined): CitationCheckItem[] {
  if (!detail) return [];
  const raw = detail.verification ?? detail.citationChecks ?? [];
  return (raw as unknown as Array<Record<string, unknown>>).map((r) => ({
    rawCitation: String(r.rawCitation ?? r.raw ?? "Atıf"),
    status: (r.status as CitationCheckItem["status"]) ?? "BELIRSIZ",
    kind: typeof r.kind === "string" ? r.kind : null,
    isDemo: Boolean(r.isDemo),
    note: typeof r.note === "string" ? r.note : null,
  }));
}

/** UDF dışa aktarım — imzalı URL ya da üretilen Document döner. */
export async function exportPetitionUdf(
  id: string,
  confirmedStatuteCitations?: string[],
): Promise<string> {
  // Dışa aktarımda teyit kapısı BİR KEZ DAHA çalışır (savunma derinliği);
  // mevzuat beyanı varsa burada da bildirilir.
  const res = await api<unknown>(`/petitions/${id}/export/udf`, {
    method: "POST",
    body: confirmedStatuteCitations?.length ? { confirmedStatuteCitations } : {},
  });
  const url = firstUrl(res);
  if (url) return url;
  if (res && typeof res === "object") {
    const docId = (res as Record<string, unknown>).documentId ?? (res as Record<string, unknown>).id;
    if (typeof docId === "string") return documentDownloadUrl(docId);
  }
  throw new ApiError("Dışa aktarma bağlantısı alınamadı.", 500, res);
}

/** Sürüm/şablon bölümlerini tek biçime indirger. */
export function sectionsOf(
  src:
    | PetitionVersionItem
    | PetitionTemplateItem
    | { sections?: unknown; sectionsJson?: unknown }
    | null
    | undefined,
): PetitionSection[] {
  if (!src) return [];
  const obj = src as Record<string, unknown>;
  const raw = Array.isArray(obj.sections)
    ? obj.sections
    : Array.isArray(obj.sectionsJson)
      ? obj.sectionsJson
      : [];
  return (raw as Array<Record<string, unknown>>).map((s) => ({
    title: String(s.title ?? s.key ?? "BÖLÜM"),
    body: String(s.body ?? s.content ?? s.text ?? ""),
    hint: typeof s.hint === "string" ? s.hint : null,
    required: Boolean(s.required),
  }));
}

export function sectionBody(s: PetitionSection): string {
  return s.body ?? s.content ?? s.text ?? "";
}

// -------------------------------------------------------------------- içtihat

export interface CaseLawSearchInput {
  query: string;
  mode?: "CLASSIC" | "AI";
  court?: string;
  caseId?: string;
  piiApproved?: boolean;
}

export interface CaseLawSearchResult {
  results: CaseLawDoc[];
  note?: string | null;
  mode?: string;
}

export async function searchCaseLaw(input: CaseLawSearchInput): Promise<CaseLawSearchResult> {
  const body: Record<string, unknown> = {
    query: input.query,
    mode: input.mode ?? "CLASSIC",
  };
  if (input.court) body.court = input.court;
  if (input.caseId) body.caseId = input.caseId;
  if (input.piiApproved) body.piiApproved = true;

  const res =
    input.mode === "AI"
      ? // AI aramada model KÜNYE YAZMAZ; yalnız sorguyu genişletir, sonuçlar
        // yerel havuzdan gelir (uydurma emsal savunması, Modül 23).
        await api<unknown>("/caselaw/ai-search", {
          method: "POST",
          body: {
            question: input.query,
            ...(input.caseId ? { caseId: input.caseId } : {}),
            ...(input.piiApproved ? { piiApproved: true } : {}),
          },
        })
      : // Klasik arama DETERMİNİSTİKTİR ve GET'tir.
        await api<unknown>("/caselaw/search", {
          query: { q: input.query, court: input.court || undefined },
        });
  const results = asList<CaseLawDoc>(res);
  const note =
    res && typeof res === "object"
      ? ((res as Record<string, unknown>).note as string | undefined) ?? null
      : null;
  const mode =
    res && typeof res === "object"
      ? ((res as Record<string, unknown>).mode as string | undefined)
      : undefined;
  return { results, note, mode };
}

export function createCaseLaw(body: {
  court: string;
  chamber?: string;
  caseNumber: string;
  decisionNumber: string;
  decisionDate?: string;
  summary?: string;
  fullText?: string;
  sourceUrl?: string;
}): Promise<CaseLawDoc> {
  return api<CaseLawDoc>("/caselaw", { method: "POST", body });
}

export function listCaseLawRefs(caseId: string): Promise<CaseLawRef[]> {
  return api<unknown>(`/cases/${caseId}/caselaw`).then((p) => asList<CaseLawRef>(p));
}

/**
 * Dosyaya emsal bağlar. Bağ DAİMA `ADAY` doğar; `KABUL`e ancak avukatın ayrı
 * kararıyla geçer (yalnız KABUL emsaller dilekçe bağlamına akar).
 */
export function addCaseLawRef(
  caseId: string,
  caseLawId: string,
  relevanceNote?: string,
): Promise<CaseLawRef> {
  const body = { caseLawId, relevanceNote: relevanceNote?.trim() || undefined };
  return api<CaseLawRef>(`/cases/${caseId}/caselaw`, { method: "POST", body });
}

export function updateCaseLawRef(
  _caseId: string,
  refId: string,
  patch: { status?: string; relevanceNote?: string },
): Promise<CaseLawRef> {
  return api<CaseLawRef>(`/caselaw-references/${refId}`, { method: "PATCH", body: patch });
}
