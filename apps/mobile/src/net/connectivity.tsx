/**
 * Bağlantı durumu.
 *
 * Yazma işlemlerinden ÖNCE kontrol edilir: bağlantı yoksa istek hiç
 * gönderilmez ve kullanıcıya "bağlantı gerekli" denir. Kuyruğa alma YOKTUR
 * (bkz. src/cache/today-cache.ts başlığı).
 */

import NetInfo from "@react-native-community/netinfo";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

interface ConnectivityValue {
  /** İnternete erişim var mı? Belirsizse (null) iyimser davranılır. */
  online: boolean;
}

const ConnectivityContext = createContext<ConnectivityValue>({ online: true });

export function ConnectivityProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // `isInternetReachable` doğrulanana kadar null gelir; o aşamada
      // bağlantıyı yok saymak kullanıcıyı gereksiz yere engeller.
      const reachable = state.isInternetReachable;
      setOnline(state.isConnected === true && reachable !== false);
    });
    void NetInfo.fetch().then((state) => {
      setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo(() => ({ online }), [online]);
  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useOnline(): boolean {
  return useContext(ConnectivityContext).online;
}
