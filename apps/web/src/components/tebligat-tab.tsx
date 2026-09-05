"use client";

/**
 * Dosya detayı → "Tebligatlar" sekmesi (Faz 6).
 *
 * Tebligat ayrı bir varlıktır: kanal (UETS/KEP/PTT/elden), yön, konu, tebliğ tarihi ve
 * isteğe bağlı süre kuralı. Tebliğ tarihi + kural girildiğinde sunucu kural motorundan
 * süreyi OTOMATİK açar (ONAYLI); kayıt üzerinde süre bağlantısı görünür.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { errText, isMissingEndpoint } from "@/lib/faz2";
import {
  TEBLIGAT_KANALLARI,
  TEBLIGAT_KANAL_LABELS,
  createTebligat,
  deleteTebligat,
  fetchTebligatSaglayici,
  listTebligatlar,
  updateTebligat,
  type Tebligat,
  type TebligatKanali,
  type TebligatSaglayiciBilgisi,
} from "@/lib/faz6-icra-finans";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { fmtDate, toIsoDate } from "@/lib/labels";

interface RuleOption {
  key: string;
  title: string;
}

export function TebligatTab({ caseId, onDeadlineOpened }: { caseId: string; onDeadlineOpened?: () => void }) {
  const [rows, setRows] = useState<Tebligat[]>([]);
  const [rules, setRules] = useState<RuleOption[]>([]);
  const [saglayici, setSaglayici] = useState<TebligatSaglayiciBilgisi | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [channel, setChannel] = useState<TebligatKanali>("UETS");
  const [direction, setDirection] = useState<"GELEN" | "GIDEN">("GELEN");
  const [subject, setSubject] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [servedAt, setServedAt] = useState("");
  const [ruleKey, setRuleKey] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTebligatlar(caseId);
      setRows(Array.isArray(list) ? list : []);
      setMissing(false);
    } catch (err) {
      if (isMissingEndpoint(err)) setMissing(true);
      else setError(errText(err, "Tebligatlar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
    fetchTebligatSaglayici().then(setSaglayici).catch(() => setSaglayici(null));
    api<unknown>("/deadline-rules")
      .then((data) => {
        const list = Array.isArray(data) ? data : (data as { rules?: unknown[]; items?: unknown[] })?.rules ?? (data as { items?: unknown[] })?.items ?? [];
        setRules(
          (list as Array<{ key?: string; title?: string; label?: string }>)
            .filter((r) => typeof r.key === "string")
            .map((r) => ({ key: r.key as string, title: r.title ?? r.label ?? (r.key as string) })),
        );
      })
      .catch(() => setRules([]));
  }, [load]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await createTebligat(caseId, {
        channel,
        direction,
        subject: subject.trim(),
        counterparty: counterparty.trim() || null,
        servedAt: servedAt || null,
        deadlineRuleKey: ruleKey || null,
        note: note.trim() || null,
      });
      setSubject("");
      setCounterparty("");
      setServedAt("");
      setRuleKey("");
      setNote("");
      setNotice(created.deadlineId ? "Tebligat kaydedildi; kural motorundan süre otomatik açıldı (Süreler sekmesi)." : "Tebligat kaydedildi.");
      if (created.deadlineId) onDeadlineOpened?.();
      await load();
    } catch (err) {
      setFormError(errText(err, "Tebligat kaydedilemedi."));
    } finally {
      setSaving(false);
    }
  }

  async function markServed(t: Tebligat) {
    setBusyId(t.id);
    setNotice(null);
    try {
      const updated = await updateTebligat(t.id, { servedAt: toIsoDate(new Date()) });
      setNotice(updated.deadlineId && !t.deadlineId ? "Tebliğ tarihi işlendi; süre otomatik açıldı." : "Tebliğ tarihi işlendi.");
      if (updated.deadlineId && !t.deadlineId) onDeadlineOpened?.();
      await load();
    } catch (err) {
      setError(errText(err, "Tebliğ tarihi işlenemedi."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: Tebligat) {
    if (!window.confirm("Bu tebligat kaydı silinsin mi? (Açılmış süre kaydı silinmez.)")) return;
    setBusyId(t.id);
    try {
      await deleteTebligat(t.id);
      await load();
    } catch (err) {
      setError(errText(err, "Tebligat silinemedi."));
    } finally {
      setBusyId(null);
    }
  }

  if (missing) {
    return (
      <FeatureUnavailable
        title="Tebligat ucu henüz yayında değil"
        detail="/api/v1/cases/:id/tebligatlar yayına alındığında bu sekme otomatik çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Tebligatlar" className="lg:col-span-2">
        {saglayici && (
          <p className="mb-3 text-[11px] leading-5 text-slate-500">
            Elektronik tebligat sağlayıcısı: <span className="font-medium">{saglayici.providerKey}</span> — {saglayici.note}
          </p>
        )}
        {error && <ErrorBox message={error} />}
        {notice && <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}</p>}
        {loading ? (
          <Spinner label="Tebligatlar yükleniyor…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Bu dosyada tebligat kaydı yok. Sağdaki formdan tebligat ekleyin; tebliğ tarihi + kural girilirse süre otomatik açılır." />
        ) : (
          <ul className="space-y-3">
            {rows.map((t) => (
              <li key={t.id} className="rounded-lg border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{t.subject}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Badge tone={t.direction === "GELEN" ? "blue" : "gray"}>{t.direction === "GELEN" ? "Gelen" : "Giden"}</Badge>
                      <span>{t.channelLabel}</span>
                      {t.counterparty && <span>· {t.counterparty}</span>}
                      {t.sentAt && <span>· Gönderim {fmtDate(t.sentAt)}</span>}
                      {t.servedAt ? <span>· Tebliğ {fmtDate(t.servedAt)}</span> : <Badge tone="yellow">Tebliğ tarihi yok</Badge>}
                      {t.deadlineRuleKey && <span className="font-mono">· {t.deadlineRuleKey}</span>}
                      {t.deadlineId && (
                        <Link href={`/app/sureler?deadlineId=${t.deadlineId}`} className="hover:text-amber-600">
                          <Badge tone="green">Süre açıldı</Badge>
                        </Link>
                      )}
                    </p>
                    {t.note && <p className="mt-1 text-xs text-slate-600">{t.note}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!t.servedAt && (
                      <Button size="sm" variant="secondary" disabled={busyId === t.id} onClick={() => void markServed(t)}>
                        Bugün tebliğ edildi
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busyId === t.id} onClick={() => void remove(t)}>
                      Sil
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Tebligat Ekle">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Kanal">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as TebligatKanali)}>
              {TEBLIGAT_KANALLARI.map((k) => (
                <option key={k} value={k}>
                  {TEBLIGAT_KANAL_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Yön">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as "GELEN" | "GIDEN")}>
              <option value="GELEN">Gelen (bize tebliğ)</option>
              <option value="GIDEN">Giden (karşı tarafa)</option>
            </Select>
          </Field>
          <Field label="Konu">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ör. Gerekçeli karar tebliği" required minLength={3} />
          </Field>
          <Field label="Karşı taraf / muhatap">
            <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </Field>
          <Field label="Tebliğ tarihi">
            <Input type="date" value={servedAt} onChange={(e) => setServedAt(e.target.value)} />
          </Field>
          <Field label="Süre kuralı (isteğe bağlı)">
            <Select value={ruleKey} onChange={(e) => setRuleKey(e.target.value)}>
              <option value="">Süre açma</option>
              {rules.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Not">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>
          {formError && <ErrorBox message={formError} />}
          <Button type="submit" variant="gold" disabled={saving || subject.trim().length < 3}>
            {saving ? "Kaydediliyor…" : "Tebligatı kaydet"}
          </Button>
          <p className="text-[11px] leading-5 text-slate-500">
            Tebliğ tarihi ve kural birlikte girildiğinde süre ONAYLI olarak açılır; hesap izi Süreler sekmesinde görünür.
          </p>
        </form>
      </Card>
    </div>
  );
}
