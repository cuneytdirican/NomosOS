"use client";

/**
 * Yöneticiler — platform personeli (PlatformUser) ve rolleri. Yalnız SUPER_ADMIN görür ve yazar.
 *
 * Uçlar: GET /platform-users · POST /platform-users · PATCH /platform-users/:id ·
 *        DELETE /platform-users/:id  (hard delete DEĞİL — pasifleştirme)
 *
 * Kurallar (sunucuda da zorlanır): kullanıcı başına tek rol · kendi rolünü kimse değiştiremez ·
 * her an en az iki aktif SUPER_ADMIN · SUPER_ADMIN atama/düşürme dört-göz kapsamındadır ·
 * twoFactorSecret hiçbir yanıtta dönmez.
 */

import { useMemo, useState } from "react";
import { useListResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  ACTION_LABELS,
  ADMIN_ROLES,
  PERMISSION_LEVEL_LABELS,
  PERMISSION_LEVEL_SYMBOLS,
  PERMISSION_MATRIX,
  type AdminAction,
} from "@/lib/rbac";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, fmtDateTime, roleLabel, roleTone } from "@/lib/labels";
import type { AdminPlatformUser } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EndpointMissingNotice,
  ErrorBox,
  Field,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  SuccessBox,
  Table,
  WarningBox,
  type Column,
} from "@/components/ui";

export default function YoneticilerPage() {
  return (
    <PageGate
      action="platform_user.view"
      hint="Platform personeli yönetimi yalnız SUPER_ADMIN rolüne açıktır."
    >
      <PlatformUsers />
    </PageGate>
  );
}

