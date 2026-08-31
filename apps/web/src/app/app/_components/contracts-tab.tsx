"use client";

/**
 * SÖZLEŞMELER sekmesi (Modül 20) — müvekkil kartında ve dosya detayında.
 *
 * ÜÇ AYRIM KORUNUR:
 *  1. SÜRÜMLER DEĞİŞTİRİLEMEZ. Her müzakere turu yeni bir sürümdür; "düzenle"
 *     diye bir eylem yoktur, "yeni sürüm" vardır. Geçmiş, kimin neyi ne zaman
 *     değiştirdiğinin kanıtıdır.
 *  2. AI İNCELEMESİ ÖNERİDİR ve her bulgu ALINTI taşır. Alıntısız bulgu ayrıca
 *     işaretlenir: sunucu metinde birebir bulunmayan alıntıyı eler, arayüz de
 *     dayanaksız bulguyu dayanaklıymış gibi göstermez.
 *  3. E-İMZA SAĞLAYICISI YOKSA SÜREÇ BAŞLAMAZ. Sahte "gönderildi" ekranı
 *     çizilmez; sunucunun "yapılandırılmamış" yanıtı olduğu gibi aktarılır.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CaseSummary } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  SuccessBox,
  Textarea,
  TruncationNotice,
} from "@/components/ui";
import { AiDisclaimer, FeatureUnavailable, PiiApprovalBox, SourceQuote } from "@/components/ai-ui";
import { CreditBadge, useCreditCosts } from "@/components/credits";
import { errText } from "@/lib/faz2";
import { SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONES,
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  SIGNATURE_METHODS,
  SIGNATURE_METHOD_LABELS,
  SIGNATURE_STATUS_LABELS,
  SIGNATURE_STATUS_TONES,
  SIGNER_ROLES,
  SIGNER_ROLE_LABELS,
  daysUntil,
  fmtDate,
  fmtDateTime,
  labelOf,
  remainingLabel,
  urgencyTone,
} from "@/lib/labels";
import { useAiCall } from "../_lib/use-ai-call";
import {
  cancelSignatureRequest,
  createContract,
  createContractVersion,
  createSignatureRequest,
  isFeatureMissing,
  isNotConfigured,
  listContractRenewals,
  listContractsPaged,
  listContractVersions,
  NOT_CONFIGURED_TEXT,
  reviewContract,
  signatureProviderHealth,
  transitionContract,
  type SignatureProviderHealth,
} from "../_lib/faz5";
import type {
  ContractItem,
  ContractRenewalItem,
  ContractReviewResult,
  ContractSigner,
  ContractStatus,
  ContractType,
  ContractVersionItem,
  SignatureMethod,
  SignerRole,
} from "../_lib/faz5-types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

export function ContractsTab({
  clientId,
  caseId,
  cases,
  onNotify,
}: {
  clientId?: string;
  caseId?: string;
  cases: CaseSummary[];
  onNotify: Notify;
}) {
  const [items, setItems] = useState<ContractItem[]>([]);
  const [renewals, setRenewals] = useState<ContractRenewalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [reviewFor, setReviewFor] = useState<ContractItem | null>(null);
  const [signFor, setSignFor] = useState<ContractItem | null>(null);
  const [versionFor, setVersionFor] = useState<ContractItem | null>(null);
  /** Durum geçişi onay penceresi — gerekçe ve elle yürürlük onayı burada alınır. */
  const [transitionFor, setTransitionFor] = useState<
    { contract: ContractItem; toStatus: ContractStatus } | null
  >(null);

  /** Sunucu zarfı kırpma gösteriyorsa uyarı çıkar (denetim bulgusu K-15). */
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const res = await listContractsPaged({ clientId, caseId, limit: SERVER_MAX_PAGE_SIZE });
      setItems(res.items);
      setTruncated(res.hasMore || res.truncated);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Sözleşmeler yüklenemedi."));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [clientId, caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Yenileme takvimi — süre hesabı SUNUCUDA deterministik yapılır. */
  useEffect(() => {
    let alive = true;
    listContractRenewals(90)
      .then((rows) => {
        if (!alive) return;
        setRenewals(clientId ? rows.filter((r) => !r.client || r.client.id === clientId) : rows);
      })
      .catch(() => {
        if (alive) setRenewals([]);
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const relevantRenewals = useMemo(() => {
    const ids = new Set(items.map((c) => c.id));
    return renewals.filter((r) => !r.contractId || ids.has(r.contractId));
  }, [renewals, items]);

  if (loading) return <Spinner label="Sözleşmeler yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Sözleşme modülü henüz hazır değil"
        detail="Sözleşme uçları yayına alındığında bu sekme otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {relevantRenewals.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">
            {relevantRenewals.length} sözleşmede yenileme / fesih ihbar süresi yaklaşıyor
          </p>
          <ul className="mt-2 space-y-1">
            {relevantRenewals.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                {r.daysLeft !== null && (
                  <Badge tone={urgencyTone(r.daysLeft)}>{remainingLabel(r.daysLeft)}</Badge>
                )}
                <span className="font-medium">{r.title}</span>
                {r.noticeDeadline && <span>· ihbar son gün: {fmtDate(r.noticeDeadline)}</span>}
                {r.autoRenew && <Badge tone="yellow">Kendiliğinden yenilenir</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-5 text-amber-800">
            İhbar süresi kaçırılırsa sözleşme kendiliğinden yenilenebilir. Süre hesabı sunucudaki
            deterministik süre motorundan gelir.
          </p>
        </div>
      )}

      <Card
        title={`Sözleşmeler (${items.length})`}
        action={
          <Button size="sm" variant="gold" onClick={() => setCreateOpen(true)}>
            + Yeni Sözleşme
          </Button>
        }
      >
        {truncated && <TruncationNotice shown={items.length} noun="sözleşme" />}
        {items.length === 0 ? (
          <EmptyState message="Kayıtlı sözleşme yok. Vekâlet ücreti, danışmanlık veya gizlilik sözleşmesini buradan açabilirsiniz." />
        ) : (
          <ul className="space-y-3">
            {items.map((c) => (
              <ContractRow
                key={c.id}
                contract={c}
                onReview={() => setReviewFor(c)}
                onSign={() => setSignFor(c)}
                onNewVersion={() => setVersionFor(c)}
                /*
                 * Seçim ARTIK DOĞRUDAN TETİKLEMEZ. Sunucu üç geçişte ek bilgi
                 * ister (FESIH/SONA_ERDI → gerekçe, YURURLUKTE → elle onay +
                 * gerekçe) ve bunlar gönderilmediği için arayüzden hiçbir
                 * sözleşme yürürlüğe alınamıyor, feshedilemiyordu: kullanıcı
                 * yalnızca "Durum değiştirilemedi" görüyordu. Karar artık
                 * gerekçe alan bir onay penceresinden geçer.
                 */
                onTransition={(status) => setTransitionFor({ contract: c, toStatus: status })}
                onNotify={onNotify}
                onChanged={load}
              />
            ))}
          </ul>
        )}
      </Card>

      <CreateContractModal
        open={createOpen}
        clientId={clientId}
        caseId={caseId}
        cases={cases}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => {
          setCreateOpen(false);
          onNotify("Sözleşme oluşturuldu.", "success");
          await load();
        }}
      />

      <NewVersionModal
        contract={versionFor}
        onClose={() => setVersionFor(null)}
        onSaved={async () => {
          setVersionFor(null);
          onNotify("Yeni sürüm kaydedildi.", "success");
          await load();
        }}
      />

      <TransitionModal
        request={transitionFor}
        onClose={() => setTransitionFor(null)}
        onDone={async (label) => {
          setTransitionFor(null);
          onNotify(`Sözleşme durumu: ${label}`, "success");
          await load();
        }}
        onNotify={onNotify}
      />

      <ReviewModal contract={reviewFor} onClose={() => setReviewFor(null)} onNotify={onNotify} />

      <SignatureModal
        contract={signFor}
        onClose={() => setSignFor(null)}
        onNotify={onNotify}
        onSent={async () => {
          await load();
        }}
      />
    </div>
  );
}

// ---------- Satır ----------

function ContractRow({
  contract,
  onReview,
  onSign,
  onNewVersion,
  onTransition,
  onNotify,
  onChanged,
}: {
  contract: ContractItem;
  onReview: () => void;
  onSign: () => void;
  onNewVersion: () => void;
  onTransition: (status: ContractStatus) => void | Promise<void>;
  onNotify: Notify;
  onChanged: () => void | Promise<void>;
}) {
  const [versions, setVersions] = useState<ContractVersionItem[] | null>(
    contract.versions && contract.versions.length > 0 ? contract.versions : null,
  );
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const noticeDays = contract.renewalNoticeDays ?? null;
  const endsIn = contract.effectiveTo ? daysUntil(contract.effectiveTo) : null;

  async function loadVersions() {
    if (versions) return;
    try {
      setVersions(await listContractVersions(contract.id));
    } catch (err) {
      setVersionsError(errText(err, "Sürüm geçmişi yüklenemedi."));
    }
  }

  const signatures = contract.signatureRequests ?? [];

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900">{contract.title}</p>
            <Badge tone={CONTRACT_STATUS_TONES[contract.status] ?? "gray"}>
              {labelOf(CONTRACT_STATUS_LABELS, contract.status)}
            </Badge>
            <Badge tone="gray">{labelOf(CONTRACT_TYPE_LABELS, contract.type)}</Badge>
            {contract.autoRenew && <Badge tone="yellow">Kendiliğinden yenilenir</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {contract.effectiveFrom ? `Yürürlük: ${fmtDate(contract.effectiveFrom)}` : "Yürürlük tarihi yok"}
            {contract.effectiveTo ? ` → ${fmtDate(contract.effectiveTo)}` : ""}
            {noticeDays !== null ? ` · ${noticeDays} gün fesih ihbarı` : ""}
            {contract.case?.title ? ` · ${contract.case.title}` : ""}
          </p>
          {endsIn !== null && endsIn <= 90 && (
            <p className="mt-1">
              <Badge tone={urgencyTone(endsIn)}>Bitişe {remainingLabel(endsIn)}</Badge>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onReview}>
            İncele
          </Button>
          <Button size="sm" variant="secondary" onClick={onNewVersion}>
            + Sürüm
          </Button>
          <Button size="sm" variant="gold" onClick={onSign}>
            İmzaya gönder
          </Button>
        </div>
      </div>

      {/* Durum geçişi */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Durumu değiştir
        </span>
        <Select
          className="w-auto py-1 text-xs"
          value={contract.status}
          onChange={(e) => void onTransition(e.target.value as ContractStatus)}
        >
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {labelOf(CONTRACT_STATUS_LABELS, s)}
            </option>
          ))}
        </Select>
        <span className="text-[11px] text-slate-400">
          Geçersiz geçişleri sunucu reddeder.
        </span>
      </div>

      {/* Sürüm geçmişi */}
      <details className="mt-3" onToggle={() => void loadVersions()}>
        <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 hover:text-slate-700">
          Sürüm geçmişi ▾
        </summary>
        <div className="mt-2">
          {versionsError ? (
            <ErrorBox message={versionsError} />
          ) : !versions ? (
            <p className="text-xs text-slate-400">Yükleniyor…</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-slate-400">Henüz sürüm yok.</p>
          ) : (
            <ul className="space-y-1.5">
              {[...versions]
                .sort((a, b) => b.versionNo - a.versionNo)
                .map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50 px-2.5 py-1.5"
                  >
                    <span className="text-xs text-slate-700">
                      <strong>v{v.versionNo}</strong>
                      {v.changeNote ? ` · ${v.changeNote}` : ""}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-slate-400">
                      {v.createdAt ? fmtDateTime(v.createdAt) : ""}
                      {contract.currentVersionId === v.id && <Badge tone="green">Güncel</Badge>}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </details>

      {/* İmza talepleri */}
      {signatures.length > 0 && (
        <Disclosure summary={`İmza süreçleri (${signatures.length})`} className="mt-3">
          <ul className="space-y-2">
            {signatures.map((s) => (
              <li key={s.id} className="rounded border border-slate-100 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SIGNATURE_STATUS_TONES[s.status] ?? "gray"}>
                    {labelOf(SIGNATURE_STATUS_LABELS, s.status)}
                  </Badge>
                  {s.method && (
                    <span className="text-[11px] text-slate-500">
                      {labelOf(SIGNATURE_METHOD_LABELS, s.method)}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500">
                    Sağlayıcı: {s.provider === "noop" ? "yapılandırılmamış" : s.provider}
                  </span>
                  {s.status !== "IMZALANDI" && s.status !== "IPTAL" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await cancelSignatureRequest(s.id);
                          onNotify("İmza süreci iptal edildi.", "info");
                          await onChanged();
                        } catch (err) {
                          onNotify(errText(err, "İmza süreci iptal edilemedi."), "error");
                        }
                      }}
                    >
                      İptal et
                    </Button>
                  )}
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {s.signers.map((sg, i) => (
                    <li key={i} className="text-[11px] text-slate-600">
                      • {sg.fullName}
                      {sg.role ? ` (${labelOf(SIGNER_ROLE_LABELS, sg.role)})` : ""}
                      {sg.email ? ` · ${sg.email}` : ""}
                      {sg.status ? ` · ${sg.status}` : ""}
                    </li>
                  ))}
                </ul>
                {s.failureReason && (
                  <p className="mt-1 text-[11px] text-red-700">{s.failureReason}</p>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </li>
  );
}

// ---------- Yeni sözleşme ----------

function CreateContractModal({
  open,
  clientId,
  caseId,
  cases,
  onClose,
  onSaved,
}: {
  open: boolean;
  clientId?: string;
  caseId?: string;
  cases: CaseSummary[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ContractType>("VEKALET_UCRET");
  const [selectedCase, setSelectedCase] = useState(caseId ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [noticeDays, setNoticeDays] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [contentText, setContentText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setType("VEKALET_UCRET");
    setSelectedCase(caseId ?? "");
    setEffectiveFrom("");
    setEffectiveTo("");
    setNoticeDays("");
    setAutoRenew(false);
    setContentText("");
    setError(null);
  }, [open, caseId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createContract({
        clientId: clientId ?? null,
        caseId: selectedCase || null,
        title,
        type,
        contentText,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        renewalNoticeDays: noticeDays.trim() ? Number(noticeDays) : null,
        autoRenew,
      });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Sözleşme oluşturulamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Yeni Sözleşme" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Başlık">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Tür">
            <Select value={type} onChange={(e) => setType(e.target.value as ContractType)}>
              {CONTRACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(CONTRACT_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {!caseId && (
          <Field label="İlgili dosya (isteğe bağlı)">
            <Select value={selectedCase} onChange={(e) => setSelectedCase(e.target.value)}>
              <option value="">(dosyaya bağlama)</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Yürürlük başlangıcı">
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </Field>
          <Field label="Yürürlük bitişi">
            <Input
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid items-end gap-4 sm:grid-cols-2">
          <Field
            label="Fesih ihbar süresi (gün)"
            hint="Süre motoru bu değerden deterministik olarak ihbar son günü üretir."
          >
            <Input
              type="number"
              min={0}
              value={noticeDays}
              onChange={(e) => setNoticeDays(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
            />
            Kendiliğinden yenileme hükmü var
          </label>
        </div>

        <Field
          label="Sözleşme metni (ilk sürüm)"
          hint="Düz metin. İnceleme ve fark hesabı bu metin üzerinden yapılır."
        >
          <Textarea
            rows={10}
            value={contentText}
            onChange={(e) => setContentText(e.target.value)}
          />
        </Field>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Oluştur"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Yeni sürüm ----------

function NewVersionModal({
  contract,
  onClose,
  onSaved,
}: {
  contract: ContractItem | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [contentText, setContentText] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contract) return;
    setContentText("");
    setChangeNote("");
    setError(null);
  }, [contract]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!contract) return;
    setBusy(true);
    setError(null);
    try {
      await createContractVersion(contract.id, { contentText, changeNote });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Sürüm kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(contract)} wide title="Yeni sürüm" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          Sürümler değiştirilemez. Karşı taraftan gelen metni ya da kendi revizyonunuzu YENİ SÜRÜM
          olarak kaydedersiniz; önceki sürüm olduğu gibi kalır.
        </p>
        <Field label="Değişiklik notu">
          <Input
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="Örn. karşı taraf revizyonu — m.7 cezai şart değişti"
          />
        </Field>
        <Field label="Sözleşme metni">
          <Textarea
            rows={14}
            value={contentText}
            onChange={(e) => setContentText(e.target.value)}
            required
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Sürümü kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Durum geçişi ----------

/** Gerekçe zorunlu olan geçişler (sunucu: contracts.service.ts `transition`). */
const NOTE_REQUIRED: readonly ContractStatus[] = ["FESIH", "SONA_ERDI"];

/**
 * DURUM GEÇİŞİ ONAY PENCERESİ.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN BİR PENCERE — NEDEN DOĞRUDAN `<select>` DEĞİL                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Durum, açılır listenin `onChange`'inde anında gönderiliyordu ve istek ne
 * `note` ne `manualApproval` taşıyordu. Sunucu ise:
 *   • FESIH / SONA_ERDI için GEREKÇE,
 *   • YURURLUKTE için ELLE ONAY + GEREKÇE (tamamlanmış e-imza yoksa)
 * arıyor. E-imza sağlayıcısı yapılandırılmadığından tamamlanmış imza da hiç
 * oluşmuyor. Yani ürünün sevk edilen hâlinde bu üç geçişin HİÇBİRİ arayüzden
 * yapılamıyordu (denetim bulgusu 6).
 *
 * Islak imza yolu bu fazın TEK ÇALIŞAN yürürlük yoludur; burada açıkça
 * anlatılır ve onay bir denetim kaydına dönüşür.
 */
function TransitionModal({
  request,
  onClose,
  onDone,
  onNotify,
}: {
  request: { contract: ContractItem; toStatus: ContractStatus } | null;
  onClose: () => void;
  onDone: (label: string) => Promise<void> | void;
  onNotify: Notify;
}) {
  const [note, setNote] = useState("");
  const [manualApproval, setManualApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setManualApproval(false);
    setError(null);
  }, [request?.contract.id, request?.toStatus]);

  if (!request) return null;

  const { contract, toStatus } = request;
  const toLabel = labelOf(CONTRACT_STATUS_LABELS, toStatus);
  const needsNote = NOTE_REQUIRED.includes(toStatus);
  const isEffective = toStatus === "YURURLUKTE";
  // Yürürlükte, tamamlanmış e-imza yoksa elle onay ŞARTTIR; sistem imzayı
  // varsayamaz, bu yüzden kutu işaretlenmeden gönderim yapılmaz.
  const noteRequired = needsNote || (isEffective && manualApproval);
  const blocked =
    (noteRequired && note.trim().length === 0) || (isEffective && !manualApproval);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await transitionContract(contract.id, toStatus, {
        note: note.trim() || undefined,
        manualApproval: isEffective ? manualApproval : undefined,
      });
      await onDone(toLabel);
    } catch (err) {
      const text = errText(err, "Durum değiştirilemedi.");
      setError(text);
      onNotify(text, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Durum değişikliği — ${toLabel}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <strong>{contract.title}</strong> ·{" "}
          {labelOf(CONTRACT_STATUS_LABELS, contract.status)} → <strong>{toLabel}</strong>
        </p>

        {isEffective && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-900">
              Yürürlüğe alma imza kanıtı ister
            </p>
            <p className="mt-1 text-[11px] leading-5 text-amber-800">
              Sistem, sözleşmenin GÜNCEL sürümü için tamamlanmış bir e-imza süreci ve
              indirilmiş imzalı nüsha arar. E-imza sağlayıcısı yapılandırılmamışsa bu
              koşul oluşmaz; ıslak imzalı nüsha elinizdeyse aşağıdaki kutuyu işaretleyip
              gerekçe yazarak elle onaylayın. Onayınız denetim kaydına yazılır.
            </p>
            <label className="mt-2 flex items-start gap-2 text-xs text-amber-900">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={manualApproval}
                onChange={(e) => setManualApproval(e.target.checked)}
              />
              <span>
                Islak imzalı nüsha elimdedir; yürürlüğü kendi sorumluluğumda onaylıyorum.
              </span>
            </label>
          </div>
        )}

        <Field
          label={noteRequired ? "Açıklama (zorunlu)" : "Açıklama"}
          hint={
            needsNote
              ? "Yürürlükten çıkışın hukuki izi budur (ör. \"12.06.2026 tarihli ihbarla feshedildi\")."
              : isEffective
                ? "Ör. \"ıslak imzalı nüsha 12.06.2026'da teslim alındı\"."
                : "İsteğe bağlı; dosya safahatına not olarak düşer."
          }
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="primary" disabled={busy || blocked}>
            {busy ? "Uygulanıyor…" : `${toLabel} olarak kaydet`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- AI incelemesi ----------

function ReviewModal({
  contract,
  onClose,
  onNotify,
}: {
  contract: ContractItem | null;
  onClose: () => void;
  onNotify: Notify;
}) {
  const { costs } = useCreditCosts();
  const [versions, setVersions] = useState<ContractVersionItem[]>([]);
  const [versionId, setVersionId] = useState("");
  const [result, setResult] = useState<ContractReviewResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /**
   * MÜVEKKİLİMİZ HANGİ TARAF.
   *
   * İnceleme onun lehine yapılır: taraf belirtilmezse "riskli madde" kavramı
   * yönsüz kalır ve karşı taraf lehine bir hükmü risk saymayan bir rapor çıkar.
   */
  const [ourParty, setOurParty] = useState("");

  useEffect(() => {
    if (!contract) return;
    setResult(null);
    setListError(null);
    setOurParty("");
    const inline = contract.versions ?? [];
    if (inline.length > 0) {
      setVersions(inline);
      setVersionId(contract.currentVersionId ?? inline[inline.length - 1].id);
      return;
    }
    let alive = true;
    listContractVersions(contract.id)
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        setVersionId(contract.currentVersionId ?? (list.length > 0 ? list[list.length - 1].id : ""));
      })
      .catch((err) => {
        if (alive) setListError(errText(err, "Sürümler yüklenemedi."));
      });
    return () => {
      alive = false;
    };
  }, [contract]);

  const ai = useAiCall(
    useCallback(
      (piiApproved: boolean) => {
        if (!contract) return Promise.reject(new Error("Sözleşme seçilmedi."));
        // `versionId` GÖVDEDE gider; boş bırakılırsa sunucu güncel sürümü inceler.
        return reviewContract(
          contract.id,
          { versionId: versionId || undefined, ourParty: ourParty.trim() || undefined },
          piiApproved,
        );
      },
      [contract, versionId, ourParty],
    ),
    "Sözleşme incelemesi yapılamadı.",
  );

  async function run(withPii = false) {
    const res = withPii ? await ai.approvePii() : await ai.run();
    if (res) {
      setResult(res);
      onNotify("İnceleme tamamlandı — bulgular öneridir.", "info");
    }
  }

  return (
    <Modal open={Boolean(contract)} wide title="Sözleşme incelemesi" onClose={onClose}>
      <div className="space-y-4">
        <AiDisclaimer text="İnceleme bir ÖNERİDİR. Riskli madde tespiti hukuki görüş değildir; metne müdahale kararı avukatındır." />

        {listError && <ErrorBox message={listError} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="İncelenecek sürüm" hint="Boş bırakılırsa güncel sürüm incelenir.">
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">(güncel sürüm)</option>
              {[...versions]
                .sort((a, b) => b.versionNo - a.versionNo)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNo}
                    {v.changeNote ? ` · ${v.changeNote}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Müvekkilimiz hangi taraf?"
            hint="İnceleme onun lehine yapılır; boş bırakılırsa bulgular yönsüz kalır."
          >
            <Input
              value={ourParty}
              onChange={(e) => setOurParty(e.target.value)}
              placeholder="Örn. Hizmet Alan / Kiracı / İşveren"
            />
          </Field>
        </div>

        <Button variant="gold" disabled={ai.busy} onClick={() => void run()}>
          {ai.busy ? "İnceleniyor…" : "İncele"}
          <CreditBadge taskType="CONTRACT_REVIEW" costs={costs} />
        </Button>

        {ai.pii && (
          <PiiApprovalBox
            prompt={ai.pii}
            busy={ai.busy}
            onApprove={() => void run(true)}
            onCancel={ai.cancelPii}
          />
        )}
        {ai.error && <ErrorBox message={ai.error} />}

        {result && (
          <div className="space-y-3">
            {result.summary && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Özet
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">
                  {result.summary}
                </p>
              </div>
            )}

            {result.findings.length === 0 ? (
              <SuccessBox message="İnceleme, alıntıyla desteklenen bir bulgu üretmedi. Bu, sözleşmenin risksiz olduğu anlamına GELMEZ — metni kendiniz de okuyun." />
            ) : (
              <ul className="space-y-2">
                {result.findings.map((f, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONES[String(f.severity ?? "").toUpperCase()] ?? "gray"}>
                        {labelOf(SEVERITY_LABELS, String(f.severity ?? "").toUpperCase()) ||
                          f.kind}
                      </Badge>
                      {f.clause && <Badge tone="navy">{f.clause}</Badge>}
                      <span className="text-sm font-medium text-slate-900">{f.title}</span>
                    </div>
                    {f.detail && (
                      <p className="mt-1.5 text-xs leading-5 text-slate-600">{f.detail}</p>
                    )}
                    {f.quote ? (
                      <SourceQuote quote={f.quote} source={f.clause ?? "Sözleşme metni"} />
                    ) : (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                        Bu bulgu metinden ALINTI TAŞIMIYOR — dayanağını kendiniz doğrulayın.
                      </p>
                    )}
                    {f.suggestion && (
                      <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-700">
                        <span className="font-medium">Öneri:</span> {f.suggestion}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/*
              SESSİZ ELEME YOK. Sunucu iki tür bulguyu eler ve ikisini de
              yanıtta bildirir; bunlar ekrana taşınmazsa avukat gördüğü listeyi
              modelin söylediğinin tamamı sanar. Şeffaflık bölümü, elenenlerin
              GEREKÇESİYLE birlikte durduğu yerdir.
            */}
            {(result.droppedQuotes.length > 0 ||
              result.droppedMissingClaims.length > 0 ||
              result.unverifiedClauseRefs.length > 0) && (
              <Disclosure
                summary={`Denetimde elenen bulgular (${
                  result.droppedQuotes.length + result.droppedMissingClaims.length
                })`}
                className="mt-3"
              >
                <div className="space-y-2">
                  {result.droppedQuotes.map((d, i) => (
                    <div
                      key={`q-${i}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <p className="text-xs font-medium text-slate-700">{d.label}</p>
                      {d.reasonLabel && (
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                          {d.reasonLabel}
                        </p>
                      )}
                      {d.quote && (
                        <p className="mt-1 text-[11px] italic leading-5 text-slate-400">
                          Modelin verdiği alıntı: “{d.quote}”
                        </p>
                      )}
                    </div>
                  ))}
                  {result.droppedMissingClaims.map((d, i) => (
                    <div
                      key={`m-${i}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <p className="text-xs font-medium text-slate-700">
                        “Eksik hüküm” iddiası: {d.topic}
                      </p>
                      {d.reason && (
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">{d.reason}</p>
                      )}
                    </div>
                  ))}
                  {result.unverifiedClauseRefs.length > 0 && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
                      Metinde bulunamadığı için temizlenen madde referansları:{" "}
                      {result.unverifiedClauseRefs.join(", ")}. Bulgular korunmuştur (alıntıları
                      doğrulandı), yalnız madde numaraları kaldırılmıştır.
                    </p>
                  )}
                </div>
              </Disclosure>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- İmzaya gönderme ----------

function SignatureModal({
  contract,
  onClose,
  onNotify,
  onSent,
}: {
  contract: ContractItem | null;
  onClose: () => void;
  onNotify: Notify;
  onSent: () => void | Promise<void>;
}) {
  const [versions, setVersions] = useState<ContractVersionItem[]>([]);
  const [versionId, setVersionId] = useState("");
  const [method, setMethod] = useState<SignatureMethod>("NES");
  const [sequential, setSequential] = useState(false);
  const [signers, setSigners] = useState<ContractSigner[]>([
    { fullName: "", email: "", role: "MUVEKKIL", order: 1 },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [health, setHealth] = useState<SignatureProviderHealth | null>(null);

  /** Sağlayıcı durumu ÖNCEDEN sorulur — hata beklemeden bilgilendirmek için. */
  useEffect(() => {
    if (!contract) return;
    let alive = true;
    signatureProviderHealth()
      .then((h) => {
        if (alive) setHealth(h);
      })
      .catch(() => {
        if (alive) setHealth(null);
      });
    return () => {
      alive = false;
    };
  }, [contract]);

  useEffect(() => {
    if (!contract) return;
    setMethod("NES");
    setSequential(false);
    setSigners([{ fullName: "", email: "", role: "MUVEKKIL", order: 1 }]);
    setError(null);
    setNotConfigured(false);
    setOk(null);
    const inline = contract.versions ?? [];
    if (inline.length > 0) {
      setVersions(inline);
      setVersionId(contract.currentVersionId ?? inline[inline.length - 1].id);
      return;
    }
    let alive = true;
    listContractVersions(contract.id)
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        setVersionId(contract.currentVersionId ?? (list.length > 0 ? list[list.length - 1].id : ""));
      })
      .catch(() => {
        if (alive) setVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [contract]);

  function updateSigner(index: number, patch: Partial<ContractSigner>) {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!contract) return;
    const valid = signers.filter((s) => s.fullName.trim() && (s.email ?? "").trim());
    if (valid.length === 0) {
      setError("En az bir imzacının adı VE e-posta adresi gereklidir.");
      return;
    }
    if (!versionId) {
      setError("İmzalanacak sürüm seçilmelidir (Modül 20, iş kuralı 3).");
      return;
    }
    setBusy(true);
    setError(null);
    setNotConfigured(false);
    setOk(null);
    try {
      const res = await createSignatureRequest(contract.id, {
        versionId,
        method,
        sequential,
        signers: valid.map((s, i) => ({ ...s, order: i + 1 })),
      });
      setOk(
        `İmza süreci oluşturuldu (${labelOf(SIGNATURE_STATUS_LABELS, res.status)}). İmzacılara bildirim sağlayıcı üzerinden gider.`,
      );
      onNotify("İmza süreci başlatıldı.", "success");
      await onSent();
    } catch (err) {
      // SIRA ÖNEMLİ: "yapılandırılmamış" 501 taşıyabilir ve `isFeatureMissing`
      // onu "uç yok" sanardı; önce bunu soruyoruz.
      if (isNotConfigured(err)) setNotConfigured(true);
      else setError(errText(err, "İmza süreci başlatılamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(contract)} wide title="İmzaya gönder" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {/* Sağlayıcı durumu — hata beklemeden, form açılır açılmaz söylenir. */}
        {(notConfigured || health?.configured === false) && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">
              E-imza sağlayıcısı yapılandırılmamış
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              {health?.note ?? NOT_CONFIGURED_TEXT}
            </p>
            <p className="mt-2 text-xs leading-5 text-amber-800">
              Sözleşme ve sürümleri kayıtlıdır; sağlayıcı tanımlandığında
              {health?.configuredVia ? ` (${health.configuredVia})` : ""} bu ekrandan süreci
              başlatabilirsiniz. Bu arada ıslak imza yolunu kullanıp imzalı nüshayı belge olarak
              yükleyebilirsiniz.
            </p>
          </div>
        )}

        {/* İmza öncesi durum koşulu — sunucu IMZAYA_HAZIR olmayanı reddeder. */}
        {contract && contract.status !== "IMZAYA_HAZIR" && (
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
            <p className="text-xs leading-5 text-slate-700">
              Bu sözleşme <strong>{labelOf(CONTRACT_STATUS_LABELS, contract.status)}</strong>{" "}
              durumunda. İmza süreci yalnızca <strong>İmzaya Hazır</strong> sözleşmelerde
              başlatılabilir; önce satırdaki durum seçicisinden geçişi yapın.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="İmzalanacak sürüm"
            hint="Zorunludur: hangi metnin imzalandığı belirsiz kalamaz."
          >
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value)} required>
              <option value="">Seçiniz…</option>
              {[...versions]
                .sort((a, b) => b.versionNo - a.versionNo)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNo}
                    {v.changeNote ? ` · ${v.changeNote}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="İmza yöntemi">
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as SignatureMethod)}
            >
              {SIGNATURE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {labelOf(SIGNATURE_METHOD_LABELS, m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sequential}
            onChange={(e) => setSequential(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
          />
          Sırayla imzalansın (her imzacı bir öncekini bekler)
        </label>

        <div>
          <p className="mb-2 text-xs font-medium text-slate-600">
            İmzacılar — ad, e-posta ve sıfat zorunludur
          </p>
          <ul className="space-y-2">
            {signers.map((s, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <Input
                  value={s.fullName}
                  onChange={(e) => updateSigner(i, { fullName: e.target.value })}
                  placeholder="Ad soyad"
                />
                <Input
                  type="email"
                  value={s.email ?? ""}
                  onChange={(e) => updateSigner(i, { email: e.target.value })}
                  placeholder="E-posta"
                />
                <Select
                  value={s.role ?? "MUVEKKIL"}
                  onChange={(e) => updateSigner(i, { role: e.target.value as SignerRole })}
                >
                  {SIGNER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {labelOf(SIGNER_ROLE_LABELS, r)}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSigners((prev) => prev.filter((_, x) => x !== i))}
                >
                  Kaldır
                </Button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() =>
              setSigners((prev) => [
                ...prev,
                { fullName: "", email: "", role: "MUVEKKIL", order: prev.length + 1 },
              ])
            }
          >
            + İmzacı ekle
          </Button>
        </div>

        {error && <ErrorBox message={error} />}
        {ok && <SuccessBox message={ok} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Başlatılıyor…" : "İmza sürecini başlat"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
