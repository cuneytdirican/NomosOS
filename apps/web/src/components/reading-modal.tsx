"use client";

/**
 * TAM EKRAN OKUMA MODALI — yasal metinlerin TAMAMININ rahat okunması için.
 *
 * Tasarım gerekçesi: klasik küçük modaller (max-h ~60vh, dar gövde) uzun
 * içtihat/sözleşme metinlerini kırpık ve yorucu gösteriyordu. Bu bileşen:
 *  - MASAÜSTÜ: ekranın tamamına yakın bir kaplama (inset-6) + ~75 karakterlik
 *    okuma sütunu (tipografi kuralı: uzun metinde satır uzunluğu 66-80 karakter
 *    idealdir; tam genişlik gözü yorar).
 *  - MOBİL: tam kaplama (inset-0) — küçük ekranın tamamı metne verilir;
 *    başlık yapışkan, alt süreklidir.
 *  - YAKINLAŞTIRMA: A− / A+ dört kademeli yazı boyutu (14/16/18/21px) —
 *    localStorage'a yazılır; avukat bir kez seçer, her okuma ekranında anımsanır.
 *  - TAM EKREN GEÇİŞ: masaüstünde kenar boşluklarını da yutar (inset-0).
 *  - KOPYALA: metni panoya alır (dosyaya yapıştırma/fiziksel nüsha karşılaştırma).
 *
 * Ölçek gereği metinler PENCERE PENCERE yüklenir (100+ sayfalık sözleşmeler);
 * bu bileşen eldeki pencereyi olabildiğince büyük ve okunur gösterir.
 */

import { useEffect, useState } from "react";

const FONT_STEPS = [14, 16, 18, 21, 24];
const FONT_KEY = "nomosos.reading.fontSize";

export interface ReadingModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Künye/alt bilgi başlığın altında küçük gösterilir (mahkeme, tarih…). */
  subtitle?: string;
  text: string;
  /** Metin üstünde gösterilecek kısa not (ör. kaynak/kapsam uyarısı). */
  note?: string;
  /** Ek üst bilgi öğesi (rozet satırı gibi). */
  headerExtra?: React.ReactNode;
}

export function ReadingModal({ open, onClose, title, subtitle, text, note, headerExtra }: ReadingModalProps) {
  const [step, setStep] = useState(2); // varsayılan 18px
  const [full, setFull] = useState(false);

  useEffect(() => {
    const saved = Number.parseInt(window.localStorage.getItem(FONT_KEY) ?? "", 10);
    const idx = FONT_STEPS.indexOf(saved);
    if (idx >= 0) setStep(idx);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setStep((s) => Math.min(s + 1, FONT_STEPS.length - 1));
      if (e.key === "-") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const fontSize = FONT_STEPS[step];

  const changeStep = (next: number) => {
    setStep(next);
    window.localStorage.setItem(FONT_KEY, String(FONT_STEPS[next]));
  };

  return (
    <div
      className={
        full
          ? "fixed inset-0 z-50 flex flex-col bg-white"
          : "fixed inset-0 z-50 flex flex-col bg-white md:inset-6 md:rounded-2xl md:shadow-2xl"
      }
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Yapışkan başlık + araçlar */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-slate-900 md:text-lg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
            {headerExtra && <div className="mt-1 flex flex-wrap items-center gap-1.5">{headerExtra}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Yakınlaştırma: A− / A+ */}
            <div className="flex items-center rounded-lg border border-slate-200" aria-label="Yazı boyutu">
              <button
                type="button"
                onClick={() => changeStep(Math.max(0, step - 1))}
                disabled={step === 0}
                className="px-2.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title="Yazıyı küçült (−)"
              >
                A−
              </button>
              <span className="px-1 text-[11px] tabular-nums text-slate-500">{fontSize}px</span>
              <button
                type="button"
                onClick={() => changeStep(Math.min(FONT_STEPS.length - 1, step + 1))}
                disabled={step === FONT_STEPS.length - 1}
                className="px-2.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title="Yazıyı büyüt (+)"
              >
                A+
              </button>
            </div>
            {/* Tam ekran geçişi (masaüstünde kenarları da yutar) */}
            <button
              type="button"
              onClick={() => setFull((v) => !v)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              title={full ? "Kenarlı görünüme dön" : "Tam ekrana geç"}
            >
              {full ? "⤡" : "⤢"}
            </button>
            {/* Kopyala */}
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(text)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              title="Metni panoya kopyala"
            >
              Kopyala
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>

      {/* Okuma gövdesi: dar sütunda, tam yükseklikte kaydırılan metin */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6">
        <div className="mx-auto max-w-3xl">
          {note && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              {note}
            </p>
          )}
          <p
            className="whitespace-pre-wrap leading-7 text-slate-800"
            style={{ fontSize: `${fontSize}px` }}
          >
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
