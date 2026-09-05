"use client";

/**
 * Ayarlar → Denetim İzi (Enterprise++) — büronun KENDİ denetim kayıtları.
 *
 * Kim, ne zaman, neyi: giriş/çıkış, müvekkil/dosya/belge işlemleri, AI çağrıları,
 * kullanıcı yönetimi, güvenlik politikası… Süzgeç (işlem, kullanıcı, tarih, metin),
 * sayfalama ve CSV dışa aktarımı (formül enjeksiyonu korumalı; dışa aktarım da
 * denetim izine düşer). Yalnız ADMIN/PARTNER.
 */

import { useCallback, useEffect, useState } from "react";
import { api, API_BASE, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Pagination, Select, Spinner } from "@/components/ui";

interface AuditRow {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
}

interface PagedAudit {
  items: AuditRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ManagedUser {
  id: string;
  fullName: string;
}

const ACTION_TONES: Array<{ re: RegExp; tone: "green" | "danger" | "navy" | "gold" | "gray" }> = [
  { re: /FAILED|REJECT|DELETE|DISABLED|RESET/, tone: "danger" },
  { re: /LOGIN_SUCCESS|CREATE|ENABLED|APPROVE/, tone: "green" },
  { re: /AI_|CHAT|EXPORT/, tone: "gold" },
  { re: /SECURITY|POLICY|USER_/, tone: "navy" },
];

function toneFor(action: string): "green" | "danger" | "navy" | "gold" | "gray" {
  return ACTION_TONES.find((t) => t.re.test(action))?.tone ?? "gray";
}

export default function DenetimPage() {
  const [data, setData] = useState<PagedAudit | null>(null);
  const [actions, setActions] = useState<Array<{ action: string; count: number }>>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: "", userId: "", from: "", to: "", q: "" });
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<PagedAudit>("/security/audit", {
        query: { page, limit: 50, ...filters },
      });
      setData(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Denetim izi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<Array<{ action: string; count: number }>>("/security/audit/actions").then(setActions).catch(() => undefined);
    void api<unknown>("/users")
      .then((rows) => setUsers(Array.isArray(rows) ? (rows as ManagedUser[]) : []))
      .catch(() => undefined);
  }, []);

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      const res = await fetch(`${API_BASE}/api/v1/security/audit/export.csv?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Dışa aktarım başarısız (HTTP ${res.status}).`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `denetim-izi-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dışa aktarım başarısız.");
    } finally {
      setExporting(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Denetim İzi</h1>
        <Card>
          <p className="p-5 text-sm text-slate-600">
            Denetim izi <strong>Ortak</strong> ve <strong>Yönetici</strong> rollerine açıktır.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Denetim İzi</h1>
          <p className="mt-1 text-sm text-slate-500">
            Büronuzda kim, ne zaman, neyi yaptı — giriş, müvekkil/dosya/belge işlemleri, AI çağrıları, kullanıcı ve güvenlik
            değişiklikleri. Kayıtlar silinemez; dışa aktarım da iz bırakır.
          </p>
        </div>
        <Button variant="secondary" disabled={exporting} onClick={() => void exportCsv()}>
          {exporting ? "Hazırlanıyor…" : "CSV indir"}
        </Button>
      </div>

      {error && <ErrorBox message={error} />}

      <Card>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="İşlem">
            <Select value={filters.action} onChange={(e) => { setPage(1); setFilters({ ...filters, action: e.target.value }); }}>
              <option value="">Tümü</option>
              {actions.map((a) => (
                <option key={a.action} value={a.action}>
                  {a.action} ({a.count})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kullanıcı">
            <Select value={filters.userId} onChange={(e) => { setPage(1); setFilters({ ...filters, userId: e.target.value }); }}>
              <option value="">Tümü</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç">
            <Input type="date" value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }); }} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }); }} />
          </Field>
          <Field label="Metin">
            <Input value={filters.q} placeholder="ayrıntı / varlık" onChange={(e) => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} />
          </Field>
        </div>
      </Card>

      <Card title={data ? `${data.total.toLocaleString("tr-TR")} kayıt` : "Kayıtlar"}>
        {loading ? (
          <Spinner label="Denetim izi yükleniyor…" />
        ) : !data || data.items.length === 0 ? (
          <EmptyState message="Bu süzgeçte kayıt yok." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Zaman</th>
                    <th className="px-3 py-2 font-medium">Kullanıcı</th>
                    <th className="px-3 py-2 font-medium">İşlem</th>
                    <th className="px-3 py-2 font-medium">Varlık</th>
                    <th className="px-3 py-2 font-medium">Ayrıntı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{new Date(r.createdAt).toLocaleString("tr-TR")}</td>
                      <td className="px-3 py-2 text-slate-800">{r.userName ?? (r.userId ? r.userId.slice(0, 8) : "sistem")}</td>
                      <td className="px-3 py-2">
                        <Badge tone={toneFor(r.action)}>{r.action}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {r.entity ?? "—"}
                        {r.entityId ? <span className="block font-mono text-[10px] text-slate-500">{r.entityId}</span> : null}
                      </td>
                      <td className="max-w-md px-3 py-2 text-xs text-slate-700">{r.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="kayıt" loading={loading} onPageChange={setPage} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
