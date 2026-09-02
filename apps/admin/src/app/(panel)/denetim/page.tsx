"use client";

/**
 * Denetim İzi — GET /audit
 *
 * PlatformAuditLog append-only'dir; kiracı silinse dahi iz kalır (tenantId'de FK yoktur).
 * Rol kapsamı SUNUCUDA filtrelenir: SUPER_ADMIN tümünü, diğer roller kendi alanlarını görür.
 * CSV dışa aktarımı `audit.export` yetkisine bağlıdır ve dört-göz listesindedir.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useListResource } from "@/lib/useResource";
import { useDebounced } from "@/lib/useDebounced";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { levelOf } from "@/lib/rbac";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge } from "@/components/ApprovalBadge";
import {
  AUDIT_ACTION_LABELS,
  CRITICAL_AUDIT_ACTIONS,
  daysAgo,
  fmtDateTime,
  labelOf,
  roleLabel,
  toDateInput,
} from "@/lib/labels";
import { exportCsv } from "@/lib/csv";
import { adminApi, errorMessage } from "@/lib/api";
import type { AdminAuditEntry } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  Table,
  WarningBox,
  type Column,
} from "@/components/ui";

export default function DenetimPage() {
  return (
    <PageGate action="audit.view">
      <AuditLogViewer />
    </PageGate>
  );
}

function AuditLogViewer() {
  const { role } = useAdminSession();
  const scoped = levelOf(role, "audit.view") === "read"; // yalnız kendi alanı

  const [action, setAction] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [from, setFrom] = useState(toDateInput(daysAgo(29)));
  const [to, setTo] = useState(toDateInput(new Date()));
  const [onlyCritical, setOnlyCritical] = useState(false);
  const search = useDebounced(searchInput);

  // İ-59: SUNUCU TARAFI dışa aktarım durumu (dört-göz akışı).
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<{ approvalId: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dlApprovalId, setDlApprovalId] = useState("");
  const [dlBusy, setDlBusy] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  async function requestServerExport() {
    setExportBusy(true);
    setExportError(null);
    setExportResult(null);
    try {
      const res = await adminApi<{
        approvalRequired: boolean;
        approvalRequest?: { id?: string } | { approvalId?: string };
        message?: string;
      }>(`${EP.audit}/export`, {
        method: "POST",
        body: {
          from: from || undefined,
          to: to || undefined,
          action: action || undefined,
          reason: exportReason.trim(),
        },
      });
      const raw = res.approvalRequest as { id?: string; approvalId?: string } | undefined;
      const approvalId = raw?.id ?? raw?.approvalId ?? "";
      setExportResult({ approvalId });
    } catch (err) {
      setExportError(errorMessage(err, "Dışa aktarım talebi açılamadı."));
    } finally {
      setExportBusy(false);
    }
  }

  async function downloadApprovedExport() {
    setDlBusy(true);
    setDlError(null);
    try {
      // Sunucu sözleşmesi: { approvalId, rowCount, truncated, csv, note }.
      const res = await adminApi<{ approvalId: string; rowCount: number; truncated: boolean; csv: string; note?: string }>(
        `${EP.audit}/export/${encodeURIComponent(dlApprovalId.trim())}`,
      );
      if (res.csv) {
        const blob = new Blob(["\ufeff" + res.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `denetim-izi-${dlApprovalId.trim().slice(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        if (res.truncated) {
          setDlError(
            `Dosya satır sınırında kesildi (${res.rowCount} satır). Tam kapsam için tarih aralığını daraltıp yeni talep açın.`,
          );
        }
      } else {
        setDlError("Sunucu dosya içeriği döndürmedi.");
      }
    } catch (err) {
      setDlError(errorMessage(err, "İndirme başarısız."));
    } finally {
      setDlBusy(false);
    }
  }

  const res = useListResource<AdminAuditEntry>(EP.audit, {
    query: {
      action: action || undefined,
      q: search || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: 200,
    },
  });

  const rows = useMemo(
    () =>
      onlyCritical
        ? res.data.filter((l) => CRITICAL_AUDIT_ACTIONS.includes(l.action))
        : res.data,
    [res.data, onlyCritical],
  );

  const actionOptions = useMemo(
    () => [...new Set(res.data.map((l) => l.action))].sort(),
    [res.data],
  );

  const columns: Array<Column<AdminAuditEntry>> = [
    {
      key: "at",
      header: "Tarih",
      render: (l) => <span className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</span>,
    },
    {
      key: "user",
      header: "Personel",
      render: (l) => (
        <div>
          <p className="font-mono text-xs text-steel-200">
            {/* F2-Ö-32: sunucu platformUser'ı İÇ İÇE döndürüyor
                ({ platformUser: { email, fullName, role } }); eski kod düz
                alanlar bekliyordu ve her satır "—" gösteriyordu. */}
            {l.platformUser?.email ?? l.platformUser?.fullName ?? l.platformUserId ?? "—"}
          </p>
          {l.platformUser?.role && (
            <p className="text-[11px] text-steel-500">{roleLabel(l.platformUser.role)}</p>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Aksiyon",
      render: (l) => (
        <span className="inline-flex items-center gap-2">
          {CRITICAL_AUDIT_ACTIONS.includes(l.action) && (
            <Badge tone="danger" title="Kritik aksiyon">
              kritik
            </Badge>
          )}
          <span>
            <span className="block text-steel-100">{labelOf(AUDIT_ACTION_LABELS, l.action)}</span>
            <span className="font-mono text-[11px] text-steel-600">{l.action}</span>
          </span>
        </span>
      ),
    },
    {
      key: "tenant",
      header: "Hedef tenant",
      render: (l) =>
        l.tenantId ? (
          <Link href={`/tenantlar/${l.tenantId}`} className="text-steel-200 hover:text-accent-300">
            {l.tenantName ?? l.tenantId}
          </Link>
        ) : (
          <span className="text-steel-600">platform</span>
        ),
    },
    {
      key: "entity",
      header: "Varlık",
      render: (l) => (
        <span className="text-xs">
          {l.entity ?? "—"}
          {l.entityId && (
            <span className="block font-mono text-[11px] text-steel-600">{l.entityId}</span>
          )}
        </span>
      ),
    },
    {
      key: "detail",
      header: "Detay (PII maskeli)",
      render: (l) => <span className="text-xs text-steel-400">{l.detail ?? "—"}</span>,
    },
    {
      key: "ip",
      header: "IP",
      render: (l) => <span className="font-mono text-xs text-steel-500">{l.ipAddress ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Denetim İzi"
        description="PlatformAuditLog — her mutasyon ve her hassas okuma (destek erişimi, ödeme detayı, dışa aktarım) kaydedilir."
        action={
          <RoleGate action="audit.export" mutation>
            <span className="inline-flex items-center gap-2">
              <ApprovalBadge action="audit.export" />
              <Button
                variant="secondary"
                disabled={rows.length === 0}
                onClick={() =>
                  exportCsv("denetim-izi", rows, [
                    { key: "createdAt", header: "Tarih", value: (l) => l.createdAt },
                    {
                      key: "user",
                      header: "Personel",
                      value: (l) => l.platformUser?.email ?? l.platformUserId ?? "",
                    },
                    { key: "role", header: "Rol", value: (l) => l.platformUser?.role ?? "" },
                    { key: "action", header: "Aksiyon", value: (l) => l.action },
                    { key: "tenantId", header: "Tenant ID", value: (l) => l.tenantId ?? "" },
                    { key: "tenant", header: "Tenant", value: (l) => l.tenantName ?? "" },
                    { key: "entity", header: "Varlık", value: (l) => l.entity ?? "" },
                    { key: "entityId", header: "Varlık ID", value: (l) => l.entityId ?? "" },
                    { key: "detail", header: "Detay", value: (l) => l.detail ?? "" },
                    { key: "ip", header: "IP", value: (l) => l.ipAddress ?? "" },
                  ])
                }
              >
                Ekrandan CSV (limitli)
              </Button>
              {/* İ-59: kapsamlı dışa aktarım SUNUCUDA — dört-göz talebi */}
              <Button
                variant="primary"
                onClick={() => {
                  setExportOpen(true);
                  setExportResult(null);
                  setExportError(null);
                }}
              >
                Sunucu dışa aktarımı (dört-göz)
              </Button>
            </span>
          </RoleGate>
        }
      />

      <WarningBox title="Dışa aktarım hakkında">
        <strong>Ekrandan CSV</strong> yalnız listelenen ilk 200 kaydı içerir (hızlı bakış).
        Kapsamlı, filigranlı ve dört-göz onaylı dışa aktarım için{" "}
        <strong>Sunucu dışa aktarımı</strong> düğmesini kullanın: talep onay kuyruğuna düşer,
        ikinci bir yetkili onayladıktan sonra dosyayı YALNIZ siz, TEK SEFER indirirsiniz.
      </WarningBox>

      {scoped && (
        <InfoBox title="Kapsamlı görünüm (👁)">
          Rolünüz yalnız kendi alanınızdaki kayıtları görür (operasyon / finans / destek).
          Filtreleme sunucu tarafında rol filtresinden geçer; istemci ek kayıt açamaz.
        </InfoBox>
      )}

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Arama">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Personel, tenant, detay"
            />
          </Field>
          <Field label="Aksiyon">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Tümü</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {labelOf(AUDIT_ACTION_LABELS, a)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs text-steel-300">
              <input
                type="checkbox"
                checked={onlyCritical}
                onChange={(e) => setOnlyCritical(e.target.checked)}
                className="h-4 w-4 rounded border-steel-600 bg-steel-950 accent-accent-500"
              />
              Yalnız kritik aksiyonlar
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchInput("");
                setAction("");
                setFrom(toDateInput(daysAgo(29)));
                setTo(toDateInput(new Date()));
                setOnlyCritical(false);
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={res.loaded ? `${rows.length} kayıt` : "Denetim izi"}
        subtitle="Append-only · uzun süreli saklama · kiracı silinse dahi iz kalır"
      >
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.loaded && rows.length === 0}
          endpoint={EP.audit}
          what="Denetim izi"
          emptyMessage="Filtrelere uyan denetim kaydı yok."
        >
          <Table columns={columns} rows={rows} rowKey={(l) => l.id} dense />
        </ResourceView>
      </Card>

      {/* İ-59: sunucu tarafı dışa aktarım talebi — dört-göz akışı */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Sunucu dışa aktarımı (dört-göz)"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Dışa aktarılacak aralık (mevcut filtreler)</p>
            <p className="mt-1">
              {from || "başlangıç"} → {to || "bugün"}
              {action ? ` · aksiyon: ${action}` : " · tüm aksiyonlar"}
            </p>
            <p className="mt-1 text-slate-500">
              Dosya sunucuda, filigranlı üretilir; talep onay kuyruğuna düşer.
            </p>
          </div>

          <Field label="Gerekçe" hint="Denetim izine yazılır; boş bırakılamaz.">
            <Input
              value={exportReason}
              onChange={(e) => setExportReason(e.target.value)}
              placeholder="Örn: 2026 Eylül finans mutabakatı"
              maxLength={500}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={exportBusy || !exportReason.trim()}
              onClick={() => void requestServerExport()}
            >
              {exportBusy ? "Talep açılıyor…" : "Dışa aktarım talebi aç"}
            </Button>
          </div>

          {exportError && <p className="text-xs text-red-700">{exportError}</p>}

          {exportResult && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800">
              <p className="font-semibold">Dışa aktarım talebi açıldı (202).</p>
              <p className="mt-1">
                Onay kuyruğundan ikinci bir yetkilinin onayı bekleniyor. Onaylandığında
                aşağıdaki indirme alanından <strong>yalnızca siz, tek sefer</strong>{" "}
                indirebilirsiniz.
                {exportResult.approvalId ? (
                  <>
                    {" "}Talep kimliği:{" "}
                    <code className="rounded bg-white px-1 py-0.5">{exportResult.approvalId}</code>
                  </>
                ) : null}
              </p>
              <Link href="/onaylar" className="mt-1 inline-block font-medium underline">
                Onay kuyruğuna git →
              </Link>
            </div>
          )}

          <div className="border-t border-slate-200 pt-3">
            <p className="mb-1.5 text-xs font-medium text-slate-700">
              Onaylanmış dışa aktarımı indir (tek seferlik)
            </p>
            <div className="flex gap-2">
              <Input
                value={dlApprovalId}
                onChange={(e) => setDlApprovalId(e.target.value)}
                placeholder="Onay talebi kimliği…"
                className="flex-1"
              />
              <Button
                variant="secondary"
                disabled={dlBusy || !dlApprovalId.trim()}
                onClick={() => void downloadApprovedExport()}
              >
                {dlBusy ? "İndiriliyor…" : "İndir"}
              </Button>
            </div>
            {dlError && <p className="mt-1 text-xs text-red-700">{dlError}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Kapat
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
