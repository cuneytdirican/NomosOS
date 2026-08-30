"use client";

/**
 * Dosya detayı → Dilekçeler sekmesi (Modül 22 girişi).
 *
 * GET  /cases/:caseId/petitions
 * POST /cases/:caseId/petitions  { type, title, templateId }
 * GET  /petition-templates
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  createPetition,
  errText,
  isFeatureMissing,
  listPetitionTemplates,
  listPetitions,
  sectionsOf,
} from "@/lib/faz2";
import type { PetitionSummary, PetitionTemplateItem } from "@/lib/types";
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
} from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import {
  PETITION_STATUS_LABELS,
  PETITION_STATUS_TONES,
  PETITION_TYPES,
  PETITION_TYPE_LABELS,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";

export function PetitionsTab({
  caseId,
  onNotify,
}: {
  caseId: string;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [items, setItems] = useState<PetitionSummary[]>([]);
  const [templates, setTemplates] = useState<PetitionTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPetitions(caseId);
      setItems(list);
      setMissing(false);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Dilekçeler yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listPetitionTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  return (
    <div className="space-y-4">
      <Card
        title={`Dilekçeler (${items.length})`}
        action={
          <Button size="sm" variant="gold" onClick={() => setModalOpen(true)}>
            + Yeni Dilekçe
          </Button>
        }
      >
        {error && (
          <div className="mb-4">
            <ErrorBox message={error} />
          </div>
        )}
        {loading ? (
          <Spinner label="Dilekçeler yükleniyor…" />
        ) : missing ? (
          <FeatureUnavailable
            title="Dilekçe Stüdyosu henüz hazır değil"
            detail="/cases/:id/petitions ucu yayına alındığında şablondan dilekçe üretebilir, bölüm bazında AI ile yeniden yazdırabilir ve UDF olarak dışa aktarabilirsiniz."
            onRetry={() => void load()}
          />
        ) : items.length === 0 ? (
          <EmptyState message="Bu dosyada dilekçe yok. Sistem şablonlarından yeni bir dilekçe başlatın." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link
                    href={`/app/dosyalar/${caseId}/dilekce/${p.id}`}
                    className="text-sm font-medium text-slate-900 hover:text-amber-600"
                  >
                    {p.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {labelOf(PETITION_TYPE_LABELS, p.type)}
                    {p._count?.versions ? ` · ${p._count.versions} sürüm` : ""}
                    {p.updatedAt ? ` · ${fmtDateTime(p.updatedAt)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={PETITION_STATUS_TONES[p.status] ?? "gray"}>
                    {labelOf(PETITION_STATUS_LABELS, p.status)}
                  </Badge>
                  <Link
                    href={`/app/dosyalar/${caseId}/dilekce/${p.id}`}
                    className="text-xs font-medium text-amber-600 hover:text-amber-500"
                  >
                    Stüdyoda aç →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <NewPetitionModal
        open={modalOpen}
        caseId={caseId}
        templates={templates}
        onClose={() => setModalOpen(false)}
        onCreated={(p) => {
          setModalOpen(false);
          onNotify(`"${p.title}" taslağı oluşturuldu.`, "success");
          void load();
        }}
      />
    </div>
  );
}

function NewPetitionModal({
  open,
  caseId,
  templates,
  onClose,
  onCreated,
}: {
  open: boolean;
  caseId: string;
  templates: PetitionTemplateItem[];
  onClose: () => void;
  onCreated: (p: PetitionSummary) => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [type, setType] = useState<string>("DAVA_DILEKCESI");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplateId("");
    setType("DAVA_DILEKCESI");
    setTitle("");
    setError(null);
  }, [open]);

  const selected = templates.find((t) => t.id === templateId) ?? null;

  useEffect(() => {
    if (selected) {
      setType(selected.petitionType);
      if (!title) setTitle(selected.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createPetition(caseId, {
        type,
        title: title.trim(),
        templateId: templateId || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(errText(err, "Dilekçe oluşturulamadı."));
    } finally {
      setSaving(false);
    }
  }

  const previewSections = sectionsOf(selected);

  return (
    <Modal open={open} title="Yeni Dilekçe" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Şablon"
          hint="Sistem şablonları UYAP dilekçe başlıklarıyla birebir uyumludur."
        >
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Şablonsuz (boş taslak)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isSystem ? " (sistem)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dilekçe türü">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {PETITION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(PETITION_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlık">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Örn. Bilirkişi raporuna itiraz dilekçesi"
              required
            />
          </Field>
        </div>

        {previewSections.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold text-slate-600">Şablon bölümleri</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {previewSections.map((s) => (
                <li key={s.title}>
                  <Badge tone={s.required ? "navy" : "gray"}>{s.title}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="gold" disabled={saving || !title.trim()}>
            {saving ? "Oluşturuluyor…" : "Taslağı Oluştur"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
