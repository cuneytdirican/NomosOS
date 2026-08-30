"use client";

/**
 * İcra dosya detayı — Modül 05.
 *
 * GET   /enforcement/:id                 — künye
 * GET   /enforcement/:id/balance         — bakiye + hesap dökümü (SUNUCU hesabı)
 * POST  /enforcement/:id/stage           — aşama geçişi (kural denetimi sunucuda)
 * GET/POST /enforcement/:id/actions      — işlem günlüğü
 * GET/POST /enforcement/:id/assets       — malvarlığı · PATCH .../assets/:assetId
 * GET/POST /enforcement/:id/collections  — tahsilatlar
 * POST  /enforcement/:id/copilot         — 6 komutluk İcra Copilot
 * GET   /deadlines?caseId=               — Süreler sekmesi
 * /documents (DocumentsTab)              — Belgeler sekmesi
 *
 * PARA: hiçbir tutar bu sayfada hesaplanmaz. Tahsilat girildikten sonra bakiye
 * yeniden OKUNUR (istemcide toplama yapılmaz).
 */

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  changeStage,
  createAction,
  createAsset,
  createCollection,
  getBalance,
  getEnforcementFile,
  listActions,
  listAssets,
  listCollections,
  updateAssetStatus,
} from "@/lib/enforcement";
import type {
  AssetRecord,
  AssetStatus,
  CollectionRecord,
  CollectionScore,
  EnforcementAction,
  EnforcementBalance,
  EnforcementFile,
  EnforcementStage,
} from "@/lib/faz3-types";
import type { Deadline } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  DataRow,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Tabs,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { BalanceCard } from "@/components/enforcement-balance";
import { EnforcementCopilot } from "@/components/enforcement-copilot";
import { DocumentsTab } from "@/components/documents-tab";
import { ComputeNote } from "@/components/compute-note";
import { fmtAmount, fmtRate } from "@/lib/money";
import {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_TONES,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  COLLECTION_METHODS,
  COLLECTION_METHOD_LABELS,
  DEADLINE_STATUS_LABELS,
  DEADLINE_STATUS_TONES,
  ENFORCEMENT_ACTION_LABELS,
  ENFORCEMENT_ACTION_TONES,
  ENFORCEMENT_ACTION_TYPES,
  ENFORCEMENT_STAGES,
  ENFORCEMENT_STAGE_LABELS,
  ENFORCEMENT_STAGE_SHORT,
  ENFORCEMENT_STAGE_TONES,
  ENFORCEMENT_TYPE_LABELS,
  daysUntil,
  fmtDate,
  labelOf,
  remainingLabel,
  toIsoDate,
  urgencyRowClass,
  urgencyTone,
} from "@/lib/labels";

