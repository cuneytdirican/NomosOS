"use client";

/**
 * BÜRO KULLANICI YÖNETİMİ — lisans kapsamındaki personel.
 *
 * UÇLAR (hazır; K-03 düzeltmesi):
 *   GET    /users/manage          — e-posta + kilit durumu dâhil liste (ADMIN/PARTNER)
 *   POST   /users                 — kullanıcı aç (e-posta, ad, rol, baro no, parola)
 *   PATCH  /users/:id             — rol/ad/pasifleştirme
 *   POST   /users/:id/reset-password  — parola sıfırla (tüm oturumları düşürür)
 *   POST   /users/:id/revoke-sessions — oturumları düşür
 *   POST   /users/:id/unlock      — kilidi aç
 *
 * LİSANS KOLTUK GÖSTERGESİ: plan koltuk bilgisi bu uçta yoksa yerel abonelik
 * bilgisinden değil, kullanıcı sayısı tavanından (200) gösterilir; plan koltuğu
 * platform panelinde ayrıca izlenir.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { USER_ROLE_LABELS } from "@/lib/labels";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
} from "@/components/ui";

interface ManagedUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  barNumber: string | null;
  isActive: boolean;
  isLocked: boolean;
  /** Enterprise++: TOTP kurulu mu (gizli anahtar dönmez). */
  twoFactorEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

const ROLE_VALUES = ["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"] as const;

/** Rol yetki sıralaması — yönetici, kendinden yetkili birine rol veremez/alamaz. */
const ROLE_RANK: Record<string, number> = {
  ADMIN: 0,
  PARTNER: 1,
  AVUKAT: 2,
  STAJYER: 3,
  SEKRETER: 3,
};

