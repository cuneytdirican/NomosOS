"use client";

/**
 * Faz 2 ortak arayüz parçaları:
 *  - AiDisclaimer   → "Bu çıktı bir öneridir" şeridi (ürün ilkesi)
 *  - FeatureUnavailable → uç henüz yayında değilken gösterilen bilgilendirme
 *  - ConfidenceMeter → güven skoru çubuğu
 *  - SourceQuote    → belgeden alınan kaynak alıntı bloğu
 *  - PiiApprovalBox → KVKK 409 onay akışı (maskeli önizleme)
 *  - useToasts / ToastStack → kısa bildirimler ("Görev oluşturuldu")
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Badge, Button } from "@/components/ui";
import { FEATURE_MISSING_TEXT, type PiiPrompt } from "@/lib/faz2";
import { confidencePercent, confidenceTone } from "@/lib/labels";

// ---------- AI uyarı şeridi ----------

export function AiDisclaimer({ text }: { text?: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
      <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-3.5 w-3.5 shrink-0">
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
      <span>
        {text ??
          "Bu çıktı bir ÖNERİDİR. Hukuki sorumluluk avukata aittir; kaynakları doğrulamadan işlem yapmayın."}
      </span>
    </p>
  );
}

// ---------- Uç henüz hazır değil ----------

export function FeatureUnavailable({
  title = "Bu özellik henüz hazır değil",
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-500">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
        {detail ?? FEATURE_MISSING_TEXT}
      </p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-4" onClick={onRetry}>
          Yeniden dene
        </Button>
      )}
    </div>
  );
}

// ---------- Güven skoru ----------

export function ConfidenceMeter({ value }: { value: number | null | undefined }) {
  const pct = confidencePercent(value);
  if (pct === null) return null;
  const tone = confidenceTone(value);
  const bar =
    tone === "green" ? "bg-emerald-500" : tone === "yellow" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2" title={`AI güven skoru: %${pct}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-medium text-slate-500">%{pct} güven</span>
    </div>
  );
}

// ---------- Kaynak alıntı ----------

export function SourceQuote({
  quote,
  source,
}: {
  quote: string | null | undefined;
  source?: ReactNode;
}) {
  if (!quote) return null;
  return (
    <blockquote className="mt-2 border-l-4 border-slate-300 bg-slate-50 py-2 pl-3 pr-2 text-xs italic leading-5 text-slate-600">
      “{quote.trim()}”
      {source && <footer className="mt-1 not-italic text-[11px] text-slate-400">{source}</footer>}
    </blockquote>
  );
}

// ---------- AI gerekçesi ----------

export function ReasoningBlock({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        AI&apos;ın gerekçesi
      </p>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">{text}</p>
    </div>
  );
}

// ---------- KVKK 409 onay kutusu ----------

export function PiiApprovalBox({
  prompt,
  busy,
  onApprove,
  onCancel,
}: {
  prompt: PiiPrompt;
  busy?: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Badge tone="gold">KVKK</Badge>
        Kişisel veri tespit edildi
      </p>
      <p className="mt-1.5 text-xs leading-5 text-amber-800">
        Metniniz dış AI sağlayıcısına gönderilmeden önce aşağıdaki maskeli haline dönüştürülecek.
        Onaylıyor musunuz?
      </p>
      {prompt.findings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {prompt.findings.map((f, i) => (
            <li key={i} className="text-xs text-amber-900">
              {/* API artık HAM DEĞER DÖNDÜRMEZ: yalnızca tür + kısmi maske + adet.
                  (Ham TCKN/IBAN'ı ekrana basmak, korumaya çalıştığımız veriyi
                  gereksizce çoğaltmaktı.) */}
              • {f.kind ?? f.label ?? f.type ?? "Bulgu"}
              {f.masked ? `: ${f.masked}` : f.value ? `: ${f.value}` : ""}
              {typeof f.count === "number" ? ` (${f.count} adet)` : ""}
            </li>
          ))}
        </ul>
      )}
      {prompt.maskedText && (
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-700">
          {prompt.maskedText}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="gold" size="sm" disabled={busy} onClick={onApprove}>
          {busy ? "Gönderiliyor…" : "Maskele ve Gönder"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

// ---------- Bildirimler ----------

export interface ToastItem {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: ToastItem["tone"] = "success") => {
      const id = ++seq.current;
      setToasts((prev) => [...prev, { id, text, tone }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    [],
  );

  return { toasts, push, dismiss };
}

const TOAST_TONES: Record<ToastItem["tone"], string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  error: "border-red-300 bg-red-50 text-red-800",
  info: "border-slate-300 bg-white text-slate-800",
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${TOAST_TONES[t.tone]}`}
        >
          <span className="leading-5">{t.text}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Bildirimi kapat"
            className="shrink-0 opacity-50 hover:opacity-100"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
