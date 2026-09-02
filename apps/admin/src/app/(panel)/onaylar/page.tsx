"use client";

/**
 * Onay kuyruğu — dört-göz (two-person rule) talepleri.
 *
 * Uçlar: GET /approvals?status= · POST /approvals/:id/approve · POST /approvals/:id/reject
 *
 * KURAL: talep eden ≠ onaylayan. Sunucu kendi talebini onaylamaya çalışanı 403 ile reddeder;
 * panel bunu ÖNCEDEN gösterir (düğme pasif + açıklama) ve 403 dönerse anlaşılır biçimde
 * yeniden söyler. Onaylanmayan talep 72 saatte SURESI_DOLDU durumuna geçer.
 */

import { useMemo, useState } from "react";
import { useListResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { can, canApproveRequest, type AdminAction } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalStatusBadge } from "@/components/ApprovalBadge";
import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_STATUSES,
  APPROVAL_TIMEOUT_HOURS,
  fmtDateTime,
  labelOf,
  payloadRows,
  remainingLabel,
  roleLabel,
} from "@/lib/labels";
import type { AdminApprovalRequest } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EndpointMissingNotice,
  ErrorBox,
  Field,
  InfoBox,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  SuccessBox,
  Tabs,
  Textarea,
  WarningBox,
} from "@/components/ui";

type TabKey = "bekleyen" | "gecmis";

export default function OnaylarPage() {
  return (
    <PageGate action="approval.view">
      <ApprovalQueue />
    </PageGate>
  );
}

