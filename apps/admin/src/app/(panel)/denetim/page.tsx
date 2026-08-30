"use client";

/**
 * Denetim İzi — PlatformAuditLog görüntüleyici.
 * Append-only: uygulama DB rolünde UPDATE/DELETE yetkisi yoktur; min. 10 yıl saklanır.
 * Rol kapsamı: SUPER_ADMIN tümünü, diğer roller yalnız kendi alanlarını görür (API'de filtrelenir).
 * CSV dışa aktarımı dört-göz onayı gerektirir.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { levelOf } from "@/lib/rbac";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  AUDIT_ACTION_LABELS,
  CRITICAL_AUDIT_ACTIONS,
  ROLE_LABELS,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";
import { MOCK_AUDIT_LOGS, type AdminAuditLog } from "@/lib/mock";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  InfoBox,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
  Select,
  Table,
  Textarea,
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
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const res = useResource<AdminAuditLog[]>("/audit-logs", [...MOCK_AUDIT_LOGS], {
    query: {
      action: action || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return res.data.filter((l) => {
      if (action && l.action !== action) return false;
      if (onlyCritical && !CRITICAL_AUDIT_ACTIONS.includes(l.action)) return false;
      if (from && l.createdAt < from) return false;
      if (to && l.createdAt > `${to}T23:59:59`) return false;
      if (!q) return true;
      return (
        l.platformUserEmail.toLocaleLowerCase("tr").includes(q) ||
        (l.targetTenantName ?? "").toLocaleLowerCase("tr").includes(q) ||
        l.detail.toLocaleLowerCase("tr").includes(q) ||
        l.action.toLocaleLowerCase("tr").includes(q)
      );
    });
  }, [res.data, action, search, from, to, onlyCritical]);

  const actionOptions = useMemo(
    () => [...new Set(res.data.map((l) => l.action))].sort(),
    [res.data],
  );

  const columns: Array<Column<AdminAuditLog>> = [
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
          <p className="font-mono text-xs text-steel-200">{l.platformUserEmail}</p>
          <p className="text-[11px] text-steel-500">
            {ROLE_LABELS[l.role as keyof typeof ROLE_LABELS] ?? l.role}
          </p>
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
        l.targetTenantName ? (
          <Link
            href={`/tenantlar/${l.targetTenantCode ?? ""}`}
            className="text-steel-200 hover:text-accent-300"
          >
            {l.targetTenantName}
          </Link>
        ) : (
          <span className="text-steel-600">platform</span>
        ),
    },
    { key: "entity", header: "Varlık", render: (l) => <span className="text-xs">{l.entity ?? "—"}</span> },
    {
      key: "detail",
      header: "Detay (eski → yeni, PII maskeli)",
      render: (l) => <span className="text-xs text-steel-400">{l.detail}</span>,
    },
    { key: "ip", header: "IP", render: (l) => <span className="font-mono text-xs text-steel-500">{l.ip}</span> },
    {
      key: "approval",
      header: "Onay",
      render: (l) =>
        l.approvalRequestId ? (
          <Link href="/onaylar" className="font-mono text-xs text-accent-300">
            {l.approvalRequestId}
          </Link>
        ) : (
          <span className="text-steel-700">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Denetim İzi"
        description="PlatformAuditLog — her mutasyon ve her hassas okuma (destek görüntüleme, ödeme detayı, dışa aktarım) kaydedilir."
        action={
          <div className="flex items-center gap-2">
            {res.pending && <MockBadge />}
            <RoleGate action="audit.export" mutation>
              <span className="inline-flex items-center gap-2">
                <Button variant="secondary" onClick={() => setExportOpen(true)}>
                  CSV dışa aktar
                </Button>
                <ApprovalBadge action="audit.export" />
              </span>
            </RoleGate>
          </div>
        }
      />

      {res.pending && <PendingEndpointNotice endpoint="/audit-logs" phase="Faz 1" />}

      {scoped && (
        <InfoBox title="Kapsamlı görünüm (👁)">
          Rolünüz yalnız kendi alanınızdaki kayıtları görür (OPS: operasyon, BILLING: finans,
          SUPPORT: kendi işlemleri). Filtreleme sunucu tarafında rol filtresinden geçer.
        </InfoBox>
      )}

      <Card bodyClassName="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Arama">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                setSearch("");
                setAction("");
                setFrom("");
                setTo("");
                setOnlyCritical(false);
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`${rows.length} kayıt`} subtitle="Append-only · min. 10 yıl saklama · zincirlenmiş hash / WORM kopya">
        <Table columns={columns} rows={rows} rowKey={(l) => l.id} dense />
      </Card>

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Denetim izi dışa aktarımı"
        subtitle="GET /audit-logs?format=csv — dört-göz onayı"
      >
        <div className="space-y-4">
          <ApprovalNotice action="audit.export" />
          <PendingEndpointNotice endpoint="/audit-logs" phase="Faz 1" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Başlangıç" required>
              <Input type="date" />
            </Field>
            <Field label="Bitiş" required>
              <Input type="date" />
            </Field>
          </div>
          <Field label="Gerekçe" required hint="Dışa aktarımın kendisi de PlatformAuditLog'a yazılır.">
            <Textarea rows={3} placeholder="Denetim talebi referansı, VERBİS başvurusu…" />
          </Field>
          <InfoBox>
            Dışa aktarım sunucu tarafında rol filtresinden geçer. Üretilen CSV dosyaları MinIO
            lifecycle ile 7 gün sonra silinir.
          </InfoBox>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled title="Uç henüz uygulanmadı">
              Onaya gönder
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
