"use client";

/**
 * İcra dosyaları — Modül 05.
 *
 * GET  /enforcement            — liste (filtre: stage, trackingType, clientId)
 * POST /enforcement            — yeni takip dosyası (mevcut bir ICRA dosyasına 1:1 bağlanır)
 * GET  /cases?type=ICRA        — takip açılabilecek dosyalar
 * GET  /clients                — müvekkil süzgeci
 *
 * PARA: alacak / tahsil edilen / kalan sütunları SUNUCUDAN gelir. Sunucu bu
 * alanları göndermezse hücre "—" gösterir; arayüz kendi toplamını üretmez
 * (bakiye mahsup sıralı deterministik bir hesaptır ve sunucuya aittir).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, DEFAULT_PAGE_SIZE } from "@/lib/api";
import { RemoteSelect } from "@/components/remote-select";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  createEnforcementFile,
  listEnforcementFilesPaged,
  type CreateEnforcementBody,
} from "@/lib/enforcement";
import type { EnforcementFile } from "@/lib/faz3-types";
import type { CaseSummary, Client } from "@/lib/types";
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
  Pagination,
  Spinner,
  StatCard,
  Textarea,
} from "@/components/ui";
import { FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { fmtAmount } from "@/lib/money";
import {
  ENFORCEMENT_STAGES,
  ENFORCEMENT_STAGE_LABELS,
  ENFORCEMENT_STAGE_TONES,
  ENFORCEMENT_TYPES,
  ENFORCEMENT_TYPE_LABELS,
  SCORE_BAND_LABELS,
  SCORE_BAND_TONES,
  labelOf,
  toIsoDate,
} from "@/lib/labels";

const EMPTY_FORM = {
  caseId: "",
  officeName: "",
  fileNumber: "",
  trackingType: "ILAMSIZ",
  principalAmount: "",
  interestRate: "",
  requestDate: toIsoDate(new Date()),
  debtorInfo: "",
};

type FormState = typeof EMPTY_FORM;

export default function IcraListPage() {
  const [files, setFiles] = useState<EnforcementFile[]>([]);
  const [clientLabel, setClientLabel] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState("");
  const [trackingType, setTrackingType] = useState("");
  const [clientId, setClientId] = useState("");
  const [open, setOpen] = useState(false);

  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Zarf okunur; `total` artık atılmıyor (denetim bulgusu K-15).
      const res = await listEnforcementFilesPaged({
        stage: stage || undefined,
        trackingType: trackingType || undefined,
        clientId: clientId || undefined,
        page,
        limit: DEFAULT_PAGE_SIZE,
      });
      setFiles(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setMissing(true);
        setFiles([]);
      } else {
        setError(errText(err, "İcra dosyaları yüklenemedi."));
      }
    } finally {
      setLoading(false);
    }
  }, [stage, trackingType, clientId, page]);

  useEffect(() => {
    void load();
  }, [load]);


  /** Sunucu süzgeci uygulamazsa istemcide de daralt (yanlış liste göstermemek için). */
  const visible = useMemo(() => {
    return files.filter((f) => {
      if (stage && f.stage !== stage) return false;
      if (trackingType && f.trackingType !== trackingType) return false;
      if (clientId && f.case?.client?.id && f.case.client.id !== clientId) return false;
      return true;
    });
  }, [files, stage, trackingType, clientId]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of files) counts[f.stage] = (counts[f.stage] ?? 0) + 1;
    return counts;
  }, [files]);

  const openCount = useMemo(
    () => files.filter((f) => f.stage !== "KAPANDI" && f.stage !== "ACIZ_VESIKASI").length,
    [files],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">İcra Takipleri</h1>
          <p className="mt-1 text-sm text-slate-500">
            Takip talebinden kapanışa kadar dosya yaşam döngüsü, işlem günlüğü ve tahsilat.
          </p>
        </div>
        <Button variant="gold" onClick={() => setOpen(true)} disabled={missing}>
          + Yeni İcra Dosyası
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* F2-Ö-23: kart sunucudan gelen TOPLAM sayıyı gösterir; files.length
            yalnız MEVCUT SAYFANIN satır sayısıdır ve sayfa 2'de yanlış görünür. */}
        <StatCard label="Toplam Takip" value={total} tone="navy" />
        <StatCard label="Açık Dosya" value={openCount} tone="slate" />
        <StatCard
          label="İtirazlı"
          value={stageCounts.ITIRAZ ?? 0}
          tone="red"
          hint="Takip durur; itirazın iptali/kaldırılması gerekir"
        />
        <StatCard
          label="Haciz / Satış"
          value={(stageCounts.HACIZ ?? 0) + (stageCounts.SATIS ?? 0)}
          tone="gold"
        />
      </div>

      <Card title="Filtre">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Aşama">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Tümü</option>
              {ENFORCEMENT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(ENFORCEMENT_STAGE_LABELS, s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Takip türü">
            <Select value={trackingType} onChange={(e) => setTrackingType(e.target.value)}>
              <option value="">Tümü</option>
              {ENFORCEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(ENFORCEMENT_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          {/*
            Müvekkil süzgeci SUNUCUDA aranır (denetim bulguları K-15, K-16).
            Önceden `/clients?limit=200` çekiliyordu; ucun tavanı 100 olduğu
            için 101. müvekkil bu süzgeçte HİÇ seçilemiyordu.
          */}
          <Field label="Müvekkil (alacaklı)">
            <RemoteSelect<Client>
              path="/clients"
              value={clientId}
              selectedLabel={clientLabel}
              onChange={(id, opt) => {
                setClientId(id);
                setClientLabel(opt?.label ?? "");
                setPage(1);
              }}
              toOption={(c) => ({ id: c.id, label: c.name })}
              placeholder="Tümü — aramak için yazın…"
              emptyMessage="Eşleşen müvekkil yok."
              ariaLabel="Müvekkil ara ve süz"
            />
          </Field>
        </div>
      </Card>

      {missing ? (
        <FeatureUnavailable
          title="İcra modülü henüz yayında değil"
          detail="/api/v1/enforcement ucu yayına alındığında bu ekran otomatik çalışacak."
          onRetry={() => void load()}
        />
      ) : loading ? (
        <Spinner label="İcra dosyaları yükleniyor…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : visible.length === 0 ? (
        <EmptyState message="Bu süzgeçle eşleşen icra dosyası yok." />
      ) : (
        <Card title={`${visible.length} dosya`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Dosya</th>
                  <th className="py-2 pr-4 font-medium">Müvekkil / Borçlu</th>
                  <th className="py-2 pr-4 font-medium">Tür</th>
                  <th className="py-2 pr-4 font-medium">Aşama</th>
                  <th className="py-2 pr-4 text-right font-medium">Asıl Alacak</th>
                  <th className="py-2 pr-4 text-right font-medium">Tahsil</th>
                  <th className="py-2 pr-4 text-right font-medium">Kalan</th>
                  <th className="py-2 font-medium">Skor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((f) => {
                  const currency = f.currency ?? "TRY";
                  return (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/app/icra/${f.id}`}
                          className="font-medium text-slate-900 hover:text-amber-600"
                        >
                          {f.fileNumber}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">{f.officeName}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="text-slate-800">{f.case?.client?.name ?? "—"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {f.debtorInfo ? `Borçlu: ${f.debtorInfo}` : "Borçlu bilgisi girilmemiş"}
                        </p>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {labelOf(ENFORCEMENT_TYPE_LABELS, f.trackingType)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={ENFORCEMENT_STAGE_TONES[f.stage] ?? "gray"}>
                          {labelOf(ENFORCEMENT_STAGE_LABELS, f.stage)}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-right font-medium tabular-nums text-slate-800">
                        {fmtAmount(f.principalAmount, currency)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-700">
                        {fmtAmount(f.collectedTotal, currency)}
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold tabular-nums text-slate-900">
                        {fmtAmount(f.remainingTotal, currency)}
                      </td>
                      <td className="py-3">
                        {f.latestScore ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Badge tone={SCORE_BAND_TONES[f.latestScore.band] ?? "gray"}>
                              {f.latestScore.score}/100
                            </Badge>
                            <span className="text-[11px] text-slate-500">
                              {labelOf(SCORE_BAND_LABELS, f.latestScore.band)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Hesaplanmadı</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            noun="icra dosyası"
            loading={loading}
            onPageChange={setPage}
          />

          <p className="mt-4 text-[11px] leading-5 text-slate-500">
            Tahsil edilen ve kalan tutarlar sunucudaki deterministik bakiye hesabından gelir
            (mahsup sırası: masraf → faiz → asıl alacak). Boş görünen hücre, sunucunun o dosya
            için henüz bakiye döndürmediği anlamına gelir.
          </p>
        </Card>
      )}

      <NewEnforcementModal
        open={open}
        existingCaseIds={files.map((f) => f.caseId)}
        onClose={() => setOpen(false)}
        onCreated={(f) => {
          setOpen(false);
          push(`${f.fileNumber} icra dosyası oluşturuldu.`);
          void load();
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- Yeni icra dosyası ----------

function NewEnforcementModal({
  open,
  existingCaseIds,
  onClose,
  onCreated,
}: {
  open: boolean;
  existingCaseIds: string[];
  onClose: () => void;
  onCreated: (file: EnforcementFile) => void;
}) {
  const [caseLabel, setCaseLabel] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setCaseLabel("");
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: CreateEnforcementBody = {
        caseId: form.caseId,
        officeName: form.officeName.trim(),
        fileNumber: form.fileNumber.trim(),
        trackingType: form.trackingType as CreateEnforcementBody["trackingType"],
        // Decimal: STRING gönderilir; Number'a çevrilmez.
        principalAmount: form.principalAmount.trim().replace(",", "."),
        interestRate: form.interestRate.trim()
          ? form.interestRate.trim().replace(",", ".")
          : undefined,
        requestDate: form.requestDate,
        debtorInfo: form.debtorInfo.trim() || undefined,
      };
      const created = await createEnforcementFile(body);
      onCreated(created);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "İcra dosyası oluşturulamadı.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Yeni İcra Dosyası" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Bağlı dosya (ICRA tipli)"
          hint="Her Case'e yalnızca bir icra dosyası açılabilir; takibi açılmış dosyalar listede yer almaz."
        >
          {/*
            Dosya SUNUCUDA aranır (denetim bulguları K-15, K-16). Önceden
            `/cases?type=ICRA&limit=200` ile tek atışta çekiliyordu; 201. icra
            dosyası bu listede HİÇ seçilemiyor, o dosyaya takip açılamıyordu.
            Case ↔ EnforcementFile 1:1'dir; takibi açılmış dosya elenir.
          */}
          <RemoteSelect<CaseSummary>
            path="/cases"
            query={{ type: "ICRA" }}
            value={form.caseId}
            selectedLabel={caseLabel}
            onChange={(id, opt) => {
              setForm({ ...form, caseId: id });
              setCaseLabel(opt?.label ?? "");
            }}
            toOption={(c) => ({
              id: c.id,
              label: c.title,
              hint: existingCaseIds.includes(c.id)
                ? "takip zaten açık"
                : (c.client?.name ?? undefined),
            })}
            placeholder="ICRA tipli dosya arayın…"
            emptyMessage="Eşleşen ICRA tipli dosya yok — önce Dosyalar ekranından açın."
            ariaLabel="İcra dosyası ara ve seç"
          />
        </Field>
        {form.caseId && existingCaseIds.includes(form.caseId) && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Bu dosyada zaten bir icra takibi açık. Her dosyaya yalnızca bir takip açılabilir.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="İcra dairesi">
            <Input
              value={form.officeName}
              onChange={(e) => setForm({ ...form, officeName: e.target.value })}
              placeholder="İstanbul 9. İcra Dairesi"
              required
            />
          </Field>
          <Field label="Dosya no">
            <Input
              value={form.fileNumber}
              onChange={(e) => setForm({ ...form, fileNumber: e.target.value })}
              placeholder="2026/8842"
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Takip türü">
            <Select
              value={form.trackingType}
              onChange={(e) => setForm({ ...form, trackingType: e.target.value })}
            >
              {ENFORCEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(ENFORCEMENT_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Takip talebi tarihi">
            <Input
              type="date"
              value={form.requestDate}
              onChange={(e) => setForm({ ...form, requestDate: e.target.value })}
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asıl alacak (₺)" hint="Kuruş ayracı nokta ya da virgül olabilir.">
            <Input
              inputMode="decimal"
              value={form.principalAmount}
              onChange={(e) => setForm({ ...form, principalAmount: e.target.value })}
              placeholder="347500.00"
              required
            />
          </Field>
          <Field label="Yıllık faiz oranı (%)" hint="Boş bırakılırsa faiz işletilmez.">
            <Input
              inputMode="decimal"
              value={form.interestRate}
              onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
              placeholder="48.00"
            />
          </Field>
        </div>

        <Field
          label="Borçlu bilgisi"
          hint="KVKK: bu metin dış AI sağlayıcısına gönderilirken maskelenir."
        >
          <Textarea
            rows={2}
            value={form.debtorInfo}
            onChange={(e) => setForm({ ...form, debtorInfo: e.target.value })}
            placeholder="Yıldız Lojistik A.Ş."
          />
        </Field>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
          Takip çıkışı, faiz ve bakiye SUNUCUDA deterministik olarak hesaplanır. Buraya yalnızca
          asıl alacak ve faiz oranı girilir; toplam tutar formda gösterilmez çünkü hesap
          arayüzde yapılmaz.
        </p>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            disabled={saving || !form.caseId || existingCaseIds.includes(form.caseId)}
          >
            {saving ? "Oluşturuluyor…" : "Takibi Aç"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
