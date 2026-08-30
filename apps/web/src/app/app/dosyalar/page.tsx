"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, asList, ApiError } from "@/lib/api";
import type { CaseSummary, Client } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  CASE_TYPE_LABELS,
  labelOf,
} from "@/lib/labels";
import { CASE_TYPES, COURT_TYPES, type CaseType } from "@nomosos/shared";

interface NewCaseForm {
  clientId: string;
  type: CaseType;
  title: string;
  courtName: string;
  fileNumber: string;
}

const EMPTY_FORM: NewCaseForm = {
  clientId: "",
  type: "DAVA",
  title: "",
  courtName: "",
  fileNumber: "",
};

export default function DosyalarPage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState<NewCaseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/cases", { query: { limit: "200" } });
      setCases(asList<CaseSummary>(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dosyalar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openModal() {
    setModalOpen(true);
    setSaveError(null);
    try {
      const data = await api<unknown>("/clients", { query: { limit: "200" } });
      setClients(asList<Client>(data));
    } catch {
      setSaveError("Müvekkil listesi yüklenemedi — önce müvekkil ekleyin.");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    if (!q) return cases;
    return cases.filter((c) =>
      [c.title, c.fileNumber ?? "", c.courtName ?? "", c.client?.name ?? ""].some((v) =>
        v.toLocaleLowerCase("tr-TR").includes(q),
      ),
    );
  }, [cases, search]);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api("/cases", {
        method: "POST",
        body: {
          clientId: form.clientId,
          type: form.type,
          title: form.title.trim(),
          courtName: form.courtName.trim() || undefined,
          fileNumber: form.fileNumber.trim() || undefined,
        },
      });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      void load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Dosya kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dosyalar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dava, icra, arabuluculuk, ceza ve danışmanlık dosyalarınız.
          </p>
        </div>
        <Button variant="gold" onClick={() => void openModal()}>
          + Yeni Dosya
        </Button>
      </div>

      <Card>
        <div className="mb-4">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Başlık, esas no, mahkeme veya müvekkil ara…"
            aria-label="Dosya ara"
          />
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState message={search ? "Aramanızla eşleşen dosya yok." : "Henüz dosya kaydı yok."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Dosya</th>
                  <th className="py-2 pr-4 font-medium">Müvekkil</th>
                  <th className="py-2 pr-4 font-medium">Tür</th>
                  <th className="py-2 pr-4 font-medium">Mahkeme / Daire</th>
                  <th className="py-2 pr-4 font-medium">Esas No</th>
                  <th className="py-2 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/app/dosyalar/${c.id}`}
                        className="font-medium text-slate-900 hover:text-amber-600"
                      >
                        {c.title}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{c.client?.name ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">{labelOf(CASE_TYPE_LABELS, c.type)}</td>
                    <td className="py-3 pr-4 text-slate-600">{c.courtName ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">{c.fileNumber ?? "—"}</td>
                    <td className="py-3">
                      <Badge tone={CASE_STATUS_TONES[c.status ?? ""] ?? "gray"}>
                        {labelOf(CASE_STATUS_LABELS, c.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} title="Yeni Dosya" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Müvekkil">
            <Select
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              required
            >
              <option value="" disabled>
                Müvekkil seçin…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dosya türü">
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CaseType })}
            >
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(CASE_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlık">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Örn. Demir v. Yıldız İnşaat — işçilik alacağı"
              required
            />
          </Field>
          <Field label="Mahkeme / Daire" hint="Örn. İstanbul 12. İş Mahkemesi">
            <Input
              list="court-types"
              value={form.courtName}
              onChange={(e) => setForm({ ...form, courtName: e.target.value })}
              placeholder="Mahkeme veya icra dairesi adı"
            />
            <datalist id="court-types">
              {COURT_TYPES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Esas / Dosya No" hint="Örn. 2026/145">
            <Input
              value={form.fileNumber}
              onChange={(e) => setForm({ ...form, fileNumber: e.target.value })}
              placeholder="2026/145"
            />
          </Field>

          {saveError && <ErrorBox message={saveError} />}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving || !form.clientId}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
