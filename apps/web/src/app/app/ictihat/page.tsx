"use client";

/**
 * İÇTİHAT ARAŞTIRMA — /app/ictihat
 *
 * POST /caselaw/search  { query, mode: CLASSIC|AI }
 * POST /caselaw         · elle karar ekleme (ortak havuz)
 * POST /cases/:id/caselaw-refs  · dosyaya emsal olarak ekle
 *
 * NOT: CaseLawDocument ortak (tenant-bağımsız) havuzdur; kiracıya özgü metin
 * yazılmaz. Dosya ile bağ `CaseLawReference` üzerinden kurulur.
 * Tohum verisi "[DEMO VERİ]" ön ekiyle gelir ve kullanıcıya açıkça işaretlenir.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, asList } from "@/lib/api";
import {
  addCaseLawRef,
  createCaseLaw,
  errText,
  extractPii,
  isFeatureMissing,
  searchCaseLaw,
  type PiiPrompt,
} from "@/lib/faz2";
import type { CaseLawDoc, CaseSummary } from "@/lib/types";
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
  Textarea,
} from "@/components/ui";
import {
  AiDisclaimer,
  FeatureUnavailable,
  PiiApprovalBox,
  ToastStack,
  useToasts,
} from "@/components/ai-ui";
import { fmtDate, isDemoCaseLaw } from "@/lib/labels";

const COURTS = [
  "Yargıtay",
  "Danıştay",
  "Bölge Adliye Mahkemesi",
  "Anayasa Mahkemesi",
  "AİHM",
  "Uyuşmazlık Mahkemesi",
  "Sayıştay",
];

export default function IctihatPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"CLASSIC" | "AI">("CLASSIC");
  const [court, setCourt] = useState("");
  const [results, setResults] = useState<CaseLawDoc[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pii, setPii] = useState<PiiPrompt | null>(null);

  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [attachTarget, setAttachTarget] = useState<CaseLawDoc | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    api<unknown>("/cases", { query: { limit: "200" } })
      .then((p) => setCases(asList<CaseSummary>(p)))
      .catch(() => setCases([]));
  }, []);

  /**
   * `mode` state'i asenkron güncellendiği için arama kipi PARAMETRE olarak
   * geçilir; aksi halde "Ara" düğmesi bir önceki kiple çalışırdı.
   */
  const runSearch = useCallback(
    async (piiApproved: boolean, searchMode: "CLASSIC" | "AI" = mode) => {
      if (!query.trim()) return;
      setMode(searchMode);
      setBusy(true);
      setError(null);
      setMissing(false);
      try {
        const res = await searchCaseLaw({
          query: query.trim(),
          mode: searchMode,
          court: court || undefined,
          piiApproved,
        });
        setResults(res.results);
        setNote(res.note ?? null);
        setSearched(true);
        setPii(null);
      } catch (err) {
        const prompt = extractPii(err);
        if (prompt) {
          setPii(prompt);
        } else if (isFeatureMissing(err)) {
          setMissing(true);
        } else {
          setError(err instanceof ApiError ? err.message : "Arama yapılamadı.");
        }
      } finally {
        setBusy(false);
      }
    },
    [query, mode, court],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">İçtihat Araştırma</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Ortak içtihat havuzunda arama yapın, kararı dosyanıza emsal olarak ekleyin veya elinizdeki
          bir kararı havuza kaydedin. Bulunan her karar künyesiyle birlikte gösterilir — künyesiz
          içtihat kullanılmaz.
        </p>
      </div>

      {/* Arama */}
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(false, "CLASSIC");
          }}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[18rem] flex-1">
              <Field
                label="Arama"
                hint={
                  mode === "AI"
                    ? "AI modu: sorunuzu doğal dille yazın; sistem anlamsal olarak eşleşen kararları getirir."
                    : "Klasik mod: künye, kelime veya kavram araması (ör. “fazla mesai ispat yükü”)."
                }
              >
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Örn. işçinin fazla mesai alacağında ispat yükü"
                  required
                />
              </Field>
            </div>
            <div className="w-56">
              <Field label="Mahkeme">
                <Select value={court} onChange={(e) => setCourt(e.target.value)}>
                  <option value="">Tümü</option>
                  {COURTS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !query.trim()}>
              {busy && mode === "CLASSIC" ? "Aranıyor…" : "Ara"}
            </Button>
            <Button
              type="button"
              variant="gold"
              disabled={busy || !query.trim()}
              onClick={() => void runSearch(false, "AI")}
            >
              {busy && mode === "AI" ? "AI arıyor…" : "AI ile Ara"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setManualOpen(true)}>
              + Elle Karar Ekle
            </Button>
            <span className="ml-auto text-xs text-slate-400">
              Aktif mod: {mode === "AI" ? "AI (anlamsal)" : "Klasik (kelime)"}
            </span>
          </div>
        </form>
      </Card>

      {mode === "AI" && (
        <AiDisclaimer text="AI araması bir ÖNERİDİR ve sonuçlar ortak havuzdaki gerçek kayıtlarla sınırlıdır. Dilekçeye aktarmadan önce künyeyi teyit edin." />
      )}

      {pii && (
        <PiiApprovalBox
          prompt={pii}
          busy={busy}
          onApprove={() => void runSearch(true)}
          onCancel={() => setPii(null)}
        />
      )}

      {error && <ErrorBox message={error} />}
      {note && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          {note}
        </p>
      )}

      {/* Sonuçlar */}
      {missing ? (
        <FeatureUnavailable
          title="İçtihat araması henüz hazır değil"
          detail="/caselaw/search ucu yayına alındığında ortak havuzda klasik ve AI destekli arama yapabileceksiniz. Elle karar ekleme formu da aynı ucu bekliyor."
          onRetry={() => void runSearch(false)}
        />
      ) : busy ? (
        <Spinner label="Kararlar aranıyor…" />
      ) : searched && results.length === 0 ? (
        <Card>
          <EmptyState message="Bu aramaya uyan karar bulunamadı. Ortak havuz yalnızca kaydedilmiş kararları içerir — elinizdeki kararı 'Elle Karar Ekle' ile havuza kazandırabilirsiniz." />
        </Card>
      ) : results.length > 0 ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{results.length} sonuç</p>
          <ul className="space-y-4">
            {results.map((doc) => (
              <CaseLawCard key={doc.id} doc={doc} onAttach={() => setAttachTarget(doc)} />
            ))}
          </ul>
        </div>
      ) : (
        <Card>
          <EmptyState message="Arama yapmak için yukarıdaki kutuyu kullanın." />
        </Card>
      )}

      <AttachModal
        doc={attachTarget}
        cases={cases}
        onClose={() => setAttachTarget(null)}
        onDone={(caseTitle) => {
          setAttachTarget(null);
          push(`Karar "${caseTitle}" dosyasına emsal olarak eklendi.`, "success");
        }}
        onError={(msg) => push(msg, "error")}
      />

      <ManualCaseLawModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={(doc) => {
          setManualOpen(false);
          setResults((prev) => [doc, ...prev]);
          setSearched(true);
          push("Karar ortak havuza eklendi.", "success");
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function CaseLawCard({ doc, onAttach }: { doc: CaseLawDoc; onAttach: () => void }) {
  const [open, setOpen] = useState(false);
  const demo = isDemoCaseLaw(doc);

  return (
    <li className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="navy">{doc.court}</Badge>
            {doc.chamber && <Badge tone="gray">{doc.chamber}</Badge>}
            {demo && <Badge tone="yellow">DEMO VERİ</Badge>}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">
            E. {doc.caseNumber} · K. {doc.decisionNumber}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {doc.decisionDate ? fmtDate(doc.decisionDate) : "Tarih belirtilmemiş"}
            {doc.sourceAdapter ? ` · Kaynak: ${doc.sourceAdapter}` : ""}
          </p>
        </div>
        {typeof doc.score === "number" && (
          <span className="text-xs text-slate-400">İlgi: {(doc.score * 100).toFixed(0)}%</span>
        )}
      </div>

      <div className="space-y-3 px-5 py-4">
        {demo && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
            Bu kayıt demo tohum verisidir; gerçek bir mahkeme kararı değildir. Dilekçede
            kullanmayın.
          </p>
        )}
        {doc.summary ? (
          <p className="text-sm leading-6 text-slate-700">{doc.summary}</p>
        ) : (
          <p className="text-xs text-slate-400">Özet yok.</p>
        )}
        {doc.relevanceNote && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <strong>İlgi gerekçesi:</strong> {doc.relevanceNote}
          </p>
        )}
        {doc.fullText && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs font-medium text-slate-500 hover:text-amber-600"
            >
              {open ? "Karar metnini gizle" : "Karar metnini göster"}
            </button>
            {open && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-6 text-slate-700">
                {doc.fullText}
              </pre>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
        <Button size="sm" variant="gold" onClick={onAttach}>
          Dosyaya emsal olarak ekle
        </Button>
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-slate-500 hover:text-amber-600"
          >
            Kaynağı aç →
          </a>
        )}
      </div>
    </li>
  );
}

