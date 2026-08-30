"use client";

/**
 * ÖNERİ ONAY KARTI — Faz 2'nin merkezî güven bileşeni.
 *
 * Ürün ilkesi: AI çıktısı ÖNERİDİR; avukat onaylar. Bu yüzden kart hiçbir
 * zaman yalnız "şunu yaptım" demez; her zaman şu üçlüyü birlikte gösterir:
 *   1) ne önerildiği (tip rozeti + yapılandırılmış içerik),
 *   2) AI'ın gerekçesi,
 *   3) belgeden alınan KAYNAK ALINTI + güven skoru.
 * SÜRE önerilerinde ayrıca deterministik motorun hesap izi (computeNote) açılır.
 *
 * [DÜZELTME] KARAR ALANLARI. Bazı öneriler API tarafında ek girdi olmadan
 * ONAYLANAMAZ ve "Onayla" düğmesi daima 400 üretiyordu; kullanıcının kuyruğu
 * temizlemesinin tek yolu REDDETMEKTİ (süre önerisinde bu, risk üstlenmek
 * demektir). Artık kart öneri tipine göre gereken alanı sorar:
 *   - DOSYA_ESLESTIRME → aday dosyalardan biri seçilir (radyo listesi),
 *   - SURE            → kural anahtarı + süreyi başlatan olay tarihi,
 *   - GOREV           → sorumlu (dosyanın sorumlusu yoksa zorunlu).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ComputeNote } from "@/components/compute-note";
import { ConfidenceMeter, ReasoningBlock, SourceQuote } from "@/components/ai-ui";
import {
  listDeadlineRules,
  listTenantUsers,
  payloadOf,
  payloadStr,
  type ApproveProposalBody,
} from "@/lib/faz2";
import type { ActionProposal, DeadlineRuleOption, TenantUser } from "@/lib/types";
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_TONES,
  PROPOSAL_TYPE_LABELS,
  PROPOSAL_TYPE_TONES,
  TASK_PRIORITY_LABELS,
  fmtDate,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";

/** Öneri tipine göre payload'dan okunacak alanlar (etiket → anahtar adayları). */
const PAYLOAD_FIELDS: Record<string, Array<{ label: string; keys: string[]; date?: boolean }>> = {
  GOREV: [
    { label: "Görev", keys: ["title", "taskTitle", "name"] },
    { label: "Açıklama", keys: ["description", "detail"] },
    { label: "Son tarih", keys: ["dueDate", "due_date"], date: true },
    { label: "Öncelik", keys: ["priority"] },
  ],
  SURE: [
    { label: "Süre", keys: ["title", "name"] },
    { label: "Son gün", keys: ["dueDate", "due_date"], date: true },
    { label: "Tetik tarihi", keys: ["triggerDate", "trigger_date"], date: true },
    { label: "Dayanak", keys: ["legalBasis", "legal_basis"] },
    { label: "Kural", keys: ["ruleKey", "rule_key"] },
    { label: "Tebligat", keys: ["serviceMethod", "service_method"] },
  ],
  SAFAHAT: [
    { label: "Olay", keys: ["title", "event"] },
    { label: "Tarih", keys: ["date", "eventDate"], date: true },
    { label: "Ayrıntı", keys: ["detail", "description"] },
  ],
  MUVEKKIL_BILGILENDIRME: [
    { label: "Konu", keys: ["subject", "title"] },
    { label: "Mesaj", keys: ["message", "body", "content"] },
    { label: "Kanal", keys: ["channel"] },
  ],
  DOSYA_ESLESTIRME: [
    { label: "Önerilen dosya", keys: ["caseTitle", "case_title", "title"] },
    { label: "Esas no", keys: ["fileNumber", "file_number"] },
    { label: "Mahkeme", keys: ["courtName", "court_name"] },
  ],
  DURUSMA_GUNCELLEME: [
    { label: "Yeni duruşma", keys: ["date", "hearingDate"], date: true },
    { label: "Salon", keys: ["courtroom"] },
    { label: "Tür", keys: ["type", "hearingType"] },
    { label: "Not", keys: ["note", "detail"] },
  ],
};

function fieldValue(p: ActionProposal, keys: string[], isDate?: boolean): string | null {
  const raw = payloadStr(p, ...keys);
  if (!raw) return null;
  if (isDate) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : fmtDate(raw);
  }
  if (keys[0] === "priority") return labelOf(TASK_PRIORITY_LABELS, raw);
  return raw;
}

/** Öneri gövdesinden dosya eşleştirme adaylarını okur. */
function candidatesOf(
  proposal: ActionProposal,
): Array<{ caseId: string; title?: string; fileNumber?: string; courtName?: string; confidence?: number; reason?: string }> {
  const raw = payloadOf(proposal).candidates;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .filter((c) => typeof c.caseId === "string")
    .map((c) => ({
      caseId: String(c.caseId),
      title: typeof c.title === "string" ? c.title : undefined,
      fileNumber: typeof c.fileNumber === "string" ? c.fileNumber : undefined,
      courtName: typeof c.courtName === "string" ? c.courtName : undefined,
      confidence: typeof c.confidence === "number" ? c.confidence : undefined,
      reason: typeof c.reason === "string" ? c.reason : undefined,
    }));
}

