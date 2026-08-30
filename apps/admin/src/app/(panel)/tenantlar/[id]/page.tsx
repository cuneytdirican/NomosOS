"use client";

/**
 * Tenant detayı — sekmeler: Genel · Kullanıcılar · Abonelik · Kullanım · Destek Erişimi · Denetim İzi.
 * KVKK: bu ekranların hiçbirinde müvekkil/dosya/belge içeriği yoktur; yalnız sayaç ve metadata.
 * Tenant ham verisine tek kapı süreli SupportAccessGrant'tir (dört-göz + tenant ADMIN onayı).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useResource } from "@/lib/useResource";
import { useAdminSession } from "@/lib/session";
import { can, isMasked } from "@/lib/rbac";
import { PageGate, RoleGate, NoAccessInline } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  AI_PROVIDER_TYPE_LABELS,
  AI_PROVIDER_TYPE_TONES,
  AUDIT_ACTION_LABELS,
  GRANT_DURATIONS,
  GRANT_SCOPES,
  GRANT_SCOPE_LABELS,
  GRANT_SCOPE_SHORT,
  GRANT_SCOPE_TONES,
  PLAN_CODES,
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  fmtBytesMb,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  labelOf,
  maskEmail,
  remainingLabel,
  toneOf,
} from "@/lib/labels";
import {
  MOCK_AUDIT_LOGS,
  MOCK_SUPPORT_GRANTS,
  MOCK_TENANTS,
  MOCK_TENANT_USERS,
  MOCK_USAGE,
  findMockTenant,
  mockTenantSeries,
  type AdminSupportGrant,
  type AdminTenant,
  type AdminTenantUser,
} from "@/lib/mock";
import {
  Badge,
  BarList,
  Button,
  Card,
  ColumnChart,
  DataRow,
  EmptyState,
  Field,
  Input,
  InfoBox,
  MockBadge,
  Modal,
  PageHeader,
  PendingEndpointNotice,
  Select,
  StatCard,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "genel" | "kullanicilar" | "abonelik" | "kullanim" | "destek" | "denetim";

export default function TenantDetayPage() {
  return (
    <PageGate
      action="tenant.view"
      hint="Analist rolünde tenant detayı kapalıdır; yalnız plan/segment agregatı görüntülenebilir."
    >
      <TenantDetail />
    </PageGate>
  );
}

function TenantDetail() {
  const params = useParams();
  const rawId = params?.id;
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";

  const { role } = useAdminSession();
  const [tab, setTab] = useState<TabKey>("genel");

  const fallback = findMockTenant(id) ?? MOCK_TENANTS[0];
  const res = useResource<AdminTenant>(`/tenants/${id}`, fallback);
  const t = res.data;

  // Analist bu sayfaya erişemez; yine de savunmacı kontrol.
  if (isMasked(role, "tenant.view")) {
    return (
      <Card>
        <InfoBox title="Maskeli rol">
          Bu rolde tenant detayı görüntülenemez. Yalnız plan/segment agregatı açıktır.
        </InfoBox>
      </Card>
    );
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "genel", label: "Genel" },
    { key: "kullanicilar", label: "Kullanıcılar" },
    { key: "abonelik", label: "Abonelik" },
    { key: "kullanim", label: "Kullanım" },
    { key: "destek", label: "Destek Erişimi" },
    { key: "denetim", label: "Denetim İzi" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.name}
        description={`${t.city} · ${t.barAssociation} · Tenant #${t.code} · Kayıt: ${fmtDate(t.createdAt)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {res.pending && <MockBadge />}
            <Badge tone={toneOf(PLAN_TONES, t.plan)}>{labelOf(PLAN_LABELS, t.plan)}</Badge>
            <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, t.status)}>
              {labelOf(SUBSCRIPTION_STATUS_LABELS, t.status)}
            </Badge>
            <Link href="/tenantlar" className="text-xs text-accent-300 hover:text-accent-200">
              ← Listeye dön
            </Link>
          </div>
        }
      />

      {res.pending && <PendingEndpointNotice endpoint={`/tenants/${id}`} phase="Faz 1" />}

      {t.alert && <WarningBox title="Anomali / uyarı">{t.alert}</WarningBox>}

      <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Tenant sekmeleri" />

      {tab === "genel" && <GenelTab tenant={t} />}
      {tab === "kullanicilar" && <KullanicilarTab tenantId={t.id} />}
      {tab === "abonelik" && <AbonelikTab tenant={t} />}
      {tab === "kullanim" && <KullanimTab tenant={t} />}
      {tab === "destek" && <DestekTab tenant={t} />}
      {tab === "denetim" && <DenetimTab tenant={t} />}
    </div>
  );
}

// ---------------------------------------------------------------- Genel

function GenelTab({ tenant }: { tenant: AdminTenant }) {
  const { role } = useAdminSession();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Kullanıcı" value={fmtNumber(tenant.users)} hint="koltuk" />
        <StatCard label="Dosya" value={fmtNumber(tenant.cases)} hint={`${fmtNumber(tenant.documents)} belge`} />
        <StatCard label="Depolama" value={fmtBytesMb(tenant.storageMb)} />
        <StatCard
          label="Sağlık skoru"
          value={`${tenant.healthScore}/100`}
          tone={tenant.healthScore < 50 ? "red" : tenant.healthScore < 75 ? "yellow" : "green"}
          hint="churn riski sıralaması"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Kimlik ve iletişim">
          <DataRow label="Tenant kodu">#{tenant.code}</DataRow>
          <DataRow label="Faturalama e-postası">{tenant.billingEmail}</DataRow>
          <DataRow label="İl / Baro">
            {tenant.city} · {tenant.barAssociation}
          </DataRow>
          <DataRow label="Kayıt / onboarding">
            {fmtDate(tenant.createdAt)} → {fmtDate(tenant.onboardedAt)}
          </DataRow>
          <DataRow label="Son aktivite">{fmtDateTime(tenant.lastActivityAt)}</DataRow>
          <DataRow label="Deneme bitişi">
            {tenant.trialEndsAt ? fmtDate(tenant.trialEndsAt) : "—"}
          </DataRow>
        </Card>

        <Card
          title="AI yapılandırması"
          subtitle="Yalnız metadata — API anahtarı hiçbir role, maskeli dahi gösterilmez."
        >
          {!can(role, "ai.provider_config") ? (
            <NoAccessInline action="ai.provider_config" />
          ) : (
            <>
              <DataRow label="Sağlayıcı tipi">
                <Badge tone={toneOf(AI_PROVIDER_TYPE_TONES, tenant.providerType)}>
                  {labelOf(AI_PROVIDER_TYPE_LABELS, tenant.providerType)}
                </Badge>
              </DataRow>
              <DataRow label="Model">
                <span className="font-mono text-xs">{tenant.model}</span>
              </DataRow>
              <DataRow label="Anahtar durumu">
                {tenant.hasApiKey ? (
                  <Badge tone="green">hasApiKey: true</Badge>
                ) : (
                  <Badge tone="red">hasApiKey: false</Badge>
                )}
              </DataRow>
              <DataRow label="AI çağrısı (30g)">{fmtCompact(tenant.aiCalls30d)}</DataRow>
              <p className="mt-3 text-xs text-steel-500">
                <code className="font-mono">encryptedApiKey</code> hiçbir{" "}
                <code className="font-mono">/api/v1/admin</code> yanıtında yer almaz;{" "}
                <code className="font-mono">MASTER_ENCRYPTION_KEY</code> panel servisinin ortamında
                bulunmaz.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card title="İşlemler" subtitle="Her mutasyon gerekçe alanıyla PlatformAuditLog'a yazılır.">
        <div className="flex flex-wrap items-center gap-3">
          <RoleGate action="tenant.suspend" mutation mode="notice">
            <span className="inline-flex items-center gap-2">
              <Button
                variant={tenant.status === "SUSPENDED" ? "secondary" : "danger"}
                onClick={() => setSuspendOpen(true)}
              >
                {tenant.status === "SUSPENDED" ? "Askıdan çıkar" : "Askıya al"}
              </Button>
              <ApprovalBadge action="tenant.suspend" />
            </span>
          </RoleGate>

          <RoleGate action="tenant.plan_change" mutation>
            <Button variant="secondary">Plan değiştir</Button>
          </RoleGate>

          <RoleGate action="tenant.create" mutation>
            <Button variant="secondary">Deneme süresini uzat</Button>
          </RoleGate>

          <RoleGate action="tenant.delete" mutation>
            <span className="inline-flex items-center gap-2">
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Kalıcı sil / veri imhası
              </Button>
              <ApprovalBadge action="tenant.delete" />
            </span>
          </RoleGate>
        </div>
        <p className="mt-4 text-xs text-steel-500">
          &quot;Tenant kullanıcısı gibi giriş yap&quot; (impersonation) bilinçli olarak kapsam
          dışıdır ve yazılmayacaktır.
        </p>
      </Card>

      <Modal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title={tenant.status === "SUSPENDED" ? "Askıdan çıkar" : "Tenant askıya al"}
        subtitle={`POST /tenants/${tenant.id}/${tenant.status === "SUSPENDED" ? "reactivate" : "suspend"}`}
      >
        <div className="space-y-4">
          <ApprovalNotice action="tenant.suspend" />
          <PendingEndpointNotice
            endpoint={`/tenants/${tenant.id}/suspend`}
            phase="Faz 1"
            method="POST"
          />
          <WarningBox>
            Askıya alma dunning zincirinin son adımıdır. Askıdaki tenant kullanıcıları girişte
            Türkçe açıklamalı 403 alır; <strong>veri silinmez</strong>, işlem geri alınabilir.
          </WarningBox>
          <Field label="Gerekçe" required hint="Zorunlu — PlatformAuditLog'a ve onay talebine yazılır.">
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn. ödeme temerrüdü — 3 başarısız deneme, dunning 2. adım tamamlandı."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSuspendOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="danger" disabled title="Uç henüz uygulanmadı">
              Onaya gönder
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Kalıcı silme / veri imhası"
        subtitle={`DELETE /tenants/${tenant.id} — iki SUPER_ADMIN onayı`}
      >
        <div className="space-y-4">
          <ApprovalNotice
            action="tenant.delete"
            extra="Bu işlem iki ayrı SUPER_ADMIN onayı gerektirir."
          />
          <PendingEndpointNotice endpoint={`/tenants/${tenant.id}`} phase="Faz 1" method="DELETE" />
          <WarningBox>
            Silme soft-delete + anonimleştirme kuyruğudur. Veri ihracı bağlantısı sürelidir; kalıcı
            silme tarihi yasal saklama süresi sonunda planlanır ve tenant kaydında görünür.
          </WarningBox>
          <Field label="Gerekçe" required>
            <Textarea rows={3} placeholder="Kapatma talebi referansı, saklama süresi bitiş tarihi…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="danger" disabled title="Uç henüz uygulanmadı">
              Onaya gönder
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// -------------------------------------------------------- Kullanıcılar

function KullanicilarTab({ tenantId }: { tenantId: string }) {
  const res = useResource<AdminTenantUser[]>(`/tenants/${tenantId}/users`, [...MOCK_TENANT_USERS]);

  const columns: Array<Column<AdminTenantUser>> = [
    { key: "name", header: "Ad Soyad", render: (u) => <span className="text-steel-100">{u.fullName}</span> },
    {
      key: "email",
      header: "E-posta",
      render: (u) => <span className="font-mono text-xs text-steel-400">{maskEmail(u.email)}</span>,
    },
    { key: "role", header: "Rol", render: (u) => <Badge tone="steel">{u.role}</Badge> },
    { key: "status", header: "Durum", render: (u) => <Badge tone={u.status === "AKTIF" ? "green" : "gray"}>{u.status}</Badge> },
    { key: "last", header: "Son giriş", render: (u) => fmtDateTime(u.lastLoginAt) },
  ];

  return (
    <div className="space-y-4">
      {res.pending && <PendingEndpointNotice endpoint={`/tenants/${tenantId}/users`} phase="Faz 1" />}
      <InfoBox>
        Yalnız kullanıcı <strong>metadata&apos;sı</strong> gösterilir (rol, durum, son giriş).
        E-posta adresleri maskelidir; kullanıcı içeriği, notları ve dosyaları görünmez.
      </InfoBox>
      <Card title={`${res.data.length} kullanıcı`} action={res.pending ? <MockBadge /> : undefined}>
        <Table columns={columns} rows={res.data} rowKey={(u) => u.id} dense />
      </Card>
    </div>
  );
}

// ------------------------------------------------------------ Abonelik

function AbonelikTab({ tenant }: { tenant: AdminTenant }) {
  const { role } = useAdminSession();
  const [planOpen, setPlanOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Abonelik">
          <DataRow label="Plan">
            <Badge tone={toneOf(PLAN_TONES, tenant.plan)}>{labelOf(PLAN_LABELS, tenant.plan)}</Badge>
          </DataRow>
          <DataRow label="Durum">
            <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, tenant.status)}>
              {labelOf(SUBSCRIPTION_STATUS_LABELS, tenant.status)}
            </Badge>
          </DataRow>
          <DataRow label="MRR katkısı">{fmtMoney(tenant.mrr)}</DataRow>
          <DataRow label="Açık bakiye">
            {tenant.openBalance > 0 ? (
              <span className="text-red-300">{fmtMoney(tenant.openBalance)}</span>
            ) : (
              "—"
            )}
          </DataRow>
          <DataRow label="Deneme bitişi">
            {tenant.trialEndsAt ? fmtDate(tenant.trialEndsAt) : "—"}
          </DataRow>
        </Card>

        <Card title="Finans işlemleri">
          {can(role, "payment.view") ? (
            <div className="space-y-3">
              <p className="text-sm text-steel-300">
                Ödeme kayıtları ve faturalar Ödemeler ekranında filtrelenebilir.
              </p>
              <Link href="/odemeler" className="text-sm text-accent-300 hover:text-accent-200">
                Ödemeler ekranına git →
              </Link>
            </div>
          ) : (
            <NoAccessInline action="payment.view" />
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <RoleGate action="tenant.plan_change" mutation mode="notice">
              <Button variant="secondary" onClick={() => setPlanOpen(true)}>
                Plan değiştir
              </Button>
            </RoleGate>
            <RoleGate action="tenant.custom_price" mutation>
              <span className="inline-flex items-center gap-2">
                <Button variant="secondary">Özel fiyat tanımla</Button>
                <ApprovalBadge action="tenant.custom_price" />
              </span>
            </RoleGate>
          </div>
        </Card>
      </div>

      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Plan değişikliği"
        subtitle="POST /subscriptions/:id/change-plan"
      >
        <div className="space-y-4">
          <PendingEndpointNotice endpoint="/subscriptions/:id/change-plan" phase="Faz 3" method="POST" />
          <Field label="Yeni plan" required>
            <Select defaultValue={tenant.plan}>
              {PLAN_CODES.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gerekçe" required>
            <Textarea rows={3} placeholder="Yükseltme talebi, sözleşme referansı…" />
          </Field>
          <InfoBox>
            Plan fiyat değişikliği mevcut aboneleri cari dönem sonuna kadar etkilemez; proration
            önizlemesi işlem detayına yazılır.
          </InfoBox>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPlanOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled title="Uç henüz uygulanmadı">
              Uygula
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------ Kullanım

function KullanimTab({ tenant }: { tenant: AdminTenant }) {
  const { role } = useAdminSession();
  const res = useResource(`/tenants/${tenant.id}/usage`, mockTenantSeries(tenant.code.length));

  const rows = useMemo(
    () => MOCK_USAGE.filter((u) => u.tenantId === tenant.id),
    [tenant.id],
  );

  if (!can(role, "ai.analytics.tenant")) {
    return (
      <Card>
        <NoAccessInline action="ai.analytics.tenant" />
      </Card>
    );
  }

  const columns: Array<Column<(typeof MOCK_USAGE)[number]>> = [
    { key: "task", header: "Görev tipi", render: (r) => <span className="font-mono text-xs">{r.taskType}</span> },
    { key: "provider", header: "Sağlayıcı", render: (r) => labelOf(AI_PROVIDER_TYPE_LABELS, r.providerType) },
    { key: "model", header: "Model", render: (r) => <span className="font-mono text-xs">{r.model}</span> },
    { key: "calls", header: "Çağrı", align: "right", render: (r) => fmtNumber(r.calls) },
    {
      key: "tokens",
      header: "Token (girdi/çıktı)",
      align: "right",
      render: (r) =>
        r.noTokenInfoCalls > 0 && r.inputTokens === 0 ? (
          <span className="text-steel-500">token bilgisi yok</span>
        ) : (
          <span className="font-mono text-xs">
            {fmtCompact(r.inputTokens)} / {fmtCompact(r.outputTokens)}
          </span>
        ),
    },
    { key: "err", header: "Hata", align: "right", render: (r) => fmtPercent(r.errorRatePct) },
    { key: "pii", header: "PII maskeli", align: "right", render: (r) => fmtPercent(r.piiMaskedPct) },
  ];

  return (
    <div className="space-y-4">
      {res.pending && <PendingEndpointNotice endpoint={`/tenants/${tenant.id}/usage`} phase="Faz 2" />}
      <Card title="Günlük AI çağrısı (14 gün)" subtitle="Kaynak: UsageSnapshot (gece toplu işi) + Redis 'bugün' sayaçları">
        <ColumnChart points={res.data} ariaLabel="Tenant günlük AI çağrı sayısı" />
      </Card>
      <Card
        title="Görev tipi × sağlayıcı × model"
        subtitle="Panel token sayar, fiyatlamaz — 'AI maliyeti (TL)' kolonu yoktur (BYO-LLM)."
        action={res.pending ? <MockBadge /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState message="Bu tenant için kayıtlı AI kullanımı bulunmuyor." />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.taskType}-${r.model}`}
            dense
          />
        )}
      </Card>
    </div>
  );
}

// -------------------------------------------------------- Destek erişimi

function DestekTab({ tenant }: { tenant: AdminTenant }) {
  const { role } = useAdminSession();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("METADATA");
  const [hours, setHours] = useState<number>(4);
  const [reason, setReason] = useState("");

  const res = useResource<AdminSupportGrant[]>("/support-grants", [...MOCK_SUPPORT_GRANTS], {
    query: { tenantId: tenant.id },
  });

  const grants = res.data.filter((g) => g.tenantCode === tenant.code || res.pending);

  const columns: Array<Column<AdminSupportGrant>> = [
    { key: "user", header: "Personel", render: (g) => <span className="font-mono text-xs">{g.platformUserEmail}</span> },
    {
      key: "scope",
      header: "Kapsam",
      render: (g) => (
        <Badge tone={toneOf(GRANT_SCOPE_TONES, g.scope)}>{labelOf(GRANT_SCOPE_SHORT, g.scope)}</Badge>
      ),
    },
    { key: "reason", header: "Gerekçe", render: (g) => <span className="text-xs text-steel-300">{g.reason}</span> },
    {
      key: "tenantApproved",
      header: "Tenant onayı",
      render: (g) =>
        g.tenantApproved ? <Badge tone="green">Onaylı</Badge> : <Badge tone="yellow">Bekliyor</Badge>,
    },
    {
      key: "window",
      header: "Pencere",
      render: (g) => (
        <div className="text-xs">
          <p className="text-steel-200">{fmtDateTime(g.startsAt)}</p>
          <p className="text-steel-500">
            {g.revokedAt
              ? `Erken iptal: ${fmtDateTime(g.revokedAt)}`
              : remainingLabel(g.expiresAt)}
          </p>
        </div>
      ),
    },
    { key: "views", header: "Görüntüleme", align: "right", render: (g) => fmtNumber(g.viewCount) },
  ];

  return (
    <div className="space-y-4">
      {res.pending && <PendingEndpointNotice endpoint="/support-grants" phase="Faz 2" />}

      <InfoBox title="Destek erişimi nasıl çalışır?">
        Impersonation yoktur. Tenant verisine tek kapı süreli erişim penceresidir: tenant ADMIN
        onayı (veya yasal zorunluluk istisnası) + dört-göz onayı → varsayılan 4 saat, azami 24 saat
        → kapsam sınırlı → <strong>salt-okur</strong> (hiçbir mutasyon ucu çalışmaz) → PII her
        kapsamda maskeli (TCKN, telefon, IBAN) → belge indirme kapalı. Her sayfa görüntüleme hem
        PlatformAuditLog&apos;a hem tenant&apos;ın kendi AuditLog&apos;una{" "}
        <code className="font-mono text-xs">PLATFORM_DESTEK_ERISIMI</code> olarak yazılır.
      </InfoBox>

      <Card
        title="Erişim kayıtları"
        subtitle="Aktif ve geçmiş SupportAccessGrant kayıtları"
        action={
          <div className="flex items-center gap-2">
            {res.pending && <MockBadge />}
            <RoleGate action="support_grant.request" mutation mode="notice">
              <span className="inline-flex items-center gap-2">
                <Button onClick={() => setOpen(true)}>Erişim talebi aç</Button>
                <ApprovalBadge action="support_grant.request" />
              </span>
            </RoleGate>
          </div>
        }
      >
        {grants.length === 0 ? (
          <EmptyState message="Bu tenant için destek erişim kaydı yok." />
        ) : (
          <Table columns={columns} rows={grants} rowKey={(g) => g.id} dense />
        )}
        {can(role, "support_grant.revoke") && grants.some((g) => !g.revokedAt) && (
          <p className="mt-3 text-xs text-steel-500">
            Aktif pencereler erken iptal edilebilir (PATCH /support-grants/:id/revoke).
          </p>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Destek erişim penceresi aç"
        subtitle={`POST /support-grants — ${tenant.name}`}
        wide
      >
        <div className="space-y-4">
          <ApprovalNotice
            action="support_grant.request"
            extra="Ayrıca tenant ADMIN'inin uygulama içi onayı gerekir; yasal zorunluluk istisnası ayrıca loglanır."
          />
          <PendingEndpointNotice endpoint="/support-grants" phase="Faz 2" method="POST" />

          <Field label="Kapsam" required hint="Varsayılan METADATA; TAM_OKUMA yalnız tenant onayıyla.">
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              {GRANT_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {GRANT_SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Süre" required hint="Varsayılan 4 saat, azami 24 saat. Süre dolunca erişim kendiliğinden kapanır.">
            <Select value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
              {GRANT_DURATIONS.map((d) => (
                <option key={d.hours} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Gerekçe"
            required
            hint="Zorunlu. Boş bırakılamaz; gerekçe hem onay talebine hem denetim izine yazılır."
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn. 'belge yüklenmiyor' bildirimi — hata loglarının incelenmesi gerekiyor."
            />
          </Field>

          {reason.trim().length === 0 && (
            <p className="text-xs text-amber-300">Gerekçe zorunludur.</p>
          )}

          <WarningBox>
            Bu pencere salt-okurdur. PII (TCKN, telefon, IBAN) her kapsamda maskelidir ve maskeleme
            kaldırılamaz; belge indirme kapalıdır.
          </WarningBox>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button disabled={reason.trim().length === 0} title="Uç henüz uygulanmadı">
              Onaya gönder ({hours} saat · {labelOf(GRANT_SCOPE_SHORT, scope)})
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------- Denetim

function DenetimTab({ tenant }: { tenant: AdminTenant }) {
  const { role } = useAdminSession();

  const rows = useMemo(
    () => MOCK_AUDIT_LOGS.filter((l) => l.targetTenantCode === tenant.code),
    [tenant.code],
  );

  if (!can(role, "audit.view")) {
    return (
      <Card>
        <NoAccessInline action="audit.view" />
      </Card>
    );
  }

  const columns: Array<Column<(typeof MOCK_AUDIT_LOGS)[number]>> = [
    { key: "at", header: "Tarih", render: (l) => fmtDateTime(l.createdAt) },
    { key: "user", header: "Personel", render: (l) => <span className="font-mono text-xs">{l.platformUserEmail}</span> },
    { key: "role", header: "Rol", render: (l) => <Badge tone="steel">{l.role}</Badge> },
    { key: "action", header: "Aksiyon", render: (l) => labelOf(AUDIT_ACTION_LABELS, l.action) },
    { key: "detail", header: "Detay", render: (l) => <span className="text-xs text-steel-400">{l.detail}</span> },
  ];

  return (
    <div className="space-y-4">
      <InfoBox>
        Bu tenant&apos;a yapılan platform işlemleri. PlatformAuditLog append-only&apos;dir;
        uygulama DB rolünde UPDATE/DELETE yetkisi yoktur ve kayıtlar en az 10 yıl saklanır.
      </InfoBox>
      <Card title={`${rows.length} kayıt`}>
        {rows.length === 0 ? (
          <EmptyState message="Bu tenant için platform işlemi kaydı yok." />
        ) : (
          <Table columns={columns} rows={rows} rowKey={(l) => l.id} dense />
        )}
      </Card>
      <Card title="İç notlar (TenantNote)">
        <BarList
          items={[
            { label: "Satış", value: 3, hint: "3 not" },
            { label: "Risk", value: 1, hint: "1 not", tone: "red" },
            { label: "Destek", value: 5, hint: "5 not", tone: "green" },
          ]}
        />
        <div className="mt-4 space-y-3">
          <Field label="Yeni not">
            <Input placeholder="Notu yazın…" />
          </Field>
          <RoleGate action="tenant.notes" mutation mode="notice">
            <Button variant="secondary" disabled title="Uç henüz uygulanmadı">
              Not ekle
            </Button>
          </RoleGate>
        </div>
      </Card>
    </div>
  );
}
