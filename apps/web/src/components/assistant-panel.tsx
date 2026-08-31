"use client";

/**
 * Dosya detayı → AI Asistan sekmesi (Modül 24).
 *
 * GET  /assistant/sessions?caseId=  · oturum listesi (sol şerit)
 * GET  /assistant/sessions/:id      · geçmiş (mesajlar + kaynaklar)
 * POST /assistant/chat              · soru → cevap + KAYNAKLAR (409 PII akışı)
 * POST /assistant/analyze/:caseId   · Tam Dosya Analizi
 * POST /assistant/notes             · Akıllı Not Öner
 * POST /caselaw/verify              · Teyit Ajanı (deterministik, LLM YOK)
 *
 * KAYNAK GÖSTERME İLKESİ — İKİ AYRI KÜME:
 *  1. DOĞRULANMIŞ kaynaklar (`verified: true`): erişilen belge parçalarına,
 *     safahata veya süre kaydına karşı denetlenmiş referanslar. "KAYNAKLAR"
 *     başlığı altında bunlar gösterilir.
 *  2. TEYİT EDİLMEMİŞ atıflar (`verified: false`, kind = CASELAW/STATUTE):
 *     modelin metninden çıkarılmış HAM künyeler. Bunlar kaynak DEĞİLDİR;
 *     ayrı bir blokta kırmızı "TEYİT EDİLMEDİ" rozetiyle ve tek tıkla Teyit
 *     Ajanı'na gönderilebilen bir düğmeyle sunulur.
 *
 * Kaynaksız cevap açıkça "kaynak gösterilmedi" uyarısıyla işaretlenir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  analyzeCase,
  chatText,
  citationsOf,
  decideSmartNote,
  errText,
  extractPii,
  isFeatureMissing,
  isVerifiedCitation,
  listChatMessages,
  listChatSessions,
  listSmartNotes,
  sendAssistantChat,
  suggestSmartNotes,
  verifyCitations,
  type PiiPrompt,
} from "@/lib/faz2";
import type {
  AnalysisReport,
  ChatSessionInfo,
  Citation,
  CitationCheckItem,
  SmartNoteItem,
} from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Spinner, Textarea } from "@/components/ui";
import {
  AiDisclaimer,
  FeatureUnavailable,
  PiiApprovalBox,
} from "@/components/ai-ui";
import {
  CITATION_STATUS_LABELS,
  CITATION_STATUS_TONES,
  NOTE_KIND_LABELS,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";

interface Bubble {
  role: "user" | "assistant";
  text: string;
  model?: string | null;
  citations?: Citation[];
  degraded?: boolean;
  warnings?: string[];
}

/** Bekleyen bir KVKK onayının hangi eylemi tetikleyeceği. */
type PendingAction =
  | { kind: "chat"; message: string }
  | { kind: "analyze" }
  | { kind: "notes" };