function AttachModal({
  doc,
  cases,
  onClose,
  onDone,
  onError,
}: {
  doc: CaseLawDoc | null;
  cases: CaseSummary[];
  onClose: () => void;
  onDone: (caseTitle: string) => void;
  onError: (msg: string) => void;
}) {
  const [caseId, setCaseId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (doc) {
      setCaseId("");
      setNote("");
    }
  }, [doc]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!doc || !caseId) return;
    setSaving(true);
    try {
      await addCaseLawRef(caseId, doc.id, note);
      onDone(cases.find((c) => c.id === caseId)?.title ?? "seçilen");
    } catch (err) {
      onError(errText(err, "Emsal eklenemedi."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={doc !== null} title="Dosyaya Emsal Ekle" onClose={onClose}>
      {doc && (
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <strong>
              {doc.court}
              {doc.chamber ? ` ${doc.chamber}` : ""}
            </strong>{" "}
            · E. {doc.caseNumber} · K. {doc.decisionNumber}
          </p>
          <Field label="Dosya">
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} required>
              <option value="">Dosya seçin…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.fileNumber ? ` (${c.fileNumber})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="İlgi notu" hint="Bu kararın dosyanızla bağını kısaca yazın.">
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Örn. Fazla mesai iddiasında tanık beyanının tek başına yeterli olmadığına dair emsal."
            />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" variant="gold" disabled={saving || !caseId}>
              {saving ? "Ekleniyor…" : "Emsal Olarak Ekle"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ManualCaseLawModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (doc: CaseLawDoc) => void;
}) {
  const [form, setForm] = useState({
    court: "Yargıtay",
    chamber: "",
    caseNumber: "",
    decisionNumber: "",
    decisionDate: "",
    summary: "",
    fullText: "",
    sourceUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createCaseLaw({
        court: form.court.trim(),
        chamber: form.chamber.trim() || undefined,
        caseNumber: form.caseNumber.trim(),
        decisionNumber: form.decisionNumber.trim(),
        decisionDate: form.decisionDate
          ? new Date(form.decisionDate).toISOString()
          : undefined,
        summary: form.summary.trim() || undefined,
        fullText: form.fullText.trim() || undefined,
        sourceUrl: form.sourceUrl.trim() || undefined,
      });
      onCreated(created);
      setForm({
        court: "Yargıtay",
        chamber: "",
        caseNumber: "",
        decisionNumber: "",
        decisionDate: "",
        summary: "",
        fullText: "",
        sourceUrl: "",
      });
    } catch (err) {
      setError(errText(err, "Karar kaydedilemedi."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title="Elle Karar Ekle" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          Bu kayıt <strong>ortak havuza</strong> yazılır ve tüm kiracılar tarafından görülebilir.
          Müvekkile ait kişisel veri veya dosyaya özgü bilgi <strong>yazmayın</strong>.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mahkeme">
            <Input
              list="ictihat-mahkemeler"
              value={form.court}
              onChange={(e) => setForm({ ...form, court: e.target.value })}
              required
            />
            <datalist id="ictihat-mahkemeler">
              {COURTS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Daire">
            <Input
              value={form.chamber}
              onChange={(e) => setForm({ ...form, chamber: e.target.value })}
              placeholder="9. Hukuk Dairesi"
            />
          </Field>
          <Field label="Esas No">
            <Input
              value={form.caseNumber}
              onChange={(e) => setForm({ ...form, caseNumber: e.target.value })}
              placeholder="2024/1234"
              required
            />
          </Field>
          <Field label="Karar No">
            <Input
              value={form.decisionNumber}
              onChange={(e) => setForm({ ...form, decisionNumber: e.target.value })}
              placeholder="2025/567"
              required
            />
          </Field>
          <Field label="Karar tarihi">
            <Input
              type="date"
              value={form.decisionDate}
              onChange={(e) => setForm({ ...form, decisionDate: e.target.value })}
            />
          </Field>
          <Field label="Kaynak bağlantısı">
            <Input
              type="url"
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              placeholder="https://karararama.yargitay.gov.tr/…"
            />
          </Field>
        </div>
        <Field label="Özet">
          <Textarea
            rows={3}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="Kararın hukuki sonucunu bir paragrafta özetleyin."
          />
        </Field>
        <Field label="Karar metni" hint="Varsa tam metni yapıştırın; arama bu metin üzerinde çalışır.">
          <Textarea
            rows={6}
            value={form.fullText}
            onChange={(e) => setForm({ ...form, fullText: e.target.value })}
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            variant="gold"
            disabled={saving || !form.caseNumber.trim() || !form.decisionNumber.trim()}
          >
            {saving ? "Kaydediliyor…" : "Havuza Ekle"}
          </Button>
        </div>
      </form>
      <p className="mt-3 text-[11px] text-slate-400">
        Dosyaya bağlamak için kaydettikten sonra sonuç kartındaki{" "}
        <Link href="/app/ictihat" className="underline">
          “Dosyaya emsal olarak ekle”
        </Link>{" "}
        düğmesini kullanın.
      </p>
    </Modal>
  );
}
