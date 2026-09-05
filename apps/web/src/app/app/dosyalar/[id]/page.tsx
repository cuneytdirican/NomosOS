"use client";

/**
 * Dosya detayı — Faz 1 tam sürüm.
 *
 * GET    /cases/:id                 — dosya detayı
 * PATCH  /cases/:id                 — künye güncelleme
 * PATCH  /cases/:id/status          — durum geçişi (safahat kaydı yazar)
 * GET/POST /cases/:id/notes         — notlar · DELETE /notes/:id · PATCH /notes/:id (sabitleme)
 * GET/POST /cases/:id/decisions     — kararlar
 * POST   /cases/:id/timeline        — manuel safahat kaydı
 * POST/PATCH/DELETE /hearings       — duruşmalar · PATCH /hearings/:id/result
 * /deadlines/compute + /deadlines/from-rule + /deadlines/:id/status  — süreler
 * GET /tasks/:id, PATCH /tasks/:id/status — görevler
 *
 * Faz 2 sekmeleri:
 * Belgeler   → POST/GET /documents, /documents/:id/pipeline (DocumentsTab)
 * Öneriler   → GET /proposals?caseId=  (ProposalCard)
 * Dilekçeler → /cases/:id/petitions    (PetitionsTab)
 * AI Asistan → POST /assistant/chat + /analyze + /notes (AssistantPanel)
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList, SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import {
  approveProposal,
  type ApproveProposalBody,
  errText,
  listCaseLawRefs,
  listProposalsPaged,
  rejectProposal,
} from "@/lib/faz2";
import type {
  ActionProposal,
  CaseDecision,
  CaseDetail,
  CaseLawRef,
  CaseNote,
  Deadline,
  DocumentItem,
  Hearing,
  Task,
  TimelineEvent,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Switch,
  Spinner,
  TruncationNotice,
  Tabs,
  tabPanelProps,
  Textarea,
} from "@/components/ui";
import { ComputeNote } from "@/components/compute-note";
import { DeadlineWizard } from "@/components/deadline-wizard";
import { HearingFormModal, HearingResultModal } from "@/components/hearing-modal";
import { TaskDetailModal } from "@/components/task-detail-modal";
import { TaskProgress } from "@/components/task-progress";
import { AssistantPanel } from "@/components/assistant-panel";
import { DocumentsTab } from "@/components/documents-tab";
import { PetitionsTab } from "@/components/petitions-tab";
import { ExpensesTab } from "../../_components/expenses-tab";
import { ProposalCard } from "@/components/proposal-card";
import { ToastStack, useToasts } from "@/components/ai-ui";
// ---- Faz 5: dosya bağlamında iletişim ve sözleşmeler ----
import { CommScopeTab } from "../../_components/comm-scope-tab";
import { ContractsTab } from "../../_components/contracts-tab";
import { EvidenceTab } from "../../_components/evidence-tab";
import { ExpertTab } from "../../_components/expert-tab";
import { RiskTab } from "../../_components/risk-tab";
import { SimulationTab } from "../../_components/simulation-tab";
import { StrategyTab } from "../../_components/strategy-tab";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  CASE_TYPE_LABELS,
  DEADLINE_SOURCE_LABELS,
  DEADLINE_SOURCE_TONES,
  DEADLINE_STATUS_LABELS,
  DEADLINE_STATUS_TONES,
  DECISION_TYPES,
  DECISION_TYPE_LABELS,
  DECISION_TYPE_TONES,
  HEARING_STATUS_LABELS,
  HEARING_STATUS_TONES,
  HEARING_TYPE_LABELS,
  PARTY_ROLE_LABELS,
  PROPOSAL_APPLIED_MESSAGES,
  PROPOSAL_TYPE_LABELS,
  REF_STATUS_LABELS,
  REF_STATUS_TONES,
  SERVICE_METHOD_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
  daysUntil,
  fmtDate,
  fmtDateTime,
  isDemoCaseLaw,
  labelOf,
  remainingLabel,
  toIsoDate,
  urgencyRowClass,
  urgencyTone,
} from "@/lib/labels";
import { CASE_STATUSES, COURT_TYPES, PARTY_ROLES, type CaseStatus, type PartyRole } from "@nomosos/shared";
import { RemoteSelect } from "@/components/remote-select";

const TABS = [
  { key: "ozet", label: "Özet" },
  { key: "safahat", label: "Safahat" },
  { key: "durusmalar", label: "Duruşmalar" },
  { key: "sureler", label: "Süreler" },
  { key: "kararlar", label: "Kararlar" },
  { key: "notlar", label: "Notlar" },
  { key: "gorevler", label: "Görevler" },
  { key: "belgeler", label: "Belgeler" },
  { key: "deliller", label: "Deliller" },
  { key: "bilirkisi", label: "Bilirkişi" },
  { key: "strateji", label: "Strateji" },
  { key: "risk", label: "Risk" },
  { key: "simulasyon", label: "Simülasyon" },
  { key: "oneriler", label: "Öneriler" },
  { key: "dilekceler", label: "Dilekçeler" },
  // ---- Faz 5 ----
  { key: "iletisim", label: "İletişim" },
  { key: "sozlesmeler", label: "Sözleşmeler" },
  { key: "ai", label: "AI Asistan" },
  // ---- Dalga 2 ----
  { key: "giderler", label: "Giderler" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TAB_KEYS = TABS.map((t) => t.key) as readonly string[];

export default function DosyaDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [decisions, setDecisions] = useState<CaseDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("ozet");
  const [actionError, setActionError] = useState<string | null>(null);

  // Modallar
  const [wizardOpen, setWizardOpen] = useState(false);
  const [hearingFormOpen, setHearingFormOpen] = useState(false);
  const [editingHearing, setEditingHearing] = useState<Hearing | null>(null);
  const [resultHearing, setResultHearing] = useState<Hearing | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskFallback, setTaskFallback] = useState<Task | null>(null);

  // Faz 2 durumu
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [proposalsTruncated, setProposalsTruncated] = useState(false);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [caseLawRefs, setCaseLawRefs] = useState<CaseLawRef[]>([]);
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();

  /**
   * Derin bağlantı desteği: `?sekme=belgeler&belge=<id>`.
   * `useSearchParams` yerine window kullanılır — sayfa istemci bileşeni olduğu
   * için ek Suspense sınırı gerektirmesin.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const wanted = sp.get("sekme");
    if (wanted && TAB_KEYS.includes(wanted)) setTab(wanted as TabKey);
    const doc = sp.get("belge");
    if (doc) setFocusDocumentId(doc);
  }, []);

  const loadProposals = useCallback(async () => {
    try {
      // Zarf okunur; kırpma olursa ekranda uyarı çıkar (denetim bulgusu K-15).
      const res = await listProposalsPaged({
        caseId: id,
        status: "BEKLIYOR",
        limit: SERVER_MAX_PAGE_SIZE,
      });
      setProposals(res.items);
      setProposalsTruncated(res.hasMore || res.truncated);
    } catch {
      setProposals([]);
      setProposalsTruncated(false);
    }
  }, [id]);

  useEffect(() => {
    void loadProposals();
    listCaseLawRefs(id)
      .then(setCaseLawRefs)
      .catch(() => setCaseLawRefs([]));
  }, [id, loadProposals]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<CaseDetail>(`/cases/${id}`);
      setDetail(data);

      // Notlar ve kararlar ayrı uçlardan gelir; detayda gömülü geldiyse onu kullan.
      const [notesRes, decisionsRes] = await Promise.allSettled([
        api<unknown>(`/cases/${id}/notes`),
        api<unknown>(`/cases/${id}/decisions`),
      ]);
      setNotes(
        notesRes.status === "fulfilled" ? asList<CaseNote>(notesRes.value) : (data.notes ?? []),
      );
      setDecisions(
        decisionsRes.status === "fulfilled"
          ? asList<CaseDecision>(decisionsRes.value)
          : (data.decisions ?? []),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dosya yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApproveProposal(p: ActionProposal, body: ApproveProposalBody) {
    setProposalBusyId(p.id);
    try {
      await approveProposal(p.id, body);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
      push(
        PROPOSAL_APPLIED_MESSAGES[p.type] ??
          `${labelOf(PROPOSAL_TYPE_LABELS, p.type)} önerisi uygulandı.`,
        "success",
      );
      window.dispatchEvent(new Event("nomosos:proposals-changed"));
      await load();
    } catch (err) {
      push(errText(err, "Öneri onaylanamadı."), "error");
    } finally {
      setProposalBusyId(null);
    }
  }

  async function handleRejectProposal(p: ActionProposal, reason: string) {
    setProposalBusyId(p.id);
    try {
      await rejectProposal(p.id, reason);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
      push("Öneri reddedildi. Gerekçe denetim kaydına işlendi.", "info");
      window.dispatchEvent(new Event("nomosos:proposals-changed"));
    } catch (err) {
      push(errText(err, "Öneri reddedilemedi."), "error");
    } finally {
      setProposalBusyId(null);
    }
  }

  async function changeDeadlineStatus(d: Deadline, status: string) {
    setActionError(null);
    try {
      await api(`/deadlines/${d.id}/status`, { method: "PATCH", body: { status } });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Süre durumu güncellenemedi.");
    }
  }

  async function deleteHearing(h: Hearing) {
    if (!window.confirm("Duruşma kaydı silinsin mi?")) return;
    setActionError(null);
    try {
      await api(`/hearings/${h.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Duruşma silinemedi.");
    }
  }

  const parties = useMemo(() => detail?.parties ?? [], [detail]);
  // D8 — taraf ekleme diyaloğu: müvekkil tarafı KATALOGDAN seçilir.
  const [partyModalOpen, setPartyModalOpen] = useState(false);
  const [partyRole, setPartyRole] = useState<PartyRole>("DAVACI");
  const [partyIsClient, setPartyIsClient] = useState(false);
  const [partyClientId, setPartyClientId] = useState("");
  const [partyClientLabel, setPartyClientLabel] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyLawyer, setPartyLawyer] = useState("");
  const [partyBusy, setPartyBusy] = useState(false);
  const [partyError, setPartyError] = useState<string | null>(null);

  function closePartyModal() {
    setPartyModalOpen(false);
    setPartyRole("DAVACI");
    setPartyIsClient(false);
    setPartyClientId("");
    setPartyClientLabel("");
    setPartyName("");
    setPartyLawyer("");
    setPartyError(null);
  }

  async function addParty() {
    if (!detail) return;
    setPartyBusy(true);
    setPartyError(null);
    try {
      await api(`/cases/${detail.id}/parties`, {
        method: "POST",
        body: {
          role: partyRole,
          isClient: partyIsClient,
          // Müvekkil taraf: ad SUNUCUDA karttan doldurulur (elle yazılmaz);
          // karşı taraf: serbest ad.
          name: partyIsClient ? partyClientLabel || "-" : partyName.trim(),
          clientId: partyIsClient ? partyClientId : null,
          ...(partyLawyer.trim() ? { lawyerName: partyLawyer.trim() } : {}),
        },
      });
      closePartyModal();
      await load();
    } catch (err) {
      setPartyError(err instanceof ApiError ? err.message : "Taraf eklenemedi.");
    } finally {
      setPartyBusy(false);
    }
  }
  const timeline = useMemo(
    () =>
      [...(detail?.timelineEvents ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [detail],
  );
  const hearings = useMemo(
    () => [...(detail?.hearings ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [detail],
  );
  const deadlines = useMemo(
    () => [...(detail?.deadlines ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [detail],
  );
  const tasks = useMemo(() => detail?.tasks ?? [], [detail]);
  const documents = useMemo(() => detail?.documents ?? [], [detail]);
  const pinnedNotes = useMemo(() => notes.filter((n) => n.isPinned), [notes]);

  const nextHearing = useMemo(() => {
    const upcoming = hearings
      .filter((h) => h.status === "PLANLANDI" && new Date(h.date).getTime() >= Date.now())
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ?? null;
  }, [hearings]);

  if (loading) return <Spinner label="Dosya yükleniyor…" />;
  if (error) return <ErrorBox message={error} />;
  if (!detail) return <EmptyState message="Dosya bulunamadı." />;

  const tabsWithCounts = TABS.map((t) => {
    switch (t.key) {
      case "durusmalar":
        return { ...t, count: hearings.length };
      case "sureler":
        return { ...t, count: deadlines.length };
      case "kararlar":
        return { ...t, count: decisions.length };
      case "notlar":
        return { ...t, count: notes.length };
      case "gorevler":
        return { ...t, count: tasks.length };
      case "belgeler":
        return { ...t, count: documents.length };
      case "oneriler":
        return { ...t, count: proposals.length };
      case "safahat":
        return { ...t, count: timeline.length };
      default:
        return t;
    }
  });

  return (
    <div className="space-y-6">
      <Link href="/app/dosyalar" className="text-xs text-slate-500 hover:text-amber-600">
        ← Dosyalar
      </Link>

      {/* Üst bilgi */}
      <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">{detail.title}</h1>
              <Badge tone={CASE_STATUS_TONES[detail.status] ?? "gray"}>
                {labelOf(CASE_STATUS_LABELS, detail.status)}
              </Badge>
              <Badge tone="gold">{labelOf(CASE_TYPE_LABELS, detail.type)}</Badge>
              {detail.isConfidential && (
                <Badge tone="danger">Gizli dosya</Badge>
              )}
              {proposals.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("oneriler")}
                  title="AI önerileri onayınızı bekliyor"
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-900" />
                  {proposals.length} öneri onay bekliyor
                </button>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {detail.client ? (
                <Link
                  href={`/app/muvekkiller/${detail.client.id}`}
                  className="hover:text-amber-400"
                >
                  Müvekkil: {detail.client.name}
                </Link>
              ) : null}
              {detail.courtName ? ` · ${detail.courtName}` : ""}
              {detail.fileNumber ? ` · Esas: ${detail.fileNumber}` : ""}
              {detail.judgeName ? ` · Hakim: ${detail.judgeName}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="gold" onClick={() => setStatusOpen(true)}>
                Durum Değiştir
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
                Künyeyi Düzenle
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditingHearing(null);
                  setHearingFormOpen(true);
                }}
              >
                + Duruşma
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setWizardOpen(true)}>
                + Kuraldan Süre
              </Button>
            </div>
          </div>
          <div className="space-y-1 text-right text-xs text-slate-500">
            <p>Açılış: {fmtDate(detail.openedAt)}</p>
            {detail.responsibleUser?.fullName && <p>Sorumlu: {detail.responsibleUser.fullName}</p>}
            {(nextHearing?.date ?? detail.nextHearingAt) && (
              <p className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300">
                Sıradaki duruşma: {fmtDateTime(nextHearing?.date ?? detail.nextHearingAt)}
              </p>
            )}
            {detail.lastActivityAt && <p>Son hareket: {fmtDate(detail.lastActivityAt)}</p>}
          </div>
        </div>
      </div>

      {actionError && <ErrorBox message={actionError} />}

      <ConfidentialityCard detail={detail} onChanged={() => void load()} />
      {/* Faz 1: vekaletname yeterliliği dosya ekranında (Gereksinim 13) */}
      <PoaStatusCard caseId={detail.id} />

      <Tabs tabs={tabsWithCounts} active={tab} onChange={setTab} ariaLabel="Dosya sekmeleri" idPrefix="dosya" />

      {/* F2-Ö-25: sekme paneli WCAG 4.1.2 — role="tabpanel" + aria-labelledby. */}
      <div {...tabPanelProps("dosya", tab)} className="mt-6">

      {/* ---------- Özet ---------- */}
      {tab === "ozet" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Taraflar"
            action={
              <button
                type="button"
                onClick={() => setPartyModalOpen(true)}
                className="text-xs font-medium text-amber-600 hover:text-amber-500"
              >
                + Taraf Ekle
              </button>
            }
          >
            {parties.length === 0 ? (
              <EmptyState message="Taraf kaydı yok." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {parties.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {p.clientId ? (
                          <Link href={`/app/muvekkiller/${p.clientId}`} className="hover:underline">
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                        {p.isClient && (
                          <Badge tone="gold" className="ml-2">
                            Müvekkilimiz
                          </Badge>
                        )}
                      </p>
                      {p.lawyerName && (
                        <p className="mt-0.5 text-xs text-slate-500">Vekili: {p.lawyerName}</p>
                      )}
                    </div>
                    <Badge tone="navy">{labelOf(PARTY_ROLE_LABELS, p.role)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Son Safahat"
            action={
              <button
                type="button"
                onClick={() => setTab("safahat")}
                className="text-xs font-medium text-amber-600 hover:text-amber-500"
              >
                Tümü →
              </button>
            }
          >
            {timeline.length === 0 ? (
              <EmptyState message="Safahat kaydı yok." />
            ) : (
              <TimelineList events={timeline.slice(0, 6)} />
            )}
          </Card>

          {pinnedNotes.length > 0 && (
            <Card title="Sabitlenmiş Notlar" className="lg:col-span-2">
              <ul className="space-y-2">
                {pinnedNotes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  >
                    <p className="whitespace-pre-wrap">{n.content}</p>
                    <p className="mt-1 text-[11px] text-amber-700">
                      {n.user?.fullName ?? "—"} · {fmtDate(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {caseLawRefs.length > 0 && (
            <Card
              title={`Emsal Kararlar (${caseLawRefs.length})`}
              className="lg:col-span-2"
              action={
                <Link
                  href="/app/ictihat"
                  className="text-xs font-medium text-amber-600 hover:text-amber-500"
                >
                  İçtihat araştır →
                </Link>
              }
            >
              <ul className="space-y-2">
                {caseLawRefs.map((r) => {
                  const doc = r.caseLaw;
                  const demo = doc ? isDemoCaseLaw(doc) : false;
                  return (
                    <li key={r.id} className="rounded-lg border border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {doc
                              ? `${doc.court}${doc.chamber ? ` ${doc.chamber}` : ""} · E. ${doc.caseNumber} · K. ${doc.decisionNumber}`
                              : "Emsal karar"}
                          </p>
                          {doc?.summary && (
                            <p className="mt-1 text-xs leading-5 text-slate-600">{doc.summary}</p>
                          )}
                          {r.relevanceNote && (
                            <p className="mt-1 text-xs text-slate-500">
                              <strong>İlgi:</strong> {r.relevanceNote}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={REF_STATUS_TONES[r.status] ?? "gray"}>
                            {labelOf(REF_STATUS_LABELS, r.status)}
                          </Badge>
                          {demo && <Badge tone="yellow">DEMO VERİ</Badge>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {detail.subject && (
            <Card title="Dosya Konusu" className="lg:col-span-2">
              <p className="text-sm leading-6 text-slate-600">{detail.subject}</p>
            </Card>
          )}
        </div>
      )}

      {/* ---------- Safahat ---------- */}
      {tab === "safahat" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Safahat" className="lg:col-span-2">
            {timeline.length === 0 ? (
              <EmptyState message="Safahat kaydı yok. İlk kaydı sağdaki formdan ekleyin." />
            ) : (
              <TimelineList events={timeline} />
            )}
          </Card>
          <TimelineForm caseId={id} onSaved={load} />
        </div>
      )}

      {/* ---------- Duruşmalar ---------- */}
      {tab === "durusmalar" && (
        <Card
          title="Duruşmalar"
          action={
            <Button
              size="sm"
              variant="gold"
              onClick={() => {
                setEditingHearing(null);
                setHearingFormOpen(true);
              }}
            >
              + Duruşma Ekle
            </Button>
          }
        >
          {hearings.length === 0 ? (
            <EmptyState message="Bu dosyada duruşma kaydı yok." />
          ) : (
            <ul className="space-y-3">
              {hearings.map((h) => (
                <li key={h.id} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{fmtDateTime(h.date)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {labelOf(HEARING_TYPE_LABELS, h.type)}
                        {h.courtroom ? ` · Salon ${h.courtroom}` : ""}
                      </p>
                      {h.prepSummary && (
                        <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                          Hazırlık: {h.prepSummary}
                        </p>
                      )}
                      {h.note && <p className="mt-1 text-xs text-slate-600">{h.note}</p>}
                    </div>
                    <Badge tone={HEARING_STATUS_TONES[h.status ?? ""] ?? "blue"}>
                      {labelOf(HEARING_STATUS_LABELS, h.status)}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setResultHearing(h)}>
                      Sonuç Gir
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingHearing(h);
                        setHearingFormOpen(true);
                      }}
                    >
                      Düzenle
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteHearing(h)}>
                      Sil
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---------- Süreler ---------- */}
      {tab === "sureler" && (
        <Card
          title="Süreler"
          action={
            <Button size="sm" variant="gold" onClick={() => setWizardOpen(true)}>
              + Kuraldan Süre Oluştur
            </Button>
          }
        >
          {deadlines.length === 0 ? (
            <EmptyState message="Bu dosyada süre kaydı yok. Kuraldan süre oluşturarak hesap izini görebilirsiniz." />
          ) : (
            <ul className="space-y-3">
              {deadlines.map((d) => {
                const days = daysUntil(d.dueDate);
                const closed = d.status === "TAMAMLANDI" || d.status === "IPTAL";
                return (
                  <li
                    key={d.id}
                    className={`rounded-lg border border-slate-200 px-4 py-3 ${
                      closed ? "opacity-60" : urgencyRowClass(days)
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{d.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Son gün: <strong className="text-slate-700">{fmtDate(d.dueDate)}</strong>
                        </p>
                        {d.legalBasis && (
                          <p className="mt-0.5 text-xs text-slate-500">Dayanak: {d.legalBasis}</p>
                        )}
                        {(d.triggerDate || d.serviceMethod) && (
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {d.triggerDate ? `Tetik: ${fmtDate(d.triggerDate)}` : ""}
                            {d.serviceMethod
                              ? ` · ${labelOf(SERVICE_METHOD_LABELS, d.serviceMethod)}`
                              : ""}
                          </p>
                        )}
                        <ComputeNote note={d.computeNote} />
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {d.status && (
                          <Badge tone={DEADLINE_STATUS_TONES[d.status] ?? "gray"}>
                            {labelOf(DEADLINE_STATUS_LABELS, d.status)}
                          </Badge>
                        )}
                        {d.source && (
                          <Badge tone={DEADLINE_SOURCE_TONES[d.source] ?? "gray"}>
                            {labelOf(DEADLINE_SOURCE_LABELS, d.source)}
                          </Badge>
                        )}
                        {!closed && <Badge tone={urgencyTone(days)}>{remainingLabel(days)}</Badge>}
                      </div>
                    </div>
                    {!closed && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {d.status === "BEKLIYOR" && (
                          <Button
                            size="sm"
                            variant="gold"
                            onClick={() => void changeDeadlineStatus(d, "ONAYLANDI")}
                          >
                            Onayla
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => void changeDeadlineStatus(d, "TAMAMLANDI")}
                        >
                          Tamamlandı
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void changeDeadlineStatus(d, "IPTAL")}
                        >
                          İptal
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* ---------- Kararlar ---------- */}
      {tab === "kararlar" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Kararlar" className="lg:col-span-2">
            {decisions.length === 0 ? (
              <EmptyState message="Bu dosyada karar kaydı yok." />
            ) : (
              <ul className="space-y-3">
                {[...decisions]
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .map((d) => (
                    <li key={d.id} className="rounded-lg border border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{d.summary}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {fmtDate(d.date)}
                            {d.outcome ? ` · Sonuç: ${d.outcome}` : ""}
                          </p>
                        </div>
                        <Badge tone={DECISION_TYPE_TONES[d.type] ?? "gray"}>
                          {labelOf(DECISION_TYPE_LABELS, d.type)}
                        </Badge>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
          <DecisionForm caseId={id} onSaved={load} />
        </div>
      )}

      {/* ---------- Notlar ---------- */}
      {tab === "notlar" && (
        <NotesTab caseId={id} notes={notes} onChanged={load} />
      )}

      {/* ---------- Görevler ---------- */}
      {tab === "gorevler" && (
        <Card title="Görevler">
          {tasks.length === 0 ? (
            <EmptyState message="Bu dosyada görev kaydı yok." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <li key={t.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          setTaskFallback(t);
                          setTaskId(t.id);
                        }}
                        className="text-left text-sm font-medium text-slate-900 hover:text-amber-600"
                      >
                        {t.title}
                      </button>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {t.assignee?.fullName ? `Sorumlu: ${t.assignee.fullName}` : "Sorumlu atanmadı"}
                        {t.reviewer?.fullName ? ` · Kontrol: ${t.reviewer.fullName}` : ""}
                        {t.dueDate ? ` · Son tarih: ${fmtDate(t.dueDate)}` : ""}
                      </p>
                    </div>
                    <Badge tone={TASK_STATUS_TONES[t.status] ?? "gray"}>
                      {labelOf(TASK_STATUS_LABELS, t.status)}
                    </Badge>
                  </div>
                  <div className="mt-2">
                    <TaskProgress status={t.status} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---------- Belgeler ---------- */}
      {tab === "belgeler" && (
        <DocumentsTab
          caseId={id}
          fallbackDocuments={documents as DocumentItem[]}
          onChanged={() => {
            void load();
            void loadProposals();
            window.dispatchEvent(new Event("nomosos:proposals-changed"));
          }}
          onNotify={push}
        />
      )}

      {/* ---------- Faz 4: Deliller ---------- */}
      {tab === "deliller" && <EvidenceTab caseId={id} onNotify={push} />}

      {/* ---------- Faz 4: Bilirkişi ---------- */}
      {tab === "bilirkisi" && (
        <ExpertTab
          caseId={id}
          onNotify={push}
          onOpenDeadlineWizard={() => setWizardOpen(true)}
        />
      )}

      {/* ---------- Faz 4: Strateji ---------- */}
      {tab === "strateji" && (
        <StrategyTab caseId={id} onNotify={push} onGoToRisk={() => setTab("risk")} />
      )}

      {/* ---------- Faz 4: Risk ---------- */}
      {tab === "risk" && <RiskTab caseId={id} onNotify={push} />}

      {/* ---------- Faz 4: Simülasyon ---------- */}
      {tab === "simulasyon" && (
        <SimulationTab
          caseId={id}
          documents={documents as DocumentItem[]}
          onNotify={push}
        />
      )}

      {/* ---------- Öneriler (dosya bazında onay kuyruğu) ---------- */}
      {tab === "oneriler" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
            <p className="text-xs leading-5 text-slate-600">
              Bu dosyaya ait belgelerden üretilen AI aksiyonları. Onayladığınızda kayıt sizin
              adınıza oluşur; reddederseniz gerekçe denetim izine yazılır.
            </p>
            <Link
              href="/app/oneriler"
              className="text-xs font-medium text-amber-600 hover:text-amber-500"
            >
              Tüm öneriler →
            </Link>
          </div>
          {/* Sessiz kırpma yasak (denetim bulgusu K-15). */}
          {proposalsTruncated && <TruncationNotice shown={proposals.length} noun="öneri" />}
          {proposals.length === 0 ? (
            <Card>
              <EmptyState message="Bu dosyada onay bekleyen öneri yok. Belgeler sekmesinden bir tebligat veya karar yüklediğinizde hat otomatik olarak öneri üretir." />
            </Card>
          ) : (
            <ul className="space-y-4">
              {proposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  busy={proposalBusyId === p.id}
                  showCase={false}
                  onApprove={handleApproveProposal}
                  onReject={handleRejectProposal}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------- Faz 5: dosyaya ait yazışmalar ---------- */}
      {tab === "iletisim" && (
        <CommScopeTab
          caseId={id}
          clientId={detail.client?.id}
          clients={detail.client ? [{ id: detail.client.id, name: detail.client.name }] : []}
          cases={[
            {
              id,
              title: detail.title,
              fileNumber: detail.fileNumber ?? null,
              status: detail.status ?? null,
            },
          ]}
          onNotify={push}
        />
      )}

      {/* ---------- Faz 5: bu dosyaya bağlı sözleşmeler ---------- */}
      {tab === "sozlesmeler" && (
        <ContractsTab
          caseId={id}
          clientId={detail.client?.id}
          cases={[{ ...detail }]}
          onNotify={push}
        />
      )}

      {/* ---------- Dilekçeler ---------- */}
      {tab === "dilekceler" && <PetitionsTab caseId={id} onNotify={push} />}

      {/* ---------- AI Asistan ---------- */}
      {tab === "ai" && (
        <AssistantPanel
          caseId={id}
          caseTitle={detail.title}
          focusDocumentId={focusDocumentId}
        />
      )}

      {/* ---------- Giderler (D2 A1) ---------- */}
      {tab === "giderler" && <ExpensesTab caseId={id} />}

      {/* ---------- Modallar ---------- */}
      <DeadlineWizard
        open={wizardOpen}
        caseId={id}
        caseType={detail.type}
        onClose={() => setWizardOpen(false)}
        onSaved={load}
      />

      <HearingFormModal
        open={hearingFormOpen}
        hearing={editingHearing}
        caseId={id}
        onClose={() => {
          setHearingFormOpen(false);
          setEditingHearing(null);
        }}
        onSaved={load}
      />

      <HearingResultModal
        open={resultHearing !== null}
        hearing={resultHearing}
        onClose={() => setResultHearing(null)}
        onSaved={load}
      />

      <TaskDetailModal
        open={taskId !== null}
        taskId={taskId}
        fallback={taskFallback}
        onClose={() => {
          setTaskId(null);
          setTaskFallback(null);
        }}
        onChanged={load}
      />

      <CaseStatusModal
        open={statusOpen}
        caseId={id}
        current={detail.status}
        onClose={() => setStatusOpen(false)}
        onSaved={load}
      />

      <CaseEditModal
        open={editOpen}
        detail={detail}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />

      {/* D8 — taraf ekleme: müvekkil tarafı müvekkil kartından SEÇİLİR (ad
          sunucuda karttan doldurulur); karşı taraf serbest metindir. */}
      <Modal
        open={partyModalOpen}
        onClose={closePartyModal}
        title="Taraf Ekle"
      >
        {partyError && <ErrorBox message={partyError} />}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void addParty();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sıfat">
              <Select value={partyRole} onChange={(e) => setPartyRole(e.target.value as PartyRole)}>
                {PARTY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {labelOf(PARTY_ROLE_LABELS, r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vekil (karşı taraf vekili)">
              <Input value={partyLawyer} onChange={(e) => setPartyLawyer(e.target.value)} placeholder="Av. …" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={partyIsClient}
              onChange={(e) => {
                setPartyIsClient(e.target.checked);
                setPartyName("");
                setPartyClientId("");
                setPartyClientLabel("");
              }}
            />
            Bu taraf bizim müvekkilimiz — müvekkil kartından seçilir
          </label>

          {partyIsClient ? (
            <Field
              label="Müvekkil"
              hint="Ad, sunucuda seçilen karttan doldurulur — elle yazılmaz (kayıt kopukluğu önlenir)."
            >
              <RemoteSelect
                path="/clients"
                toOption={(c: { id: string; name: string }) => ({ id: c.id, label: c.name })}
                value={partyClientId}
                selectedLabel={partyClientLabel}
                onChange={(_id, option) => {
                  setPartyClientId(option?.id ?? "");
                  setPartyClientLabel(option?.label ?? "");
                }}
                ariaLabel="Müvekkil ara ve seç"
              />
            </Field>
          ) : (
            <Field label="Taraf adı">
              <Input
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="Örn. Deniz Tekstil A.Ş."
              />
            </Field>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={closePartyModal}>
              Vazgeç
            </Button>
            <Button
              type="submit"
              disabled={partyBusy || (partyIsClient ? !partyClientId : partyName.trim().length < 2)}
            >
              {partyBusy ? "Ekleniyor…" : "Taraf Ekle"}
            </Button>
          </div>
        </form>
      </Modal>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
      {/* /tabpanel F2-Ö-25 */}
    </div>
  );
}

// ---------- Safahat ----------

function TimelineList({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {events.map((ev) => (
        <li key={ev.id} className="relative">
          <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500" />
          <p className="text-xs text-slate-500">
            {fmtDate(ev.date)}
            {ev.source ? ` · ${ev.source}` : ""}
            {ev.user?.fullName ? ` · ${ev.user.fullName}` : ""}
          </p>
          <p className="text-sm font-medium text-slate-900">{ev.title}</p>
          {ev.detail && <p className="mt-0.5 text-xs text-slate-500">{ev.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

function TimelineForm({ caseId, onSaved }: { caseId: string; onSaved: () => Promise<void> | void }) {
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/cases/${caseId}/timeline`, {
        method: "POST",
        body: {
          date: new Date(date).toISOString(),
          title: title.trim(),
          detail: detail.trim() || undefined,
          source: "MANUEL",
        },
      });
      setTitle("");
      setDetail("");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Safahat kaydı eklenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Kayıt Ekle">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Tarih">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Başlık">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Örn. Bilirkişi raporu tebliğ edildi"
            required
          />
        </Field>
        <Field label="Ayrıntı">
          <Textarea rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" disabled={saving || !title.trim()} className="w-full">
          {saving ? "Ekleniyor…" : "Safahata Ekle"}
        </Button>
      </form>
    </Card>
  );
}

// ---------- Kararlar ----------

function DecisionForm({ caseId, onSaved }: { caseId: string; onSaved: () => Promise<void> | void }) {
  const [type, setType] = useState<string>("ARA_KARAR");
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/cases/${caseId}/decisions`, {
        method: "POST",
        body: {
          type,
          date: new Date(date).toISOString(),
          summary: summary.trim(),
          outcome: outcome.trim() || undefined,
        },
      });
      setSummary("");
      setOutcome("");
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Karar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Karar Ekle">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Karar türü">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {DECISION_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelOf(DECISION_TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Karar tarihi">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Özet">
          <Textarea
            rows={4}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Kararın konusu ve hüküm fıkrası özeti"
            required
          />
        </Field>
        <Field label="Sonuç" hint="Örn. Kabul / Kısmen kabul / Red">
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" disabled={saving || !summary.trim()} className="w-full">
          {saving ? "Kaydediliyor…" : "Kararı Kaydet"}
        </Button>
        <p className="text-[11px] leading-5 text-slate-500">
          Karar kaydı süre motorunun tetikleyicisidir; kararı ekledikten sonra Süreler sekmesinden
          ilgili kanun yolu süresini oluşturun.
        </p>
      </form>
    </Card>
  );
}

// ---------- Notlar ----------

function NotesTab({
  caseId,
  notes,
  onChanged,
}: {
  caseId: string;
  notes: CaseNote[];
  onChanged: () => Promise<void> | void;
}) {
  const [content, setContent] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/cases/${caseId}/notes`, {
        method: "POST",
        body: { content: content.trim(), isPinned },
      });
      setContent("");
      setIsPinned(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(n: CaseNote) {
    setError(null);
    try {
      await api(`/notes/${n.id}`, { method: "PATCH", body: { isPinned: !n.isPinned } });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not sabitlenemedi.");
    }
  }

  async function remove(n: CaseNote) {
    if (!window.confirm("Not silinsin mi?")) return;
    setError(null);
    try {
      await api(`/notes/${n.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Not silinemedi.");
    }
  }

  const sorted = [...notes].sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Notlar" className="lg:col-span-2">
        {error && (
          <div className="mb-4">
            <ErrorBox message={error} />
          </div>
        )}
        {sorted.length === 0 ? (
          <EmptyState message="Bu dosyada not yok." />
        ) : (
          <ul className="space-y-3">
            {sorted.map((n) => (
              <li
                key={n.id}
                className={`rounded-lg border px-4 py-3 ${
                  n.isPinned ? "border-amber-300 bg-amber-50" : "border-slate-200"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm text-slate-800">{n.content}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    {n.user?.fullName ?? "—"} · {fmtDateTime(n.createdAt)}
                    {n.isPinned ? " · sabitlendi" : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void togglePin(n)}>
                      {n.isPinned ? "Sabitlemeyi kaldır" : "Sabitle"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(n)}>
                      Sil
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Not Ekle">
        <form onSubmit={add} className="space-y-4">
          <Field label="Not">
            <Textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Dosyaya ilişkin serbest not…"
              required
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
            />
            Dosya başında sabitle
          </label>
          <Button type="submit" disabled={saving || !content.trim()} className="w-full">
            {saving ? "Kaydediliyor…" : "Notu Kaydet"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ---------- Durum ve künye modalları ----------

function CaseStatusModal({
  open,
  caseId,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  caseId: string;
  current: CaseStatus;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<CaseStatus>(current);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(current);
    setNote("");
    setError(null);
  }, [open, current]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/cases/${caseId}/status`, {
        method: "PATCH",
        body: { status, note: note.trim() || undefined },
      });
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dosya durumu güncellenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Dosya Durumunu Değiştir" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Durum değişikliği dosyanın safahat akışına otomatik olarak işlenir.
        </p>
        <Field label="Yeni durum">
          <Select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)}>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelOf(CASE_STATUS_LABELS, s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Açıklama">
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Örn. Gerekçeli karar tebliğ edildi, istinaf aşamasına geçildi."
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="gold" disabled={saving || status === current}>
            {saving ? "Kaydediliyor…" : "Durumu Güncelle"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CaseEditModal({
  open,
  detail,
  onClose,
  onSaved,
}: {
  open: boolean;
  detail: CaseDetail;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState({
    title: detail.title,
    courtName: detail.courtName ?? "",
    fileNumber: detail.fileNumber ?? "",
    judgeName: detail.judgeName ?? "",
    subject: detail.subject ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: detail.title,
      courtName: detail.courtName ?? "",
      fileNumber: detail.fileNumber ?? "",
      judgeName: detail.judgeName ?? "",
      subject: detail.subject ?? "",
    });
    setError(null);
  }, [open, detail]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/cases/${detail.id}`, {
        method: "PATCH",
        body: {
          title: form.title.trim(),
          courtName: form.courtName.trim() || null,
          fileNumber: form.fileNumber.trim() || null,
          judgeName: form.judgeName.trim() || null,
          subject: form.subject.trim() || null,
        },
      });
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dosya güncellenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Dosya Künyesi" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Başlık">
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mahkeme / Daire">
            <Input
              list="court-types-detail"
              value={form.courtName}
              onChange={(e) => setForm({ ...form, courtName: e.target.value })}
            />
            <datalist id="court-types-detail">
              {COURT_TYPES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Esas / Dosya No">
            <Input
              value={form.fileNumber}
              onChange={(e) => setForm({ ...form, fileNumber: e.target.value })}
              placeholder="2026/145"
            />
          </Field>
        </div>
        <Field label="Hakim">
          <Input
            value={form.judgeName}
            onChange={(e) => setForm({ ...form, judgeName: e.target.value })}
          />
        </Field>
        <Field label="Dosya konusu">
          <Textarea
            rows={4}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * GİZLİ DOSYA KARTI (Enterprise++): gizlilik anahtarı + erişim listesi.
 * Anahtarı ve listeyi yalnız yönetici/ortak ya da sorumlu avukat düzenler
 * (sunucu `canManageConfidentiality` ile söyler; asıl yaptırım API'dedir).
 */
function PoaStatusCard({ caseId }: { caseId: string }) {
  const [status, setStatus] = useState<{ hasValidPoa: boolean; banner: string | null; powerOfAttorneys: Array<{ id: string; type?: string; notary?: string | null; number?: string | null; daysRemaining: number | null; usable: boolean }> } | null>(null);
  useEffect(() => {
    void api<{ hasValidPoa: boolean; banner: string | null; powerOfAttorneys: Array<{ id: string; type?: string; notary?: string | null; number?: string | null; daysRemaining: number | null; usable: boolean }> }>(`/cases/${caseId}/poa-status`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [caseId]);
  if (!status) return null;
  const soon = status.powerOfAttorneys.filter((p) => p.usable && p.daysRemaining !== null && p.daysRemaining <= 30);
  if (status.hasValidPoa && soon.length === 0) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${status.hasValidPoa ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-300 bg-red-50 text-red-900"}`}>
      <p className="font-semibold">{status.hasValidPoa ? "Vekaletname süresi yaklaşıyor" : "Vekaletname eksik"}</p>
      <p className="mt-1 text-xs leading-5">
        {status.banner ?? soon.map((p) => `${p.notary ?? "Noter"} ${p.number ?? ""} — ${p.daysRemaining} gün kaldı`).join(" · ")}
      </p>
    </div>
  );
}

function ConfidentialityCard({ detail, onChanged }: { detail: CaseDetail; onChanged: () => void }) {
  const [users, setUsers] = useState<Array<{ id: string; fullName: string; role?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const canManage = detail.canManageConfidentiality === true;
  const members = detail.members ?? [];

  useEffect(() => {
    if (!canManage) return;
    void api<unknown>("/users")
      .then((rows) => setUsers(asList<{ id: string; fullName: string; role?: string }>(rows)))
      .catch(() => undefined);
  }, [canManage]);

  if (!detail.isConfidential && !canManage) return null;

  async function toggle(next: boolean) {
    if (next && !window.confirm("Dosya GİZLİ yapılacak: yalnız yönetici/ortak, sorumlu avukat ve erişim listesindekiler görebilecek. Devam?")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/cases/${detail.id}`, { method: "PATCH", body: { isConfidential: next } });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gizlilik değiştirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMembers(userIds: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api(`/cases/${detail.id}/members`, { method: "PUT", body: { userIds } });
      setAddId("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erişim listesi kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = users.filter((u) => !memberIds.has(u.id) && u.id !== detail.responsibleUser?.id);

  return (
    <Card title="Gizlilik ve erişim">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-800">
              {detail.isConfidential ? "Bu dosya GİZLİ" : "Dosya büro geneline açık"}
            </p>
            <p className="text-xs text-slate-500">
              Gizli dosyayı yalnız yönetici/ortak, sorumlu avukat{detail.responsibleUser?.fullName ? ` (${detail.responsibleUser.fullName})` : ""} ve
              aşağıdaki erişim listesi görür; listelerde, ajandada ve aramada diğerlerine görünmez.
            </p>
          </div>
          {canManage && (
            <Switch checked={detail.isConfidential === true} label="Gizli dosya" busy={busy} onChange={(next) => void toggle(next)} />
          )}
        </div>
        {error && <ErrorBox message={error} />}
        {detail.isConfidential && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Erişim listesi</p>
            {members.length === 0 ? (
              <p className="text-sm text-slate-500">Sorumlu avukat dışında kimse eklenmedi.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <li key={m.userId} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-800">
                    {m.user.fullName}
                    {canManage && (
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        disabled={busy}
                        onClick={() => void saveMembers(members.filter((x) => x.userId !== m.userId).map((x) => x.userId))}
                      >
                        çıkar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-64">
                  <Select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Erişim listesine kullanıcı ekle">
                    <option value="">Kullanıcı ekle…</option>
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button size="sm" variant="secondary" disabled={busy || !addId} onClick={() => void saveMembers([...members.map((m) => m.userId), addId])}>
                  Ekle
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
