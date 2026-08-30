"use client";

/**
 * Gerçek API veri kancaları. TEMSİLİ VERİ YOKTUR.
 *
 * Durumlar:
 * - loading  → yükleniyor
 * - missing  → uç henüz hazır değil (ağ hatası / 404 / 501..504) → "Bu uç henüz hazır değil"
 * - forbidden→ 403; yetkisiz veri hiçbir biçimde gösterilmez
 * - error    → başka bir hata
 * - data     → gerçek veri (yoksa null / boş dizi → "boş durum")
 */

import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  asList,
  errorMessage,
  isEndpointMissing,
  isForbidden,
  type ApiOptions,
} from "./api";

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  /** İstek başarıyla tamamlandı (veri geldi, boş olabilir). */
  loaded: boolean;
  /** Uç henüz hazır değil (yazılmadı ya da servis kapalı). */
  missing: boolean;
  forbidden: boolean;
  error: string | null;
  /** Bilgilendirme kutusunda gösterilen beklenen uç yolu. */
  endpoint: string;
  reload: () => void;
}

export interface ListResourceState<T> extends Omit<ResourceState<T[]>, "data"> {
  data: T[];
  /** Yanıt geldi ama liste boş. */
  empty: boolean;
}

function useRequest<T>(
  path: string | null,
  options: ApiOptions | undefined,
  transform: (payload: unknown) => T,
): ResourceState<T> {
  const optionsKey = JSON.stringify(options ?? {});

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      setLoaded(false);
      setData(null);
      return;
    }
    let cancelled = false;
    const parsed = JSON.parse(optionsKey) as ApiOptions;

    setLoading(true);
    setError(null);
    setForbidden(false);
    setMissing(false);

    adminApi<unknown>(path, parsed)
      .then((res) => {
        if (cancelled) return;
        setData(transform(res));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setLoaded(false);
        if (isEndpointMissing(err)) {
          setMissing(true);
          return;
        }
        if (isForbidden(err)) {
          setForbidden(true);
          setError("Bu veriyi görüntüleme yetkiniz yok (API 403).");
          return;
        }
        setError(errorMessage(err, "Veri alınamadı."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `transform` kasıtlı olarak bağımlılık listesinde değildir (her render'da yeni referans).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, optionsKey, nonce]);

  return { data, loading, loaded, missing, forbidden, error, endpoint: path ?? "", reload };
}

/** Tekil kaynak (nesne) çeker. */
export function useResource<T>(
  path: string | null,
  options?: ApiOptions,
): ResourceState<T> {
  const state = useRequest<T>(path, options, (payload) => payload as T);
  return state;
}

/** Liste kaynağı çeker; dizi ya da { data|items|results|rows } sarmalayıcısını kabul eder. */
export function useListResource<T>(
  path: string | null,
  options?: ApiOptions,
): ListResourceState<T> {
  const state = useRequest<T[]>(path, options, (payload) => asList<T>(payload));
  const rows = state.data ?? [];
  return {
    ...state,
    data: rows,
    empty: state.loaded && rows.length === 0,
  };
}
