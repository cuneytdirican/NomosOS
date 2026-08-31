"use client";

/**
 * Müvekkil kartı → VEKALETNAMELER sekmesi (Modül 12).
 *
 * İKİ ŞEY BİRBİRİNDEN AYRI DURUR:
 *  1. KAYIT — noter, yevmiye no, tarih, özel yetki maddeleri. Deterministiktir,
 *     avukatın girdiğidir; "süresi doldu / azilli" durumu tarihlerden çıkar ve
 *     uyarı listesi sunucuda AI'sız, kredisiz hesaplanır.
 *  2. ANALİZ — "bu dava için yeterli mi?" sorusunun AI yanıtı. ÖNERİDİR:
 *     şema yorumunun deyişiyle "verdict avukatı bağlamaz, dosyaya rapor olarak
 *     düşer". Sonuç kartı bu yüzden kaydın YANINDA değil ayrı bir panelde,
 *     "avukat teyidi gerekir" şeridiyle gösterilir ve kapsam maddelerini
 *     KENDİLİĞİNDEN DEĞİŞTİRMEZ.
 *
 * ÖZEL YETKİ KATALOĞU SUNUCUDAN GELİR (`GET /power-of-attorney/scope-catalog`):
 * otuzdan fazla yetki, her biri hukuki dayanağıyla. İstemcide ikinci bir
 * katalog tutulsaydı listeler ayrıştığı an ekran, sunucunun tanımadığı bir kod
 * gönderip kaydı doğrulamadan düşürürdü.
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
  Textarea,
  TruncationNotice,
} from "@/components/ui";
import { AiDisclaimer, FeatureUnavailable, PiiApprovalBox, SourceQuote } from "@/components/ai-ui";
import { CreditBadge, useCreditCosts } from "@/components/credits";
import { errText } from "@/lib/faz2";
import { SERVER_MAX_PAGE_SIZE } from "@/lib/api";
import {
  POA_TERMINATION_TYPES,
  POA_TERMINATION_TYPE_LABELS,
  POA_TYPES,
  POA_TYPE_LABELS,
  POA_VERDICT_DOTS,
  POA_VERDICT_LABELS,
  POA_VERDICT_TONES,
  daysUntil,
  fmtDate,
  fmtDateTime,
  labelOf,
  poaStateOf,
  remainingLabel,
  scopeCodeLabel,
  toIsoDate,
  urgencyTone,
} from "@/lib/labels";
import { useAiCall } from "../_lib/use-ai-call";
import {
  analyzePoaScope,
  createPoa,
  fetchScopeCatalog,
  isFeatureMissing,
  listPoaPaged,
  revokePoa,
} from "../_lib/faz5";
import type {
  PoaItem,
  PoaScopeCheckResult,
  PoaScopeDefinition,
  PoaScopeItem,
  PoaType,
} from "../_lib/faz5-types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

/** Süre bitişine bu kadar gün kaldıysa sekmenin üstünde uyarı şeridi çıkar. */
const EXPIRY_WARN_DAYS = 30;

