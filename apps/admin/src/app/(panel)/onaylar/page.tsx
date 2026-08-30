"use client";

/**
 * Onay kuyruğu — dört-göz (two-person rule) talepleri.
 * Kurallar: talep eden ≠ onaylayan; onaylanmayan talep 72 saatte ZAMAN_ASIMI olur;
 * onay ekranı öncesi step-up doğrulama (2FA yeniden istenir).
 */

import { useMemo, useState } from "react";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { ACTION_LABELS, canApproveRequest, can } from "@/lib/rbac";
import { PageGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalStatusBadge } from "@/components/ApprovalBadge";
import {
  APPROVAL_TIMEOUT_HOURS,
  ROLE_LABELS,
  fmtDateTime,
  remainingLabel,
} from "@/lib/labels";
import { MOCK_APPROVALS, type AdminApproval } from "@/lib/mock";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoBox,
  Input,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
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
  const [decision, setDecision] = useState<{ item: AdminApproval; type: "onay" | "red" } | null>(
    null,
  );
  const [totp, setTotp] = useState("");

  const res = useResource<AdminApproval[]>("/approvals", [...MOCK_APPROVALS]);

  const pending = useMemo(() => res.data.filter((a) => a.status === "BEKLIYOR"), [res.data]);
  const history = useMemo(() => res.data.filter((a) => a.status !== "BEKLIYOR"), [res.data]);

  const list = tab === "bekleyen" ? pending : history;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onay Kuyruğu"
        description="Tek kişiyle tamamlanamayan işlemler burada bekler. Her iki kimlik (talep eden ve onaylayan) PlatformAuditLog'a yazılır."
        action={res.pending ? <MockBadge /> : undefined}
      />

      {res.pending && <PendingEndpointNotice endpoint="/approvals" phase="Faz 1" />}

      <InfoBox title="Dört-göz kapsamındaki işlemler">
        <ol className="mt-1 list-inside list-decimal space-y-0.5 text-sm">
          <li>Tenant kalıcı silme / veri imhası (iki SUPER_ADMIN)</li>
          <li>Tenant askıya alma (talep: OPS/BILLING → onay: SUPER veya farklı OPS_ADMIN)</li>
          <li>İade — eşik üstü (varsayılan &gt; ₺5.000) ve her toplu iade</li>
          <li>Özel fiyat / manuel indirim</li>
          <li>Destek erişim penceresi açma (+ tenant ADMIN onayı)</li>
          <li>Bakım modu tam kilidi ve platform geneli flag / rate-limit değişikliği</li>
          <li>Yeni SUPER_ADMIN atama / mevcut SUPER_ADMIN&apos;i düşürme</li>
          <li>PlatformAuditLog dışa aktarımı</li>
        </ol>
      </InfoBox>

      <Tabs
        tabs={[
          { key: "bekleyen", label: "Bekleyen", count: pending.length },
          { key: "gecmis", label: "Karara bağlananlar", count: history.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {list.length === 0 ? (
        <EmptyState message={tab === "bekleyen" ? "Bekleyen onay yok." : "Kayıt yok."} />
      ) : (
        <ul className="space-y-4">
          {list.map((a) => {
            const isOwnRequest = a.requestedByEmail === user?.email;
            const allowed = canApproveRequest(role, user?.id, a.requestedById) && !isOwnRequest;
            return (
              <li key={a.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="steel" title="PlatformApprovalRequest.action">
                          {ACTION_LABELS[a.actionKey] ?? a.action}
                        </Badge>
                        <ApprovalBadge action={a.actionKey} force />
                        <ApprovalStatusBadge status={a.status} expiresAt={a.expiresAt} />
                      </div>
                      <p className="mt-2 text-base font-medium text-steel-50">{a.summary}</p>
                      <p className="mt-1 text-sm text-steel-300">
                        <span className="text-steel-500">Gerekçe: </span>
                        {a.reason}
                      </p>
                      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-steel-500 sm:grid-cols-2">
                        <div>
                          <dt className="inline">Talep eden: </dt>
                          <dd className="inline text-steel-300">
                            {a.requestedByEmail} (
                            {ROLE_LABELS[a.requestedByRole as keyof typeof ROLE_LABELS] ??
                              a.requestedByRole}
                            )
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Talep tarihi: </dt>
                          <dd className="inline text-steel-300">{fmtDateTime(a.requestedAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Hedef: </dt>
                          <dd className="inline text-steel-300">{a.targetTenantName ?? "platform"}</dd>
                        </div>
                        <div>
                          <dt className="inline">
                            {a.status === "BEKLIYOR" ? "Zaman aşımı: " : "Karar: "}
                          </dt>
                          <dd className="inline text-steel-300">
                            {a.status === "BEKLIYOR"
                              ? `${fmtDateTime(a.expiresAt)} · ${remainingLabel(a.expiresAt)}`
                              : `${a.approvedByEmail ?? "—"} · ${fmtDateTime(a.decidedAt)}`}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {a.status === "BEKLIYOR" && (
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {!can(role, "approval.decide") ? (
                          <p className="max-w-[16rem] text-right text-xs text-steel-500">
                            Onay verme yetkiniz yok; bu kuyruğu yalnız görüntüleyebilirsiniz.
                          </p>
                        ) : isOwnRequest ? (
                          <p className="max-w-[16rem] text-right text-xs text-amber-300">
                            Kendi talebinizi onaylayamazsınız (talep eden ≠ onaylayan).
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={!allowed}
                            onClick={() => {
                              setDecision({ item: a, type: "red" });
                              setTotp("");
                            }}
                          >
                            Reddet
                          </Button>
                          <Button
                            disabled={!allowed}
                            onClick={() => {
                              setDecision({ item: a, type: "onay" });
                              setTotp("");
                            }}
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
      )}

      <p className="text-xs text-steel-500">
        Onaylanmayan talepler {APPROVAL_TIMEOUT_HOURS} saat sonunda kendiliğinden ZAMAN_ASIMI
        durumuna geçer ve işlem uygulanmaz.
      </p>

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision?.type === "onay" ? "Talebi onayla" : "Talebi reddet"}
        subtitle={decision ? `PATCH /approvals/${decision.item.id}` : undefined}
      >
        {decision && (
          <div className="space-y-4">
            <PendingEndpointNotice
              endpoint={`/approvals/${decision.item.id}`}
              phase="Faz 1"
              method="PATCH"
            />
            <Card bodyClassName="p-4">
              <p className="text-sm text-steel-100">{decision.item.summary}</p>
              <p className="mt-1 text-xs text-steel-500">
                Talep eden: {decision.item.requestedByEmail}
              </p>
            </Card>

            {decision.type === "onay" && (
              <WarningBox title="Step-up doğrulama">
                Dört-göz onayı öncesi 2FA yeniden istenir. Onayınız işlemi{" "}
                <strong>uygulanabilir</strong> hâle getirir ve her iki kimlik denetim izine yazılır.
              </WarningBox>
            )}

            {decision.type === "onay" && (
              <Field label="TOTP kodu" required>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                />
              </Field>
            )}

            <Field
              label={decision.type === "onay" ? "Onay notu" : "Red gerekçesi"}
              required={decision.type === "red"}
            >
              <Textarea rows={3} placeholder="Karar gerekçesi…" />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDecision(null)}>
                Vazgeç
              </Button>
              <Button
                variant={decision.type === "onay" ? "primary" : "danger"}
                disabled={decision.type === "onay" && totp.length !== 6}
                title="Uç henüz uygulanmadı"
              >
                {decision.type === "onay" ? "Onayla" : "Reddet"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
