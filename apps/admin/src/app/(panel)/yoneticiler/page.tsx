"use client";

/**
 * Yöneticiler — platform personeli ve rolleri. Yalnız SUPER_ADMIN görebilir ve yazabilir.
 * Kurallar: davet-temelli oluşturma (self-signup ucu hiç yazılmaz), 2FA zorunlu,
 * her an en az iki aktif SUPER_ADMIN, kendi rolünü kimse düşüremez, hard delete yok.
 */

import { useMemo, useState } from "react";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
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
import {
  PLATFORM_USER_STATUS_LABELS,
  PLATFORM_USER_STATUS_TONES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_TONES,
  fmtDateTime,
  labelOf,
  toneOf,
} from "@/lib/labels";
import { MOCK_PLATFORM_USERS, type AdminPlatformUser } from "@/lib/mock";
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
  const res = useResource<AdminPlatformUser[]>("/platform-users", [...MOCK_PLATFORM_USERS]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlatformUser | null>(null);
  const [newRole, setNewRole] = useState<string>("");

  const activeSuperAdmins = useMemo(
    () => res.data.filter((u) => u.role === "SUPER_ADMIN" && u.status === "AKTIF").length,
    [res.data],
  );

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
      render: (u) => (
        <Badge tone={ROLE_TONES[u.role as keyof typeof ROLE_TONES] ?? "gray"}>
          {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Durum",
      render: (u) => (
        <Badge tone={toneOf(PLATFORM_USER_STATUS_TONES, u.status)}>
          {labelOf(PLATFORM_USER_STATUS_LABELS, u.status)}
        </Badge>
      ),
    },
    {
      key: "totp",
      header: "2FA",
      render: (u) =>
        u.totpReady ? (
          <Badge tone="green">Kurulu</Badge>
        ) : (
          <Badge tone="red" title="2FA kurulmadan hiçbir panel sayfasına erişemez.">
            Kurulmadı
          </Badge>
        ),
    },
    {
      key: "login",
      header: "Son giriş",
      render: (u) => (
        <div className="text-xs text-steel-400">
          <p>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—"}</p>
          <p className="font-mono text-steel-600">{u.lastLoginIp ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "ip",
      header: "IP allowlist",
      render: (u) =>
        u.ipAllowlist.length > 0 ? (
          <span className="font-mono text-xs text-steel-300">{u.ipAllowlist.join(", ")}</span>
        ) : (
          <span className="text-xs text-steel-500">global politika</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (u) => {
        const isSelf = u.email === user?.email;
        const lastSuperAdmin =
          u.role === "SUPER_ADMIN" && u.status === "AKTIF" && activeSuperAdmins <= 2;
        return (
          <RoleGate action="platform_user.manage" mutation>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={isSelf}
                title={isSelf ? "Kendi rolünüzü değiştiremezsiniz." : undefined}
                onClick={() => {
                  setEditing(u);
                  setNewRole(u.role);
                }}
              >
                Rol değiştir
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={isSelf || lastSuperAdmin}
                title={
                  lastSuperAdmin
                    ? "Sistemde her an en az iki aktif SUPER_ADMIN bulunmalıdır."
                    : isSelf
                      ? "Kendinizi pasifleştiremezsiniz."
                      : undefined
                }
              >
                Pasifleştir
              </Button>
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
        description="Platform personeli (PlatformUser) — tenant kullanıcılarından tamamen ayrı kimlik uzayı; aralarında FK yoktur."
        action={
          <div className="flex items-center gap-2">
            {res.pending && <MockBadge />}
            <RoleGate action="platform_user.manage" mutation>
              <Button onClick={() => setInviteOpen(true)}>Personel davet et</Button>
            </RoleGate>
          </div>
        }
      />

      {res.pending && <PendingEndpointNotice endpoint="/platform-users" phase="Faz 1" />}

      {activeSuperAdmins < 2 && (
        <WarningBox title="Kritik: tek SUPER_ADMIN">
          Sistemde her an en az iki aktif SUPER_ADMIN bulunmalıdır; tek kalınırsa dört-göz işlemleri
          kilitlenir.
        </WarningBox>
      )}

      <InfoBox>
        Personel <strong>davet-temelli</strong> oluşturulur; self-signup ucu hiç yazılmaz. 2FA
        (TOTP) istisnasız zorunludur ve kurulum tamamlanmadan hesap aktifleşmez.{" "}
        <code className="font-mono text-xs">DEVRE_DISI</code> statüsü{" "}
        <code className="font-mono text-xs">token_version</code> artırarak tüm aktif oturumları
        anında düşürür. Hard delete yoktur.
      </InfoBox>

      <Card title={`${res.data.length} platform kullanıcısı`}>
        <Table columns={columns} rows={res.data} rowKey={(u) => u.id} dense />
      </Card>

      <RoleMatrixCard />

      {/* Davet */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Personel davet et"
        subtitle="POST /platform-users"
      >
        <div className="space-y-4">
          <PendingEndpointNotice endpoint="/platform-users" phase="Faz 1" method="POST" />
          <Field label="Kurumsal e-posta" required hint="Kurumsal domain zorunludur.">
            <Input type="email" placeholder="ad.soyad@nomosos.com" />
          </Field>
          <Field label="Ad Soyad" required>
            <Input placeholder="Ad Soyad" />
          </Field>
          <Field label="Rol" required hint="Kullanıcı başına tek rol atanır.">
            <Select defaultValue="SUPPORT_AGENT">
              {ADMIN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]} ({r})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="IP allowlist (CIDR)" hint="SUPER_ADMIN ve OPS_ADMIN için şiddetle önerilir.">
            <Input placeholder="10.20.4.0/24" />
          </Field>
          <InfoBox>
            Davet edilen kullanıcı ilk girişte 2FA kurulumunu tamamlamadan hiçbir sayfaya erişemez.
          </InfoBox>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled title="Uç henüz uygulanmadı">
              Davet gönder
            </Button>
          </div>
        </div>
      </Modal>

      {/* Rol değişikliği */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Rol değiştir"
        subtitle={editing ? `PATCH /platform-users/${editing.id}` : undefined}
      >
        {editing && (
          <div className="space-y-4">
            <PendingEndpointNotice
              endpoint={`/platform-users/${editing.id}`}
              phase="Faz 1"
              method="PATCH"
            />
            <p className="text-sm text-steel-300">
              {editing.fullName} ·{" "}
              <span className="font-mono text-xs text-steel-500">{editing.email}</span>
            </p>
            <Field label="Yeni rol" required hint={ROLE_DESCRIPTIONS[newRole as keyof typeof ROLE_DESCRIPTIONS]}>
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} ({r})
                  </option>
                ))}
              </Select>
            </Field>

            {(newRole === "SUPER_ADMIN" || editing.role === "SUPER_ADMIN") && (
              <>
                <ApprovalNotice
                  action="platform_user.assign_super_admin"
                  extra="Yeni SUPER_ADMIN atama ve mevcut SUPER_ADMIN'i düşürme iki SUPER_ADMIN onayı gerektirir."
                />
                <div>
                  <ApprovalBadge action="platform_user.assign_super_admin" force />
                </div>
              </>
            )}

            <Field label="Gerekçe" required>
              <Input placeholder="Görev değişikliği, devir teslim…" />
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Vazgeç
              </Button>
              <Button disabled title="Uç henüz uygulanmadı">
                {newRole === "SUPER_ADMIN" ? "Onaya gönder" : "Kaydet"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Kodlanmış yetki matrisinin ekrandaki görünümü — UI ve API aynı tanımı kullanır. */
function RoleMatrixCard() {
  const actions = Object.keys(PERMISSION_MATRIX) as AdminAction[];

  return (
    <Card
      title="Yetki matrisi"
      subtitle="src/lib/rbac.ts içindeki tek kaynaktan üretilir; API tarafı aynı tanımı kullanmalıdır (platform-permissions.ts)."
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