function PlatformUsers() {
  const { user } = useAdminSession();
  const res = useListResource<AdminPlatformUser>(EP.platformUsers.list);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlatformUser | null>(null);
  const disable = useMutation();

  const activeSuperAdmins = useMemo(
    () => res.data.filter((u) => u.role === "SUPER_ADMIN" && u.isActive).length,
    [res.data],
  );

  async function doDisable(u: AdminPlatformUser) {
    await disable.run(
      EP.platformUsers.remove(u.id),
      { method: "DELETE" },
      { successMessage: `${u.email} pasifleştirildi.`, onSuccess: () => res.reload() },
    );
    res.reload();
  }

  const columns: Array<Column<AdminPlatformUser>> = [
    {
      key: "user",
      header: "Kullanıcı",
      render: (u) => (
        <div>
          <p className="text-steel-100">{u.fullName}</p>
          <p className="font-mono text-xs text-steel-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Rol",
      render: (u) => <Badge tone={roleTone(u.role)}>{roleLabel(u.role)}</Badge>,
    },
    {
      key: "status",
      header: "Durum",
      render: (u) =>
        u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge tone="gray">Pasif</Badge>,
    },
    {
      key: "totp",
      header: "2FA",
      render: (u) =>
        u.twoFactorEnabled === undefined ? (
          <span className="text-xs text-steel-600">—</span>
        ) : u.twoFactorEnabled ? (
          <Badge tone="green">Kurulu</Badge>
        ) : (
          <Badge tone="yellow">Kurulmadı</Badge>
        ),
    },
    { key: "login", header: "Son giriş", render: (u) => fmtDateTime(u.lastLoginAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) => {
        const isSelf = u.id === user?.id || u.email === user?.email;
        const lastSuperAdmins = u.role === "SUPER_ADMIN" && u.isActive && activeSuperAdmins <= 2;
        return (
          <RoleGate action="platform_user.manage" mutation>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={isSelf}
                title={isSelf ? "Kendi rolünüzü değiştiremezsiniz." : undefined}
                onClick={() => setEditing(u)}
              >
                Düzenle
              </Button>
              {u.isActive && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isSelf || lastSuperAdmins || disable.loading}
                  title={
                    lastSuperAdmins
                      ? "Sistemde her an en az iki aktif SUPER_ADMIN bulunmalıdır."
                      : isSelf
                        ? "Kendinizi pasifleştiremezsiniz."
                        : undefined
                  }
                  onClick={() => void doDisable(u)}
                >
                  Pasifleştir
                </Button>
              )}
            </div>
          </RoleGate>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yöneticiler"
        description="Platform personeli (PlatformUser) — tenant kullanıcılarından tamamen ayrı kimlik uzayı; aralarında FK yoktur ve e-posta uzayları ayrıdır."
        action={
          <RoleGate action="platform_user.manage" mutation>
            <Button onClick={() => setInviteOpen(true)}>Personel ekle</Button>
          </RoleGate>
        }
      />

      {res.loaded && activeSuperAdmins < 2 && (
        <WarningBox title="Kritik: tek SUPER_ADMIN">
          Sistemde her an en az iki aktif SUPER_ADMIN bulunmalıdır; tek kalınırsa dört-göz
          işlemleri kilitlenir.
        </WarningBox>
      )}

      <InfoBox>
        Personel <strong>yönetici eliyle</strong> oluşturulur; self-signup ucu yoktur. 2FA (TOTP)
        sırrı <code className="font-mono text-xs">MASTER_ENCRYPTION_KEY</code> ile şifreli saklanır
        ve <strong>hiçbir yanıtta düz metin dönmez</strong>. Pasifleştirme kalıcı silme değildir;
        denetim izi korunur.
      </InfoBox>

      {disable.missing && (
        <EndpointMissingNotice
          endpoint="/platform-users/:id"
          method="DELETE"
          what="Personel pasifleştirme"
        />
      )}
      {disable.error && <ErrorBox message={disable.error} />}
      {disable.success && <SuccessBox message={disable.success} />}

      <Card title={res.loaded ? `${res.data.length} platform kullanıcısı` : "Platform kullanıcıları"}>
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.platformUsers.list}
          what="Platform kullanıcıları"
          emptyMessage="Kayıtlı platform kullanıcısı yok."
        >
          <Table columns={columns} rows={res.data} rowKey={(u) => u.id} dense />
        </ResourceView>
      </Card>

      <RoleMatrixCard />

      {inviteOpen && (
        <UserModal
          platformUser={null}
          onClose={() => setInviteOpen(false)}
          onSaved={() => res.reload()}
        />
      )}
      {editing && (
        <UserModal
          platformUser={editing}
          onClose={() => setEditing(null)}
          onSaved={() => res.reload()}
        />
      )}
    </div>
  );
}

function UserModal({
  platformUser,
  onClose,
  onSaved,
}: {
  platformUser: AdminPlatformUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = platformUser === null;
  const [email, setEmail] = useState(platformUser?.email ?? "");
  const [fullName, setFullName] = useState(platformUser?.fullName ?? "");
  const [role, setRole] = useState(platformUser?.role ?? "SUPPORT_AGENT");
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(platformUser?.isActive ?? true);
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  const superAdminInvolved = role === "SUPER_ADMIN" || platformUser?.role === "SUPER_ADMIN";
  const roleChanged = !isNew && role !== platformUser?.role;
  const needsApproval = superAdminInvolved && (isNew || roleChanged);

  const path = isNew ? EP.platformUsers.create : EP.platformUsers.update(platformUser!.id);

  async function submit() {
    const body: Record<string, unknown> = {
      fullName: fullName.trim(),
      role,
      reason: reason.trim(),
    };
    if (isNew) {
      body.email = email.trim();
      if (password) body.password = password;
    } else {
      body.isActive = isActive;
    }

    const ok = await mutation.run(
      path,
      { method: isNew ? "POST" : "PATCH", body },
      {
        successMessage: isNew ? "Platform kullanıcısı oluşturuldu." : "Kullanıcı güncellendi.",
        onSuccess: onSaved,
      },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Personel ekle" : `Düzenle: ${platformUser?.fullName}`}
      subtitle={`${isNew ? "POST" : "PATCH"} /api/admin/v1${path}`}
    >
      <div className="space-y-4">
        {isNew ? (
          <>
            <Field label="Kurumsal e-posta" required hint="Tenant e-posta uzayından tamamen ayrıdır.">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ad.soyad@nomosos.local"
              />
            </Field>
            <Field
              label="Geçici şifre"
              hint="Boş bırakılırsa sunucu kendi davet/şifre akışını uygular."
            >
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
              />
            </Field>
          </>
        ) : (
          <p className="text-sm text-steel-300">
            <span className="font-mono text-xs text-steel-500">{platformUser?.email}</span>
          </p>
        )}

        <Field label="Ad Soyad" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ad Soyad" />
        </Field>

        <Field label="Rol" required hint={ROLE_DESCRIPTIONS[role as keyof typeof ROLE_DESCRIPTIONS]}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} ({r})
              </option>
            ))}
          </Select>
        </Field>

        {!isNew && (
          <label className="flex items-center gap-2 text-sm text-steel-200">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-steel-600 bg-steel-950 accent-accent-500"
            />
            Hesap aktif
          </label>
        )}

        {needsApproval && (
          <>
            <ApprovalNotice
              action="platform_user.assign_super_admin"
              extra="SUPER_ADMIN atama ve mevcut SUPER_ADMIN'i düşürme dört-göz kapsamındadır."
            />
            <div>
              <ApprovalBadge action="platform_user.assign_super_admin" force />
            </div>
          </>
        )}

        <Field label="Gerekçe" required>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Görev değişikliği, devir teslim…"
          />
        </Field>

        {mutation.missing && (
          <EndpointMissingNotice
            endpoint={path}
            method={isNew ? "POST" : "PATCH"}
            what="Platform kullanıcısı"
          />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            disabled={
              mutation.loading ||
              reason.trim().length === 0 ||
              fullName.trim().length === 0 ||
              (isNew && email.trim().length === 0)
            }
            onClick={() => void submit()}
          >
            {mutation.loading ? "Kaydediliyor…" : needsApproval ? "Onaya gönder" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Kodlanmış yetki matrisinin ekrandaki görünümü — UI ve API aynı tanımı kullanır. */
function RoleMatrixCard() {
  const actions = Object.keys(PERMISSION_MATRIX) as AdminAction[];

  return (
    <Card
      title="Yetki matrisi"
      subtitle="src/lib/rbac.ts içindeki tek kaynaktan üretilir; API tarafı aynı tanımı birebir uygular."
    >
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-steel-400">
        {(Object.keys(PERMISSION_LEVEL_LABELS) as Array<keyof typeof PERMISSION_LEVEL_LABELS>).map(
          (lvl) => (
            <span key={lvl} className="inline-flex items-center gap-1.5">
              <span className="font-mono text-steel-200">{PERMISSION_LEVEL_SYMBOLS[lvl]}</span>
              {PERMISSION_LEVEL_LABELS[lvl]}
            </span>
          ),
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-steel-800">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-steel-400">
                İşlem
              </th>
              {ADMIN_ROLES.map((r) => (
                <th
                  key={r}
                  className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-steel-400"
                  title={ROLE_DESCRIPTIONS[r]}
                >
                  {r.replace("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a} className="border-b border-steel-800/60 last:border-0">
                <td className="px-3 py-2 text-steel-200">
                  <span className="block">{ACTION_LABELS[a]}</span>
                  <span className="font-mono text-[11px] text-steel-600">{a}</span>
                </td>
                {ADMIN_ROLES.map((r) => {
                  const lvl = PERMISSION_MATRIX[a][r];
                  return (
                    <td
                      key={r}
                      className={`px-3 py-2 text-center font-mono ${
                        lvl === "none" ? "text-steel-700" : "text-steel-100"
                      }`}
                      title={PERMISSION_LEVEL_LABELS[lvl]}
                    >
                      {PERMISSION_LEVEL_SYMBOLS[lvl]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
