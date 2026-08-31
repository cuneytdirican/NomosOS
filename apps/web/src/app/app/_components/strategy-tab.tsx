"use client";

/**
 * Dosya detayı → STRATEJİ sekmesi (Modül 15).
 *
 * Zincir DİKEY akar ve dokuz halkadan oluşur:
 *   karşı argümanlar → bizim argümanlarımız → deliller → hukuki dayanak →
 *   zayıf noktalar → karşı cevaplar → alternatif senaryolar → risk notları →
 *   GENEL RİSK SKORU.
 *
 * İlk sekiz halka `StrategyNodeType` enum'unun sekiz değeridir. DOKUZUNCU HALKA
 * BİR DÜĞÜM TİPİ DEĞİLDİR: risk skoru Risk Motoru'nun deterministik çıktısıdır
 * ve iş kuralı gereği strateji üzerinden elle değiştirilemez (Modül 15, kural 6).
 * Bu yüzden son halka salt okunur bir özet olarak risk kartından okunur.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "@/components/ui";
import { AiDisclaimer, FeatureUnavailable, PiiApprovalBox } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  RISK_BAND_DOTS,
  RISK_BAND_LABELS,
  RISK_BAND_TONES,
  STRATEGY_CHAIN,
  STRATEGY_NODE_TYPES,
  STRATEGY_NODE_TYPE_LABELS,
  STRATEGY_STATUS_LABELS,
  STRATEGY_STATUS_TONES,
  fmtDateTime,
  labelOf,
  riskBandOf,
  strengthLabel,
  strengthTone,
} from "@/lib/labels";
import {
  buildStrategy,
  createStrategyNode,
  deleteStrategyNode,
  findScore,
  getCaseRisk,
  getStrategy,
  listStrategyVersions,
  strategyNodesOf,
  updateStrategyNode,
} from "../_lib/faz4";
import type { RiskScore, Strategy, StrategyNode, StrategyVersion } from "../_lib/faz4-types";
import { useAiCall } from "../_lib/use-ai-call";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

const STRENGTHS = ["", "DUSUK", "ORTA", "YUKSEK"] as const;

export function StrategyTab({
  caseId,
  onNotify,
  onGoToRisk,
}: {
  caseId: string;
  onNotify: Notify;
  /** Dokuzuncu halkadan risk sekmesine geçiş. */
  onGoToRisk?: () => void;
}) {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [versions, setVersions] = useState<StrategyVersion[]>([]);
  const [overall, setOverall] = useState<RiskScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nodeModal, setNodeModal] = useState<{ nodeType: string } | null>(null);
  const [editNode, setEditNode] = useState<StrategyNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      const s = await getStrategy(caseId);
      setStrategy(s);
      if (s?.id) {
        listStrategyVersions(s.id)
          .then(setVersions)
          .catch(() => setVersions(s.versions ?? []));
      } else {
        setVersions([]);
      }
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(errText(err, "Strateji yüklenemedi."));
      setStrategy(null);
    } finally {
      setLoading(false);
    }

    // Dokuzuncu halka: risk kartı okunamazsa halka "hesaplanmadı" der, ekran çalışır.
    getCaseRisk(caseId)
      .then((risk) => setOverall(findScore(risk, "GENEL")))
      .catch(() => setOverall(null));
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildFn = useCallback((piiApproved: boolean) => buildStrategy(caseId, undefined, piiApproved), [caseId]);
  const buildAi = useAiCall<Strategy>(buildFn, "Strateji üretilemedi.");

  const nodes = useMemo(() => strategyNodesOf(strategy), [strategy]);
  const byType = useMemo(() => {
    const map = new Map<string, StrategyNode[]>();
    for (const n of nodes) {
      const key = String(n.nodeType);
      const bucket = map.get(key);
      if (bucket) bucket.push(n);
      else map.set(key, [n]);
    }
    return map;
  }, [nodes]);

  async function runBuild() {
    const res = await buildAi.run();
    if (res) {
      onNotify("Strateji taslağı üretildi. Düğümler ÖNERİ statüsündedir.", "success");
      await load();
    }
  }

  async function approveBuildPii() {
    const res = await buildAi.approvePii();
    if (res) {
      onNotify("Strateji taslağı üretildi.", "success");
      await load();
    }
  }

  async function removeNode(node: StrategyNode) {
    if (!strategy?.id) return;
    if (!window.confirm("Düğüm ve varsa alt düğümleri silinsin mi?")) return;
    try {
      await deleteStrategyNode(strategy.id, node.id);
      onNotify("Düğüm silindi.", "info");
      await load();
    } catch (err) {
      onNotify(errText(err, "Düğüm silinemedi."), "error");
    }
  }

  if (loading) return <Spinner label="Strateji yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Strateji motoru henüz hazır değil"
        detail="Strateji uçları yayına alındığında bu ekran otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {/* Üst şerit */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            {strategy?.title ?? "Strateji henüz oluşturulmadı"}
            {strategy && (
              <Badge tone={STRATEGY_STATUS_TONES[String(strategy.status)] ?? "gray"}>
                {labelOf(STRATEGY_STATUS_LABELS, String(strategy.status))}
              </Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {strategy?.currentVersion
              ? `v${strategy.currentVersion.versionNo} · ${fmtDateTime(strategy.currentVersion.createdAt)}`
              : "Sürüm yok"}
            {nodes.length > 0 ? ` · ${nodes.length} düğüm` : ""}
          </p>
        </div>
        <Button variant="gold" disabled={buildAi.busy} onClick={() => void runBuild()}>
          {buildAi.busy
            ? "Üretiliyor…"
            : strategy
              ? "AI ile stratejiyi yenile"
              : "AI ile strateji üret"}
        </Button>
      </div>

      {buildAi.pii && (
        <PiiApprovalBox
          prompt={buildAi.pii}
          busy={buildAi.busy}
          onApprove={() => void approveBuildPii()}
          onCancel={buildAi.cancelPii}
        />
      )}
      {buildAi.missing && <FeatureUnavailable detail="Strateji üretim ucu henüz yayında değil." />}
      {buildAi.error && !buildAi.missing && <ErrorBox message={buildAi.error} />}

      {/* BAYAT uyarı şeridi */}
      {strategy?.status === "BAYAT" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">
            Dosyada yeni gelişme var — stratejiyi yenileyin
          </p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            {strategy.staleReason ??
              "Dosyaya strateji üretildikten sonra yeni bir dilekçe, karar veya bilirkişi raporu eklendi. Mevcut zincir bu gelişmeyi henüz içermiyor."}
          </p>
          <Button
            size="sm"
            variant="gold"
            className="mt-3"
            disabled={buildAi.busy}
            onClick={() => void runBuild()}
          >
            Stratejiyi yenile
          </Button>
        </div>
      )}

      {strategy && (
        <AiDisclaimer text="Strateji düğümleri AI ÖNERİSİ olarak doğar. Onaylanmamış düğümler dilekçeye aktarılmaz; içtihat atıfları teyit edilmeden kullanılamaz." />
      )}

      {/* ---------- 9 halkalı zincir ---------- */}
      <ol className="space-y-3">
        {STRATEGY_CHAIN.map((ring, index) => {
          const isRiskRing = ring.key === "__RISK_SKORU";
          const ringNodes = isRiskRing ? [] : (byType.get(ring.key) ?? []);
          return (
            <li key={ring.key} className="relative">
              {/* Halkalar arası akış oku */}
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-3 left-6 h-3 w-px bg-slate-300"
                />
              )}
              <section
                className={`rounded-xl border bg-white shadow-sm ${
                  isRiskRing ? "border-slate-900" : "border-slate-200"
                }`}
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                  <h3 className="flex items-center gap-3 text-sm font-semibold text-slate-900">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isRiskRing ? "bg-slate-900 text-amber-400" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {index + 1}
                    </span>
                    {ring.label}
                    {!isRiskRing && ringNodes.length > 0 && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                        {ringNodes.length}
                      </span>
                    )}
                  </h3>
                  {!isRiskRing && strategy && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setNodeModal({ nodeType: ring.key })}
                    >
                      + Düğüm
                    </Button>
                  )}
                </header>

                <div className="px-5 py-4">
                  {isRiskRing ? (
                    <RiskRing score={overall} onGoToRisk={onGoToRisk} />
                  ) : ringNodes.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Bu halkada düğüm yok
                      {strategy ? " — veri yetersiz ya da henüz girilmedi." : "."}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {ringNodes.map((n) => (
                        <li
                          key={n.id}
                          className="rounded-lg border border-slate-200 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="whitespace-pre-wrap text-sm text-slate-800">
                                {n.content}
                              </p>
                              {n.sourceRef && (
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Dayanak / kaynak: {n.sourceRef}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {n.strength !== null && n.strength !== undefined && n.strength !== "" && (
                                <Badge tone={strengthTone(n.strength)}>
                                  {strengthLabel(n.strength)}
                                </Badge>
                              )}
                              {strategy && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditNode(n)}
                                  >
                                    Düzenle
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void removeNode(n)}
                                  >
                                    Sil
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </li>
          );
        })}
      </ol>

      {/* ---------- Versiyon geçmişi ---------- */}
      <Card title={`Versiyon Geçmişi (${versions.length})`}>
        {versions.length === 0 ? (
          <EmptyState message="Kayıtlı strateji versiyonu yok. Versiyonlar silinemez; her yenileme yeni bir versiyon üretir." />
        ) : (
          <ul className="space-y-2">
            {[...versions]
              .sort((a, b) => b.versionNo - a.versionNo)
              .map((v) => (
                <li key={v.id}>
                  <Disclosure
                    summary={
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={v.id === strategy?.currentVersionId ? "green" : "gray"}>
                          v{v.versionNo}
                        </Badge>
                        <span className="text-slate-600">{fmtDateTime(v.createdAt)}</span>
                        {v.model && <span className="text-slate-500">· {v.model}</span>}
                      </span>
                    }
                  >
                    <p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">
                      {v.summary ?? "Bu versiyon için değişiklik özeti yok."}
                    </p>
                  </Disclosure>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {strategy && (
        <NodeModal
          open={nodeModal !== null || editNode !== null}
          strategyId={strategy.id}
          node={editNode}
          defaultType={nodeModal?.nodeType ?? "BIZIM_ARGUMAN"}
          onClose={() => {
            setNodeModal(null);
            setEditNode(null);
          }}
          onSaved={async () => {
            setNodeModal(null);
            setEditNode(null);
            onNotify("Strateji düğümü kaydedildi.", "success");
            await load();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ risk halkası

function RiskRing({
  score,
  onGoToRisk,
}: {
  score: RiskScore | null;
  onGoToRisk?: () => void;
}) {
  if (!score) {
    return (
      <p className="text-xs text-slate-500">
        Genel risk skoru henüz hesaplanmadı. Risk sekmesinden yeniden hesaplatabilirsiniz.
      </p>
    );
  }
  const band = String(score.band ?? riskBandOf(score.score));
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{RISK_BAND_DOTS[band] ?? "⚪"}</span>
        <div>
          <p className="text-2xl font-bold leading-none text-slate-900">{score.score}</p>
          <p className="mt-1 text-xs text-slate-500">
            <Badge tone={RISK_BAND_TONES[band] ?? "gray"}>
              {labelOf(RISK_BAND_LABELS, band)} risk
            </Badge>
          </p>
        </div>
      </div>
      <p className="max-w-md text-[11px] leading-5 text-slate-500">
        Skor Risk Motoru&apos;nun deterministik çıktısıdır ve strateji üzerinden
        değiştirilemez. Gerekçeleri ve elle düzeltmeyi Risk sekmesinde bulursunuz.
      </p>
      {onGoToRisk && (
        <Button size="sm" variant="secondary" onClick={onGoToRisk}>
          Risk kartına git →
        </Button>
      )}
    </div>
  );
}

// -------------------------------------------------------------- düğüm modalı

function NodeModal({
  open,
  strategyId,
  node,
  defaultType,
  onClose,
  onSaved,
}: {
  open: boolean;
  strategyId: string;
  node: StrategyNode | null;
  defaultType: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [nodeType, setNodeType] = useState(defaultType);
  const [content, setContent] = useState("");
  const [strength, setStrength] = useState<string>("");
  const [sourceRef, setSourceRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNodeType(node ? String(node.nodeType) : defaultType);
    setContent(node?.content ?? "");
    setStrength(typeof node?.strength === "string" ? node.strength : "");
    setSourceRef(node?.sourceRef ?? "");
    setError(null);
  }, [open, node, defaultType]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (node) {
        await updateStrategyNode(strategyId, node.id, {
          content: content.trim(),
          strength: strength || null,
          sourceRef: sourceRef.trim() || null,
        });
      } else {
        await createStrategyNode(strategyId, {
          nodeType,
          content: content.trim(),
          strength: strength || undefined,
          sourceRef: sourceRef.trim() || undefined,
        });
      }
      await onSaved();
    } catch (err) {
      setError(errText(err, "Düğüm kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={node ? "Düğümü Düzenle" : "Strateji Düğümü Ekle"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Halka">
          <Select
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value)}
            disabled={Boolean(node)}
          >
            {STRATEGY_NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelOf(STRATEGY_NODE_TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="İçerik">
          <Textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Argümanı, delili ya da senaryoyu tek paragrafta yazın."
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Güç">
            <Select value={strength} onChange={(e) => setStrength(e.target.value)}>
              {STRENGTHS.map((s) => (
                <option key={s || "yok"} value={s}>
                  {s ? strengthLabel(s) : "Belirtilmedi"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dayanak / kaynak" hint="Madde, içtihat künyesi veya belge adı.">
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || !content.trim()}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
