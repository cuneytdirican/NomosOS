"use client";

/**
 * Sistem — SystemSetting'ler, bakım modu, feature flag'ler ve duyuru yayını.
 * Dört-göz: bakım modu TAM KİLİT ve platform geneli flag / rate-limit değişikliği.
 * Not: secret'lar SystemSetting'e KONMAZ, .env'de kalır.
 */

import { useState } from "react";
import { useResource } from "@/lib/useResource";
import { PageGate, RoleGate } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_SEVERITY_LABELS,
  ANNOUNCEMENT_SEVERITY_TONES,
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_STATUS_TONES,
  FLAG_MODE_LABELS,
  FLAG_MODE_TONES,
  MAINTENANCE_MODE_LABELS,
  fmtDateTime,
  labelOf,
  toneOf,
} from "@/lib/labels";
import {
  MOCK_ANNOUNCEMENTS,
  MOCK_FLAGS,
  MOCK_HEALTH,
  MOCK_SETTINGS,
  type AdminAnnouncement,
  type AdminFeatureFlag,
  type AdminSystemSetting,
} from "@/lib/mock";
import {
  Badge,
  Button,
  Card,
  Field,
  HealthDot,
  InfoBox,
  Input,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
  Select,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "ayarlar" | "bakim" | "flags" | "duyurular";

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
        description="Platform ayarları, bakım penceresi, feature flag'ler ve duyuru yönetimi."
      />
      <Tabs
        tabs={[
          { key: "ayarlar", label: "Ayarlar" },
          { key: "bakim", label: "Bakım modu" },
          { key: "flags", label: "Feature flags" },
          { key: "duyurular", label: "Duyurular" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "ayarlar" && <SettingsTab />}
      {tab === "bakim" && <MaintenanceTab />}
      {tab === "flags" && <FlagsTab />}
      {tab === "duyurular" && <AnnouncementsTab />}
    </div>
  );
}

// ------------------------------------------------------------- Ayarlar

function SettingsTab() {
  const res = useResource<AdminSystemSetting[]>("/settings", [...MOCK_SETTINGS]);

  const columns: Array<Column<AdminSystemSetting>> = [
    { key: "key", header: "Anahtar", render: (s) => <span className="font-mono text-xs">{s.key}</span> },
    {
      key: "label",
      header: "Ayar",
      render: (s) => (
        <div>
          <p className="text-steel-100">{s.label}</p>
          <p className="text-xs text-steel-500">{s.description}</p>
        </div>
      ),
    },
    {
      key: "value",
      header: "Değer",
      align: "right",
      render: (s) => <span className="font-mono text-steel-100">{s.value}</span>,
    },
    {
      key: "edit",
      header: "",
      align: "right",
      render: (s) => (
        <RoleGate
          action={s.key === "api_rate_limit_per_min" ? "system.flag_global_write" : "system.settings"}
          mutation
        >
          <span className="inline-flex items-center gap-2">
            {s.key === "api_rate_limit_per_min" && <ApprovalBadge action="system.flag_global_write" />}
            <Button size="sm" variant="secondary" disabled title="Uç henüz uygulanmadı">
              Düzenle
            </Button>
          </span>
        </RoleGate>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {res.pending && <PendingEndpointNotice endpoint="/settings" phase="Faz 1" />}
      <InfoBox>
        Tipli anahtar-değer ayarları. <strong>Secret&apos;lar buraya konmaz</strong>; API anahtarları
        ve şifreleme anahtarları <code className="font-mono text-xs">.env</code> içinde kalır.
        Yazma yetkisi (PUT /settings/:key) yalnız SUPER_ADMIN&apos;dedir.
      </InfoBox>
      <Card title={`${res.data.length} ayar`} action={res.pending ? <MockBadge /> : undefined}>
        <Table columns={columns} rows={res.data} rowKey={(s) => s.key} dense />
      </Card>
    </div>
  );
}

// --------------------------------------------------------- Bakım modu

function MaintenanceTab() {
  const [mode, setMode] = useState("KAPALI");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const health = useResource("/metrics/system", [...MOCK_HEALTH]);

  return (
    <div className="space-y-4">
      {health.pending && <PendingEndpointNotice endpoint="/metrics/system" phase="Faz 2" />}

      <Card title="Bakım penceresi" subtitle="BANNER yalnız uyarı bandı gösterir; TAM_KILIT tüm tenant erişimini keser.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mod" hint="TAM_KILIT dört-göz onayı gerektirir (spec dört-göz listesi #6).">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.keys(MAINTENANCE_MODE_LABELS).map((m) => (
                <option key={m} value={m}>
                  {MAINTENANCE_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pencere başlangıcı">
            <Input type="datetime-local" />
          </Field>
          <Field label="Pencere bitişi">
            <Input type="datetime-local" />
          </Field>
          <Field label="Duyuru öncesi bildirim" hint="Öneri: 72 saat önceden duyuru yayınlayın.">
            <Select defaultValue="72">
              <option value="24">24 saat</option>
              <option value="48">48 saat</option>
              <option value="72">72 saat</option>
            </Select>
          </Field>
        </div>

        {mode === "TAM_KILIT" && (
          <div className="mt-4">
            <ApprovalNotice action="system.maintenance_lock" />
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <RoleGate
            action={mode === "TAM_KILIT" ? "system.maintenance_lock" : "system.settings"}
            mutation
            mode="notice"
          >
            <Button
              variant={mode === "TAM_KILIT" ? "danger" : "primary"}
              onClick={() => setConfirmOpen(true)}
            >
              {mode === "TAM_KILIT" ? "Onaya gönder" : "Uygula"}
            </Button>
          </RoleGate>
          {mode === "TAM_KILIT" && <ApprovalBadge action="system.maintenance_lock" />}
        </div>
      </Card>

      <Card title="Sistem sağlığı" subtitle="Özet + Grafana derin linki; panel bir APM değildir.">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {health.data.map((h) => (
            <li key={h.key} className="rounded-lg border border-steel-800 bg-steel-950/60 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-steel-100">
                <HealthDot status={h.status} />
                {h.label}
              </p>
              <p className="mt-1 font-mono text-sm text-steel-200">{h.value}</p>
              <p className="mt-0.5 text-xs text-steel-500">{h.detail}</p>
              <p className="mt-1 text-[11px] text-steel-600">Ölçüm: {fmtDateTime(h.checkedAt)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Bakım modu değişikliği"
        subtitle="PUT /settings/maintenance_mode"
      >
        <div className="space-y-4">
          <PendingEndpointNotice endpoint="/settings/maintenance_mode" phase="Faz 1" method="PUT" />
          {mode === "TAM_KILIT" && <ApprovalNotice action="system.maintenance_lock" />}
          <Field label="Gerekçe" required>
            <Textarea rows={3} placeholder="Örn. PostgreSQL sürüm yükseltmesi; duyuru 72 saat önce yayınlandı." />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled title="Uç henüz uygulanmadı">
              {mode === "TAM_KILIT" ? "Onaya gönder" : "Uygula"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------- Feature flags

function FlagsTab() {
  const res = useResource<AdminFeatureFlag[]>("/flags", [...MOCK_FLAGS]);
  const [editing, setEditing] = useState<AdminFeatureFlag | null>(null);

  const columns: Array<Column<AdminFeatureFlag>> = [
    {
      key: "key",
      header: "Flag",
      render: (f) => (
        <div>
          <p className="font-mono text-xs text-steel-100">{f.key}</p>
          <p className="text-xs text-steel-500">{f.description}</p>
        </div>
      ),
    },
    {
      key: "mode",
      header: "Mod",
      render: (f) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge tone={toneOf(FLAG_MODE_TONES, f.mode)}>{labelOf(FLAG_MODE_LABELS, f.mode)}</Badge>
          {f.global && (
            <Badge tone="yellow" title="Platform geneli — dört-göz onayı gerekir.">
              global
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "detail",
      header: "Kapsam",
      render: (f) =>
        f.mode === "YUZDESEL" ? (
          <span className="text-xs">%{f.percentage} kullanıcı</span>
        ) : f.mode === "ALLOWLIST" ? (
          <span className="text-xs text-steel-300">{f.tenantCodes.length} tenant allowlist</span>
        ) : (
          <span className="text-xs text-steel-500">—</span>
        ),
    },
    {
      key: "history",
      header: "Son değişiklik",
      render: (f) => (
        <div className="text-xs text-steel-400">
          <p>{f.updatedByEmail}</p>
          <p className="text-steel-600">{fmtDateTime(f.updatedAt)}</p>
        </div>
      ),
    },
    {
      key: "edit",
      header: "",
      align: "right",
      // Kapı, matrisin DOĞRU satırıyla açılır (denetim bulgusu 17): global flag yazımı
      // ayrı bir eylemdir (dört-göz). Kapıyı `system.flag_write` ile açıp rozeti global
      // eyleme göre göstermek, matris satırı ileride değişirse UI'ın eski kararı sessizce
      // vermesi demekti.
      render: (f) => (
        <RoleGate action={f.global ? "system.flag_global_write" : "system.flag_write"} mutation>
          <span className="inline-flex items-center gap-2">
            {f.global && <ApprovalBadge action="system.flag_global_write" />}
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
      {res.pending && <PendingEndpointNotice endpoint="/flags" phase="Faz 2" />}
      <InfoBox>
        Flag modları: kapalı · yüzdesel rollout · tenant allowlist. Etkin flag seti API tarafında
        Redis&apos;te önbelleklenir. Platform geneli değişiklik (global) dört-göz onayı gerektirir;
        değişiklik geçmişi kim/ne zaman bilgisiyle listelenir.
      </InfoBox>
      <Card title={`${res.data.length} feature flag`} action={res.pending ? <MockBadge /> : undefined}>
        <Table columns={columns} rows={res.data} rowKey={(f) => f.id} dense />
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Flag: ${editing.key}` : ""}
        subtitle="PATCH /flags/:id · PUT /flags/:id/overrides"
      >
        {editing && (
          <div className="space-y-4">
            <PendingEndpointNotice endpoint={`/flags/${editing.id}`} phase="Faz 2" method="PATCH" />
            {editing.global && <ApprovalNotice action="system.flag_global_write" />}
            <Field label="Mod" required>
              <Select defaultValue={editing.mode}>
                {Object.keys(FLAG_MODE_LABELS).map((m) => (
                  <option key={m} value={m}>
                    {FLAG_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Yüzde (yalnız YUZDESEL modda)">
              <Input type="number" min={0} max={100} defaultValue={editing.percentage ?? 0} />
            </Field>
            <Field label="Tenant allowlist" hint="Virgülle ayrılmış tenant kodları.">
              <Input defaultValue={editing.tenantCodes.join(", ")} />
            </Field>
            <Field label="Gerekçe" required>
              <Textarea rows={2} placeholder="Pilot genişletme, geri alma gerekçesi…" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Vazgeç
              </Button>
              <Button disabled title="Uç henüz uygulanmadı">
                {editing.global ? "Onaya gönder" : "Kaydet"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------- Duyurular

function AnnouncementsTab() {
  const res = useResource<AdminAnnouncement[]>("/announcements", [...MOCK_ANNOUNCEMENTS]);
  const [composeOpen, setComposeOpen] = useState(false);

  const columns: Array<Column<AdminAnnouncement>> = [
    {
      key: "title",
      header: "Başlık",
      render: (a) => (
        <div>
          <p className="text-steel-100">{a.title}</p>
          <p className="text-xs text-steel-500">{a.body}</p>
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
          <p className="text-steel-500">{a.audienceDetail}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Durum",
      render: (a) => (
        <Badge tone={toneOf(ANNOUNCEMENT_STATUS_TONES, a.status)}>
          {labelOf(ANNOUNCEMENT_STATUS_LABELS, a.status)}
        </Badge>
      ),
    },
    {
      key: "window",
      header: "Yayın penceresi",
      render: (a) => (
        <span className="text-xs text-steel-400">
          {fmtDateTime(a.startsAt)} → {a.endsAt ? fmtDateTime(a.endsAt) : "süresiz"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {res.pending && <PendingEndpointNotice endpoint="/announcements" phase="Faz 2" />}
      <InfoBox>
        Duyurular tek yönlüdür: tenant uygulaması bunları{" "}
        <code className="font-mono text-xs">GET /api/v1/announcements</code> ile salt okur. Taslak →
        yayın akışı; hedef kitle tümü / plan / tenant listesi olabilir.
      </InfoBox>
      <Card
        title={`${res.data.length} duyuru`}
        action={
          <div className="flex items-center gap-2">
            {res.pending && <MockBadge />}
            <RoleGate action="announcement.publish" mutation>
              <Button onClick={() => setComposeOpen(true)}>Yeni duyuru</Button>
            </RoleGate>
          </div>
        }
      >
        <Table columns={columns} rows={res.data} rowKey={(a) => a.id} dense />
      </Card>

      <Modal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="Duyuru yayınla"
        subtitle="POST /announcements"
        wide
      >
        <div className="space-y-4">
          <PendingEndpointNotice endpoint="/announcements" phase="Faz 2" method="POST" />
          <Field label="Başlık" required>
            <Input placeholder="Planlı bakım: 1 Eylül 02:00–04:00" />
          </Field>
          <Field label="Gövde (markdown)" required>
            <Textarea rows={5} placeholder="Bakım penceresi süresince platform salt-okur modda olacaktır…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Önem" required>
              <Select defaultValue="INFO">
                {Object.keys(ANNOUNCEMENT_SEVERITY_LABELS).map((s) => (
                  <option key={s} value={s}>
                    {ANNOUNCEMENT_SEVERITY_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hedef kitle" required>
              <Select defaultValue="ALL">
                {Object.keys(ANNOUNCEMENT_AUDIENCE_LABELS).map((a) => (
                  <option key={a} value={a}>
                    {ANNOUNCEMENT_AUDIENCE_LABELS[a]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Yayın başlangıcı" required>
              <Input type="datetime-local" />
            </Field>
            <Field label="Yayın bitişi">
              <Input type="datetime-local" />
            </Field>
          </div>
          <WarningBox>
            Kritik duyurular tüm tenant kullanıcılarına gösterilir. Yayın işlemi
            PlatformAuditLog&apos;a <code className="font-mono text-xs">ANNOUNCEMENT_PUBLISH</code>{" "}
            olarak yazılır.
          </WarningBox>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setComposeOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="secondary" disabled title="Uç henüz uygulanmadı">
              Taslak kaydet
            </Button>
            <Button disabled title="Uç henüz uygulanmadı">
              Yayınla
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
