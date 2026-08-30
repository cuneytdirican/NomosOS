"use client";

/**
 * Yazma işlemleri için ortak kanca.
 *
 * - 403 → "Bu işlem için yetkiniz yok" (sunucu kararı; UI gizlemesi yalnız ergonomi).
 * - 404/501/ağ → "Bu uç henüz hazır değil".
 * - Dört-göz akışına düşen işlemlerde sunucu onay talebi döner; mesaj buna göre kurulur.
 */

import { useCallback, useState } from "react";
import { adminApi, errorMessage, isEndpointMissing, isForbidden, type ApiOptions } from "./api";
import type { AdminMutationResult } from "./types";

export interface MutationState {
  loading: boolean;
  error: string | null;
  missing: boolean;
  success: string | null;
  reset: () => void;
}

export interface RunOptions {
  /** Başarıda gösterilecek metin (onay talebi döndüyse otomatik olarak değiştirilir). */
  successMessage?: string;
  onSuccess?: (result: AdminMutationResult) => void;
}

export function useMutation(): MutationState & {
  run: (path: string, options: ApiOptions, runOptions?: RunOptions) => Promise<boolean>;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setSuccess(null);
    setMissing(false);
  }, []);

  const run = useCallback(
    async (path: string, options: ApiOptions, runOptions?: RunOptions): Promise<boolean> => {
      setLoading(true);
      setError(null);
      setSuccess(null);
      setMissing(false);
      try {
        const result = await adminApi<AdminMutationResult | null>(path, options);
        const approvalId = result?.approvalRequestId ?? result?.approvalRequest?.id;
        if (approvalId || result?.requiresApproval) {
          setSuccess(
            `Dört-göz onay talebi oluşturuldu${approvalId ? ` (#${approvalId})` : ""}. İşlem, farklı bir yetkili onaylayana kadar UYGULANMAZ.`,
          );
        } else {
          setSuccess(runOptions?.successMessage ?? "İşlem tamamlandı.");
        }
        runOptions?.onSuccess?.(result ?? {});
        return true;
      } catch (err) {
        if (isEndpointMissing(err)) {
          setMissing(true);
          return false;
        }
        if (isForbidden(err)) {
          setError(
            errorMessage(
              err,
              "Bu işlem için yetkiniz yok (API 403). Yetki matrisi sunucuda zorlanır.",
            ),
          );
          return false;
        }
        setError(errorMessage(err));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { loading, error, missing, success, reset, run };
}
