"use client";

/**
 * Dosya detayı → DELİLLER sekmesi (Modül 14).
 *
 * İçerik:
 *  - iddia ↔ delil matrisi (satır = iddia, sütun = delil; hücre = bağ + güç),
 *  - iddia / delil ekleme ve bağ kurma-kaldırma,
 *  - hukuki dayanak ekleme,
 *  - "AI ile matris öner" (EVIDENCE_MATRIX) ve "Eksik delil analizi"
 *    (EVIDENCE_GAP) — her ikisi de ÖNERİDİR ve TEK TEK eklenir.
 *
 * ÜRÜN İLKESİ: hiçbir AI çıktısı doğrudan kayda dönüşmez. Öneri kartındaki
 * "Ekle" düğmesi avukatın açık eylemidir; toplu uygulama düğmesi BİLEREK YOKTUR
 * (tek tıkla onaylanan yığın, onay olmaktan çıkar).
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
import { AiDisclaimer, FeatureUnavailable, PiiApprovalBox, SourceQuote } from "@/components/ai-ui";
import { errText, isFeatureMissing } from "@/lib/faz2";
import {
  CLAIM_SIDES,
  CLAIM_SIDE_LABELS,
  CLAIM_SIDE_TONES,
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_TONES,
  EVIDENCE_STATUSES,
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_STATUS_TONES,
  EVIDENCE_TYPES,
  EVIDENCE_TYPE_ICONS,
  EVIDENCE_TYPE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  fmtDate,
  labelOf,
  strengthLabel,
  strengthTone,
} from "@/lib/labels";
import {
  addLegalBasis,
  aiEvidenceGaps,
  aiEvidenceMatrix,
  buildMatrix,
  createClaim,
  createEvidence,
  linkClaimEvidence,
  listClaims,
  listEvidence,
  unlinkClaimEvidence,
  updateClaim,
} from "../_lib/faz4";
import type { Claim, Evidence, EvidenceSuggestion } from "../_lib/faz4-types";
import { useAiCall } from "../_lib/use-ai-call";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

/** Bağ yönünün hücre/ipucu etiketi (F2 · E6). */
const LINK_TYPE_LABELS: Record<string, string> = {
  SUPPORTS: "Destekliyor",
  CONTRADICTS: "Çürütüyor",
  BELIRSIZ: "Yön belirsiz",
};

/** Delili KİM sundu (F2 · E6 / KK6) — envanter sütunu etiketleri. */
const EVIDENCE_SIDE_LABELS: Record<string, string> = {
  BIZ: "Biz",
  KARSI_TARAF: "Karşı taraf",
  ORTAK: "Mahkeme/Ortak",
};

const EVIDENCE_SIDE_TONES: Record<string, "blue" | "red" | "gray"> = {
  BIZ: "blue",
  KARSI_TARAF: "red",
  ORTAK: "gray",
};