export function AssistantPanel({
  caseId,
  caseTitle,
  focusDocumentId,
}: {
  caseId: string;
  caseTitle: string;
  focusDocumentId?: string | null;
}) {
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pii, setPii] = useState<{ prompt: PiiPrompt; action: PendingAction } | null>(null);

  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notes, setNotes] = useState<SmartNoteItem[]>([]);
  const [notesBusy, setNotesBusy] = useState(false);
  const [sideError, setSideError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);

  // Oturum listesi
  const loadSessions = useCallback(async () => {
    try {
      const list = await listChatSessions(caseId);
      setSessions(list);
      setMissing(false);
      return list;
    } catch (err) {
      if (isFeatureMissing(err)) {
        // /assistant/sessions yoksa oturumsuz (tek akış) çalışılır — sohbet
        // /ai/chat üzerinden yine de mümkün olabilir.
        setSessions([]);
      } else {
        setError(errText(err, "Oturumlar yüklenemedi."));
      }
      return [];
    }
  }, [caseId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pii, busy]);

  // Var olan mevcut notlar
  useEffect(() => {
    listSmartNotes(caseId)
      .then(setNotes)
      .catch(() => {
        /* uç yoksa boş kalır */
      });
  }, [caseId]);

  async function openSession(id: string) {
    setSessionId(id);
    setMessages([]);
    setError(null);
    setBusy(true);
    try {
      const history = await listChatMessages(id);
      setMessages(
        history
          .filter((m) => String(m.role).toUpperCase() !== "SYSTEM")
          .map((m) => ({
            role: String(m.role).toUpperCase() === "USER" ? "user" : "assistant",
            text: m.content,
            model: m.model,
            citations: citationsOf(m),
          })),
      );
    } catch (err) {
      setError(errText(err, "Mesaj geçmişi yüklenemedi."));
    } finally {
      setBusy(false);
    }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
    setPii(null);
    setError(null);
  }

  async function runChat(message: string, piiApproved: boolean) {
    setBusy(true);
    setError(null);
    try {
      // OTURUMU API AÇAR: ilk mesaj `sessionId` olmadan gönderilir, cevaptan
      // gelen kimlik kullanılır. Ayrı bir "oturum aç" ucu bilinçli olarak yok
      // (boş oturum kaydı üretmemek için).
      const sid = sessionId;

      const res = await sendAssistantChat({
        caseId,
        sessionId: sid,
        message,
        piiApproved,
      });
      if (res.sessionId && !sid) {
        setSessionId(res.sessionId);
        void loadSessions();
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: chatText(res),
          model: res.model ?? res.usedModel,
          citations: citationsOf(res),
          degraded: res.degraded,
          warnings: res.warnings,
        },
      ]);
      setPii(null);
    } catch (err) {
      const prompt = extractPii(err);
      if (prompt) {
        setPii({ prompt, action: { kind: "chat", message } });
      } else if (isFeatureMissing(err)) {
        setMissing(true);
      } else {
        setError(errText(err, "AI yanıtı alınamadı."));
      }
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || busy) return;
    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setInput("");
    setPii(null);
    void runChat(msg, false);
  }

  async function runAnalyze(piiApproved: boolean) {
    setAnalyzing(true);
    setSideError(null);
    try {
      const res = await analyzeCase(caseId, piiApproved);
      setReport(res);
      setPii(null);
    } catch (err) {
      const prompt = extractPii(err);
      if (prompt) setPii({ prompt, action: { kind: "analyze" } });
      else setSideError(errText(err, "Dosya analizi üretilemedi."));
    } finally {
      setAnalyzing(false);
    }
  }

  async function runNotes(piiApproved: boolean) {
    setNotesBusy(true);
    setSideError(null);
    try {
      const res = await suggestSmartNotes(caseId, "GENEL", undefined, piiApproved);
      setNotes((prev) => {
        const known = new Set(prev.map((n) => n.id));
        return [...res.filter((n) => !known.has(n.id)), ...prev];
      });
      setPii(null);
    } catch (err) {
      const prompt = extractPii(err);
      if (prompt) setPii({ prompt, action: { kind: "notes" } });
      else setSideError(errText(err, "Akıllı not önerisi alınamadı."));
    } finally {
      setNotesBusy(false);
    }
  }

  function approvePii() {
    if (!pii) return;
    const { action } = pii;
    if (action.kind === "chat") void runChat(action.message, true);
    else if (action.kind === "analyze") void runAnalyze(true);
    else void runNotes(true);
  }

  async function decideNote(note: SmartNoteItem, approved: boolean) {
    try {
      await decideSmartNote(note.id, approved);
      setNotes((prev) =>
        approved
          ? prev.map((n) => (n.id === note.id ? { ...n, isApproved: true } : n))
          : prev.filter((n) => n.id !== note.id),
      );
    } catch (err) {
      setSideError(errText(err, "Not kararı kaydedilemedi."));
    }
  }

  if (missing) {
    return (
      <FeatureUnavailable
        title="AI Dosya Asistanı henüz hazır değil"
        detail="POST /assistant/chat ucu yayına alındığında bu sekmeden dosyanın belgeleri, safahatı ve süreleri üzerinden kaynaklı cevaplar alabileceksiniz."
        onRetry={() => setMissing(false)}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Sol şerit — oturumlar */}
      <aside className="space-y-3">
        <Button variant="gold" size="sm" className="w-full" onClick={newSession}>
          + Yeni Sohbet
        </Button>
        <div className="rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Oturumlar
          </p>
          {sessions.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">
              Henüz oturum yok. İlk sorunuz yeni bir oturum açar.
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void openSession(s.id)}
                    className={`w-full px-3 py-2.5 text-left text-xs transition-colors ${
                      sessionId === s.id
                        ? "bg-amber-50 font-semibold text-slate-900"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="line-clamp-2">{s.title}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {fmtDateTime(s.updatedAt ?? s.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Yan eylemler */}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            AI Eylemleri
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={analyzing}
            onClick={() => void runAnalyze(false)}
          >
            {analyzing ? "Analiz ediliyor…" : "Tam Dosya Analizi"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={notesBusy}
            onClick={() => void runNotes(false)}
          >
            {notesBusy ? "Öneriliyor…" : "Akıllı Not Öner"}
          </Button>
          {sideError && <p className="text-[11px] leading-4 text-red-700">{sideError}</p>}
        </div>
      </aside>

      {/* Sohbet */}
      <div className="space-y-4">
        <AiDisclaimer />

        <Card title="AI Dosya Asistanı">
          <div className="flex h-[30rem] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto rounded-lg bg-slate-50 p-4">
              {messages.length === 0 && !pii && !busy && (
                <div className="text-sm text-slate-500">
                  <p>
                    <strong>{caseTitle}</strong> hakkında soru sorun. Asistan yalnızca bu dosyanın
                    belgelerini, safahatını, taraflarını ve sürelerini kullanır ve her cevabın
                    altında kaynak gösterir.
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-slate-500">
                    <li>• “Bilirkişi raporunun aleyhime olan tespitleri neler?”</li>
                    <li>• “Bu dosyada hangi süreler yaklaşıyor?”</li>
                    <li>• “Karşı tarafın cevap dilekçesindeki zamanaşımı savunmasını özetle.”</li>
                  </ul>
                  {focusDocumentId && (
                    <p className="mt-3 rounded-md bg-white px-3 py-2 text-xs text-slate-600">
                      Belgeler sekmesinden bir belge seçtiniz — sorunuzda o belgeye atıf yapabilirsiniz.
                    </p>
                  )}
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl px-4 py-2.5 text-sm leading-6 ${
                      m.role === "user"
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-white text-slate-800"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>

                    {m.role === "assistant" && (
                      <CitationList citations={m.citations ?? []} caseId={caseId} />
                    )}

                    {m.role === "assistant" && m.warnings && m.warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {m.warnings.map((w, wi) => (
                          <li key={wi} className="text-[11px] text-amber-700">
                            ⚠ {w}
                          </li>
                        ))}
                      </ul>
                    )}

                    {m.role === "assistant" && m.degraded && (
                      <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                        Gömme (embedding) sağlayıcısı yapılandırılmadığı için anahtar kelime
                        aramasıyla yanıtlandı — kapsam sınırlı olabilir.
                      </p>
                    )}

                    {m.role === "assistant" && (
                      <p className="mt-1.5 border-t border-slate-100 pt-1 text-[11px] text-slate-500">
                        {m.model ? `Model: ${m.model} · ` : ""}Bu çıktı bir öneridir.
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {pii && (
                <PiiApprovalBox
                  prompt={pii.prompt}
                  busy={busy || analyzing || notesBusy}
                  onApprove={approvePii}
                  onCancel={() => setPii(null)}
                />
              )}

              {busy && <Spinner label="AI düşünüyor…" />}
              {error && <ErrorBox message={error} />}
              <div ref={endRef} />
            </div>

            <form onSubmit={handleSubmit} className="mt-4 flex items-end gap-3">
              <Textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Dosya hakkında sorunuzu yazın… (Enter ile gönderin)"
                className="flex-1 resize-none"
              />
              <Button type="submit" disabled={busy || !input.trim()}>
                Gönder
              </Button>
            </form>
          </div>
        </Card>

        {report && <AnalysisReportCard report={report} />}

        {notes.length > 0 && (
          <Card title={`Akıllı Notlar (${notes.length})`}>
            <ul className="space-y-3">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-lg border px-4 py-3 ${
                    n.isApproved ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={n.source === "AI" ? "gold" : "gray"}>
                      {n.source === "AI" ? "AI önerisi" : "Manuel"}
                    </Badge>
                    <Badge tone="navy">{labelOf(NOTE_KIND_LABELS, n.kind)}</Badge>
                    {n.isApproved && <Badge tone="green">Onaylandı</Badge>}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                    {n.content}
                  </p>
                  {!n.isApproved && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="gold" onClick={() => void decideNote(n, true)}>
                        Nota Dönüştür
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void decideNote(n, false)}>
                        Yoksay
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function citationLabel(c: Citation, index: number): string {
  return (
    c.label ??
    c.sourceLabel ??
    c.documentName ??
    `Belge parçası ${c.chunkIndex ?? c.index ?? index + 1}`
  );
}

/**
 * Cevabın altındaki kaynak bölümü.
 *
 * DOĞRULANMIŞ referanslar "KAYNAKLAR" başlığı altında; teyit edilmemiş
 * içtihat/mevzuat künyeleri AYRI ve kırmızı bir blokta gösterilir. Bu ayrım
 * ürünün "uydurma atıf yasağı" vaadinin kullanıcıya görünen yüzüdür: modelin
 * uydurduğu bir künye ASLA kaynak gibi sunulmaz.
 */
function CitationList({ citations, caseId }: { citations: Citation[]; caseId: string }) {
  const verified = citations.filter((c) => isVerifiedCitation(c));
  const unverified = citations.filter((c) => !isVerifiedCitation(c));

  return (
    <>
      {verified.length === 0 ? (
        <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
          Doğrulanmış kaynak gösterilmedi. Kaynaksız iddialar doğrulanmadan
          kullanılmamalıdır.
        </p>
      ) : (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Kaynaklar (doğrulandı)
          </p>
          <ol className="mt-1.5 space-y-1.5">
            {verified.map((c, i) => {
              const label = citationLabel(c, i);
              const quote = c.quote ?? c.snippet ?? c.text ?? null;
              const documentId = c.documentId ?? c.refId ?? null;
              const inner = (
                <>
                  <span className="font-medium">
                    [{i + 1}] {label}
                  </span>
                  {c.page ? <span className="text-slate-500"> · s.{c.page}</span> : null}
                  {quote && (
                    <span className="mt-0.5 block italic text-slate-500">
                      “{quote.length > 220 ? `${quote.slice(0, 220)}…` : quote}”
                    </span>
                  )}
                </>
              );
              return (
                <li key={c.id ?? `v${i}`} className="text-[11px] leading-5">
                  {documentId ? (
                    <Link
                      href={`/app/dosyalar/${caseId}?sekme=belgeler&belge=${documentId}`}
                      className="block rounded px-1 py-0.5 text-slate-600 hover:bg-amber-50 hover:text-amber-700"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <span className="block px-1 py-0.5 text-slate-600">{inner}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {unverified.length > 0 && <UnverifiedCitations citations={unverified} />}
    </>
  );
}

/**
 * TEYİT EDİLMEMİŞ ATIFLAR.
 *
 * Bu künyeler modelin METNİNDEN çıkarılmıştır; sistemde var olup olmadıkları
 * BİLİNMEZ. Tek tıkla Teyit Ajanı'na (deterministik, LLM YOK) gönderilir.
 */
function UnverifiedCitations({ citations }: { citations: Citation[] }) {
  const [checks, setChecks] = useState<CitationCheckItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const raws = citations
    .map((c) => c.label ?? c.sourceLabel ?? c.text ?? "")
    .map((v) => v.trim())
    .filter(Boolean);

  async function runVerify() {
    setBusy(true);
    setError(null);
    try {
      const res = await verifyCitations(raws, { sourceType: "CHAT" });
      setChecks(
        res.results.map((r) => ({
          rawCitation: r.raw,
          status: r.status,
          kind: r.kind,
          isDemo: r.isDemo,
          note: r.note ?? null,
        })),
      );
    } catch (err) {
      setError(errText(err, "Teyit çalıştırılamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
          Teyit edilmemiş atıflar ({citations.length})
        </p>
        {raws.length > 0 && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runVerify()}>
            {busy ? "Teyit ediliyor…" : "Teyit Ajanı'na gönder"}
          </Button>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-5 text-red-800">
        Aşağıdaki içtihat/mevzuat künyeleri modelin METNİNDEN çıkarılmıştır ve
        <strong> doğrulanmamıştır</strong>. Kaynak olarak kullanmadan önce teyit edin —
        uydurma künye olabilir.
      </p>
      <ul className="mt-2 space-y-1">
        {citations.map((c, i) => {
          const raw = (c.label ?? c.sourceLabel ?? c.text ?? "Atıf").trim();
          const check = checks?.find((x) => x.rawCitation.trim() === raw);
          return (
            <li key={c.id ?? `u${i}`} className="flex flex-wrap items-start gap-2 text-[11px] leading-5">
              <Badge tone={check ? (CITATION_STATUS_TONES[check.status] ?? "red") : "red"}>
                {check ? labelOf(CITATION_STATUS_LABELS, check.status) : "TEYİT EDİLMEDİ"}
              </Badge>
              <span className="font-medium text-red-900">{raw}</span>
              {check?.note && <span className="w-full text-red-800">{check.note}</span>}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-[11px] text-red-800">{error}</p>}
    </div>
  );
}

/** Tam Dosya Analizi raporu — serbest JSON'u okunabilir bölümlere döker. */
function AnalysisReportCard({ report }: { report: AnalysisReport }) {
  const content = report.contentJson ?? report.content ?? {};
  const entries = Object.entries(content).filter(([, v]) => v !== null && v !== undefined);

  return (
    <Card
      title="Tam Dosya Analizi"
      action={
        <span className="text-[11px] text-slate-500">
          {report.model ? `${report.model} · ` : ""}
          {fmtDateTime(report.createdAt)}
        </span>
      }
    >
      <AiDisclaimer text="Analiz raporu değiştirilemez (immutable) bir öneridir; dosya değiştikçe yeni rapor üretilir." />
      {entries.length === 0 ? (
        <EmptyState message="Rapor içeriği boş döndü." />
      ) : (
        <dl className="mt-4 space-y-4">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {humanizeKey(key)}
              </dt>
              <dd className="mt-1 text-sm leading-6 text-slate-700">{renderValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

const REPORT_KEY_LABELS: Record<string, string> = {
  summary: "Özet",
  ozet: "Özet",
  strengths: "Güçlü Yanlar",
  weaknesses: "Zayıf Yanlar",
  risks: "Riskler",
  riskler: "Riskler",
  opportunities: "Fırsatlar",
  nextSteps: "Sonraki Adımlar",
  recommendations: "Öneriler",
  timeline: "Kritik Tarihler",
  parties: "Taraflar",
  citations: "Kaynaklar",
  deadlines: "Süreler",
};

function humanizeKey(key: string): string {
  if (REPORT_KEY_LABELS[key]) return REPORT_KEY_LABELS[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function renderValue(value: unknown): React.ReactNode {
  if (typeof value === "string") return <p className="whitespace-pre-wrap">{value}</p>;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {value.map((v, i) => (
          <li key={i}>{typeof v === "string" ? v : renderValue(v)}</li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    return (
      <ul className="space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <li key={k}>
            <span className="text-xs font-medium text-slate-500">{humanizeKey(k)}: </span>
            {typeof v === "string" ? v : renderValue(v)}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}