function ApprovalQueue() {
  const { role, user } = useAdminSession();
  const [tab, setTab] = useState<TabKey>("bekleyen");
  const [statusFilter, setStatusFilter] = useState("");
  const [decision, setDecision] = useState<{
    item: AdminApprovalRequest;
    type: "onay" | "red";
  } | null>(null);

  const res = useListResource<AdminApprovalRequest>(EP.approvals.list, {
    query: {
      status: tab === "bekleyen" ? "BEKLIYOR" : statusFilter || undefined,
    },
  });

  const rows = useMemo(() => {
    if (tab === "bekleyen") return res.data.filter((a) => a.status === "BEKLIYOR");
    return res.data.filter((a) => a.status !== "BEKLIYOR");
  }, [res.data, tab]);

  const canDecide = can(role, "approval.decide");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onay Kuyruğu"
        description="Tek kişiyle tamamlanamayan işlemler burada bekler. Talep eden ve onaylayan kimlikleri PlatformAuditLog'a yazılır."
      />

      <InfoBox title="Dört-göz kuralı">
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
          <li>
            <strong>Talep eden kendi talebini onaylayamaz.</strong> Bu satırlarda düğmeler
            pasiftir; zorlanırsa sunucu 403 döner.
          </li>
          <li>
            Onaylanmayan talep <strong>{APPROVAL_TIMEOUT_HOURS} saat</strong> sonunda
            kendiliğinden <code className="font-mono text-xs">SURESI_DOLDU</code> olur ve işlem
            uygulanmaz.
          </li>
          <li>
            Kapsam: tenant askıya alma/silme, plan ve özel fiyat değişikliği, iade, destek erişim
            penceresi, bakım kilidi, platform geneli flag, SUPER_ADMIN atama, denetim izi dışa
            aktarımı.
          </li>
        </ul>
      </InfoBox>

      {!canDecide && (
        <WarningBox title="Salt-görüntüleme">
          Rolünüz onay kuyruğunu görüntüleyebilir ancak karar veremez; onayla/reddet düğmeleri
          gösterilmez.
        </WarningBox>
      )}

      <Tabs
        tabs={[
          { key: "bekleyen", label: "Bekleyen", count: rows.length },
          { key: "gecmis", label: "Karara bağlananlar" },
        ]}
        active={tab}
        onChange={(k) => {
          setTab(k);
          setStatusFilter("");
        }}
      />

      {tab === "gecmis" && (
        <Card bodyClassName="p-4">
          <div className="max-w-xs">
            <Field label="Durum">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Tümü (bekleyen hariç)</option>
                {APPROVAL_STATUSES.filter((s) => s !== "BEKLIYOR").map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && rows.length === 0}
        endpoint={EP.approvals.list}
        what="Onay kuyruğu"
        emptyMessage={tab === "bekleyen" ? "Bekleyen onay yok." : "Karara bağlanmış talep yok."}
      >
        <ul className="space-y-4">
          {rows.map((a) => {
            const isOwnRequest =
              (!!user?.id && a.requestedBy === user.id) ||
              (!!user?.email && !!a.requestedByEmail && a.requestedByEmail === user.email);
            const allowed = canApproveRequest(role, user?.id, a.requestedBy) && !isOwnRequest;
            const payload = payloadRows(a.payload ?? a.payloadJson);

            return (
              <li key={a.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="steel" title="PlatformApprovalRequest.action">
                          {labelOf(APPROVAL_ACTION_LABELS, a.action)}
                        </Badge>
                        {/* İ-58: rozet satırın KENDİ eylemini taşır — eskiden
                            her satıra sabit "tenant.suspend" basılıyordu ve
                            örn. kredi değişikliği de "askıya alma" gibi
                            görünüyordu. */}
                        <ApprovalBadge action={a.action as AdminAction} force />
                        <ApprovalStatusBadge status={a.status} expiresAt={a.expiresAt} />
                        {isOwnRequest && (
                          <Badge tone="yellow" title="Talep eden ≠ onaylayan kuralı">
                            Sizin talebiniz
                          </Badge>
                        )}
                      </div>

                      <p className="mt-2 font-mono text-xs text-steel-500">{a.action}</p>

                      {a.tenantName || a.tenantId ? (
                        <p className="mt-1 text-sm text-steel-200">
                          Hedef: <span className="text-steel-50">{a.tenantName ?? a.tenantId}</span>
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-steel-400">Hedef: platform</p>
                      )}

                      {payload.length > 0 && (
                        <div className="mt-3 rounded-lg border border-steel-800 bg-steel-950/60 p-3">
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel-500">
                            Talep içeriği
                          </p>
                          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                            {payload.map((p) => (
                              <div key={p.key} className="flex gap-2">
                                <dt className="shrink-0 font-mono text-steel-500">{p.key}:</dt>
                                <dd className="break-words text-steel-200">{p.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}

                      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-steel-500 sm:grid-cols-2">
                        <div>
                          <dt className="inline">Talep eden: </dt>
                          <dd className="inline text-steel-300">
                            {a.requestedByEmail ?? a.requestedByName ?? a.requestedBy}
                            {a.requestedByRole ? ` (${roleLabel(a.requestedByRole)})` : ""}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Talep tarihi: </dt>
                          <dd className="inline text-steel-300">{fmtDateTime(a.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline">
                            {a.status === "BEKLIYOR" ? "Zaman aşımı: " : "Karar: "}
                          </dt>
                          <dd className="inline text-steel-300">
                            {a.status === "BEKLIYOR"
                              ? `${fmtDateTime(a.expiresAt)} · ${remainingLabel(a.expiresAt)}`
                              : `${a.decidedByEmail ?? a.decidedBy ?? "—"} · ${fmtDateTime(a.decidedAt)}`}
                          </dd>
                        </div>
                        {a.decisionNote && (
                          <div>
                            <dt className="inline">Karar notu: </dt>
                            <dd className="inline text-steel-300">{a.decisionNote}</dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    {a.status === "BEKLIYOR" && canDecide && (
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {isOwnRequest && (
                          <p className="max-w-[18rem] text-right text-xs text-amber-300">
                            Kendi talebinizi onaylayamazsınız (dört-göz kuralı). Farklı bir
                            yetkilinin karar vermesi gerekir; sunucu aksi denemeyi 403 ile
                            reddeder.
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={!allowed}
                            title={isOwnRequest ? "Kendi talebinizi reddedemezsiniz." : undefined}
                            onClick={() => setDecision({ item: a, type: "red" })}
                          >
                            Reddet
                          </Button>
                          <Button
                            disabled={!allowed}
                            title={isOwnRequest ? "Kendi talebinizi onaylayamazsınız." : undefined}
                            onClick={() => setDecision({ item: a, type: "onay" })}
                          >
                            Onayla
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </ResourceView>

      {decision && (
        <DecisionModal
          item={decision.item}
          type={decision.type}
          onClose={() => setDecision(null)}
          onDone={() => res.reload()}
        />
      )}
    </div>
  );
}

function DecisionModal({
  item,
  type,
  onClose,
  onDone,
}: {
  item: AdminApprovalRequest;
  type: "onay" | "red";
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const mutation = useMutation();
  const path = type === "onay" ? EP.approvals.approve(item.id) : EP.approvals.reject(item.id);

  async function submit() {
    const ok = await mutation.run(
      path,
      { method: "POST", body: { note: note.trim() } },
      {
        successMessage:
          type === "onay"
            ? "Talep onaylandı; işlem uygulandı ve denetim izine yazıldı."
            : "Talep reddedildi.",
        onSuccess: onDone,
      },
    );
    if (ok) onDone();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={type === "onay" ? "Talebi onayla" : "Talebi reddet"}
      subtitle={`POST /api/admin/v1${path}`}
    >
      <div className="space-y-4">
        <Card bodyClassName="p-4">
          <p className="text-sm text-steel-100">{labelOf(APPROVAL_ACTION_LABELS, item.action)}</p>
          <p className="mt-1 text-xs text-steel-500">
            Talep eden: {item.requestedByEmail ?? item.requestedBy} ·{" "}
            {item.tenantName ?? item.tenantId ?? "platform"}
          </p>
        </Card>

        {type === "onay" && (
          <WarningBox title="Onay işlemi geri alınamaz">
            Onayınız işlemi <strong>uygulanabilir</strong> hâle getirir; hem talep eden hem
            onaylayan kimliği denetim izine yazılır.
          </WarningBox>
        )}

        <Field
          label={type === "onay" ? "Onay notu" : "Red gerekçesi"}
          required={type === "red"}
          hint="PlatformApprovalRequest.decisionNote alanına yazılır."
        >
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Karar gerekçesi…"
          />
        </Field>

        {mutation.missing && (
          <EndpointMissingNotice endpoint={path} method="POST" what="Onay kararı" />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            variant={type === "onay" ? "primary" : "danger"}
            disabled={mutation.loading || (type === "red" && note.trim().length === 0)}
            onClick={() => void submit()}
          >
            {mutation.loading ? "Gönderiliyor…" : type === "onay" ? "Onayla" : "Reddet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
