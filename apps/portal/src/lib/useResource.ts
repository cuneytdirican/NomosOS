"use client";

/**
 * Gerçek API veri kancaları. TEMSİLİ (MOCK) VERİ YOKTUR.
 *
 * Durumlar:
 *  loading   → yükleniyor
 *  missing   → uç henüz hazır değil / erişilemiyor (0, 404, 501–504)
 *  forbidden → 403 (portalda beklenmez; yine de sessizce yutulmaz)
 *  error     → başka bir hata
 *  data      → gerçek veri (boş olabilir → nazik boş durum metni)
 *
 * `missing` ile `empty` arasındaki fark müvekkil ekranında bilinçli olarak
 * SİLİKTİR: her ikisi de "burada henüz gösterilecek bir şey yok" der. Portal
 * API'si yayınlanmamış kaynağı da 404 ile gizler; ekranın "böyle bir kayıt var
 * ama size kapalı" demesi yayın kontrolünü delerdi.
 */

import { useCallback, useEffect, useState } from "react";
import {
  asList,
  errorMessage,
  isEndpointMissing,
  isForbidden,
  portalApi,
  type ApiOptions,
} from "./api";

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  loaded: boolean;
  missing: boolean;
  forbidden: boolean;
  error: string | null;
  endpoint: string;
  reload: () => void;
}

export interface ListResourceState<T> extends Omit<ResourceState<T[]>, "data"> {
  data: T[];
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

    portalApi<unknown>(path, parsed)
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
          return;
        }
        setError(errorMessage(err, "Bilgiler şu anda getirilemedi."));
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

/** Tekil kaynak. */
export function useResource<T>(path: string | null, options?: ApiOptions): ResourceState<T> {
  return useRequest<T>(path, options, (payload) => payload as T);
}

/** Liste kaynağı — dizi ya da { data|items|results|rows } sarmalayıcısı kabul edilir. */
export function useListResource<T>(
  path: string | null,
  options?: ApiOptions,
): ListResourceState<T> {
  const state = useRequest<T[]>(path, options, (payload) => asList<T>(payload));
  const rows = state.data ?? [];
  return { ...state, data: rows, empty: state.loaded && rows.length === 0 };
}