export function ProposalCard({
  proposal,
  busy,
  onApprove,
  onReject,
  showCase = true,
}: {
  proposal: ActionProposal;
  busy?: boolean;
  onApprove: (p: ActionProposal, body: ApproveProposalBody) => void;
  onReject: (p: ActionProposal, reason: string) => void;
  /** Dosya detayında dosya adını tekrar yazmaya gerek yok. */
  showCase?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  // ---- Karar alanları (öneri tipine göre) ----
  const candidates = candidatesOf(proposal);
  const [pickedCase, setPickedCase] = useState<string>(
    candidates.length === 1 ? candidates[0].caseId : "",
  );
  const [ruleKey, setRuleKey] = useState<string>(
    payloadStr(proposal, "ruleKey", "suggestedRuleKey") ?? "",
  );
  const [triggerDate, setTriggerDate] = useState<string>(
    (payloadStr(proposal, "triggerDate", "eventDate") ?? "").slice(0, 10),
  );
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [rules, setRules] = useState<DeadlineRuleOption[]>([]);

  const needsCasePick = proposal.type === "DOSYA_ESLESTIRME" && candidates.length !== 1;
  const needsRule = proposal.type === "SURE";
  const needsAssignee = proposal.type === "GOREV";

  // Seçim listeleri yalnızca gereken kartlarda yüklenir.
  useEffect(() => {
    if (!needsAssignee) return;
    let alive = true;
    listTenantUsers()
      .then((list) => {
        if (alive) setUsers(list);
      })
      .catch(() => {
        /* uç yoksa alan boş kalır; API dosyanın sorumlusunu kullanır */
      });
    return () => {
      alive = false;
    };
  }, [needsAssignee]);

  useEffect(() => {
    if (!needsRule) return;
    let alive = true;
    listDeadlineRules()
      .then((list) => {
        if (alive) setRules(list);
      })
      .catch(() => {
        /* kural listesi alınamazsa anahtar elle yazılabilir */
      });
    return () => {
      alive = false;
    };
  }, [needsRule]);

  /** API'ye gidecek onay gövdesi — boş alanlar `approveProposal` içinde elenir. */
  function approvalBody(): ApproveProposalBody {
    const body: ApproveProposalBody = {};
    if (proposal.type === "DOSYA_ESLESTIRME" && pickedCase) body.caseId = pickedCase;
    if (proposal.type === "SURE") {
      if (ruleKey.trim()) body.ruleKey = ruleKey.trim();
      if (triggerDate) body.triggerDate = triggerDate;
    }
    if (proposal.type === "GOREV" && assigneeId) body.assigneeId = assigneeId;
    return body;
  }

  /** Zorunlu alan eksikse onay düğmesi kapalıdır (400 üretmeyelim). */
  const blocked = needsCasePick && !pickedCase;

  const fields = PAYLOAD_FIELDS[proposal.type] ?? [];
  const payload = payloadOf(proposal);
  const computeNote =
    typeof payload.computeNote === "string"
      ? payload.computeNote
      : typeof payload.compute_note === "string"
        ? (payload.compute_note as string)
        : null;
  const rows = fields
    .map((f) => ({ label: f.label, value: fieldValue(proposal, f.keys, f.date) }))
    .filter((r): r is { label: string; value: string } => Boolean(r.value));

  const pending = proposal.status === "BEKLIYOR";

  return (
    <li className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Başlık şeridi */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PROPOSAL_TYPE_TONES[proposal.type] ?? "gray"}>
              {labelOf(PROPOSAL_TYPE_LABELS, proposal.type)}
            </Badge>
            {!pending && (
              <Badge tone={PROPOSAL_STATUS_TONES[proposal.status] ?? "gray"}>
                {labelOf(PROPOSAL_STATUS_LABELS, proposal.status)}
              </Badge>
            )}
            <h3 className="text-sm font-semibold text-slate-900">{proposal.title}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {showCase && proposal.case ? (
              <>
                <Link
                  href={`/app/dosyalar/${proposal.case.id}`}
                  className="font-medium hover:text-amber-600"
                >
                  {proposal.case.title}
                </Link>
                {" · "}
              </>
            ) : null}
            {proposal.document?.name ? `Kaynak belge: ${proposal.document.name}` : "Kaynak belge —"}
            {proposal.createdAt ? ` · ${fmtDateTime(proposal.createdAt)}` : ""}
          </p>
        </div>
        <ConfidenceMeter value={proposal.confidence} />
      </div>

      <div className="space-y-3 px-5 py-4">
        {/* Önerilen içerik */}
        {rows.length > 0 ? (
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex gap-2 text-sm">
                <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {r.label}
                </dt>
                <dd className="min-w-0 text-slate-800">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-slate-400">
            Öneri ayrıntısı yapılandırılmış olarak gelmedi; gerekçe ve kaynak alıntıya bakın.
          </p>
        )}

        {/* SÜRE önerisinde deterministik hesap izi */}
        {proposal.type === "SURE" && (
          <div>
            {computeNote ? (
              <ComputeNote note={computeNote} />
            ) : (
              <p className="text-[11px] text-slate-400">
                Hesap izi öneriyle birlikte gelmedi. Süre onaylandığında deterministik motor
                hesabı yeniden üretir ve izi süre kaydına yazar.
              </p>
            )}
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              AI yalnızca tetikleyici olayı <strong>tespit eder</strong>; gün hesabı deterministik
              süre motorunun işidir.
            </p>
          </div>
        )}

        <ReasoningBlock text={proposal.reasoning} />

        <SourceQuote
          quote={proposal.sourceQuote}
          source={
            proposal.document?.name
              ? `Kaynak: ${proposal.document.name}`
              : "Kaynak: yüklenen belge"
          }
        />

        {!proposal.sourceQuote && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
            Bu öneri için belgeden kaynak alıntı çıkarılamadı — onaylamadan önce belgeyi elle
            kontrol edin.
          </p>
        )}

        {/* ---- Onay için gereken kararlar ---- */}
        {pending && needsCasePick && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold text-slate-700">
              Belgenin bağlanacağı dosyayı seçin
            </p>
            <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
              Sistem tek bir dosyaya kesin olarak karar veremedi; seçim sizindir. Yanlış dosya,
              süre ve duruşma önerilerinin yanlış bağlamda üretilmesine yol açar.
            </p>
            {candidates.length === 0 ? (
              <p className="mt-2 text-[11px] text-amber-800">
                Öneride aday dosya yok. Belgeyi Belgeler sekmesinden elle bir dosyaya bağlayın.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {candidates.map((c) => (
                  <li key={c.caseId}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs hover:border-amber-300">
                      <input
                        type="radio"
                        name={`case-${proposal.id}`}
                        className="mt-0.5"
                        checked={pickedCase === c.caseId}
                        onChange={() => setPickedCase(c.caseId)}
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-slate-800">
                          {c.fileNumber ?? "Esas no yok"} — {c.title ?? "Dosya"}
                        </span>
                        {c.courtName && (
                          <span className="block text-[11px] text-slate-500">{c.courtName}</span>
                        )}
                        {c.reason && (
                          <span className="block text-[11px] text-slate-500">{c.reason}</span>
                        )}
                        {typeof c.confidence === "number" && (
                          <span className="block text-[11px] text-slate-400">
                            eşleşme güveni %{Math.round(c.confidence * 100)}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pending && needsRule && (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 sm:grid-cols-2">
            <Field
              label="Süre kuralı"
              hint="Son gün ONAY ANINDA bu kuralla yeniden hesaplanır."
            >
              {rules.length > 0 ? (
                <Select value={ruleKey} onChange={(e) => setRuleKey(e.target.value)}>
                  <option value="">— kural seçin —</option>
                  {rules.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name} ({r.key})
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={ruleKey}
                  onChange={(e) => setRuleKey(e.target.value)}
                  placeholder="örn. CEVAP_DILEKCESI_HMK_127"
                />
              )}
            </Field>
            <Field label="Süreyi başlatan olay tarihi" hint="Tebliğ/karar tarihi.">
              <Input
                type="date"
                value={triggerDate}
                onChange={(e) => setTriggerDate(e.target.value)}
              />
            </Field>
          </div>
        )}

        {pending && needsAssignee && users.length > 0 && (
          <Field
            label="Sorumlu"
            hint="Boş bırakırsanız dosyanın sorumlu avukatı atanır; dosyanın sorumlusu yoksa seçim ZORUNLUDUR."
          >
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">— dosyanın sorumlusu —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.role})
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {/* Karar şeridi */}
      {pending && (
        <div className="border-t border-slate-100 px-5 py-3">
          {rejecting ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Red gerekçesi (AI'ın öğrenmesi ve denetim izi için zorunlu)…"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => onReject(proposal, reason.trim())}
                >
                  {busy ? "Gönderiliyor…" : "Reddet"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRejecting(false);
                    setReason("");
                  }}
                >
                  Vazgeç
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="gold"
                disabled={busy || blocked}
                onClick={() => onApprove(proposal, approvalBody())}
              >
                Onayla
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
                Reddet (gerekçe)
              </Button>
              {proposal.documentId && (
                <Link
                  href={
                    proposal.case?.id
                      ? `/app/dosyalar/${proposal.case.id}?sekme=belgeler&belge=${proposal.documentId}`
                      : `/app/oneriler`
                  }
                  className="ml-auto text-xs font-medium text-slate-500 hover:text-amber-600"
                >
                  Belgeye git →
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
