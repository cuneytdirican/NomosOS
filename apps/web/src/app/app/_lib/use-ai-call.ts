"use client";

/**
 * Faz 4 AI çağrıları için ortak durum kancası.
 *
 * Üç şeyi tek yerde toplar:
 *  1. meşguliyet ve hata metni,
 *  2. KVKK 409 akışı — maskeli önizleme onaylanmadan istek TEKRARLANMAZ,
 *  3. "uç henüz yayında değil" ayrımı (`missing`), böylece çağıran ekran
 *     kırmızı hata yerine "Bu özellik henüz hazır değil" gösterebilir.
 *
 * Çağrılan fonksiyon `piiApproved` bayrağını ALIR: onay verildiğinde AYNI istek
 * yalnızca bu bayrakla yeniden gönderilir; istemci hiçbir metni kendisi
 * maskelemez (maskeleme sunucunun işidir).
 */

import { useCallback, useState } from "react";
import { errText, extractPii, isFeatureMissing, type PiiPrompt } from "@/lib/faz2";
// Modül 26 — kredi hattı kancaları. Başarılı çağrıdan sonra gösterge tazelenir;
// 402 / 50-kredi tavanı hatası kabuktaki açıklayıcı karta yönlendirilir.
import { notifyCreditError, notifyCreditsChanged } from "@/lib/credits";

export interface AiCallState<T> {
  data: T | null;
  busy: boolean;
  error: string | null;
  missing: boolean;
  pii: PiiPrompt | null;
  run: (piiApproved?: boolean) => Promise<T | null>;
  approvePii: () => Promise<T | null>;
  cancelPii: () => void;
  setData: (value: T | null) => void;
  reset: () => void;
}

export function useAiCall<T>(
  fn: (piiApproved: boolean) => Promise<T>,
  fallbackMessage: string,
): AiCallState<T> {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pii, setPii] = useState<PiiPrompt | null>(null);

  const run = useCallback(
    async (piiApproved = false): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setMissing(false);
      try {
        const result = await fn(piiApproved);
        setPii(null);
        setData(result);
        // Kredi tüketmiş olabilir; üst çubuktaki gösterge hemen tazelensin.
        notifyCreditsChanged();
        return result;
      } catch (err) {
        const prompt = extractPii(err);
        if (prompt) {
          setPii(prompt);
          return null;
        }
        // Kredi hatasında ayrıntılı kartı kabuk gösterir; ekrandaki kısa
        // hata satırı yine yazılır (kart kapatılmış olabilir).
        notifyCreditError(err);
        setMissing(isFeatureMissing(err));
        setError(errText(err, fallbackMessage));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn, fallbackMessage],
  );

  const approvePii = useCallback(() => run(true), [run]);
  const cancelPii = useCallback(() => setPii(null), []);
  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setMissing(false);
    setPii(null);
  }, []);

  return { data, busy, error, missing, pii, run, approvePii, cancelPii, setData, reset };
}
