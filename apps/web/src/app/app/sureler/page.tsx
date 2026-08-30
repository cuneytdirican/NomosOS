"use client";

/**
 * Süreler — Modül 04 ana ekranı.
 *
 * GET    /deadlines?status=&from=&to=&caseId=   — filtreli liste
 * POST   /deadlines                              — manuel süre
 * PATCH  /deadlines/:id/status                   — ONAYLANDI / TAMAMLANDI / IPTAL
 * DELETE /deadlines/:id                          — sil
 * Kuraldan oluşturma: DeadlineWizard (compute + from-rule)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import type { CaseSummary, Deadline } from "@/lib/types";
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
  Spinner,
  StatCard,
  Textarea,
} from "@/components/ui";
import { ComputeNote } from "@/components/compute-note";
import { DeadlineWizard } from "@/components/deadline-wizard";
import {
  DEADLINE_SOURCE_LABELS,
  DEADLINE_SOURCE_TONES,
  DEADLINE_STATUS_LABELS,
  DEADLINE_STATUS_TONES,
  SERVICE_METHOD_LABELS,
  daysUntil,
  fmtDate,
  labelOf,
  remainingLabel,
  toIsoDate,
  urgencyRowClass,
  urgencyTone,
} from "@/lib/labels";
import { DEADLINE_STATUSES } from "@nomosos/shared";

interface Filters {
  status: string;
  from: string;
  to: string;
  caseId: string;
}

const EMPTY_FILTERS: Filters = { status: "", from: "", to: "", caseId: "" };

export default function SurelerPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const load = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/deadlines", {
        query: {
          status: f.status || undefined,
          from: f.from || undefined,
          to: f.to || undefined,
          caseId: f.caseId || undefined,
          // API artık sayfalı döner; süre listesi kaçırılmaması gereken bir
          // kayıt olduğu için üst sınıra yakın çekilir (Faz 2: sayfalama arayüzü).
          limit: "200",
        },
      });
      setDeadlines(asList<Deadline>(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Süreler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(EMPTY_FILTERS);
    api<unknown>("/cases", { query: { limit: "200" } })
      .then((data) => setCases(asList<CaseSummary>(data)))
      .catch((err) => {
        // Hatayı sessizce yutmak, kullanıcıya "hiç dosyam yok" izlenimi
        // veriyordu (denetim bulgusu 20).
        setCases([]);
        setError(err instanceof ApiError ? err.message : "Dosya listesi yüklenemedi.");
      });
  }, [load]);

  async function changeStatus(d: Deadline, status: string) {
    setBusyId(d.id);
    setActionError(null);
    try {
      await api(`/deadlines/${d.id}/status`, { method: "PATCH", body: { status } });
      await load(filters);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Süre durumu güncellenemedi.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeDeadline(d: Deadline) {
    if (!window.confirm(`"${d.title}" süresi silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusyId(d.id);
    setActionError(null);
    try {
      await api(`/deadlines/${d.id}`, { method: "DELETE" });
      await load(filters);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Süre silinemedi.");
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const open = deadlines.filter(
      (d) => d.status !== "TAMAMLANDI" && d.status !== "IPTAL",
    );
    return {
      total: deadlines.length,
      overdue: open.filter((d) => daysUntil(d.dueDate) < 0).length,
      critical: open.filter((d) => {
        const n = daysUntil(d.dueDate);
        return n >= 0 && n <= 3;
      }).length,
      pending: deadlines.filter((d) => d.status === "BEKLIYOR" || d.source === "AI_ONERISI").length,
    };
  }, [deadlines]);

  const suggestions = deadlines.filter(
    (d) => d.source === "AI_ONERISI" && d.status === "BEKLIYOR",
  );
  const rest = deadlines.filter((d) => !(d.source === "AI_ONERISI" && d.status === "BEKLIYOR"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Süreler</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hesap deterministik kural motorunda yapılır; AI yalnızca öneri üretir, süre avukat
            onayıyla kesinleşir.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setManualOpen(true)}>
            Manuel Süre
          </Button>
          <Button variant="gold" onClick={() => setWizardOpen(true)}>
            + Kuraldan Süre Oluştur
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Listelenen Süre" value={stats.total} tone="slate" />
        <StatCard
          label="Geciken"
          value={stats.overdue}
          tone={stats.overdue > 0 ? "red" : "slate"}
          hint="Son günü geçmiş, kapatılmamış"
        />
        <StatCard
          label="Kritik (≤3 gün)"
          value={stats.critical}
          tone={stats.critical > 0 ? "navy" : "slate"}
        />
        <StatCard label="Onay Bekleyen" value={stats.pending} tone="gold" />
      </div>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(filters);
          }}
          className="mb-5 flex flex-wrap items-end gap-4"
        >
          <div className="w-44">
            <Field label="Durum">
              <Select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">Tüm durumlar</option>
                {DEADLINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {labelOf(DEADLINE_STATUS_LABELS, s)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Başlangıç">
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label="Bitiş">
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </Field>
          <div className="w-64">
            <Field label="Dosya">
              <Select
                value={filters.caseId}
                onChange={(e) => setFilters({ ...filters, caseId: e.target.value })}
              >
                <option value="">Tüm dosyalar</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.fileNumber ? ` (${c.fileNumber})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={loading}>
            Listele
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              void load(EMPTY_FILTERS);
            }}
          >
            Filtreyi temizle
          </Button>
        </form>

        {actionError && (
          <div className="mb-4">
            <ErrorBox message={actionError} />
          </div>
        )}

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : deadlines.length === 0 ? (
          <EmptyState message="Bu filtrede süre kaydı bulunmuyor." />
        ) : (
          <div className="space-y-6">
            {/* AI önerileri — onay kuyruğu */}
            {suggestions.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900">
                  Onay bekleyen AI önerileri
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                    {suggestions.length}
                  </span>
                </h3>
                <ul className="space-y-3">
                  {suggestions.map((d) => (
                    <li
                      key={d.id}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
                    >
                      <DeadlineRow deadline={d} />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="gold"
                          disabled={busyId === d.id}
                          onClick={() => void changeStatus(d, "ONAYLANDI")}
                        >
                          Onayla
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === d.id}
                          onClick={() => void changeStatus(d, "IPTAL")}
                        >
                          Reddet
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="space-y-3">
              {rest.map((d) => {
                const days = daysUntil(d.dueDate);
                const closed = d.status === "TAMAMLANDI" || d.status === "IPTAL";
                return (
                  <li
                    key={d.id}
                    className={`rounded-lg border border-slate-200 px-4 py-3 ${
                      closed ? "opacity-60" : urgencyRowClass(days)
                    }`}
                  >
                    <DeadlineRow deadline={d} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {d.status !== "TAMAMLANDI" && (
                        <Button
                          size="sm"
                          disabled={busyId === d.id}
                          onClick={() => void changeStatus(d, "TAMAMLANDI")}
                        >
                          Tamamlandı işaretle
                        </Button>
                      )}
                      {d.status === "BEKLIYOR" && (
                        <Button
                          size="sm"
                          variant="gold"
                          disabled={busyId === d.id}
                          onClick={() => void changeStatus(d, "ONAYLANDI")}
                        >
                          Onayla
                        </Button>
                      )}
                      {d.status !== "IPTAL" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === d.id}
                          onClick={() => void changeStatus(d, "IPTAL")}
                        >
                          İptal et
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === d.id}
                        onClick={() => void removeDeadline(d)}
                      >
                        Sil
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <DeadlineWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={() => void load(filters)}
      />

      <ManualDeadlineModal
        open={manualOpen}
        cases={cases}
        onClose={() => setManualOpen(false)}
        onSaved={() => void load(filters)}
      />
    </div>
  );
}

function DeadlineRow({ deadline: d }: { deadline: Deadline }) {
  const days = daysUntil(d.dueDate);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{d.title}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Son gün: <strong className="text-slate-700">{fmtDate(d.dueDate)}</strong>
          {d.case ? (
            <>
              {" · "}
              <Link href={`/app/dosyalar/${d.case.id}`} className="hover:text-amber-600">
                {d.case.title}
                {d.case.fileNumber ? ` (${d.case.fileNumber})` : ""}
              </Link>
            </>
          ) : null}
        </p>
        {(d.legalBasis || d.ruleKey) && (
          <p className="mt-0.5 text-xs text-slate-500">
            Dayanak: {d.legalBasis ?? d.ruleKey}
          </p>
        )}
        {(d.triggerDate || d.serviceMethod) && (
          <p className="mt-0.5 text-[11px] text-slate-400">
            {d.triggerDate ? `Tetik: ${fmtDate(d.triggerDate)}` : ""}
            {d.serviceMethod ? ` · ${labelOf(SERVICE_METHOD_LABELS, d.serviceMethod)}` : ""}
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
        {d.status !== "TAMAMLANDI" && d.status !== "IPTAL" && (
          <Badge tone={urgencyTone(days)}>{remainingLabel(days)}</Badge>
        )}
      </div>
    </div>
  );
}

function ManualDeadlineModal({
  open,
  cases,
  onClose,
  onSaved,
}: {
  open: boolean;
  cases: CaseSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(toIsoDate(new Date()));
  const [legalBasis, setLegalBasis] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/deadlines", {
        method: "POST",
        body: {
          caseId,
          title: title.trim(),
          dueDate: new Date(dueDate).toISOString(),
          source: "MANUEL",
          status: "ONAYLANDI",
          legalBasis: legalBasis.trim() || undefined,
          computeNote: note.trim() || undefined,
        },
      });
      onSaved();
      onClose();
      setTitle("");
      setLegalBasis("");
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Süre kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Manuel Süre Ekle" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Mevzuat kuralına dayanan süreler için <strong>Kuraldan Süre Oluştur</strong> akışını
          kullanın — hesap izi ve dayanak otomatik kaydedilir.
        </p>
        <Field label="Dosya">
          <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} required>
            <option value="" disabled>
              Dosya seçin…
            </option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.fileNumber ? ` (${c.fileNumber})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Başlık">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Örn. Ara karar gereği belge sunma"
            required
          />
        </Field>
        <Field label="Son gün">
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Dayanak (isteğe bağlı)">
          <Input
            value={legalBasis}
            onChange={(e) => setLegalBasis(e.target.value)}
            placeholder="Örn. Duruşma ara kararı"
          />
        </Field>
        <Field label="Not">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving || !caseId}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