export function PoaTab({
  clientId,
  cases,
  onNotify,
}: {
  clientId: string;
  cases: CaseSummary[];
  onNotify: Notify;
}) {
  const [items, setItems] = useState<PoaItem[]>([]);
  const [catalog, setCatalog] = useState<PoaScopeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [analyzeFor, setAnalyzeFor] = useState<PoaItem | null>(null);
  const [revokeFor, setRevokeFor] = useState<PoaItem | null>(null);
  /** Sunucu zarfı kırpma gösteriyorsa uyarı çıkar (denetim bulgusu K-15). */
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      // Zarf okunur; `total` atılmaz (denetim bulgusu K-15).
      const res = await listPoaPaged({ clientId, limit: SERVER_MAX_PAGE_SIZE });
      setItems(res.items);
      setTruncated(res.hasMore || res.truncated);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Vekaletnameler yüklenemedi."));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Katalog bir kez çekilir; uç yoksa onay kutuları gizlenir, kayıt yine açılır. */
  useEffect(() => {
    let alive = true;
    fetchScopeCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch(() => {
        if (alive) setCatalog([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const labelOfCode = useCallback(
    (code: string) => catalog.find((c) => c.code === code)?.label ?? scopeCodeLabel(code),
    [catalog],
  );

  const warnings = useMemo(
    () =>
      items.filter((p) => {
        if (p.revokedAt) return false;
        if (!p.expiresAt) return false;
        return daysUntil(p.expiresAt) <= EXPIRY_WARN_DAYS;
      }),
    [items],
  );

  if (loading) return <Spinner label="Vekaletnameler yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Vekaletname modülü henüz hazır değil"
        detail="Vekaletname uçları yayına alındığında bu sekme otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">
            {warnings.length} vekaletnamenin süresi doldu veya dolmak üzere
          </p>
          <ul className="mt-2 space-y-1">
            {warnings.map((p) => {
              const d = daysUntil(p.expiresAt!);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                  <Badge tone={urgencyTone(d)}>{remainingLabel(d)}</Badge>
                  {p.notary ?? "Noter"} {p.number ? `· Yevmiye ${p.number}` : ""} ·{" "}
                  {fmtDate(p.expiresAt)}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-5 text-amber-800">
            Süresi dolan vekaletname ile işlem yapılamaz; yenisi alınmadan dosyada usul işlemi
            yürütmeyin.
          </p>
        </div>
      )}

      <Card
        title={`Vekaletnameler (${items.length})`}
        action={
          <Button size="sm" variant="gold" onClick={() => setCreateOpen(true)}>
            + Vekaletname Ekle
          </Button>
        }
      >
        {truncated && <TruncationNotice shown={items.length} noun="vekaletname" />}
        {items.length === 0 ? (
          <EmptyState message="Bu müvekkil için kayıtlı vekaletname yok. Dosya açmadan önce vekaletnameyi kaydedin." />
        ) : (
          <ul className="space-y-3">
            {items.map((p) => (
              <PoaRow
                key={p.id}
                poa={p}
                labelOfCode={labelOfCode}
                onAnalyze={() => setAnalyzeFor(p)}
                onRevoke={() => setRevokeFor(p)}
              />
            ))}
          </ul>
        )}
      </Card>

      <CreatePoaModal
        open={createOpen}
        clientId={clientId}
        cases={cases}
        catalog={catalog}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => {
          setCreateOpen(false);
          onNotify("Vekaletname kaydedildi.", "success");
          await load();
        }}
      />

      <AnalyzePoaModal
        poa={analyzeFor}
        cases={cases}
        labelOfCode={labelOfCode}
        onClose={() => setAnalyzeFor(null)}
        onNotify={onNotify}
      />

      <RevokePoaModal
        poa={revokeFor}
        onClose={() => setRevokeFor(null)}
        onSaved={async () => {
          setRevokeFor(null);
          onNotify("Vekaletname pasife alındı.", "info");
          await load();
        }}
      />
    </div>
  );
}

// ---------- Satır ----------

function PoaRow({
  poa,
  labelOfCode,
  onAnalyze,
  onRevoke,
}: {
  poa: PoaItem;
  labelOfCode: (code: string) => string;
  onAnalyze: () => void;
  onRevoke: () => void;
}) {
  const state = poaStateOf(poa);
  const present = poa.scopeItems.filter((s) => s.present);
  const absent = poa.scopeItems.filter((s) => !s.present);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900">
              {poa.notary ?? "Noter belirtilmemiş"}
              {poa.number ? ` · Yevmiye ${poa.number}` : ""}
            </p>
            <Badge tone={state.tone}>{state.label}</Badge>
            {poa.type && <Badge tone="navy">{labelOf(POA_TYPE_LABELS, poa.type)}</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Düzenleme: {fmtDate(poa.issuedAt)} ·{" "}
            {poa.expiresAt ? `Geçerlilik: ${fmtDate(poa.expiresAt)}` : "Süresiz"}
            {poa.revokedAt ? ` · Azil/istifa: ${fmtDate(poa.revokedAt)}` : ""}
            {poa.case?.title ? ` · ${poa.case.title}` : ""}
          </p>
          {poa.revokeReason && (
            <p className="mt-1 text-xs text-red-700">Gerekçe: {poa.revokeReason}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onAnalyze}>
            Bu dava için yeterli mi?
          </Button>
          {state.key === "AKTIF" && (
            <Button size="sm" variant="ghost" onClick={onRevoke}>
              Azil / istifa
            </Button>
          )}
        </div>
      </div>

      {poa.scopeItems.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {present.map((s) => (
              <Badge key={s.code} tone="green">
                {s.label ?? labelOfCode(s.code)}
              </Badge>
            ))}
          </div>
          {absent.length > 0 && (
            <p className="text-[11px] leading-5 text-slate-500">
              <span className="font-medium text-slate-600">Bu vekaletnamede YOK:</span>{" "}
              {absent.map((s) => s.label ?? labelOfCode(s.code)).join(", ")}
            </p>
          )}
        </div>
      )}

      {poa.scope && (
        <Disclosure summary="Kapsam metni" className="mt-3">
          <p className="whitespace-pre-wrap text-xs leading-5 text-slate-600">{poa.scope}</p>
        </Disclosure>
      )}
    </li>
  );
}

// ---------- Yeni vekaletname ----------

function CreatePoaModal({
  open,
  clientId,
  cases,
  catalog,
  onClose,
  onSaved,
}: {
  open: boolean;
  clientId: string;
  cases: CaseSummary[];
  catalog: PoaScopeDefinition[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [type, setType] = useState<PoaType>("GENEL");
  const [notary, setNotary] = useState("");
  const [number, setNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState(toIsoDate(new Date()));
  const [expiresAt, setExpiresAt] = useState("");
  const [caseId, setCaseId] = useState("");
  const [scope, setScope] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** `DIGER` seçildiğinde sunucu açıklama ZORUNLU tutar. */
  const [otherNote, setOtherNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType("GENEL");
    setNotary("");
    setNumber("");
    setIssuedAt(toIsoDate(new Date()));
    setExpiresAt("");
    setCaseId("");
    setScope("");
    setChecked(new Set());
    setOtherNote("");
    setError(null);
  }, [open]);

  function toggle(code: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const special = catalog.filter((c) => c.requiresSpecialAuthority);
  const general = catalog.filter((c) => !c.requiresSpecialAuthority);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (checked.has("DIGER") && otherNote.trim().length < 3) {
      setError('"Diğer" yetkisi seçildiğinde açıklama girilmesi zorunludur.');
      return;
    }
    setBusy(true);
    setError(null);
    /**
     * Kapsam maddeleri TAM KATALOGLA yazılır: işaretlenmeyen madde
     * `present: false` olarak kaydedilir. "Kayıtta yok" ile "vekaletnamede yok"
     * farkı böyle korunur — kapsam analizi eksik yetkiyi ancak bu ayrımla
     * gerekçelendirebilir.
     */
    const scopeItems: PoaScopeItem[] = catalog.map((c) => ({
      code: c.code,
      present: checked.has(c.code),
      ...(c.code === "DIGER" && checked.has("DIGER") ? { note: otherNote.trim() } : {}),
    }));
    try {
      await createPoa({
        clientId,
        caseId: caseId || null,
        type,
        notary: notary.trim(),
        number: number.trim(),
        issuedAt,
        expiresAt: expiresAt || null,
        scope: scope.trim(),
        scopeItems,
      });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Vekaletname kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Yeni Vekaletname" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vekaletname türü">
            <Select value={type} onChange={(e) => setType(e.target.value as PoaType)}>
              {POA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(POA_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Dosya (isteğe bağlı)"
            hint="Boş bırakılırsa müvekkilin tüm dosyalarında geçerli sayılır."
          >
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">(dosyaya bağlama)</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Noter">
            <Input
              value={notary}
              onChange={(e) => setNotary(e.target.value)}
              placeholder="Örn. Beyoğlu 14. Noterliği"
            />
          </Field>
          <Field label="Yevmiye numarası">
            <Input value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Düzenleme tarihi">
            <Input
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              required
            />
          </Field>
          <Field label="Geçerlilik bitişi" hint="Boş = süresiz">
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>

        {catalog.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            Yetki kataloğu yüklenemedi. Vekaletnameyi kaydedebilirsiniz; özel yetkileri katalog
            geldiğinde işaretleyin.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-slate-600">
                Özel yetkiler — vekaletnamede AÇIKÇA yazan maddeleri işaretleyin
              </p>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                Bu yetkiler açıkça verilmedikçe kullanılamaz. İşaretlenmeyen madde
                &quot;vekaletnamede yok&quot; olarak kaydedilir ve kapsam analizi eksik yetkileri
                buna göre gerekçelendirir.
              </p>
              <div className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {special.map((c) => (
                  <ScopeCheckbox
                    key={c.code}
                    def={c}
                    checked={checked.has(c.code)}
                    onToggle={() => toggle(c.code)}
                  />
                ))}
              </div>
            </div>

            {general.length > 0 && (
              <Disclosure summary={`Genel vekalet kapsamındaki yetkiler (${general.length})`}>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {general.map((c) => (
                    <ScopeCheckbox
                      key={c.code}
                      def={c}
                      checked={checked.has(c.code)}
                      onToggle={() => toggle(c.code)}
                    />
                  ))}
                </div>
              </Disclosure>
            )}

            {checked.has("DIGER") && (
              <Field label="“Diğer” yetkisinin açıklaması" hint="Sunucu bu alanı zorunlu tutar.">
                <Input
                  value={otherNote}
                  onChange={(e) => setOtherNote(e.target.value)}
                  placeholder="Vekaletnamede geçen özel yetkiyi yazın"
                />
              </Field>
            )}
          </div>
        )}

        <Field
          label="Kapsam metni"
          hint="Vekaletnamenin metni (OCR ya da elle). Kapsam analizinin GİRDİSİDİR — alıntılar buradan çıkar."
        >
          <Textarea rows={4} value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>

        {error && <ErrorBox message={error} />}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ScopeCheckbox({
  def,
  checked,
  onToggle,
}: {
  def: PoaScopeDefinition;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className="flex items-start gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      title={def.description ?? undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
      />
      <span className="min-w-0">
        {def.label}
        {def.legalBasis && (
          <span className="ml-1 text-[10px] text-slate-400">({def.legalBasis})</span>
        )}
      </span>
    </label>
  );
}

// ---------- Kapsam analizi ----------

function AnalyzePoaModal({
  poa,
  cases,
  labelOfCode,
  onClose,
  onNotify,
}: {
  poa: PoaItem | null;
  cases: CaseSummary[];
  labelOfCode: (code: string) => string;
  onClose: () => void;
  onNotify: Notify;
}) {
  const { costs } = useCreditCosts();
  const [caseId, setCaseId] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<PoaScopeCheckResult | null>(null);

  useEffect(() => {
    if (!poa) return;
    setCaseId(poa.caseId ?? (cases.length === 1 ? cases[0].id : ""));
    setQuestion("");
    setResult(null);
  }, [poa, cases]);

  const ai = useAiCall(
    useCallback(
      (piiApproved: boolean) => {
        if (!poa) return Promise.reject(new Error("Vekaletname seçilmedi."));
        if (!caseId) return Promise.reject(new Error("Analiz için bir dosya seçin."));
        return analyzePoaScope(poa.id, { caseId, question }, piiApproved);
      },
      [caseId, poa, question],
    ),
    "Kapsam analizi yapılamadı.",
  );

  async function run(withPii = false) {
    const res = withPii ? await ai.approvePii() : await ai.run();
    if (res) {
      setResult(res);
      onNotify("Kapsam analizi tamamlandı — sonuç bir öneridir.", "info");
    }
  }

  return (
    <Modal open={Boolean(poa)} wide title="Vekaletname kapsam analizi" onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          Seçtiğiniz dosyanın türü ve talepleri, vekaletnamedeki özel yetkilerle karşılaştırılır.
          Sonuç bir <strong>öneridir</strong>; kapsam maddelerini değiştirmez.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dosya">
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Seçiniz…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Özel soru (isteğe bağlı)">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Örn. sulh teklifini kabul edebilir miyim?"
            />
          </Field>
        </div>

        <Button variant="gold" disabled={ai.busy || !caseId} onClick={() => void run()}>
          {ai.busy ? "Analiz ediliyor…" : "Yeterlilik analizi çalıştır"}
          <CreditBadge taskType="POA_SCOPE_ANALYSIS" costs={costs} />
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

        {result && <ScopeCheckCard result={result} poa={poa} labelOfCode={labelOfCode} />}

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Analiz sonucu kartı.
 *
 * "AVUKAT TEYİDİ GEREKİR" şeridi kartın ALTINDA DEĞİL ÜSTÜNDEDİR: YETERSİZ
 * kararını okuyan bir avukatın gözü sonuca takılıp uyarıyı atlamasın.
 */
function ScopeCheckCard({
  result,
  poa,
  labelOfCode,
}: {
  result: PoaScopeCheckResult;
  poa: PoaItem | null;
  labelOfCode: (code: string) => string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <AiDisclaimer text="Bu bir HUKUKİ DEĞERLENDİRME ÖNERİSİDİR, kesin görüş değildir. Vekaletname metnini kendiniz okuyup teyit etmeden usul işlemi yapmayın." />
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            {POA_VERDICT_DOTS[result.verdict] ?? "⚪"}
          </span>
          <Badge tone={POA_VERDICT_TONES[result.verdict] ?? "gray"}>
            {labelOf(POA_VERDICT_LABELS, result.verdict)}
          </Badge>
          {result.checkedAt && (
            <span className="text-[11px] text-slate-400">{fmtDateTime(result.checkedAt)}</span>
          )}
          {result.model && <span className="text-[11px] text-slate-400">Model: {result.model}</span>}
        </div>

        {/*
          KARARIN NEDEN DÜŞÜRÜLDÜĞÜ — rozetin HEMEN YANINDA.
          Sunucu, doğrulanmış bulgu kalmadığında ya da iç tutarsızlıkta modelin
          "YETERLI" kararını zorla BELIRSIZ'e çeker. Bu gerekçe kayda yazılıyor
          ama ekrana hiç taşınmıyordu: avukat BELIRSIZ rozetinin altında
          "yeterli görünmektedir" diyen bir değerlendirme okuyordu.
        */}
        {result.verdictDowngradeNote && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
              Sistem kararı düşürdü
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              {result.verdictDowngradeNote}
            </p>
          </div>
        )}

        {result.question && (
          <p className="mt-3 text-xs text-slate-500">
            Sorulan: <span className="text-slate-700">{result.question}</span>
          </p>
        )}

        {result.missingPowers.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Eksik bulunan yetkiler
            </p>
            <ul className="mt-2 space-y-2">
              {result.missingPowers.map((m, i) => (
                <li
                  key={`${m.code}-${i}`}
                  className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2"
                >
                  <p className="text-sm font-medium text-red-900">
                    {m.label ?? labelOfCode(m.code)}
                  </p>
                  {m.why && <p className="mt-1 text-xs leading-5 text-red-800">{m.why}</p>}
                  {m.quote && (
                    <SourceQuote
                      quote={m.quote}
                      source={poa?.notary ? `${poa.notary} vekaletnamesi` : "Vekaletname metni"}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
            Analiz eksik yetki bildirmedi. Yine de dosyada yapacağınız işlemin özel yetki
            gerektirip gerektirmediğini kendiniz teyit edin.
          </p>
        )}

        {result.aiCommentary && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Değerlendirme
            </p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {result.aiCommentary}
            </p>
          </div>
        )}

        {result.quotes.length > 0 && (
          <Disclosure
            summary={`Vekaletname metninden alıntılar (${result.quotes.length})`}
            className="mt-4"
          >
            <div className="space-y-2">
              {result.quotes.map((q, i) => (
                <SourceQuote key={i} quote={q} source="Vekaletname metni" />
              ))}
            </div>
          </Disclosure>
        )}

        {/*
          ELENEN BULGULAR — "sessiz eleme yok" vaadinin arayüzdeki karşılığı.
          Sunucu, alıntısı metinde birebir bulunamayan bulguları atar; kaç
          bulgunun ve neden elendiği görünmezse avukat, gördüğü listenin modelin
          söylediğinin tamamı olduğunu sanır.
        */}
        {result.droppedQuotes.length > 0 && (
          <Disclosure
            summary={`Doğrulanamadığı için elenen bulgular (${result.droppedQuotes.length})`}
            className="mt-3"
          >
            <ul className="space-y-2">
              {result.droppedQuotes.map((d, i) => (
                <li
                  key={`${d.label}-${i}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="text-xs font-medium text-slate-700">{d.label}</p>
                  {d.reasonLabel && (
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{d.reasonLabel}</p>
                  )}
                  {d.quote && (
                    <p className="mt-1 text-[11px] italic leading-5 text-slate-400">
                      Modelin verdiği alıntı: “{d.quote}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

// ---------- Azil / istifa ----------

function RevokePoaModal({
  poa,
  onClose,
  onSaved,
}: {
  poa: PoaItem | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [kind, setKind] = useState<(typeof POA_TERMINATION_TYPES)[number]>("AZIL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!poa) return;
    setReason("");
    setDate(toIsoDate(new Date()));
    setKind("AZIL");
    setError(null);
  }, [poa]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!poa) return;
    setBusy(true);
    setError(null);
    try {
      await revokePoa(poa.id, { reason, revokedAt: date, terminationType: kind });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Vekaletname pasife alınamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(poa)} title="Azil / istifa kaydı" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Bu kayıt vekaletnameyi PASİFE alır ve geri alınamaz bir hukuki sonuç doğurur. Müvekkilin
          portal erişimini de gözden geçirin: vekalet ilişkisi biten müvekkile dosya açık
          kalmamalıdır.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sonlanma türü">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof POA_TERMINATION_TYPES)[number])}
            >
              {POA_TERMINATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(POA_TERMINATION_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tebliğ / karar tarihi">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Gerekçe">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Azil bildirimi, istifa dilekçesi, süre dolumu…"
            required
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Pasife al"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
