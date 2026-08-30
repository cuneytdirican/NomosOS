"use client";

/**
 * Sistem — SystemSetting'ler, feature flag'ler, duyurular ve sağlık panosu.
 *
 * Uçlar:
 *   GET  /settings              ·  PUT /settings            { key, valueJson, reason }
 *   GET  /feature-flags         ·  POST /feature-flags      ·  PATCH /feature-flags/:id
 *   GET  /announcements         ·  POST /announcements      ·  PATCH|DELETE /announcements/:id
 *   GET  /health
 *
 * Dört-göz: platform GENELİ flag değişikliği (isEnabledGlobally) ve bakım modu tam kilidi.
 * Secret'lar SystemSetting'e KONMAZ; .env'de kalır.
 */

import { useMemo, useState } from "react";
import { useListResource, useResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { EP } from "@/lib/endpoints";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import { normalizeHealth } from "@/lib/health";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_SEVERITY_LABELS,
  ANNOUNCEMENT_SEVERITY_TONES,
  HEALTH_STATUS_LABELS,
  HEALTH_STATUS_TONES,
  fmtDateTime,
  labelOf,
  parseJson,
  toneOf,
} from "@/lib/labels";
import type {
  AdminAnnouncement,
  AdminFeatureFlag,
  AdminHealthResponse,
  AdminSetting,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EndpointMissingNotice,
  ErrorBox,
  Field,
  HealthDot,
  InfoBox,
  Input,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  SuccessBox,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "ayarlar" | "flags" | "duyurular" | "saglik";

export default function SistemPage() {
  return (
    <PageGate action="system.settings">
      <SystemScreen />
    </PageGate>
  );
}

function SystemScreen() {
  const [tab, setTab] = useState<TabKey>("ayarlar");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sistem"
        description="Platform ayarları, feature flag'ler, duyurular ve sağlık panosu."
      />
      <Tabs
        tabs={[
          { key: "ayarlar", label: "Ayarlar" },
          { key: "flags", label: "Feature flags" },
          { key: "duyurular", label: "Duyurular" },
          { key: "saglik", label: "Sağlık" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "ayarlar" && <SettingsTab />}
      {tab === "flags" && <FlagsTab />}
      {tab === "duyurular" && <AnnouncementsTab />}
      {tab === "saglik" && <HealthTab />}
    </div>
  );
}

// ------------------------------------------------------------- Ayarlar

/** valueJson genellikle JSON string'tir; okunabilir metne indirger. */
function readableValue(valueJson: string | null | undefined): string {
  if (valueJson === null || valueJson === undefined) return "—";
  const parsed = parseJson<unknown>(valueJson, valueJson);
  if (parsed === null || parsed === undefined) return "—";
  if (typeof parsed === "object") return JSON.stringify(parsed);
  return String(parsed);
}

function SettingsTab() {
  const res = useListResource<AdminSetting>(EP.settings);
  const [editing, setEditing] = useState<AdminSetting | null>(null);

  const columns: Array<Column<AdminSetting>> = [
    {
      key: "key",
      header: "Anahtar",
      render: (s) => <span className="font-mono text-xs text-steel-100">{s.key}</span>,
    },
    {
      key: "description",
      header: "Açıklama",
      render: (s) => <span className="text-xs text-steel-400">{s.description ?? "—"}</span>,
    },
    {
      key: "value",
      header: "Değer",
      align: "right",
      render: (s) => (
        <span className="font-mono text-steel-100">{readableValue(s.valueJson)}</span>
      ),
    },
    {
      key: "updated",
      header: "Son değişiklik",
      render: (s) => (
        <div className="text-xs text-steel-500">
          <p>{s.updatedByEmail ?? s.updatedBy ?? "—"}</p>
          <p className="text-steel-600">{fmtDateTime(s.updatedAt)}</p>
        </div>
      ),
    },
    {
      key: "edit",
      header: "",
      align: "right",
      render: (s) => (
        <RoleGate action="system.settings" mutation>
          <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
            Düzenle
          </Button>
        </RoleGate>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <InfoBox>
        Tipli anahtar-değer ayarları. <strong>Secret&apos;lar buraya konmaz</strong>; API
        anahtarları ve <code className="font-mono text-xs">MASTER_ENCRYPTION_KEY</code>{" "}
        <code className="font-mono text-xs">.env</code> içinde kalır. Bakım modu tam kilidi gibi
        yıkıcı ayarlar dört-göz kapsamındadır; sunucu doğrudan uygulamaz.
      </InfoBox>
      <Card title={res.loaded ? `${res.data.length} ayar` : "Ayarlar"}>
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.settings}
          what="Sistem ayarları"
          emptyMessage="Tanımlı sistem ayarı yok."
        >
          <Table columns={columns} rows={res.data} rowKey={(s) => s.key} dense />
        </ResourceView>
      </Card>

      {editing && (
        <SettingModal
          setting={editing}
          onClose={() => setEditing(null)}
          onSaved={() => res.reload()}
        />
      )}
    </div>
  );
}

function SettingModal({
  setting,
  onClose,
  onSaved,
}: {
  setting: AdminSetting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(setting.valueJson ?? "");
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  const isMaintenanceLock =
    setting.key.toLowerCase().includes("maintenance") &&
    value.toUpperCase().includes("TAM_KILIT");

  const validJson = useMemo(() => {
    if (value.trim() === "") return false;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  async function submit() {
    const ok = await mutation.run(
      EP.settings,
      { method: "PUT", body: { key: setting.key, valueJson: value, reason: reason.trim() } },
      { successMessage: "Ayar güncellendi.", onSuccess: onSaved },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Ayar: ${setting.key}`}
      subtitle={`PUT /api/admin/v1${EP.settings}`}
    >
      <div className="space-y-4">
        {setting.description && <InfoBox>{setting.description}</InfoBox>}

        <Field
          label="Değer (JSON)"
          required
          hint={'SystemSetting.valueJson bir JSON değeridir. Metin değerler tırnak içinde yazılır: "KAPALI"'}
        >
          <Textarea
            rows={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
        {!validJson && value.trim() !== "" && (
          <p className="text-xs text-amber-300">Geçerli bir JSON değeri girin.</p>
        )}

        {isMaintenanceLock && <ApprovalNotice action="system.maintenance_lock" />}

        <Field label="Gerekçe" required hint="PlatformAuditLog kaydına yazılır.">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Örn. tolerans süresi 7 → 10 gün; finans ekibi talebi."
          />
        </Field>

        {mutation.missing && (
          <EndpointMissingNotice endpoint={EP.settings} method="PUT" what="Ayar güncelleme" />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            disabled={!validJson || reason.trim().length === 0 || mutation.loading}
            onClick={() => void submit()}
          >
            {mutation.loading ? "Kaydediliyor…" : isMaintenanceLock ? "Onaya gönder" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------- Feature flags

function tenantIdsOf(flag: AdminFeatureFlag): string[] {
  if (Array.isArray(flag.enabledTenantIds)) return flag.enabledTenantIds;
  return parseJson<string[]>(flag.enabledTenantIdsJson, []);
}

function FlagsTab() {
  const res = useListResource<AdminFeatureFlag>(EP.featureFlags.list);
  const [editing, setEditing] = useState<AdminFeatureFlag | null>(null);
  const [creating, setCreating] = useState(false);

  const columns: Array<Column<AdminFeatureFlag>> = [
    {
      key: "key",
      header: "Flag",
      render: (f) => (
        <div>
          <p className="font-mono text-xs text-steel-100">{f.key}</p>
          <p className="text-xs text-steel-500">{f.description ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "mode",
      header: "Durum",
      render: (f) => (
        <span className="inline-flex items-center gap-1.5">
          {f.isEnabledGlobally ? (
            <Badge tone="green">Platform geneli açık</Badge>
          ) : tenantIdsOf(f).length > 0 ? (
            <Badge tone="accent">Tenant allowlist</Badge>
          ) : (
            <Badge tone="gray">Kapalı</Badge>
          )}
        </span>
      ),
    },
    {
      key: "scope",
      header: "Kapsam",
      render: (f) => {
        const ids = tenantIdsOf(f);
        return ids.length > 0 ? (
          <span className="text-xs text-steel-300">{ids.length} tenant</span>
        ) : (
          <span className="text-xs text-steel-600">—</span>
        );
      },
    },
    {
      key: "updated",
      header: "Son değişiklik",
      render: (f) => (
        <div className="text-xs text-steel-400">
          <p>{f.updatedByEmail ?? f.updatedBy ?? "—"}</p>
          <p className="text-steel-600">{fmtDateTime(f.updatedAt)}</p>
        </div>
      ),
    },
    {
      key: "edit",
      header: "",
      align: "right",
      render: (f) => (
        <RoleGate action="system.flag_write" mutation>
          <span className="inline-flex items-center gap-2">
            {f.isEnabledGlobally && <ApprovalBadge action="system.flag_global_write" />}
            <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
              Düzenle
            </Button>
          </span>
        </RoleGate>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <InfoBox>
        Flag iki eksende çalışır: <strong>platform geneli açık</strong> (
        <code className="font-mono text-xs">isEnabledGlobally</code>) ve{" "}
        <strong>tenant allowlist</strong> (
        <code className="font-mono text-xs">enabledTenantIdsJson</code>). Platform geneli
        değişiklik dört-göz onayı gerektirir; tenant bazlı pilot açma normal yazma işlemidir.
      </InfoBox>

      <Card
        title={res.loaded ? `${res.data.length} feature flag` : "Feature flags"}
        action={
          <RoleGate action="system.flag_write" mutation>
            <Button onClick={() => setCreating(true)}>Yeni flag</Button>
          </RoleGate>
        }
      >
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.featureFlags.list}
          what="Feature flag listesi"
          emptyMessage="Tanımlı feature flag yok."
        >
          <Table columns={columns} rows={res.data} rowKey={(f) => f.id} dense />
        </ResourceView>
      </Card>

      {(editing || creating) && (
        <FlagModal
          flag={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => res.reload()}
        />
      )}
    </div>
  );
}

function FlagModal({
  flag,
  onClose,
  onSaved,
}: {
  flag: AdminFeatureFlag | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = flag === null;
  const [key, setKey] = useState(flag?.key ?? "");
  const [description, setDescription] = useState(flag?.description ?? "");
  const [globalOn, setGlobalOn] = useState(flag?.isEnabledGlobally ?? false);
  const [tenantIds, setTenantIds] = useState(flag ? tenantIdsOf(flag).join(", ") : "");
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  const globalChanged = !isNew && globalOn !== flag?.isEnabledGlobally;
  const needsApproval = globalOn && (isNew || globalChanged);

  const ids = tenantIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const path = isNew ? EP.featureFlags.create : EP.featureFlags.update(flag!.id);

  async function submit() {
    const ok = await mutation.run(
      path,
      {
        method: isNew ? "POST" : "PATCH",
        body: {
          ...(isNew ? { key: key.trim() } : {}),
          description: description.trim() || null,
          isEnabledGlobally: globalOn,
          enabledTenantIds: ids,
          reason: reason.trim(),
        },
      },
      { successMessage: isNew ? "Flag oluşturuldu." : "Flag güncellendi.", onSuccess: onSaved },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Yeni feature flag" : `Flag: ${flag?.key}`}
      subtitle={`${isNew ? "POST" : "PATCH"} /api/admin/v1${path}`}
    >
      <div className="space-y-4">
        {isNew && (
          <Field label="Anahtar" required hint="kebab-case, ör. strategy-engine">
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="strategy-engine"
              className="font-mono"
            />
          </Field>
        )}

        <Field label="Açıklama">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Modül 15 — dava stratejisi motoru"
          />
        </Field>

        <label className="flex items-start gap-2 text-sm text-steel-200">
          <input
            type="checkbox"
            checked={globalOn}
            onChange={(e) => setGlobalOn(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-steel-600 bg-steel-950 accent-accent-500"
          />
          <span>
            Platform geneli açık
            <span className="block text-xs text-steel-500">
              Tüm tenantları etkiler; dört-göz onayı gerekir.
            </span>
          </span>
        </label>

        <Field
          label="Tenant allowlist"
          hint="Virgülle ayrılmış tenant kimlikleri (UUID). Boş bırakılırsa yalnız global anahtar geçerlidir."
        >
          <Textarea
            rows={2}
            value={tenantIds}
            onChange={(e) => setTenantIds(e.target.value)}
            className="font-mono text-xs"
            placeholder="00000000-0000-0000-0000-000000000001, …"
          />
        </Field>

        {needsApproval && <ApprovalNotice action="system.flag_global_write" />}

        <Field label="Gerekçe" required>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Pilot genişletme, geri alma gerekçesi…"
          />
        </Field>

        {mutation.missing && (
          <EndpointMissingNotice
            endpoint={path}
            method={isNew ? "POST" : "PATCH"}
            what="Feature flag"
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
              (isNew && key.trim().length === 0)
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

// ---------------------------------------------------------- Duyurular

function AnnouncementsTab() {
  const res = useListResource<AdminAnnouncement>(EP.announcements.list);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useMutation();

  async function doDelete(a: AdminAnnouncement) {
    await remove.run(
      EP.announcements.remove(a.id),
      { method: "DELETE" },
      { successMessage: "Duyuru silindi.", onSuccess: () => res.reload() },
    );
    res.reload();
  }

  const columns: Array<Column<AdminAnnouncement>> = [
    {
      key: "title",
      header: "Başlık",
      render: (a) => (
        <div>
          <p className="text-steel-100">{a.title}</p>
          <p className="line-clamp-2 text-xs text-steel-500">{a.body}</p>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Önem",
      render: (a) => (
        <Badge tone={toneOf(ANNOUNCEMENT_SEVERITY_TONES, a.severity)}>
          {labelOf(ANNOUNCEMENT_SEVERITY_LABELS, a.severity)}
        </Badge>
      ),
    },
    {
      key: "audience",
      header: "Hedef",
      render: (a) => (
        <div className="text-xs">
          <p className="text-steel-200">{labelOf(ANNOUNCEMENT_AUDIENCE_LABELS, a.audience)}</p>
          {a.targetJson && (
            <p className="font-mono text-[11px] text-steel-500">{a.targetJson}</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Durum",
      render: (a) =>
        a.publishedAt ? <Badge tone="green">Yayında</Badge> : <Badge tone="gray">Taslak</Badge>,
    },
    {
      key: "window",
      header: "Yayın penceresi",
      render: (a) => (
        <span className="text-xs text-steel-400">
          {fmtDateTime(a.publishedAt)} → {a.expiresAt ? fmtDateTime(a.expiresAt) : "süresiz"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (a) => (
        <RoleGate action="announcement.publish" mutation>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={remove.loading}
              onClick={() => void doDelete(a)}
            >
              Sil
            </Button>
          </div>
        </RoleGate>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <InfoBox>
        Duyurular tek yönlüdür: tenant uygulaması bunları salt okur. Taslak → yayın akışı;{" "}
        <code className="font-mono text-xs">publishedAt</code> boşken duyuru taslaktır. Hedef
        kitle tümü / plan / tenant listesi olabilir.
      </InfoBox>

      {remove.missing && (
        <EndpointMissingNotice
          endpoint="/announcements/:id"
          method="DELETE"
          what="Duyuru silme"
        />
      )}
      {remove.error && <ErrorBox message={remove.error} />}
      {remove.success && <SuccessBox message={remove.success} />}

      <Card
        title={res.loaded ? `${res.data.length} duyuru` : "Duyurular"}
        action={
          <RoleGate action="announcement.publish" mutation>
            <Button onClick={() => setCreating(true)}>Yeni duyuru</Button>
          </RoleGate>
        }
      >
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.announcements.list}
          what="Duyurular"
          emptyMessage="Duyuru yok."
        >
          <Table columns={columns} rows={res.data} rowKey={(a) => a.id} dense />
        </ResourceView>
      </Card>

      {(editing || creating) && (
        <AnnouncementModal
          announcement={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => res.reload()}
        />
      )}
    </div>
  );
}

/** ISO → <input type="datetime-local"> değeri. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AnnouncementModal({
  announcement,
  onClose,
  onSaved,
}: {
  announcement: AdminAnnouncement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = announcement === null;
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [severity, setSeverity] = useState(announcement?.severity ?? "BILGI");
  const [audience, setAudience] = useState(announcement?.audience ?? "TUM");
  const [target, setTarget] = useState(announcement?.targetJson ?? "");
  const [publishedAt, setPublishedAt] = useState(toLocalInput(announcement?.publishedAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(announcement?.expiresAt));
  const mutation = useMutation();

  const path = isNew ? EP.announcements.create : EP.announcements.update(announcement!.id);

  async function submit(publishNow: boolean) {
    const body_: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim(),
      severity,
      audience,
      targetJson: audience === "TUM" ? null : target.trim() || null,
      publishedAt: publishNow
        ? publishedAt
          ? new Date(publishedAt).toISOString()
          : new Date().toISOString()
        : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    };

    const ok = await mutation.run(
      path,
      { method: isNew ? "POST" : "PATCH", body: body_ },
      {
        successMessage: publishNow ? "Duyuru yayınlandı." : "Taslak kaydedildi.",
        onSuccess: onSaved,
      },
    );
    if (ok) onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Yeni duyuru" : "Duyuruyu düzenle"}
      subtitle={`${isNew ? "POST" : "PATCH"} /api/admin/v1${path}`}
      wide
    >
      <div className="space-y-4">
        <Field label="Başlık" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Planlı bakım: 1 Eylül 02:00–04:00"
          />
        </Field>
        <Field label="Gövde" required>
          <Textarea
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Bakım penceresi süresince platform salt-okur modda olacaktır…"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Önem" required>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {ANNOUNCEMENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {ANNOUNCEMENT_SEVERITY_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hedef kitle" required>
            <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
              {ANNOUNCEMENT_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {ANNOUNCEMENT_AUDIENCE_LABELS[a]}
                </option>
              ))}
            </Select>
          </Field>
          {audience !== "TUM" && (
            <Field
              label="Hedef (JSON)"
              hint='Plan bazlı: ["BURO","ENTERPRISE"] · Tenant bazlı: ["<tenantId>", …]'
            >
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="font-mono text-xs"
                placeholder='["BURO","ENTERPRISE"]'
              />
            </Field>
          )}
          <Field label="Yayın başlangıcı" hint="Boş bırakılırsa yayınlarken şimdi kabul edilir.">
            <Input
              type="datetime-local"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
            />
          </Field>
          <Field label="Yayın bitişi">
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        </div>

        <WarningBox>
          Kritik duyurular tüm tenant kullanıcılarına gösterilir. Yayın işlemi
          PlatformAuditLog&apos;a yazılır.
        </WarningBox>

        {mutation.missing && (
          <EndpointMissingNotice endpoint={path} method={isNew ? "POST" : "PATCH"} what="Duyuru" />
        )}
        {mutation.error && <ErrorBox message={mutation.error} />}
        {mutation.success && <SuccessBox message={mutation.success} />}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button
            variant="secondary"
            disabled={mutation.loading || title.trim() === "" || body.trim() === ""}
            onClick={() => void submit(false)}
          >
            Taslak kaydet
          </Button>
          <Button
            disabled={mutation.loading || title.trim() === "" || body.trim() === ""}
            onClick={() => void submit(true)}
          >
            {mutation.loading ? "Gönderiliyor…" : "Yayınla"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Sağlık

function HealthTab() {
  const res = useResource<AdminHealthResponse>(EP.health);
  const checks = useMemo(() => normalizeHealth(res.data), [res.data]);

  return (
    <div className="space-y-4">
      <InfoBox>
        Özet sağlık panosu. Panel bir APM değildir; ayrıntılı ölçüm için altyapı izleme
        araçlarına bakılır.
      </InfoBox>
      <Card title="Bileşen durumu" subtitle="Kaynak: GET /health">
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.loaded && checks.length === 0}
          endpoint={EP.health}
          what="Sistem sağlığı"
          emptyMessage="Sağlık kontrolü satırı dönmedi."
        >
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {checks.map((h) => (
              <li key={h.key} className="rounded-lg border border-steel-800 bg-steel-950/60 px-4 py-3">
                <p className="flex items-center justify-between gap-2 text-sm font-medium text-steel-100">
                  <span className="flex items-center gap-2">
                    <HealthDot status={h.status} />
                    {h.label}
                  </span>
                  <Badge tone={toneOf(HEALTH_STATUS_TONES, h.status)}>
                    {labelOf(HEALTH_STATUS_LABELS, h.status)}
                  </Badge>
                </p>
                {h.value && <p className="mt-1 font-mono text-sm text-steel-200">{h.value}</p>}
                {h.detail && <p className="mt-0.5 text-xs text-steel-500">{h.detail}</p>}
                {h.checkedAt && (
                  <p className="mt-1 text-[11px] text-steel-600">Ölçüm: {fmtDateTime(h.checkedAt)}</p>
                )}
              </li>
            ))}
          </ul>
        </ResourceView>
      </Card>
    </div>
  );
}
