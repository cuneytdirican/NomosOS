"use client";

/**
 * Duruşma ekleme/düzenleme ve "sonuç gir" modalları.
 * Hem /app/durusmalar hem de dosya detayındaki Duruşmalar sekmesi bunları kullanır.
 *
 * POST   /hearings            — yeni duruşma (Case.nextHearingAt API tarafında güncellenir)
 * PATCH  /hearings/:id        — düzenleme
 * PATCH  /hearings/:id/result — sonuç + safahat kaydı
 */

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { CaseSummary, Hearing } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { RemoteSelect } from "@/components/remote-select";
import {
  HEARING_STATUSES,
  HEARING_STATUS_LABELS,
  HEARING_TYPE_LABELS,
  fmtDateTime,
  labelOf,
  toLocalInput,
} from "@/lib/labels";
import { HEARING_TYPES, type HearingType } from "@nomosos/shared";

interface HearingFormState {
  caseId: string;
  type: HearingType;
  date: string;
  courtroom: string;
  note: string;
  prepSummary: string;
}

function emptyForm(caseId?: string): HearingFormState {
  return {
    caseId: caseId ?? "",
    type: "DURUSMA",
    date: "",
    courtroom: "",
    note: "",
    prepSummary: "",
  };
}

export function HearingFormModal({
  open,
  hearing,
  caseId,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Doluysa düzenleme, boşsa yeni kayıt. */
  hearing?: Hearing | null;
  /** Dosya detayından açıldığında sabitlenir; listeden açıldığında seçtirilir. */
  caseId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<HearingFormState>(emptyForm(caseId));
  const [caseLabel, setCaseLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (hearing) {
      setForm({
        caseId: hearing.caseId ?? caseId ?? "",
        type: (hearing.type as HearingType) ?? "DURUSMA",
        date: toLocalInput(hearing.date),
        courtroom: hearing.courtroom ?? "",
        note: hearing.note ?? "",
        prepSummary: hearing.prepSummary ?? "",
      });
    } else {
      setForm(emptyForm(caseId));
    }
    setCaseLabel(hearing?.case?.title ?? "");
  }, [open, hearing, caseId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        caseId: form.caseId,
        type: form.type,
        date: new Date(form.date).toISOString(),
        courtroom: form.courtroom.trim() || undefined,
        note: form.note.trim() || undefined,
        prepSummary: form.prepSummary.trim() || undefined,
      };
      if (hearing) {
        await api(`/hearings/${hearing.id}`, { method: "PATCH", body });
      } else {
        await api("/hearings", { method: "POST", body });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Duruşma kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={hearing ? "Duruşmayı Düzenle" : "Yeni Duruşma"}
      onClose={onClose}
      wide
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/*
          Dosya seçimi SUNUCUDA aranır (denetim bulguları K-15, K-16).
                                        denetim bulgusu K-15 · denetim bulgusu K-16
          Önceden `/cases?limit=200` ile tek atışta çekiliyordu; 201. dosya bu
          açılır listede HİÇ seçilemiyor, o dosyaya duruşma eklenemiyordu.
        */}
        {!caseId && (
          <Field label="Dosya" hint="Başlık veya esas no yazarak arayın">
            <RemoteSelect<CaseSummary>
              path="/cases"
              value={form.caseId}
              selectedLabel={caseLabel}
              onChange={(id, opt) => {
                setForm({ ...form, caseId: id });
                setCaseLabel(opt?.label ?? "");
              }}
              toOption={(c) => ({ id: c.id, label: c.title, hint: c.fileNumber ?? undefined })}
              placeholder="Dosya arayın…"
              emptyMessage="Eşleşen dosya yok."
              ariaLabel="Dosya ara ve seç"
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tür">
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as HearingType })}
            >
              {HEARING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(HEARING_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tarih ve saat">
            <Input
              type="datetime-local"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
        </div>

        <Field label="Salon / Duruşma yeri">
          <Input
            value={form.courtroom}
            onChange={(e) => setForm({ ...form, courtroom: e.target.value })}
            placeholder="Örn. 3 No'lu Duruşma Salonu"
          />
        </Field>

        <Field label="Hazırlık notu" hint="Duruşmaya girmeden önce hatırlanacaklar.">
          <Textarea
            rows={2}
            value={form.prepSummary}
            onChange={(e) => setForm({ ...form, prepSummary: e.target.value })}
            placeholder="Tanık listesi, sunulacak belgeler, talep edilecek ara karar…"
          />
        </Field>

        <Field label="Not">
          <Textarea
            rows={2}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Serbest not"
          />
        </Field>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving || !form.caseId || !form.date}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function HearingResultModal({
  open,
  hearing,
  onClose,
  onSaved,
}: {
  open: boolean;
  hearing: Hearing | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>("YAPILDI");
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(hearing?.status === "PLANLANDI" ? "YAPILDI" : (hearing?.status ?? "YAPILDI"));
    setNote(hearing?.note ?? "");
    setNextDate("");
    setError(null);
  }, [open, hearing]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!hearing) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/hearings/${hearing.id}/result`, {
        method: "PATCH",
        body: {
          status,
          note: note.trim() || undefined,
          nextHearingDate: nextDate ? new Date(nextDate).toISOString() : undefined,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Duruşma sonucu kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Duruşma Sonucu" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {hearing && (
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <p className="font-medium text-slate-900">{hearing.case?.title ?? "Dosya"}</p>
            <p className="mt-0.5">{fmtDateTime(hearing.date)}</p>
          </div>
        )}

        <Field label="Sonuç durumu">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {HEARING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelOf(HEARING_STATUS_LABELS, s)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Ara karar / sonuç özeti"
          hint="Bu özet dosyanın safahat akışına da işlenir."
        >
          <Textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Örn. Bilirkişi raporu için 2 hafta süre verildi, duruşma ertelendi."
            required
          />
        </Field>

        {status === "ERTELENDI" && (
          <Field label="Yeni duruşma tarihi" hint="Girilirse yeni duruşma kaydı açılır.">
            <Input
              type="datetime-local"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          </Field>
        )}

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="gold" disabled={saving}>
            {saving ? "Kaydediliyor…" : "Sonucu Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
