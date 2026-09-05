"use client";

/**
 * "Şablondan görev zinciri" (Faz 7C): dosya türüne uygun iş akışı şablonlarını listeler,
 * adımlar seçilerek dosyaya görev zinciri açılır. Atama tahmin edilmez: seçilen kullanıcı →
 * dosya sorumlusu → uygulayan.
 */

import { useEffect, useMemo, useState } from "react";
import { ApiError, api, asList } from "@/lib/api";
import { applyWorkflow, listWorkflowTemplates, type WorkflowTemplateView } from "@/lib/faz7-is-akisi";
import { Badge, Button, ErrorBox, Field, Input, Modal, Select } from "@/components/ui";

export function WorkflowApplyModal({
  open,
  caseId,
  caseType,
  onClose,
  onApplied,
}: {
  open: boolean;
  caseId: string;
  caseType?: string | null;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const [templates, setTemplates] = useState<WorkflowTemplateView[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [key, setKey] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSkip(new Set());
    api<unknown>("/users")
      .then((p) => setUsers(asList<{ id: string; fullName: string }>(p)))
      .catch(() => setUsers([]));
    listWorkflowTemplates(caseType ?? undefined)
      .then((list) => {
        setTemplates(list);
        setKey((k) => k || list[0]?.key || "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Şablonlar yüklenemedi."));
  }, [open, caseType]);

  const selected = useMemo(() => templates.find((t) => t.key === key) ?? null, [templates, key]);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await applyWorkflow(selected.key, {
        caseId,
        assigneeId: assigneeId || null,
        reviewerId: reviewerId || null,
        startDate,
        skip: [...skip],
      });
      onApplied(`${res.templateName}: ${res.count} görev açıldı.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Şablon uygulanamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Şablondan görev zinciri" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="İş akışı şablonu">
          <Select value={key} onChange={(e) => setKey(e.target.value)} data-testid="is-akisi-sablon">
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
                {t.isSystem ? " (sistem)" : ""}
                {t.caseType ? ` — ${t.caseType}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        {selected?.description && <p className="text-xs text-slate-500">{selected.description}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sorumlu" hint="Boş: dosya sorumlusu, o da yoksa siz.">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Dosya sorumlusu</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kontrol eden (kontrollü adımlar)">
            <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">Yok</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        {selected && (
          <ol className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {selected.items.map((it, i) => (
              <li key={i} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!skip.has(i)}
                  onChange={(e) => {
                    const next = new Set(skip);
                    if (e.target.checked) next.delete(i);
                    else next.add(i);
                    setSkip(next);
                  }}
                  aria-label={`Adım ${i + 1}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-900">{it.title}</span>
                  {it.description && <span className="block text-xs text-slate-500">{it.description}</span>}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Badge tone="gray">+{it.offsetDays} gün</Badge>
                  {it.roleHint && <Badge tone="blue">{it.roleHint}</Badge>}
                  {it.needsReview && <Badge tone="gold">kontrollü</Badge>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="gold" disabled={busy || !selected || (selected.items.length - skip.size) <= 0} onClick={() => void submit()}>
            {busy ? "Açılıyor…" : `${selected ? selected.items.length - skip.size : 0} görev aç`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