export default function KullanicilarPage() {
  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    role: "AVUKAT",
    barNumber: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pwUser, setPwUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>("/users/manage");
      setRows(Array.isArray(data) ? (data as ManagedUser[]) : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kullanıcılar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Oturum açan kullanıcı kimliği — rol koruma kuralları için.
    void api<{ userId?: string; role?: string } | { user?: { id?: string; role?: string } }>("/me")
      .then((me) => {
        const u = me as { userId?: string; role?: string; user?: { id?: string; role?: string } };
        if (u?.userId) setCurrentUserId(u.userId);
        if (u?.role) setCurrentRole(u.role);
      })
      .catch(() => undefined);
  }, [load]);

  async function handleCreate() {
    setBusy(true);
    setFormError(null);
    try {
      await api("/users", {
        method: "POST",
        body: {
          email: form.email.trim(),
          fullName: form.fullName.trim(),
          role: form.role,
          ...(form.barNumber.trim() ? { barNumber: form.barNumber.trim() } : {}),
          password: form.password,
        },
      });
      setCreateOpen(false);
      setForm({ email: "", fullName: "", role: "AVUKAT", barNumber: "", password: "" });
      setNotice("Kullanıcı açıldı. Yeni kullanıcı ilk girişte parolasını değiştirmelidir.");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Kullanıcı açılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(id: string, body: Record<string, unknown>, msg: string) {
    setError(null);
    try {
      await api(`/users/${id}`, { method: "PATCH", body });
      setNotice(msg);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Güncelleme başarısız.");
    }
  }

  async function action(id: string, action_: "revoke-sessions" | "unlock" | "reset-2fa", msg: string) {
    setError(null);
    try {
      await api(`/users/${id}/${action_}`, { method: "POST" });
      setNotice(msg);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "İşlem başarısız.");
    }
  }

  async function resetPassword() {
    if (!pwUser) return;
    setPwBusy(true);
    setFormError(null);
    try {
      await api(`/users/${pwUser.id}/reset-password`, {
        method: "POST",
        body: { newPassword },
      });
      setPwUser(null);
      setNewPassword("");
      setNotice(
        "Parola sıfırlandı ve kullanıcının TÜM oturumları düşürüldü — yeni parolayı kendisine iletin.",
      );
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Parola sıfırlanamadı.");
    } finally {
      setPwBusy(false);
    }
  }

  /** Hedef üzerinde yetki var mı — kendinden yüksek rüle dokunma yasağı. */
  function canManage(target: ManagedUser): boolean {
    if (target.id === currentUserId) return false; // kendi rolünü kendisi değiştiremez
    if (currentRole === null || ROLE_RANK[currentRole] === undefined) return false;
    if (currentRole !== "ADMIN" && currentRole !== "PARTNER") return false;
    return ROLE_RANK[currentRole] <= (ROLE_RANK[target.role] ?? 99);
  }

  const columns = [
    {
      key: "fullName",
      header: "Kullanıcı",
      render: (u: ManagedUser) => (
        <div>
          <p className="font-medium text-slate-900">{u.fullName}</p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Rol",
      render: (u: ManagedUser) =>
        canManage(u) ? (
          <Select
            aria-label="Rol"
            value={u.role}
            onChange={(e) => void patchUser(u.id, { role: e.target.value }, `${u.fullName} → ${USER_ROLE_LABELS[e.target.value] ?? e.target.value}`)}
          >
            {ROLE_VALUES.map((r) => (
              <option key={r} value={r}>
                {USER_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={u.role === "ADMIN" || u.role === "PARTNER" ? "navy" : "blue"}>
            {USER_ROLE_LABELS[u.role] ?? u.role}
          </Badge>
        ),
    },
    {
      key: "barNumber",
      header: "Baro No",
      render: (u: ManagedUser) => u.barNumber ?? "—",
    },
    {
      key: "status",
      header: "Durum",
      render: (u: ManagedUser) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={u.isActive ? "green" : "gray"}>{u.isActive ? "Aktif" : "Pasif"}</Badge>
          {u.isLocked && <Badge tone="danger">Kilitli</Badge>}
          <Badge tone={u.twoFactorEnabled ? "navy" : "gray"}>{u.twoFactorEnabled ? "2FA açık" : "2FA yok"}</Badge>
        </span>
      ),
    },
    {
      key: "actions",
      header: "İşlemler",
      render: (u: ManagedUser) => (
        <span className="flex flex-wrap gap-1">
          {u.isLocked && (
            <Button variant="secondary" onClick={() => void action(u.id, "unlock", "Kilit açıldı.")}>
              Kilidi Aç
            </Button>
          )}
          {u.isActive ? (
            <Button
              variant="secondary"
              disabled={!canManage(u)}
              onClick={() => void patchUser(u.id, { isActive: false }, `${u.fullName} pasifleştirildi.`)}
            >
              Pasifleştir
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={!canManage(u)}
              onClick={() => void patchUser(u.id, { isActive: true }, `${u.fullName} etkinleştirildi.`)}
            >
              Etkinleştir
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={!canManage(u)}
            onClick={() => {
              setPwUser(u);
              setNewPassword("");
            }}
          >
            Parola Sıfırla
          </Button>
          <Button variant="secondary" onClick={() => void action(u.id, "revoke-sessions", "Oturumlar düşürüldü.")}>
            Oturumları Düşür
          </Button>
          {u.twoFactorEnabled && canManage(u) && (
            <Button
              variant="secondary"
              onClick={() => {
                if (window.confirm(`${u.fullName} için 2FA sıfırlansın mı? Tüm oturumları düşer; büro politikası zorunluysa girişte yeniden kurar.`)) {
                  void action(u.id, "reset-2fa", "2FA sıfırlandı; oturumlar düşürüldü.");
                }
              }}
            >
              2FA Sıfırla
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kullanıcılar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lisans kapsamındaki personeliniz — rol atayın, parola sıfırlayın, kilidi açın.
            Kullanıcı sayısı üst sınırı: 200.
          </p>
        </div>
        <Button variant="gold" onClick={() => setCreateOpen(true)}>
          + Yeni Kullanıcı
        </Button>
      </div>

      {notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && <ErrorBox message={error} />}

      <Card>
        {loading ? (
          <div className="p-6">
            <Spinner label="Kullanıcılar yükleniyor…" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState message="Kullanıcı listesi alınamadı (yalnız Ortak/Yönetici görebilir)." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  {columns.map((c) => (
                    <th key={c.key} className="px-4 py-3 font-medium">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((u) => (
                  <tr key={u.id}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3">
                        {c.render(u)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Yeni kullanıcı modalı */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Yeni Kullanıcı">
        <div className="space-y-4">
          <Field label="E-posta">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="avukat@buro.com"
            />
          </Field>
          <Field label="Ad Soyad">
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Ayşe Yılmaz"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLE_VALUES.map((r) => (
                  <option key={r} value={r}>
                    {USER_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Baro No (isteğe bağlı)">
              <Input
                value={form.barNumber}
                onChange={(e) => setForm({ ...form, barNumber: e.target.value })}
                placeholder="12345"
              />
            </Field>
          </div>
          <Field
            label="Geçici Parola"
            hint="En az 10 karakter. Yeni kullanıcı ilk girişte bu parolayı kullanır."
          >
            <Input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Güçlü bir geçici parola"
            />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={busy || !form.email.trim() || form.fullName.trim().length < 3 || form.password.length < 10}
              onClick={() => void handleCreate()}
            >
              {busy ? "Açılıyor…" : "Kullanıcıyı Aç"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Parola sıfırlama modalı */}
      <Modal
        open={pwUser !== null}
        onClose={() => {
          setPwUser(null);
          setNewPassword("");
        }}
        title={`Parola Sıfırla — ${pwUser?.fullName ?? ""}`}
      >
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-4 text-amber-800">
            Yeni parolayı belirlediğinizde kullanıcının <strong>TÜM oturumları düşürülür</strong>. Yeni
            parolayı güvenli bir kanaldan iletin. İşlem denetim izine yazılır.
          </p>
          <Field label="Yeni Parola" hint="En az 10 karakter.">
            <Input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Güçlü bir parola"
            />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPwUser(null);
                setNewPassword("");
              }}
            >
              Vazgeç
            </Button>
            <Button disabled={pwBusy || newPassword.length < 10} onClick={() => void resetPassword()}>
              {pwBusy ? "Sıfırlanıyor…" : "Sıfırla"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
