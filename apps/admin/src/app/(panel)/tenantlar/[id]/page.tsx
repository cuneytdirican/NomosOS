"use client";

/**
 * Tenant detayı — sekmeler: Genel · Kullanım · Destek Erişimi · Denetim İzi.
 *
 * KVKK: bu ekranların hiçbirinde müvekkil, dosya veya belge İÇERİĞİ yoktur; yalnız sayaç
 * ve üstveri gösterilir. Tenant ham verisine tek kapı süreli SupportAccessGrant'tir
 * (gerekçe zorunlu, azami 24 saat, PII maskeli, salt-okur). Impersonation YOKTUR.
 *
 * Uçlar:
 *   GET    /tenants/:id
 *   POST   /tenants/:id/suspend | /activate     (dört-göz → onay talebi)
 *   GET    /metrics/usage?tenantId=&from=&to=
 *   GET    /metrics/ai?tenantId=&groupBy=taskType
 *   GET    /support-access?tenantId=
 *   POST   /tenants/:id/support-access
 *   DELETE /support-access/:id
 *   GET    /audit?tenantId=
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useListResource, useResource } from "@/lib/useResource";
import { useMutation } from "@/lib/useMutation";
import { useAdminSession } from "@/lib/session";
import { EP } from "@/lib/endpoints";
import { can, isMasked } from "@/lib/rbac";
import { PageGate, RoleGate, NoAccessInline } from "@/components/RoleGate";
import { ApprovalBadge, ApprovalNotice } from "@/components/ApprovalBadge";
import {
  AI_PROVIDER_TYPE_LABELS,
  AI_PROVIDER_TYPE_TONES,
  AUDIT_ACTION_LABELS,
  GRANT_DEFAULT_HOURS,
  GRANT_DURATIONS,
  GRANT_MAX_HOURS,
  GRANT_SCOPES,
  GRANT_SCOPE_LABELS,
  GRANT_SCOPE_SHORT,
  GRANT_SCOPE_TONES,
  PLAN_LABELS,
  PLAN_TONES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONES,
  daysAgo,
  fmtBytes,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  isExpired,
  labelOf,
  remainingLabel,
  toDateInput,
  toneOf,
} from "@/lib/labels";
import type {
  AdminAiMetricRow,
  AdminAuditEntry,
  AdminSupportGrant,
  AdminTenantDetail,
  AdminUsagePoint,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ColumnChart,
  DataRow,
  EndpointMissingNotice,
  ErrorBox,
  Field,
  InfoBox,
  Modal,
  PageHeader,
  ResourceView,
  Select,
  StatCard,
  SuccessBox,
  Table,
  Tabs,
  Textarea,
  WarningBox,
  type Column,
} from "@/components/ui";

type TabKey = "genel" | "kullanim" | "destek" | "denetim";

export default function TenantDetayPage() {
  return (
    <PageGate
      action="tenant.view"
      hint="Analist rolünde tenant detayı kapalıdır; yalnız plan/durum agregatı görüntülenebilir."
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

  const res = useResource<AdminTenantDetail>(id ? EP.tenants.detail(id) : null);
  const t = res.data;

  // Analist bu sayfaya erişemez; yine de savunmacı kontrol.
  if (isMasked(role, "tenant.view")) {
    return (
      <Card>
        <InfoBox title="Maskeli rol">
          Bu rolde tenant detayı görüntülenemez. Müvekkil, dosya ve belge verisi bu role kapalıdır;
          yalnız plan/segment agregatı açıktır.
        </InfoBox>
      </Card>
    );
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "genel", label: "Genel" },
    { key: "kullanim", label: "Kullanım" },
    { key: "destek", label: "Destek Erişimi" },
    { key: "denetim", label: "Denetim İzi" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t?.name ?? "Tenant"}
        description={
          t
            ? `Tenant ${t.id}${t.createdAt ? ` · Kayıt: ${fmtDate(t.createdAt)}` : ""}`
            : `Tenant ${id}`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {t?.planKey && (
              <Badge tone={toneOf(PLAN_TONES, t.planKey)}>{labelOf(PLAN_LABELS, t.planKey)}</Badge>
            )}
            {t?.status && (
              <Badge tone={toneOf(SUBSCRIPTION_STATUS_TONES, t.status)}>
                {labelOf(SUBSCRIPTION_STATUS_LABELS, t.status)}
              </Badge>
            )}
            <Link href="/tenantlar" className="text-xs text-accent-300 hover:text-accent-200">
              ← Listeye dön
            </Link>
          </div>
        }
      />

      <InfoBox title="Bu ekranda ne YOKTUR?">
        Müvekkil, dosya ve belge <strong>içeriği</strong> panelde hiçbir rolde görüntülenemez;
        sunucu bu alanları döndürmez. Tenant verisine tek kapı, aşağıdaki{" "}
        <strong>süreli ve PII maskeli destek erişimi</strong> penceresidir. &quot;Tenant kullanıcısı
        gibi giriş yap&quot; (impersonation) bilinçli olarak kapsam dışıdır.
      </InfoBox>

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && !t}
        endpoint={EP.tenants.detail(id)}
        what="Tenant detayı"
        emptyMessage="Tenant bulunamadı."
      >
        {t && (
          <>
            <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Tenant sekmeleri" />
            {tab === "genel" && <GenelTab tenant={t} onChanged={res.reload} />}
            {tab === "kullanim" && <KullanimTab tenantId={t.id} />}
            {tab === "destek" && <DestekTab tenant={t} />}
            {tab === "denetim" && <DenetimTab tenantId={t.id} />}
          </>
        )}
      </ResourceView>
    </div>
  );
}

// ---------------------------------------------------------------- Genel

function GenelTab({
  tenant,
  onChanged,
}: {
  tenant: AdminTenantDetail;
  onChanged: () => void;
}) {
  const { role } = useAdminSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = useMutation();

  const suspended = tenant.status === "SUSPENDED";
  const actionKey = suspended ? "tenant.reactivate" : "tenant.suspend";
  const path = suspended ? EP.tenants.activate(tenant.id) : EP.tenants.suspend(tenant.id);

  async function submit() {
    const ok = await mutation.run(
      path,
      { method: "POST", body: { reason: reason.trim() } },
      {
        successMessage: suspended
          ? "Tenant aktifleştirme işlemi uygulandı."
          : "Tenant askıya alma işlemi uygulandı.",
        onSuccess: () => onChanged(),
      },
    );
    if (ok) setReason("");
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Kullanıcı" value={fmtNumber(tenant.userCount)} hint={`${fmtNumber(tenant.seats)} koltuk`} />
        <StatCard
          label="Dosya"
          value={fmtNumber(tenant.caseCount)}
          hint={`${fmtNumber(tenant.documentCount)} belge`}
        />
        <StatCard label="Depolama" value={fmtBytes(tenant.storageBytes)} />
        <StatCard label="AI çağrısı" value={fmtCompact(tenant.aiCallCount)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Kimlik ve abonelik">
          <DataRow label="Tenant kimliği">
            <span className="font-mono text-xs">{tenant.id}</span>
          </DataRow>
          <DataRow label="Büro adı">{tenant.name}</DataRow>
          <DataRow label="Plan">
            {tenant.planKey ? labelOf(PLAN_LABELS, tenant.planKey) : "—"}
          </DataRow>
          <DataRow label="Durum">
            {tenant.status ? labelOf(SUBSCRIPTION_STATUS_LABELS, tenant.status) : "—"}
          </DataRow>
          <DataRow label="Dönem">
            {tenant.currentPeriodStart || tenant.currentPeriodEnd
              ? `${fmtDate(tenant.currentPeriodStart)} → ${fmtDate(tenant.currentPeriodEnd)}`
              : "—"}
          </DataRow>
          <DataRow label="Deneme bitişi">{fmtDate(tenant.trialEndsAt)}</DataRow>
          <DataRow label="MRR katkısı">{fmtMoney(tenant.mrr)}</DataRow>
          <DataRow label="Kayıt tarihi">{fmtDate(tenant.createdAt)}</DataRow>
        </Card>

        <Card
          title="AI yapılandırması"
          subtitle="Yalnız üstveri — API anahtarı hiçbir role, maskeli dahi gösterilmez."
        >
          {!can(role, "ai.provider_config") ? (
            <NoAccessInline action="ai.provider_config" />
          ) : (
            <>
              <DataRow label="AI politikası">{tenant.aiPolicy ?? "—"}</DataRow>
              <DataRow label="Otomatik maskeleme rızası">
                {tenant.autoMaskConsent === null || tenant.autoMaskConsent === undefined
                  ? "—"
                  : tenant.autoMaskConsent
                    ? "Verildi"
                    : "Verilmedi"}
              </DataRow>
              {(tenant.aiProviders ?? []).length === 0 ? (
                <p className="mt-3 text-xs text-steel-500">
                  Sağlayıcı yapılandırması dönmedi ya da tanımlı değil.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {(tenant.aiProviders ?? []).map((p) => (
                    <li
                      key={p.id}
                      className="rounded-lg border border-steel-800 bg-steel-950/60 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneOf(AI_PROVIDER_TYPE_TONES, p.providerType)}>
                          {labelOf(AI_PROVIDER_TYPE_LABELS, p.providerType)}
                        </Badge>
                        {p.hasApiKey ? (
                          <Badge tone="green">hasApiKey: true</Badge>
                        ) : (
                          <Badge tone="red">hasApiKey: false</Badge>
                        )}
                        {p.isActive === false && <Badge tone="gray">pasif</Badge>}
                      </div>
                      <p className="mt-1 font-mono text-xs text-steel-400">{p.model ?? "—"}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-steel-500">
                <code className="font-mono">encryptedApiKey</code> hiçbir{" "}
                <code className="font-mono">/api/admin/v1</code> yanıtında yer almaz;{" "}
                <code className="font-mono">MASTER_ENCRYPTION_KEY</code> panel bağlamında
                çözülmez.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card
        title="Yaşam döngüsü işlemleri"
        subtitle="Her mutasyon gerekçe alanıyla PlatformAuditLog'a yazılır."
      >
        <div className="flex flex-wrap items-center gap-3">
          <RoleGate action={actionKey} mutation mode="notice">
            <span className="inline-flex items-center gap-2">
              <Button
                variant={suspended ? "secondary" : "danger"}
                onClick={() => {
                  mutation.reset();
                  setOpen(true);
                }}
              >
                {suspended ? "Askıdan çıkar" : "Askıya al"}
              </Button>
              <ApprovalBadge action={actionKey} />
            </span>
          </RoleGate>
        </div>
        {mutation.success && (
          <div className="mt-4">
            <SuccessBox message={mutation.success} />
          </div>
        )}
        <p className="mt-4 text-xs text-steel-500">
          Plan değişikliği ve iptal <Link href="/abonelikler" className="text-accent-300 underline">Abonelikler</Link>{" "}
          ekranından yapılır; iade akışı{" "}
          <Link href="/odemeler" className="text-accent-300 underline">Ödemeler</Link> ekranındadır.
        </p>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={suspended ? "Tenant aktifleştir" : "Tenant askıya al"}
        subtitle={`POST /api/admin/v1${path}`}
      >
        <div className="space-y-4">
          <ApprovalNotice action={actionKey} />
          <WarningBox>
            Askıya alma dunning zincirinin son adımıdır. Askıdaki tenant kullanıcıları girişte
            Türkçe açıklamalı hata alır; <strong>veri silinmez</strong> ve işlem geri alınabilir.
          </WarningBox>
          <Field
            label="Gerekçe"
            required
            hint="Zorunlu — hem onay talebine hem PlatformAuditLog'a yazılır."
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn. ödeme temerrüdü — 3 başarısız deneme, dunning 2. adım tamamlandı."
            />
          </Field>
          {mutation.missing && (
            <EndpointMissingNotice endpoint={path} method="POST" what="Tenant durum değişikliği" />
          )}
          {mutation.error && <ErrorBox message={mutation.error} />}
          {mutation.success && <SuccessBox message={mutation.success} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Kapat
            </Button>
            <Button
              variant={suspended ? "primary" : "danger"}
              disabled={reason.trim().length === 0 || mutation.loading}
              onClick={() => void submit()}
            >
              {mutation.loading ? "Gönderiliyor…" : "Onaya gönder"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------- Kullanım

function KullanimTab({ tenantId }: { tenantId: string }) {
  const { role } = useAdminSession();
  const from = toDateInput(daysAgo(29));
  const to = toDateInput(new Date());

  const usage = useListResource<AdminUsagePoint>(EP.metrics.usage, {
    query: { tenantId, from, to },
  });
  const ai = useListResource<AdminAiMetricRow>(EP.metrics.ai, {
    query: { tenantId, groupBy: "taskType" },
  });

  const series = useMemo(
    () =>
      usage.data
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((p) => ({
          label: new Date(p.date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }),
          value: Number(p.aiCallCount ?? 0),
        })),
    [usage.data],
  );

  if (!can(role, "ai.analytics.tenant")) {
    return (
      <Card>
        <NoAccessInline action="ai.analytics.tenant" />
      </Card>
    );
  }

  const columns: Array<Column<AdminAiMetricRow>> = [
    {
      key: "task",
      header: "Görev tipi",
      render: (r) => (
        <span className="font-mono text-xs">{r.taskType ?? r.key ?? r.label ?? "—"}</span>
      ),
    },
    {
      key: "provider",
      header: "Sağlayıcı",
      render: (r) => (r.providerType ? labelOf(AI_PROVIDER_TYPE_LABELS, r.providerType) : "—"),
    },
    {
      key: "model",
      header: "Model",
      render: (r) => <span className="font-mono text-xs">{r.model ?? "—"}</span>,
    },
    { key: "calls", header: "Çağrı", align: "right", render: (r) => fmtNumber(r.calls) },
    {
      key: "tokens",
      header: "Token (girdi/çıktı)",
      align: "right",
      render: (r) =>
        r.inputTokens === null || r.inputTokens === undefined ? (
          <span className="text-steel-500">token bilgisi yok</span>
        ) : (
          <span className="font-mono text-xs">
            {fmtCompact(r.inputTokens)} / {fmtCompact(r.outputTokens)}
          </span>
        ),
    },
    {
      key: "unknown",
      header: "Token bilgisi yok",
      align: "right",
      render: (r) =>
        r.unknownTokenCalls ? (
          <Badge tone="yellow">{fmtNumber(r.unknownTokenCalls)}</Badge>
        ) : (
          <span className="text-steel-600">—</span>
        ),
    },
    { key: "err", header: "Hata", align: "right", render: (r) => fmtPercent(r.errorRatePct) },
    { key: "pii", header: "PII maskeli", align: "right", render: (r) => fmtPercent(r.piiMaskedPct) },
  ];

  return (
    <div className="space-y-4">
      <Card
        title="Günlük AI çağrısı (30 gün)"
        subtitle="Kaynak: GET /metrics/usage — UsageSnapshot"
      >
        <ResourceView
          loading={usage.loading}
          missing={usage.missing}
          forbidden={usage.forbidden}
          error={usage.error}
          empty={usage.loaded && series.length === 0}
          endpoint={EP.metrics.usage}
          what="Tenant kullanım serisi"
          emptyMessage="Bu aralıkta kullanım kaydı yok."
        >
          <ColumnChart points={series} ariaLabel="Tenant günlük AI çağrı sayısı" />
        </ResourceView>
      </Card>

      <Card
        title="Görev tipine göre kırılım"
        subtitle="Panel token sayar, fiyatlamaz — 'AI maliyeti (TL)' kolonu YOKTUR (BYO-LLM)."
      >
        <ResourceView
          loading={ai.loading}
          missing={ai.missing}
          forbidden={ai.forbidden}
          error={ai.error}
          empty={ai.empty}
          endpoint={EP.metrics.ai}
          what="AI kırılımı"
          emptyMessage="Bu tenant için kayıtlı AI kullanımı bulunmuyor."
        >
          <Table
            columns={columns}
            rows={ai.data}
            rowKey={(r, i) => `${r.taskType ?? r.key ?? i}-${r.model ?? ""}-${i}`}
            dense
          />
        </ResourceView>
      </Card>
    </div>
  );
}

// -------------------------------------------------------- Destek erişimi

function DestekTab({ tenant }: { tenant: AdminTenantDetail }) {
  const { role } = useAdminSession();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>(GRANT_SCOPES[0]);
  const [hours, setHours] = useState<number>(GRANT_DEFAULT_HOURS);
  const [reason, setReason] = useState("");

  const res = useListResource<AdminSupportGrant>(EP.supportAccess.list, {
    query: { tenantId: tenant.id },
  });
  const create = useMutation();
  const revoke = useMutation();

  const grants = useMemo(
    () =>
      res.data
        .slice()
        .sort((a, b) => String(b.grantedAt).localeCompare(String(a.grantedAt))),
    [res.data],
  );

  async function submit() {
    const ok = await create.run(
      EP.tenants.supportAccess(tenant.id),
      { method: "POST", body: { reason: reason.trim(), scope, hours } },
      {
        successMessage: "Destek erişim penceresi açıldı.",
        onSuccess: () => res.reload(),
      },
    );
    if (ok) {
      setReason("");
      res.reload();
    }
  }

  async function doRevoke(id: string) {
    await revoke.run(
      EP.supportAccess.revoke(id),
      { method: "DELETE" },
      { successMessage: "Erişim penceresi iptal edildi.", onSuccess: () => res.reload() },
    );
    res.reload();
  }

  const columns: Array<Column<AdminSupportGrant>> = [
    {
      key: "user",
      header: "Personel",
      render: (g) => (
        <span className="font-mono text-xs">{g.platformUserEmail ?? g.platformUserId}</span>
      ),
    },
    {
      key: "scope",
      header: "Kapsam",
      render: (g) => (
        <Badge tone={toneOf(GRANT_SCOPE_TONES, g.scope)}>
          {labelOf(GRANT_SCOPE_SHORT, g.scope)}
        </Badge>
      ),
    },
    {
      key: "reason",
      header: "Gerekçe",
      render: (g) => <span className="text-xs text-steel-300">{g.reason}</span>,
    },
    {
      key: "window",
      header: "Pencere",
      render: (g) => (
        <div className="text-xs">
          <p className="text-steel-200">{fmtDateTime(g.grantedAt)}</p>
          <p className="text-steel-500">
            {g.revokedAt
              ? `Erken iptal: ${fmtDateTime(g.revokedAt)}`
              : remainingLabel(g.expiresAt)}
          </p>
        </div>
      ),
    },
    {
      key: "state",
      header: "Durum",
      render: (g) =>
        g.revokedAt ? (
          <Badge tone="gray">İptal edildi</Badge>
        ) : isExpired(g.expiresAt) ? (
          <Badge tone="steel">Süresi doldu</Badge>
        ) : (
          <Badge tone="green">Aktif</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (g) => {
        const active = !g.revokedAt && !isExpired(g.expiresAt);
        if (!active) return null;
        return (
          <RoleGate action="support_grant.revoke" mutation>
            <Button
              size="sm"
              variant="danger"
              disabled={revoke.loading}
              onClick={() => void doRevoke(g.id)}
            >
              İptal et
            </Button>
          </RoleGate>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <InfoBox title="Destek erişimi nasıl çalışır?">
        <strong>Impersonation yoktur.</strong> Tenant verisine tek kapı süreli, kapsamı sınırlı ve{" "}
        <strong>PII maskeli salt-okur</strong> erişim penceresidir: gerekçe zorunlu → varsayılan{" "}
        {GRANT_DEFAULT_HOURS} saat, azami {GRANT_MAX_HOURS} saat → süre dolunca erişim
        kendiliğinden kapanır → hiçbir mutasyon ucu çalışmaz. Pencere hem{" "}
        <code className="font-mono text-xs">PlatformAuditLog</code>&apos;a hem tenant&apos;ın kendi{" "}
        <code className="font-mono text-xs">AuditLog</code>&apos;una yazılır.
      </InfoBox>

      {revoke.missing && (
        <EndpointMissingNotice
          endpoint="/support-access/:id"
          method="DELETE"
          what="Erişim iptali"
        />
      )}
      {revoke.error && <ErrorBox message={revoke.error} />}
      {revoke.success && <SuccessBox message={revoke.success} />}

      <Card
        title="Erişim kayıtları"
        subtitle="Aktif ve geçmiş SupportAccessGrant kayıtları"
        action={
          <RoleGate action="support_grant.request" mutation mode="notice">
            <span className="inline-flex items-center gap-2">
              <Button
                onClick={() => {
                  create.reset();
                  setOpen(true);
                }}
              >
                Erişim talebi aç
              </Button>
              <ApprovalBadge action="support_grant.request" />
            </span>
          </RoleGate>
        }
      >
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.supportAccess.list}
          what="Destek erişim kayıtları"
          emptyMessage="Bu tenant için destek erişim kaydı yok."
        >
          <Table columns={columns} rows={grants} rowKey={(g) => g.id} dense />
        </ResourceView>
        {!can(role, "support_grant.revoke") && grants.length > 0 && (
          <p className="mt-3 text-xs text-steel-500">
            Erken iptal yetkisi rolünüzde yok; iptal düğmesi gösterilmez.
          </p>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Destek erişim penceresi aç"
        subtitle={`POST /api/admin/v1${EP.tenants.supportAccess(tenant.id)}`}
        wide
      >
        <div className="space-y-4">
          <ApprovalNotice
            action="support_grant.request"
            extra="Pencere açıldığında tenant'ın kendi denetim izine de kayıt düşer."
          />

          <Field
            label="Kapsam"
            required
            hint="Varsayılan SADECE_ÜSTVERİ. İçerik kapsamında dahi PII maskesi kaldırılamaz."
          >
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              {GRANT_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {GRANT_SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Süre"
            required
            hint={`Varsayılan ${GRANT_DEFAULT_HOURS} saat, azami ${GRANT_MAX_HOURS} saat. Süre dolunca erişim kendiliğinden kapanır.`}
          >
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
            Bu pencere <strong>salt-okurdur</strong>. PII (TCKN, telefon, IBAN) her kapsamda
            maskelidir ve maskeleme kaldırılamaz; belge indirme kapalıdır. Impersonation yoktur.
          </WarningBox>

          {create.missing && (
            <EndpointMissingNotice
              endpoint={EP.tenants.supportAccess(tenant.id)}
              method="POST"
              what="Destek erişim talebi"
            />
          )}
          {create.error && <ErrorBox message={create.error} />}
          {create.success && <SuccessBox message={create.success} />}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Kapat
            </Button>
            <Button
              disabled={reason.trim().length === 0 || hours > GRANT_MAX_HOURS || create.loading}
              onClick={() => void submit()}
            >
              {create.loading
                ? "Gönderiliyor…"
                : `Onaya gönder (${hours} saat · ${labelOf(GRANT_SCOPE_SHORT, scope)})`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------- Denetim

function DenetimTab({ tenantId }: { tenantId: string }) {
  const { role } = useAdminSession();
  const res = useListResource<AdminAuditEntry>(can(role, "audit.view") ? EP.audit : null, {
    query: { tenantId, limit: 100 },
  });

  if (!can(role, "audit.view")) {
    return (
      <Card>
        <NoAccessInline action="audit.view" />
      </Card>
    );
  }

  const columns: Array<Column<AdminAuditEntry>> = [
    { key: "at", header: "Tarih", render: (l) => fmtDateTime(l.createdAt) },
    {
      key: "user",
      header: "Personel",
      render: (l) => (
        <span className="font-mono text-xs">{l.platformUserEmail ?? l.platformUserId ?? "—"}</span>
      ),
    },
    {
      key: "role",
      header: "Rol",
      render: (l) => (l.platformUserRole ? <Badge tone="steel">{l.platformUserRole}</Badge> : "—"),
    },
    { key: "action", header: "Aksiyon", render: (l) => labelOf(AUDIT_ACTION_LABELS, l.action) },
    {
      key: "detail",
      header: "Detay",
      render: (l) => <span className="text-xs text-steel-400">{l.detail ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <InfoBox>
        Bu tenant&apos;a yapılan platform işlemleri. PlatformAuditLog append-only&apos;dir; kiracı
        silinse dahi iz kalır (tenantId alanında FK yoktur).
      </InfoBox>
      <Card title="Platform işlemleri">
        <ResourceView
          loading={res.loading}
          missing={res.missing}
          forbidden={res.forbidden}
          error={res.error}
          empty={res.empty}
          endpoint={EP.audit}
          what="Denetim izi"
          emptyMessage="Bu tenant için platform işlemi kaydı yok."
        >
          <Table columns={columns} rows={res.data} rowKey={(l) => l.id} dense />
        </ResourceView>
      </Card>
    </div>
  );
}
