"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, fetchPaged, ApiError, DEFAULT_PAGE_SIZE } from "@/lib/api";
import type { CaseSummary, Client } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
} from "@/components/ui";
import { RemoteSelect } from "@/components/remote-select";
import { JudicialBodyPicker } from "@/components/judicial-picker";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  CASE_TYPE_LABELS,
  labelOf,
} from "@/lib/labels";
import { CASE_TYPES, type CaseType } from "@nomosos/shared";

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewCaseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * ARAMA VE SAYFALAMA SUNUCUDA YAPILIR (denetim bulguları K-15, K-16).
   *
   * Önceden `/cases?limit=200` ile tek atışta 200 kayıt çekilip arama
   * İSTEMCİDE `title`/`fileNumber`/`courtName`/`client.name` üzerinde
   * süzülüyordu — oysa sunucu `where.OR` ile TAM OLARAK aynı dört alanı zaten
   * süzüyordu. 640 dosyalı büroda `openedAt desc` sıralamasında 430. sıradaki
   * dosya aranınca ekran "sonuç yok" diyor, avukat dosyanın sistemde olmadığı
   * sonucuna varıyordu. Ayrıca zarftaki `total` atıldığı için 200'den
   * sonrasının var olduğu bile görünmüyordu.
   *
   * Desen `muvekkiller/page.tsx:61-82` ile aynıdır (300 ms debounce dahil).
   *
   * denetim bulgusu K-15 · denetim bulgusu K-16
   */
  const load = useCallback(async (q: string, pageNo: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPaged<CaseSummary>("/cases", {
        query: { q: q.trim() || undefined },
        page: pageNo,
        limit: DEFAULT_PAGE_SIZE,
      });
      setCases(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dosyalar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Yazarken her tuşta istek atmamak için kısa gecikme (debounce).
  useEffect(() => {
    const timer = setTimeout(() => void load(search, page), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search, page]);

  function openModal() {
    setModalOpen(true);
    setSaveError(null);
  }

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
      void load(search, page);
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
        <Button variant="gold" onClick={openModal}>
          + Yeni Dosya
        </Button>
      </div>

      <Card>
        <div className="mb-4">
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // Arama değişince ilk sayfaya dön — aksi hâlde boş sayfada kalınır.
              setPage(1);
            }}
            placeholder="Başlık, esas no, mahkeme veya müvekkil ara…"
            aria-label="Dosya ara"
          />
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : cases.length === 0 ? (
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
                {cases.map((c) => (
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
                    <td className="py-3 pr-4 text-slate-600">
                      {c.fileNumber ?? "—"}
                      {c.isConfidential && (
                        <Badge tone="danger" className="ml-2">
                          Gizli
                        </Badge>
                      )}
                    </td>
                    <td className="py-3">
                      <Badge tone={CASE_STATUS_TONES[c.status ?? ""] ?? "gray"}>
                        {labelOf(CASE_STATUS_LABELS, c.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              noun="dosya"
              loading={loading}
              onPageChange={setPage}
            />
          </div>
        )}
      </Card>

      <Modal open={modalOpen} title="Yeni Dosya" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-4">
          {/*
            Müvekkil seçimi SUNUCUDA aranır (denetim bulgusu K-15).
            Önceden `/clients?limit=200` ile tek atışta çekiliyordu; müvekkil
            ucunun sunucu tavanı 100 olduğu için 101. müvekkil bu açılır
            listede HİÇ seçilemiyordu.
          */}
          <Field label="Müvekkil" hint="Ad yazarak arayın">
            <RemoteSelect<Client>
              path="/clients"
              value={form.clientId}
              onChange={(id) => setForm({ ...form, clientId: id })}
              toOption={(c) => ({ id: c.id, label: c.name })}
              placeholder="Müvekkil arayın…"
              emptyMessage="Eşleşen müvekkil yok — önce müvekkil ekleyin."
              ariaLabel="Müvekkil ara ve seç"
            />
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
          <Field label="Mahkeme / Daire" hint="İl seçin, katalogdan seçin; listede yoksa elle yazabilirsiniz.">
            <JudicialBodyPicker
              type="MAHKEME"
              value={form.courtName}
              onChange={(courtName) => setForm({ ...form, courtName })}
            />
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
