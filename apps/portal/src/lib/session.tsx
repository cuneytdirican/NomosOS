"use client";

/**
 * Portal oturumu — `PortalUser` kimliği.
 *
 * Büro (`User`) ve platform (`PlatformUser`) oturumlarından tamamen ayrıdır:
 * ayrı localStorage anahtarı, ayrı JWT audience (`aud: "portal"`).
 *
 * Açılışta `GET /api/v1/portal/auth/me` çağrılır:
 *  - 200 → profil sunucudan tazelenir (müvekkil adı, büro adı).
 *  - 401 → token silinir, /giris.
 *  - uç yok / ağ hatası → yerel profille devam edilir, `apiUnavailable` işaretlenir;
 *    müvekkil ekranın tepesinde nazik bir bilgilendirme görür.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearToken,
  getStoredUser,
  getToken,
  isEndpointMissing,
  isUnauthorized,
  portalApi,
  setStoredUser,
  toStoredUser,
  type StoredPortalUser,
} from "./api";
import { EP } from "./endpoints";
import type { PortalProfile } from "./types";

export interface PortalSession {
  ready: boolean;
  authenticated: boolean;
  user: StoredPortalUser | null;
  /** Profil ucu yanıt vermiyor — ekranlar yerel bilgiyle çalışıyor. */
  apiUnavailable: boolean;
  logout: () => void;
  refresh: () => void;
}

const DEFAULT_SESSION: PortalSession = {
  ready: false,
  authenticated: false,
  user: null,
  apiUnavailable: false,
  logout: () => undefined,
  refresh: () => undefined,
};

const SessionContext = createContext<PortalSession>(DEFAULT_SESSION);

export function PortalSessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<StoredPortalUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * ÇIKIŞ — önce SUNUCUDA, sonra istemcide.
   *
   * Sunucu çağrısı BEKLENİR: `POST /auth/logout` hesabın oturum damgasını
   * tazeler ve bu token'ı gerçekten öldürür. Yalnızca `localStorage`'ı silmek,
   * ortak bir bilgisayarda token'ı 8 saat daha geçerli bırakırdı. Çağrı
   * başarısız olsa bile (ağ kopuk) yerel oturum yine kapatılır — kullanıcı
   * ekranda mahsur kalmamalıdır.
   */
  const logout = useCallback(() => {
    void portalApi(EP.auth.logout, { method: "POST", noAuthRedirect: true })
      .catch(() => undefined)
      .finally(() => {
        clearToken();
        setAuthenticated(false);
        setUser(null);
        if (typeof window !== "undefined") window.location.href = "/giris";
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = getToken();

    if (!token) {
      setAuthenticated(false);
      setUser(null);
      setReady(true);
      return;
    }

    // Önce yereldeki profille ekranı aç, sonra sunucudan tazele.
    setUser(getStoredUser());
    setAuthenticated(true);

    portalApi<PortalProfile>(EP.auth.me)
      .then((profile) => {
        if (cancelled) return;
        const next: StoredPortalUser = toStoredUser(profile);
        setStoredUser(next);
        setUser(next);
        setApiUnavailable(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          clearToken();
          setAuthenticated(false);
          setUser(null);
          return;
        }
        if (isEndpointMissing(err)) {
          setApiUnavailable(true);
          return;
        }
        setApiUnavailable(false);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo<PortalSession>(
    () => ({ ready, authenticated, user, apiUnavailable, logout, refresh }),
    [ready, authenticated, user, apiUnavailable, logout, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function usePortalSession(): PortalSession {
  return useContext(SessionContext);
}