const TABS = [
  { key: "islemler", label: "İşlemler" },
  { key: "malvarligi", label: "Malvarlığı" },
  { key: "tahsilat", label: "Tahsilatlar" },
  { key: "copilot", label: "İcra Copilot" },
  { key: "sureler", label: "Süreler" },
  { key: "belgeler", label: "Belgeler" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function IcraDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [file, setFile] = useState<EnforcementFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("islemler");

  const [balance, setBalance] = useState<EnforcementBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [stageOpen, setStageOpen] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const f = await getEnforcementFile(id);
      setFile(f);
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) setMissing(true);
      else setError(errText(err, "İcra dosyası yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      setBalance(await getBalance(id));
    } catch (err) {
      setBalance(null);
      if (!isMissingEndpoint(err)) {
        setBalanceError(errText(err, "Bakiye hesabı alınamadı."));
      }
    } finally {
      setBalanceLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadFile();
    void loadBalance();
  }, [loadFile, loadBalance]);

  /** Tahsilat/işlem sonrası: bakiye SUNUCUDAN yeniden okunur, istemcide toplanmaz. */
  const refreshAfterMoneyChange = useCallback(() => {
    void loadFile();
    void loadBalance();
  }, [loadFile, loadBalance]);

  if (missing) {
    return (
      <FeatureUnavailable
        title="İcra modülü henüz yayında değil"
        detail="/api/v1/enforcement ucu yayına alındığında bu ekran otomatik çalışacak."
        onRetry={() => void loadFile()}
      />
    );
  }
  if (loading) return <Spinner label="İcra dosyası yükleniyor…" />;
  if (error) return <ErrorBox message={error} />;
  if (!file) return <EmptyState message="İcra dosyası bulunamadı." />;

  const currency = file.currency ?? "TRY";

  return (
    <div className="space-y-6">
      <Link href="/app/icra" className="text-xs text-slate-500 hover:text-amber-600">
        ← İcra Takipleri
      </Link>

      {/* Künye */}
      <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">
                {file.officeName} · {file.fileNumber}
              </h1>
              <Badge tone="gold">{labelOf(ENFORCEMENT_TYPE_LABELS, file.trackingType)}</Badge>
              <Badge tone={ENFORCEMENT_STAGE_TONES[file.stage] ?? "gray"}>
                {labelOf(ENFORCEMENT_STAGE_LABELS, file.stage)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {file.case?.client?.name ? `Alacaklı: ${file.case.client.name}` : "Alacaklı: —"}
              {file.debtorInfo ? ` · Borçlu: ${file.debtorInfo}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Takip talebi: {fmtDate(file.requestDate)}
              {file.paymentOrderServedAt
                ? ` · Ödeme emri tebliği: ${fmtDate(file.paymentOrderServedAt)}`
                : ""}
              {file.objectionDate ? ` · İtiraz: ${fmtDate(file.objectionDate)}` : ""}
              {file.interestRate ? ` · Yıllık faiz: ${fmtRate(file.interestRate)}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button size="sm" variant="gold" onClick={() => setStageOpen(true)}>
              Aşama Değiştir
            </Button>
            {file.case && (
              <Link
                href={`/app/dosyalar/${file.caseId}`}
                className="text-xs text-slate-300 hover:text-amber-400"
              >
                Bağlı dosya: {file.case.title ?? file.caseId} →
              </Link>
            )}
          </div>
        </div>

        <StageStrip current={file.stage} />
      </div>

      <BalanceCard
        balance={balance}
        loading={balanceLoading}
        error={balanceError}
        currency={currency}
        onRefresh={() => void loadBalance()}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="İcra dosyası sekmeleri" />

      {tab === "islemler" && (
        <ActionsTab
          enforcementId={id}
          currency={currency}
          onChanged={refreshAfterMoneyChange}
          onNotify={push}
        />
      )}
      {tab === "malvarligi" && (
        <AssetsTab enforcementId={id} currency={currency} onNotify={push} />
      )}
      {tab === "tahsilat" && (
        <CollectionsTab
          enforcementId={id}
          currency={currency}
          onChanged={refreshAfterMoneyChange}
          onNotify={push}
        />
      )}
      {tab === "copilot" && (
        <EnforcementCopilot
          enforcementId={id}
          latestScore={file.latestScore ?? null}
          onScoreUpdated={(score: CollectionScore) =>
            setFile((prev) => (prev ? { ...prev, latestScore: score } : prev))
          }
        />
      )}
      {tab === "sureler" && <DeadlinesTab caseId={file.caseId} />}
      {tab === "belgeler" && (
        <DocumentsTab
          caseId={file.caseId}
          fallbackDocuments={[]}
          onChanged={() => void loadFile()}
          onNotify={push}
        />
      )}

      <StageModal
        open={stageOpen}
        current={file.stage}
        onClose={() => setStageOpen(false)}
        onSaved={(updated) => {
          setStageOpen(false);
          setFile(updated);
          push(`Aşama ${labelOf(ENFORCEMENT_STAGE_LABELS, updated.stage)} olarak güncellendi.`);
          void loadBalance();
        }}
        enforcementId={id}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Aşama şeridi ----------

function StageStrip({ current }: { current: EnforcementStage }) {
  const index = ENFORCEMENT_STAGES.indexOf(current);
  return (
    <div className="mt-5 flex flex-wrap gap-1.5" aria-label="Takip aşaması">
      {ENFORCEMENT_STAGES.map((s, i) => {
        const done = index >= 0 && i < index;
        const active = s === current;
        return (
          <span
            key={s}
            title={labelOf(ENFORCEMENT_STAGE_LABELS, s)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              active
                ? "bg-amber-500 text-slate-900"
                : done
                  ? "bg-slate-700 text-slate-200"
                  : "bg-slate-800 text-slate-500"
            }`}
          >
            {done && "✓ "}
            {ENFORCEMENT_STAGE_SHORT[s] ?? s}
          </span>
        );
      })}
    </div>
  );
}

function StageModal({
  open,
  current,
  enforcementId,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: EnforcementStage;
  enforcementId: string;
  onClose: () => void;
  onSaved: (file: EnforcementFile) => void;
}) {
  const [stage, setStage] = useState<EnforcementStage>(current);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage(current);
      setNote("");
      setError(null);
    }
  }, [open, current]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await changeStage(enforcementId, stage, note.trim() || undefined));
    } catch (err) {
      // Sunucu geçişi reddedebilir (örn. itirazlı dosyada doğrudan HACIZ,
      // haciz tutanağı olmadan SATIS). Mesajı OLDUĞU GİBİ gösteririz.
      setError(err instanceof ApiError ? err.message : "Aşama değiştirilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Aşama Değiştir" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Yeni aşama"
          hint="Aşama şeridi tek yönlüdür. Geçiş kuralları sunucuda denetlenir; uygun olmayan geçiş reddedilir."
        >
          <Select value={stage} onChange={(e) => setStage(e.target.value as EnforcementStage)}>
            {ENFORCEMENT_STAGES.map((s) => (
              <option key={s} value={s}>
                {labelOf(ENFORCEMENT_STAGE_LABELS, s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Not (isteğe bağlı)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving || stage === current}>
            {saving ? "Kaydediliyor…" : "Aşamayı Güncelle"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- İşlem günlüğü ----------

function ActionsTab({
  enforcementId,
  currency,
  onChanged,
  onNotify,
}: {
  enforcementId: string;
  currency: string;
  onChanged: () => void;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [items, setItems] = useState<EnforcementAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "HACIZ_TALEBI",
    date: toIsoDate(new Date()),
    description: "",
    amount: "",
    resultNote: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listActions(enforcementId));
    } catch (err) {
      setError(errText(err, "İşlem günlüğü yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [enforcementId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await createAction(enforcementId, {
        type: form.type as EnforcementAction["type"],
        date: form.date,
        description: form.description.trim(),
        amount: form.amount.trim() ? form.amount.trim().replace(",", ".") : undefined,
        resultNote: form.resultNote.trim() || undefined,
      });
      setOpen(false);
      setForm({ ...form, description: "", amount: "", resultNote: "" });
      onNotify("İşlem günlüğe eklendi.");
      await load();
      onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "İşlem eklenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="İşlem Günlüğü"
      action={
        <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
          + İşlem Ekle
        </Button>
      }
    >
      {loading ? (
        <Spinner label="İşlemler yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : items.length === 0 ? (
        <EmptyState message="Bu dosyada kayıtlı işlem yok. Takip talebi, ödeme emri ve haciz adımlarını buraya işleyin." />
      ) : (
        <ol className="space-y-3">
          {items.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ENFORCEMENT_ACTION_TONES[a.type] ?? "gray"}>
                    {labelOf(ENFORCEMENT_ACTION_LABELS, a.type)}
                  </Badge>
                  <span className="text-xs text-slate-500">{fmtDate(a.date)}</span>
                </div>
                {a.amount !== undefined && a.amount !== null && a.amount !== "" && (
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {fmtAmount(a.amount, currency)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-5 text-slate-800">{a.description}</p>
              {a.resultNote && (
                <p className="mt-1 rounded border-l-2 border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  Sonuç: {a.resultNote}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <Modal open={open} title="Yeni İşlem" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="İşlem tipi">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {ENFORCEMENT_ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelOf(ENFORCEMENT_ACTION_LABELS, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tarih">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Açıklama">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Bankalara haciz müzekkeresi yazıldı (3 banka)"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tutar (₺, isteğe bağlı)" hint="Harç/masraf işlemlerinde doldurulur.">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
            <Field label="Sonuç notu">
              <Input
                value={form.resultNote}
                onChange={(e) => setForm({ ...form, resultNote: e.target.value })}
                placeholder="3 araç kaydı bulundu"
              />
            </Field>
          </div>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ---------- Malvarlığı ----------

function AssetsTab({
  enforcementId,
  currency,
  onNotify,
}: {
  enforcementId: string;
  currency: string;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [items, setItems] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    assetType: "BANKA_HESABI",
    description: "",
    estimatedValue: "",
    discoveredAt: toIsoDate(new Date()),
    note: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listAssets(enforcementId));
    } catch (err) {
      setError(errText(err, "Malvarlığı kayıtları yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [enforcementId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(asset: AssetRecord, status: AssetStatus) {
    setBusyId(asset.id);
    try {
      await updateAssetStatus(enforcementId, asset.id, status);
      onNotify(`${asset.description}: ${labelOf(ASSET_STATUS_LABELS, status)}`);
      await load();
    } catch (err) {
      onNotify(
        err instanceof ApiError ? err.message : "Malvarlığı durumu güncellenemedi.",
        "error",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await createAsset(enforcementId, {
        assetType: form.assetType as AssetRecord["assetType"],
        description: form.description.trim(),
        estimatedValue: form.estimatedValue.trim()
          ? form.estimatedValue.trim().replace(",", ".")
          : undefined,
        discoveredAt: form.discoveredAt,
        note: form.note.trim() || undefined,
      });
      setOpen(false);
      setForm({ ...form, description: "", estimatedValue: "", note: "" });
      onNotify("Malvarlığı kaydı eklendi.");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Malvarlığı kaydı eklenemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Malvarlığı"
      action={
        <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
          + Varlık Ekle
        </Button>
      }
    >
      {loading ? (
        <Spinner label="Malvarlığı yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : items.length === 0 ? (
        <EmptyState message="Borçluya ait tespit edilmiş malvarlığı kaydı yok." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Tür</th>
                <th className="py-2 pr-4 font-medium">Açıklama</th>
                <th className="py-2 pr-4 text-right font-medium">Tahmini Değer</th>
                <th className="py-2 pr-4 font-medium">Tespit</th>
                <th className="py-2 pr-4 font-medium">Durum</th>
                <th className="py-2 font-medium">Durum Güncelle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-4 text-slate-600">
                    {labelOf(ASSET_TYPE_LABELS, a.assetType)}
                  </td>
                  <td className="py-3 pr-4">
                    <p className="text-slate-800">{a.description}</p>
                    {a.note && <p className="mt-0.5 text-xs text-slate-500">{a.note}</p>}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-slate-800">
                    {fmtAmount(a.estimatedValue, currency)}
                  </td>
                  <td className="py-3 pr-4 text-xs text-slate-500">{fmtDate(a.discoveredAt)}</td>
                  <td className="py-3 pr-4">
                    <Badge tone={ASSET_STATUS_TONES[a.status] ?? "gray"}>
                      {labelOf(ASSET_STATUS_LABELS, a.status)}
                    </Badge>
                  </td>
                  <td className="py-3">
                    <Select
                      value={a.status}
                      disabled={busyId === a.id}
                      onChange={(e) => void changeStatus(a, e.target.value as AssetStatus)}
                      className="!py-1 text-xs"
                      aria-label={`${a.description} durumu`}
                    >
                      {ASSET_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {labelOf(ASSET_STATUS_LABELS, s)}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-5 text-slate-400">
        Tahmini değer bir tespit notudur; takip bakiyesine dâhil edilmez. Satış geliri ancak
        Tahsilatlar sekmesine kaydedildiğinde bakiyeye yansır.
      </p>

      <Modal open={open} title="Yeni Malvarlığı Kaydı" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Varlık türü">
              <Select
                value={form.assetType}
                onChange={(e) => setForm({ ...form, assetType: e.target.value })}
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelOf(ASSET_TYPE_LABELS, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tespit tarihi">
              <Input
                type="date"
                value={form.discoveredAt}
                onChange={(e) => setForm({ ...form, discoveredAt: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Açıklama">
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="X Bankası vadesiz TL hesabı"
              required
            />
          </Field>
          <Field label="Tahmini değer (₺)">
            <Input
              inputMode="decimal"
              value={form.estimatedValue}
              onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
            />
          </Field>
          <Field label="Not">
            <Textarea
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ---------- Tahsilatlar ----------

function CollectionsTab({
  enforcementId,
  currency,
  onChanged,
  onNotify,
}: {
  enforcementId: string;
  currency: string;
  onChanged: () => void;
  onNotify: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const [items, setItems] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "",
    date: toIsoDate(new Date()),
    method: "BANKA",
    note: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listCollections(enforcementId));
    } catch (err) {
      setError(errText(err, "Tahsilatlar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [enforcementId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await createCollection(enforcementId, {
        amount: form.amount.trim().replace(",", "."),
        date: form.date,
        method: form.method as CollectionRecord["method"],
        note: form.note.trim() || undefined,
      });
      setOpen(false);
      setForm({ ...form, amount: "", note: "" });
      onNotify("Tahsilat kaydedildi; bakiye ve müvekkil finansı sunucuda güncellendi.");
      await load();
      // Bakiye burada TOPLANMAZ — sunucudan yeniden okunur.
      onChanged();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Tahsilat kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Tahsilatlar"
      action={
        <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
          + Tahsilat Gir
        </Button>
      }
    >
      {loading ? (
        <Spinner label="Tahsilatlar yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : items.length === 0 ? (
        <EmptyState message="Bu dosyada tahsilat kaydı yok." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {fmtAmount(c.amount, currency)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {fmtDate(c.date)} · {labelOf(COLLECTION_METHOD_LABELS, c.method)}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
              </div>
              <Badge tone="green">Tahsil edildi</Badge>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] leading-5 text-slate-400">
        Her tahsilat aynı işlemde bir finans hareketi (TAHSILAT) üretir ve müvekkil bakiyesine
        yansır. Toplamlar burada değil sunucuda hesaplanır; kayıttan sonra Bakiye kartı yeniden
        okunur.
      </p>

      <Modal open={open} title="Tahsilat Girişi" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tutar (₺)">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="42000.00"
                required
              />
            </Field>
            <Field label="Tarih">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field
            label="Tahsilat yöntemi"
            hint="Haricen (anlaşma) tahsilatta tahsil harcı yükümlülüğü doğabilir."
          >
            <Select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            >
              {COLLECTION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {labelOf(COLLECTION_METHOD_LABELS, m)}
                </option>
              ))}
            </Select>
          </Field>
          {form.method === "ANLASMA" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Haricen tahsilatta tahsil harcı doğar. Harcı ayrıca İşlemler sekmesine
              &quot;Harç Ödemesi&quot; olarak işleyin.
            </p>
          )}
          <Field label="Not">
            <Textarea
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Tahsilatı Kaydet"}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ---------- Süreler ----------

function DeadlinesTab({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void api<unknown>("/deadlines", { query: { caseId, limit: 200 } })
      .then((p) => {
        if (alive) {
          setItems(asList<Deadline>(p));
          setError(null);
        }
      })
      .catch((err) => {
        if (alive) setError(errText(err, "Süreler yüklenemedi."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [caseId]);

  return (
    <Card title="Süreler">
      {loading ? (
        <Spinner label="Süreler yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : items.length === 0 ? (
        <EmptyState message="Bu dosyaya bağlı süre kaydı yok. Ödeme emri tebliğ tarihi girildiğinde İİK itiraz süresi kural motorunda oluşur." />
      ) : (
        <ul className="space-y-2">
          {items.map((d) => {
            const days = daysUntil(d.dueDate);
            return (
              <li
                key={d.id}
                className={`rounded-lg bg-white px-4 py-3 shadow-sm ${urgencyRowClass(days)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{d.title}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={urgencyTone(days)}>{remainingLabel(days)}</Badge>
                    <Badge tone={DEADLINE_STATUS_TONES[d.status ?? ""] ?? "gray"}>
                      {labelOf(DEADLINE_STATUS_LABELS, d.status)}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Son gün: {fmtDate(d.dueDate)}
                  {d.legalBasis ? ` · ${d.legalBasis}` : ""}
                </p>
                <ComputeNote note={d.computeNote} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4">
        <DataRow label="İpucu">
          Süre ekleme ve hesap izi için{" "}
          <Link href="/app/sureler" className="text-amber-600 hover:text-amber-500">
            Süreler ekranını
          </Link>{" "}
          kullanın.
        </DataRow>
      </div>
    </Card>
  );
}
