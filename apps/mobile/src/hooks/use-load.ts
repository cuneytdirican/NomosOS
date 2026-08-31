/**
 * Basit veri çekme kancası — yükleniyor / hata / veri üçlüsü ve `reload`.
 *
 * Bilinçli olarak küçük: mobil salt-okur ağırlıklı olduğu için önbellek
 * geçersizleştirme, sayfalama ve mutasyon yönetimi olan bir veri katmanına
 * (react-query vb.) ihtiyaç yoktur; her ekran kendi verisini çeker,
 * yazma sonrası `reload()` çağırır.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/api/client";

export interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** İlk yükleme tamamlandı mı? Aşağı çekip yenilemede iskelet göstermemek için. */
  loaded: boolean;
  reload: () => void;
}

export function useLoad<T>(loader: () => Promise<T>, deps: readonly unknown[] = []): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);

  // `loader` her render'da yeni bir kapanış (closure); bağımlılık listesine
  // konursa sonsuz döngü olur. Son sürümü ref'te tutup `deps` ile tetikleriz.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    loaderRef
      .current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setError(errorMessage(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, loaded, reload };
}
