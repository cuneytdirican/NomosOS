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
import type { AdminAuditEntry } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoBox,
  Input,
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
                CSV dışa aktar
              </Button>
            </span>
          </RoleGate>
        }
      />

      <WarningBox title="Dışa aktarım hakkında">
        Buradaki CSV, <strong>ekranda listelenen ve sunucunun rol filtresinden geçmiş</strong>{" "}
        kayıtları istemcide dosyaya yazar. Kapsamlı, dört-göz onaylı ve filigranlı sunucu tarafı
        dışa aktarımı ayrı bir uçtur; hazır olduğunda bu düğme o uca bağlanacaktır.
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
    </div>
  );
}
