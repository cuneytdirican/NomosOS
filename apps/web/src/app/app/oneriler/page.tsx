"use client";

/**
 * ÖNERİ ONAY KUYRUĞU — /app/oneriler
 *
 * GET  /proposals?status=BEKLIYOR
 * POST /proposals/:id/approve
 * POST /proposals/:id/reject  { reason }
 *
 * Belge hattının ürettiği her AI aksiyonu buradan geçer. Avukat onaylamadan
 * hiçbir görev/süre/safahat kaydı oluşmaz; onaylandığında kart listeden düşer
 * ve ne üretildiği bildirim olarak gösterilir ("Görev oluşturuldu").
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiError, DEFAULT_PAGE_SIZE } from "@/lib/api";
import {
  approveProposal,
  type ApproveProposalBody,
  errText,
  isFeatureMissing,
  listProposalsPaged,
  rejectProposal,
} from "@/lib/faz2";
import type { ActionProposal, ProposalType } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Pagination,
  Select,
  Spinner,
} from "@/components/ui";
import { AiDisclaimer, FeatureUnavailable, ToastStack, useToasts } from "@/components/ai-ui";
import { ProposalCard } from "@/components/proposal-card";
import {
  PROPOSAL_APPLIED_MESSAGES,
  PROPOSAL_TYPES,
  PROPOSAL_TYPE_LABELS,
  PROPOSAL_TYPE_TONES,
  labelOf,
} from "@/lib/labels";

type StatusFilter = "BEKLIYOR" | "ONAYLANDI" | "UYGULANDI" | "REDDEDILDI" | "";

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "BEKLIYOR", label: "Onay bekleyen" },
  { key: "UYGULANDI", label: "Uygulanan" },
  { key: "REDDEDILDI", label: "Reddedilen" },
  { key: "", label: "Tümü" },
];

export default function OnerilerPage() {
  const [items, setItems] = useState<ActionProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("BEKLIYOR");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    try {
      // Zarf okunur; `total` artık atılmıyor (denetim bulgusu K-15).
      const res = await listProposalsPaged({
        status: status || undefined,
        type: typeFilter || undefined,
        page,
        limit: DEFAULT_PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      if (isFeatureMissing(err)) setMissing(true);
      else setError(err instanceof ApiError ? err.message : "Öneriler yüklenemedi.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status, typeFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Tür süzgeci artık SUNUCUDA uygulanır (denetim bulguları K-15, K-16).
   * Önceden 200 kaydın üzerinde istemcide süzülüyordu: "Tür: SÜRE" seçen
   * kullanıcı "son 200 önerinin içindeki süre önerileri"ni görüyordu.
   *
   * denetim bulgusu K-15 · denetim bulgusu K-16
   */
  const visible = items;

  const countsByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of items) map.set(p.type, (map.get(p.type) ?? 0) + 1);
    return map;
  }, [items]);

  async function handleApprove(p: ActionProposal, body: ApproveProposalBody) {
    setBusyId(p.id);
    setError(null);
    try {
      await approveProposal(p.id, body);
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      push(
        PROPOSAL_APPLIED_MESSAGES[p.type] ??
          `${labelOf(PROPOSAL_TYPE_LABELS, p.type)} önerisi uygulandı.`,
        "success",
      );
      window.dispatchEvent(new Event("nomosos:proposals-changed"));
    } catch (err) {
      push(errText(err, "Öneri onaylanamadı."), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(p: ActionProposal, reason: string) {
    setBusyId(p.id);
    setError(null);
    try {
      await rejectProposal(p.id, reason);
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      push("Öneri reddedildi. Gerekçe denetim kaydına işlendi.", "info");
      window.dispatchEvent(new Event("nomosos:proposals-changed"));
    } catch (err) {
      push(errText(err, "Öneri reddedilemedi."), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Öneriler</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Yüklenen belgelerden AI&apos;ın çıkardığı aksiyonlar. Hiçbiri siz onaylamadan kayda
            geçmez — her kartta gerekçe ve belgeden alınan kaynak alıntı yer alır.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          Yenile
        </Button>
      </div>

      <AiDisclaimer text="AI çıktısı bir ÖNERİDİR. Onay verdiğinizde ilgili kayıt (görev, süre, safahat) sizin adınıza oluşturulur ve sorumluluk size geçer." />

      {/* Durum sekmeleri + tip süzgeci */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key || "hepsi"}
              type="button"
              onClick={() => {
                setStatus(t.key);
                // Süzgeç değişince ilk sayfaya dön.
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                status === t.key
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
              {t.key === status && total > 0 ? ` (${total})` : ""}
            </button>
          ))}
        </div>
        <div className="w-56">
          <Select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tüm öneri tipleri</option>
            {PROPOSAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelOf(PROPOSAL_TYPE_LABELS, t)}
                {countsByType.get(t) ? ` (${countsByType.get(t)})` : ""}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Tip dağılımı */}
      {countsByType.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...countsByType.entries()].map(([type, count]) => (
            <button key={type} type="button" onClick={() => setTypeFilter(type)}>
              <Badge tone={PROPOSAL_TYPE_TONES[type] ?? "gray"}>
                {labelOf(PROPOSAL_TYPE_LABELS, type as ProposalType)}: {count}
              </Badge>
            </button>
          ))}
          {typeFilter && (
            <button
              type="button"
              onClick={() => setTypeFilter("")}
              className="text-xs font-medium text-slate-500 underline hover:text-amber-600"
            >
              süzgeci kaldır
            </button>
          )}
        </div>
      )}

      {error && <ErrorBox message={error} />}

      {missing ? (
        <FeatureUnavailable
          title="Öneri kuyruğu henüz hazır değil"
          detail="Belge işleme hattı (POST /documents → /proposals) yayına alındığında yüklediğiniz belgelerden üretilen görev, süre ve safahat önerileri burada listelenecek."
          onRetry={() => void load()}
        />
      ) : loading ? (
        <Spinner label="Öneriler yükleniyor…" />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            message={
              status === "BEKLIYOR"
                ? "Onay bekleyen öneri yok. Bir dosyaya belge yüklediğinizde hat otomatik olarak öneri üretir."
                : "Bu süzgeçte kayıt yok."
            }
          />
          <p className="mt-3 text-center text-xs text-slate-400">
            <Link href="/app/dosyalar" className="underline hover:text-amber-600">
              Dosyalara gidin
            </Link>{" "}
            ve Belgeler sekmesinden tebligat, karar veya bilirkişi raporu yükleyin.
          </p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {visible.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              busy={busyId === p.id}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
          <li>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              noun="öneri"
              loading={loading}
              onPageChange={setPage}
            />
          </li>
        </ul>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
