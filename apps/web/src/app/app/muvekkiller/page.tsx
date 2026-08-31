"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, asList, ApiError } from "@/lib/api";
import type { Client } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { CLIENT_TYPE_LABELS, fmtDate, labelOf } from "@/lib/labels";
import { CLIENT_TYPES, type ClientType } from "@nomosos/shared";
import { ConflictResultCard } from "../_components/conflict-result";
import { quickConflictCheck } from "../_lib/faz4";
import type { ConflictCheck } from "../_lib/faz4-types";

interface NewClientForm {
  type: ClientType;
  name: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: NewClientForm = { type: "GERCEK_KISI", name: "", email: "", phone: "" };

/** Sunucu tarafı sayfa boyutu — API varsayılanıyla aynı. */
const PAGE_SIZE = 20;

export default function MuvekkillerPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NewClientForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * ÇATIŞMA ÖN TARAMASI (Modül 11).
   *
   * Ad yazıldıkça arka planda tarama yapılır ve DİKKAT/ÇAKIŞMA çıkarsa kayıttan
   * ÖNCE uyarı kartı gösterilir. Uyarı KAYDI ENGELLEMEZ: modülün tavrı
   * "engelleme değil uyarı"dır (iş kuralı 1) ve tarama ucu yayında değilse
   * `quickConflictCheck` sessizce null döner — form akışı hiçbir koşulda durmaz.
   */
  const [conflict, setConflict] = useState<ConflictCheck | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);

  /**
   * ARAMA VE SAYFALAMA SUNUCUDA YAPILIR.
   *
   * Önceden yalnızca ilk 20 kayıt çekilip arama istemcide süzülüyordu; 20'den
   * fazla müvekkili olan büroda arama kutusu 21. müvekkili ASLA bulamıyordu ve
   * listede sayfa geçişi yoktu — üstelik sunucuda `q` süzgeci hazırdı
   * (denetim bulgusu 8).
   */
  const load = useCallback(async (q: string, pageNo: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ items?: Client[]; total?: number; totalPages?: number }>("/clients", {
        query: { q: q.trim() || undefined, page: String(pageNo), limit: String(PAGE_SIZE) },
      });
      setClients(asList<Client>(data));
      setTotal(data?.total ?? 0);
      setTotalPages(data?.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Müvekkiller yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Yazarken her tuşta istek atmamak için kısa gecikme (debounce).
  useEffect(() => {
    const timer = setTimeout(() => void load(search, page), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search, page]);

  useEffect(() => {
    if (!modalOpen) return;
    const name = form.name.trim();
    if (name.length < 3) {
      setConflict(null);
      return;
    }
    let alive = true;
    setConflictBusy(true);
    const timer = setTimeout(() => {
      void quickConflictCheck(name)
        .then((res) => {
          if (alive) setConflict(res);
        })
        .finally(() => {
          if (alive) setConflictBusy(false);
        });
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [modalOpen, form.name]);

  function closeModal() {
    setModalOpen(false);
    setConflict(null);
    setSaveError(null);
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api("/clients", {
        method: "POST",
        body: {
          type: form.type,
          name: form.name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        },
      });
      closeModal();
      setForm(EMPTY_FORM);
      void load(search, page);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Müvekkil kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Müvekkiller</h1>
          <p className="mt-1 text-sm text-slate-500">
            Müvekkil kartları — dosyalar, iletişim ve finansal hareketlerin merkezi.
          </p>
        </div>
        <Button variant="gold" onClick={() => setModalOpen(true)}>
          + Yeni Müvekkil
        </Button>
      </div>

      <Card>
        <div className="mb-4">
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Ad, e-posta, telefon, kategori veya referans kodu ile ara…"
            aria-label="Müvekkil ara"
          />
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} />
        ) : clients.length === 0 ? (
          <EmptyState
            message={search ? "Aramanızla eşleşen müvekkil bulunamadı." : "Henüz müvekkil kaydı yok."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Ad / Unvan</th>
                  <th className="py-2 pr-4 font-medium">Tür</th>
                  <th className="py-2 pr-4 font-medium">Kategori</th>
                  <th className="py-2 pr-4 font-medium">Dosya</th>
                  <th className="py-2 pr-4 font-medium">E-posta</th>
                  <th className="py-2 pr-4 font-medium">Telefon</th>
                  <th className="py-2 font-medium">Kayıt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/app/muvekkiller/${c.id}`)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        href={`/app/muvekkiller/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-slate-900 hover:text-amber-600"
                      >
                        {c.name}
                      </Link>
                      {c.referenceCode && (
                        <span className="ml-2 text-xs text-slate-500">{c.referenceCode}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={c.type === "TUZEL_KISI" ? "navy" : "blue"}>
                        {labelOf(CLIENT_TYPE_LABELS, c.type)}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{c.category ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">{c._count?.cases ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">{c.email ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">{c.phone ?? "—"}</td>
                    <td className="py-3 text-slate-500">{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">
                  Toplam {total} müvekkil · sayfa {page} / {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ‹ Önceki
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Sonraki ›
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Modal open={modalOpen} title="Yeni Müvekkil" onClose={closeModal}>
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Müvekkil türü">
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ClientType })}
            >
              {CLIENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(CLIENT_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={form.type === "TUZEL_KISI" ? "Ticaret unvanı" : "Ad soyad"}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={form.type === "TUZEL_KISI" ? "Örn. Yıldız İnşaat A.Ş." : "Örn. Ayşe Demir"}
              required
            />
          </Field>

          {/* Çatışma ön taraması — kaydı ENGELLEMEZ, yalnızca uyarır. */}
          {conflictBusy && (
            <p className="text-xs text-slate-500">Çatışma taraması yapılıyor…</p>
          )}
          {conflict && String(conflict.result) !== "TEMIZ" && (
            <ConflictResultCard check={conflict} compact />
          )}
          {conflict && String(conflict.result) === "TEMIZ" && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              🟢 Çatışma taraması temiz — büro kayıtlarında eşleşme bulunamadı.
            </p>
          )}
          <Field label="E-posta">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ornek@eposta.com"
            />
          </Field>
          <Field label="Telefon">
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="0 5xx xxx xx xx"
            />
          </Field>

          {saveError && <ErrorBox message={saveError} />}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            {conflict && String(conflict.result) === "CAKISMA" && (
              <p className="mr-auto max-w-xs text-[11px] leading-4 text-red-700">
                Uyarıya rağmen kaydedebilirsiniz; tarama ve kararınız kayıt altındadır.
              </p>
            )}
            <Button variant="secondary" onClick={closeModal}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