export function EvidenceTab({ caseId, onNotify }: { caseId: string; onNotify: Notify }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [claimModal, setClaimModal] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ claimId: string; evidenceId: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    const [claimsRes, evidenceRes] = await Promise.allSettled([
      listClaims(caseId),
      listEvidence(caseId),
    ]);

    if (claimsRes.status === "rejected" && evidenceRes.status === "rejected") {
      if (isFeatureMissing(claimsRes.reason)) setMissing(true);
      else setError(errText(claimsRes.reason, "Delil verisi yüklenemedi."));
      setClaims([]);
      setEvidences([]);
      setLoading(false);
      return;
    }

    setClaims(claimsRes.status === "fulfilled" ? claimsRes.value : []);
    setEvidences(evidenceRes.status === "fulfilled" ? evidenceRes.value : []);
    if (claimsRes.status === "rejected") {
      setError(errText(claimsRes.reason, "İddia listesi yüklenemedi."));
    } else if (evidenceRes.status === "rejected") {
      setError(errText(evidenceRes.reason, "Delil listesi yüklenemedi."));
    }
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const matrix = useMemo(() => buildMatrix(claims, evidences), [claims, evidences]);

  // ---- AI: matris önerisi
  const matrixFn = useCallback(
    (piiApproved: boolean) => aiEvidenceMatrix(caseId, piiApproved),
    [caseId],
  );
  const matrixAi = useAiCall<EvidenceSuggestion[]>(matrixFn, "Matris önerisi üretilemedi.");

  // ---- AI: eksik delil analizi
  const gapFn = useCallback(
    (piiApproved: boolean) => aiEvidenceGaps(caseId, piiApproved),
    [caseId],
  );
  const gapAi = useAiCall(gapFn, "Eksik delil analizi yapılamadı.");

  async function toggleLink(claimId: string, evidenceId: string) {
    const link = matrix.linkIndex.get(`${claimId}::${evidenceId}`);
    if (!link) {
      setLinkTarget({ claimId, evidenceId });
      return;
    }
    if (!window.confirm("İddia ile delil arasındaki bağ kaldırılsın mı?")) return;
    try {
      // Silme ucu evidenceId ile adreslenir (DELETE /claims/:id/evidence/:evidenceId).
      await unlinkClaimEvidence(claimId, evidenceId);
      onNotify("Bağ kaldırıldı.", "info");
      await load();
    } catch (err) {
      onNotify(errText(err, "Bağ kaldırılamadı."), "error");
    }
  }

  async function addSuggestion(s: EvidenceSuggestion, index: number) {
    try {
      if (s.claimId && s.evidenceId) {
        await linkClaimEvidence(s.claimId, {
          evidenceId: s.evidenceId,
          // Sunucu şeması 1-5 tamsayı ister (z.number().int()); öneri metni
          // değil sayı taşınır.
          strength: typeof s.strength === "number" ? s.strength : undefined,
          note: s.reason ?? undefined,
        });
        onNotify("İddia–delil bağı kuruldu.", "success");
      } else if (s.claimId && s.reference) {
        await addLegalBasis(s.claimId, { reference: s.reference, note: s.reason ?? undefined });
        onNotify("Hukuki dayanak eklendi.", "success");
      } else if (s.evidenceTitle) {
        await createEvidence(caseId, {
          type: String(s.evidenceType ?? "DIGER"),
          title: s.evidenceTitle,
          description: s.reason ?? undefined,
        });
        onNotify("Delil kaydı oluşturuldu.", "success");
      } else if (s.claimText) {
        await createClaim(caseId, { side: String(s.side ?? "BIZ"), text: s.claimText });
        onNotify("İddia kaydı oluşturuldu.", "success");
      } else {
        onNotify("Bu öneri eksik geldiği için eklenemedi.", "error");
        return;
      }
      // Eklenen öneri listeden düşer; kalanlar avukatın kararını beklemeye devam eder.
      matrixAi.setData((matrixAi.data ?? []).filter((_, i) => i !== index));
      await load();
    } catch (err) {
      onNotify(errText(err, "Öneri eklenemedi."), "error");
    }
  }

  if (loading) return <Spinner label="Delil matrisi yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Delil yönetimi henüz hazır değil"
        detail="İddia ve delil uçları yayına alındığında bu ekran otomatik olarak çalışacak."
        onRetry={() => void load()}
      />
    );
  }

  const suggestions = matrixAi.data ?? [];
  const gaps = gapAi.data ?? [];

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {/* Aksiyon şeridi */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <p className="max-w-xl text-xs leading-5 text-slate-600">
          İspat haritası: hangi iddiamızı hangi delil destekliyor? Matris avukat onaylı
          veridir; AI yalnızca <strong>öneri</strong> üretir.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setClaimModal(true)}>
            + İddia
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEvidenceModal(true)}>
            + Delil
          </Button>
          <Button size="sm" variant="gold" disabled={matrixAi.busy} onClick={() => void matrixAi.run()}>
            {matrixAi.busy ? "Üretiliyor…" : "AI ile matris öner"}
          </Button>
          <Button size="sm" disabled={gapAi.busy} onClick={() => void gapAi.run()}>
            {gapAi.busy ? "Analiz ediliyor…" : "Eksik delil analizi"}
          </Button>
        </div>
      </div>

      {/* ---------- Matris ---------- */}
      <Card title={`İspat Matrisi (${claims.length} iddia · ${evidences.length} delil)`}>
        {claims.length === 0 ? (
          <EmptyState message="Henüz iddia kaydı yok. Önce dosyanın iddialarını (vakıa ve talepler) girin." />
        ) : evidences.length === 0 ? (
          <EmptyState message="Henüz delil kaydı yok. Delil ekledikçe matris sütunları oluşur." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[16rem] border-b border-slate-200 bg-white py-2 pr-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                    İddia
                  </th>
                  {evidences.map((e) => (
                    <th
                      key={e.id}
                      className="border-b border-slate-200 px-2 py-2 align-bottom text-[11px] font-medium text-slate-500"
                      title={`${labelOf(EVIDENCE_TYPE_LABELS, e.type)} · ${e.title}`}
                    >
                      <span className="block text-base leading-none">
                        {EVIDENCE_TYPE_ICONS[e.type] ?? "📎"}
                      </span>
                      <span className="mt-1 block max-w-[7rem] truncate">{e.title}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.claims.map((c) => {
                  const linkCount = evidences.filter((e) =>
                    matrix.linkIndex.has(`${c.id}::${e.id}`),
                  ).length;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-white py-3 pr-4 align-top">
                        <p className="text-sm text-slate-900">{c.text}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={CLAIM_SIDE_TONES[c.side] ?? "gray"}>
                            {labelOf(CLAIM_SIDE_LABELS, c.side)}
                          </Badge>
                          <Badge tone={CLAIM_STATUS_TONES[c.status] ?? "gray"}>
                            {labelOf(CLAIM_STATUS_LABELS, c.status)}
                          </Badge>
                          {linkCount === 0 && <Badge tone="danger">Delilsiz</Badge>}
                        </div>
                      </td>
                      {evidences.map((e) => {
                        const link = matrix.linkIndex.get(`${c.id}::${e.id}`);
                        const label = strengthLabel(link?.strength ?? null);
                        // YÖN göstergesi (F2 · E6): çürütme desteğe katılmaz,
                        // hücrede ayrı işaretle görünür.
                        const direction = link?.linkType ?? "SUPPORTS";
                        return (
                          <td
                            key={e.id}
                            className="border-b border-slate-100 px-2 py-3 text-center align-middle"
                          >
                            <button
                              type="button"
                              onClick={() => void toggleLink(c.id, e.id)}
                              title={
                                link
                                  ? `${LINK_TYPE_LABELS[direction] ?? direction}${label ? ` · ${label}` : ""}${link.note ? ` · ${link.note}` : ""} — kaldırmak için tıklayın`
                                  : "Bağ kurmak için tıklayın"
                              }
                              aria-label={
                                link
                                  ? `${c.text} iddiası ile ${e.title} delili arasındaki bağı kaldır`
                                  : `${c.text} iddiasına ${e.title} delilini bağla`
                              }
                              className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors ${
                                link
                                  ? direction === "CONTRADICTS"
                                    ? "border-transparent bg-red-600 text-white"
                                    : direction === "BELIRSIZ"
                                      ? "border-transparent bg-slate-500 text-white"
                                      : "border-transparent text-white"
                                  : "border-dashed border-slate-300 text-slate-300 hover:border-slate-500 hover:text-slate-500"
                              }`}
                              style={
                                link && direction === "SUPPORTS"
                                  ? { backgroundColor: strengthColor(link.strength) }
                                  : undefined
                              }
                            >
                              {link
                                ? direction === "CONTRADICTS"
                                  ? "✕"
                                  : direction === "BELIRSIZ"
                                    ? "?"
                                    : strengthMark(link.strength)
                                : "+"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-slate-500">
              Hücreye tıklayarak bağ kurun veya kaldırın. Renk bağın gücünü gösterir:
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" /> güçlü
              </span>
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> orta
              </span>
              <span className="ml-2 inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" /> zayıf /
                belirtilmemiş
              </span>
            </p>
          </div>
        )}
      </Card>

      {/* ---------- AI matris önerisi ---------- */}
      {(matrixAi.pii || matrixAi.error || matrixAi.missing || suggestions.length > 0) && (
        <Card title="AI Matris Önerileri">
          {matrixAi.pii ? (
            <PiiApprovalBox
              prompt={matrixAi.pii}
              busy={matrixAi.busy}
              onApprove={() => void matrixAi.approvePii()}
              onCancel={matrixAi.cancelPii}
            />
          ) : matrixAi.missing ? (
            <FeatureUnavailable detail="Matris önerisi ucu henüz yayında değil." />
          ) : matrixAi.error ? (
            <ErrorBox message={matrixAi.error} />
          ) : (
            <div className="space-y-3">
              <AiDisclaimer text="Bu öneriler kayda GEÇMEZ. Her satırı ayrı ayrı inceleyip eklemeniz gerekir; toplu uygulama yoktur." />
              {suggestions.length === 0 ? (
                <EmptyState message="AI ek bir iddia veya bağ önermedi." />
              ) : (
                <ul className="space-y-3">
                  {suggestions.map((s, i) => (
                    <li
                      key={s.id ?? `oneri-${i}`}
                      className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {s.claimText ?? s.evidenceTitle ?? s.reference ?? "Öneri"}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            {suggestionKindLabel(s)}
                          </p>
                          {s.reason && (
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              <strong>Gerekçe:</strong> {s.reason}
                            </p>
                          )}
                          {(s.sourceRefs ?? []).map((r, ri) => (
                            <SourceQuote
                              key={ri}
                              quote={r.quote}
                              source={r.documentName ?? r.locator ?? r.label}
                            />
                          ))}
                        </div>
                        <Button size="sm" variant="gold" onClick={() => void addSuggestion(s, i)}>
                          Ekle
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ---------- Eksik delil analizi ---------- */}
      {(gapAi.pii || gapAi.error || gapAi.missing || gaps.length > 0) && (
        <Card title="Eksik Delil Analizi">
          {gapAi.pii ? (
            <PiiApprovalBox
              prompt={gapAi.pii}
              busy={gapAi.busy}
              onApprove={() => void gapAi.approvePii()}
              onCancel={gapAi.cancelPii}
            />
          ) : gapAi.missing ? (
            <FeatureUnavailable detail="Eksik delil analizi ucu henüz yayında değil." />
          ) : gapAi.error ? (
            <ErrorBox message={gapAi.error} />
          ) : (
            <div className="space-y-3">
              <AiDisclaimer text="Bu rapor bir ÖNERİDİR; delil ikamesi kararı ve süresi avukata aittir." />
              {gaps.length === 0 ? (
                <EmptyState message="AI desteksiz iddia bulmadı." />
              ) : (
                <ul className="space-y-2">
                  {gaps.map((g, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {g.claimText ?? "İddia"}
                        </p>
                        {g.severity && (
                          <Badge tone={SEVERITY_TONES[String(g.severity).toUpperCase()] ?? "gray"}>
                            {labelOf(SEVERITY_LABELS, String(g.severity).toUpperCase())}
                          </Badge>
                        )}
                      </div>
                      {g.issue && <p className="mt-1 text-xs leading-5 text-slate-600">{g.issue}</p>}
                      {g.suggestedEvidence && (
                        <p className="mt-1 text-xs leading-5 text-amber-800">
                          <strong>Önerilen delil:</strong> {g.suggestedEvidence}
                        </p>
                      )}
                      {(g.sourceRefs ?? []).map((r, ri) => (
                        <SourceQuote
                          key={ri}
                          quote={r.quote}
                          source={r.documentName ?? r.locator ?? r.label}
                        />
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ---------- İddia detayları (durum + hukuki dayanak) ---------- */}
      {claims.length > 0 && (
        <Card title="İddia Detayları">
          <ul className="space-y-3">
            {matrix.claims.map((c) => (
              <li key={c.id}>
                <Disclosure
                  summary={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={CLAIM_SIDE_TONES[c.side] ?? "gray"}>
                        {labelOf(CLAIM_SIDE_LABELS, c.side)}
                      </Badge>
                      <span className="text-slate-800">{c.text}</span>
                    </span>
                  }
                >
                  <ClaimDetail claim={c} onChanged={load} onNotify={onNotify} />
                </Disclosure>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------- Delil listesi ---------- */}
      {evidences.length > 0 && (
        <Card title={`Delil Envanteri (${evidences.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Delil</th>
                  <th className="py-2 pr-4 font-medium">Tür</th>
                  <th className="py-2 pr-4 font-medium">Kim sundu</th>
                  <th className="py-2 pr-4 font-medium">Durum</th>
                  <th className="py-2 pr-4 font-medium">Elde edilme</th>
                  <th className="py-2 font-medium">Bağlı iddia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {evidences.map((e) => {
                  const bound = claims.filter((c) =>
                    matrix.linkIndex.has(`${c.id}::${e.id}`),
                  ).length;
                  return (
                    <tr key={e.id}>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-slate-900">{e.title}</p>
                        {e.witnessName && (
                          <p className="text-xs text-slate-500">Tanık: {e.witnessName}</p>
                        )}
                        {e.description && (
                          <p className="mt-0.5 text-xs text-slate-500">{e.description}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {EVIDENCE_TYPE_ICONS[e.type] ?? "📎"}{" "}
                        {labelOf(EVIDENCE_TYPE_LABELS, e.type)}
                      </td>
                      <td className="py-3 pr-4">
                        {e.offeredBy ? (
                          <Badge tone={EVIDENCE_SIDE_TONES[e.offeredBy] ?? "gray"}>
                            {labelOf(EVIDENCE_SIDE_LABELS, e.offeredBy)}
                          </Badge>
                        ) : (
                          <Badge tone="gray">Belirtilmedi</Badge>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={EVIDENCE_STATUS_TONES[e.status] ?? "gray"}>
                          {labelOf(EVIDENCE_STATUS_LABELS, e.status)}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-slate-500">{fmtDate(e.obtainedAt)}</td>
                      <td className="py-3 text-slate-600">
                        {bound === 0 ? <Badge tone="yellow">Bağsız</Badge> : `${bound} iddia`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ClaimModal
        open={claimModal}
        caseId={caseId}
        onClose={() => setClaimModal(false)}
        onSaved={async () => {
          setClaimModal(false);
          onNotify("İddia eklendi.", "success");
          await load();
        }}
      />

      <EvidenceModal
        open={evidenceModal}
        caseId={caseId}
        onClose={() => setEvidenceModal(false)}
        onSaved={async () => {
          setEvidenceModal(false);
          onNotify("Delil eklendi.", "success");
          await load();
        }}
      />

      <LinkModal
        target={linkTarget}
        claims={claims}
        evidences={evidences}
        onClose={() => setLinkTarget(null)}
        onSaved={async () => {
          setLinkTarget(null);
          onNotify("İddia–delil bağı kuruldu.", "success");
          await load();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- yardımcılar

function strengthColor(value: string | number | null | undefined): string {
  const tone = strengthTone(value);
  if (tone === "green") return "#059669";
  if (tone === "yellow") return "#f59e0b";
  return "#94a3b8";
}

function strengthMark(value: string | number | null | undefined): string {
  const tone = strengthTone(value);
  if (tone === "green") return "●";
  if (tone === "yellow") return "◐";
  return "○";
}

function suggestionKindLabel(s: EvidenceSuggestion): string {
  if (s.claimId && s.evidenceId) return "Mevcut iddia ile mevcut delil arasında bağ önerisi";
  if (s.claimId && s.reference) return "Hukuki dayanak önerisi";
  if (s.evidenceTitle) return `Yeni delil önerisi · ${labelOf(EVIDENCE_TYPE_LABELS, String(s.evidenceType ?? "DIGER"))}`;
  if (s.claimText) return `Yeni iddia önerisi · ${labelOf(CLAIM_SIDE_LABELS, String(s.side ?? "BIZ"))}`;
  return "Öneri";
}

// ------------------------------------------------------------ iddia detayı

function ClaimDetail({
  claim,
  onChanged,
  onNotify,
}: {
  claim: Claim;
  onChanged: () => Promise<void> | void;
  onNotify: Notify;
}) {
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function changeStatus(status: string) {
    try {
      await updateClaim(claim.id, { status });
      onNotify("İddia durumu güncellendi.", "success");
      await onChanged();
    } catch (err) {
      onNotify(errText(err, "İddia durumu güncellenemedi."), "error");
    }
  }

  async function submitBasis(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await addLegalBasis(claim.id, {
        reference: reference.trim(),
        note: note.trim() || undefined,
      });
      setReference("");
      setNote("");
      onNotify("Hukuki dayanak eklendi.", "success");
      await onChanged();
    } catch (err) {
      onNotify(errText(err, "Hukuki dayanak eklenemedi."), "error");
    } finally {
      setBusy(false);
    }
  }

  const bases = claim.legalBases ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">İspat durumu:</span>
        {CLAIM_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void changeStatus(s)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors ${
              claim.status === s
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {labelOf(CLAIM_STATUS_LABELS, s)}
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Hukuki dayanaklar
        </p>
        {bases.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">Bu iddiaya bağlı dayanak yok.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {bases.map((b) => (
              <li key={b.id} className="text-xs text-slate-700">
                • <strong>{b.reference}</strong>
                {b.note ? ` — ${b.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submitBasis} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Madde / içtihat künyesi">
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Örn. TBK m.227"
            required
          />
        </Field>
        <Field label="Not">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" size="sm" disabled={busy || !reference.trim()}>
          Dayanak Ekle
        </Button>
      </form>
      <p className="text-[11px] text-slate-500">
        Elle girilen künyeler teyit edilmemiştir; dilekçeye aktarmadan önce İçtihat
        modülünden doğrulayın.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ modallar

function ClaimModal({
  open,
  caseId,
  onClose,
  onSaved,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [side, setSide] = useState<string>("BIZ");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSide("BIZ");
    setText("");
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createClaim(caseId, { side, text: text.trim() });
      await onSaved();
    } catch (err) {
      setError(errText(err, "İddia kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="İddia Ekle" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Kimin iddiası">
          <Select value={side} onChange={(e) => setSide(e.target.value)}>
            {CLAIM_SIDES.map((s) => (
              <option key={s} value={s}>
                {labelOf(CLAIM_SIDE_LABELS, s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="İddia metni" hint="Vakıa ya da talep — tek cümlede, ispat edilebilir biçimde.">
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Örn. Teslim edilen hammadde sözleşmedeki teknik şartnameye uygun değildir."
            required
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EvidenceModal({
  open,
  caseId,
  onClose,
  onSaved,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState({
    type: "BELGE",
    title: "",
    description: "",
    witnessName: "",
    obtainedAt: "",
    status: "PLANLANAN",
    offeredBy: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      type: "BELGE",
      title: "",
      description: "",
      witnessName: "",
      obtainedAt: "",
      status: "PLANLANAN",
      offeredBy: "",
    });
    setError(null);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createEvidence(caseId, {
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        witnessName: form.witnessName.trim() || undefined,
        obtainedAt: form.obtainedAt ? new Date(form.obtainedAt).toISOString() : undefined,
        status: form.status,
        offeredBy: form.offeredBy || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Delil kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Delil Ekle" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Delil türü">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelOf(EVIDENCE_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sunum durumu">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {EVIDENCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(EVIDENCE_STATUS_LABELS, s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Delili kim sundu?"
          hint="Bizim sunduğumuz delil, kendi iddiamızı çürütüyor olarak bağlanamaz (matris tutarlılık kuralı)."
        >
          <Select
            value={form.offeredBy}
            onChange={(e) => setForm({ ...form, offeredBy: e.target.value })}
          >
            <option value="">Belirtilmedi</option>
            <option value="BIZ">Biz (dava dosyamızda)</option>
            <option value="KARSI_TARAF">Karşı taraf</option>
            <option value="ORTAK">Mahkeme / bilirkişi / ortak</option>
          </Select>
        </Field>
        <Field label="Delil adı">
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Örn. 12.03.2026 tarihli irsaliye"
            required
          />
        </Field>
        {form.type === "TANIK" && (
          <Field label="Tanık adı">
            <Input
              value={form.witnessName}
              onChange={(e) => setForm({ ...form, witnessName: e.target.value })}
            />
          </Field>
        )}
        <Field label="Açıklama" hint="Bu delil hangi vakıayı ispata yarıyor?">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Elde edilme tarihi">
          <Input
            type="date"
            value={form.obtainedAt}
            onChange={(e) => setForm({ ...form, obtainedAt: e.target.value })}
          />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || !form.title.trim()}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LinkModal({
  target,
  claims,
  evidences,
  onClose,
  onSaved,
}: {
  target: { claimId: string; evidenceId: string } | null;
  claims: Claim[];
  evidences: Evidence[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  // Güç 1-5 tamsayıdır (sunucu şeması z.number().int()). Eskiden "ORTA" gibi
  // metin gönderiliyordu — sunucu 422 döndürürdü.
  const [strength, setStrength] = useState(3);
  // Bağın YÖNÜ (F2 · E6): CONTRADICTS, matriste desteğe KATILMAZ.
  const [linkType, setLinkType] = useState<"SUPPORTS" | "CONTRADICTS" | "BELIRSIZ">("SUPPORTS");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setStrength(3);
    setLinkType("SUPPORTS");
    setNote("");
    setError(null);
  }, [target]);

  if (!target) return null;
  const claim = claims.find((c) => c.id === target.claimId);
  const evidence = evidences.find((e) => e.id === target.evidenceId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await linkClaimEvidence(target.claimId, {
        evidenceId: target.evidenceId,
        strength,
        linkType,
        note: note.trim() || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(errText(err, "Bağ kurulamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="İddia – Delil Bağı" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          <p>
            <strong>İddia:</strong> {claim?.text ?? "—"}
          </p>
          <p className="mt-1">
            <strong>Delil:</strong> {evidence?.title ?? "—"}
          </p>
        </div>
        <Field
          label="Bağın yönü"
          hint="Bu delil iddiayı destekliyor mu, çürütüyor mu? Çürütme matris desteğe KATILMAZ — risk görünür kalır."
        >
          <Select
            value={linkType}
            onChange={(e) =>
              setLinkType(e.target.value as "SUPPORTS" | "CONTRADICTS" | "BELIRSIZ")
            }
          >
            <option value="SUPPORTS">Destekliyor (SUPPORTS)</option>
            <option value="CONTRADICTS">Çürütüyor (CONTRADICTS)</option>
            <option value="BELIRSIZ">Yön belirsiz (BELIRSIZ)</option>
          </Select>
        </Field>
        <Field label="Bağın gücü" hint="Bu delil iddiayı ne kadar güçlü ispat ediyor? (1-5)">
          <Select
            value={String(strength)}
            onChange={(e) => setStrength(Number(e.target.value))}
          >
            <option value="1">1 — çok zayıf</option>
            <option value="2">2 — zayıf</option>
            <option value="3">3 — orta</option>
            <option value="4">4 — güçlü</option>
            <option value="5">5 — çok güçlü</option>
          </Select>
        </Field>
        <Field label="Not">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="gold" disabled={busy}>
            {busy ? "Bağlanıyor…" : "Bağla"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
