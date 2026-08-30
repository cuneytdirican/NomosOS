"use client";

/**
 * Panel oturumu — PlatformUser kimliği.
 *
 * Tenant oturumundan (apps/web) tamamen ayrıdır: farklı localStorage anahtarı,
 * farklı JWT audience ("platform"), token içinde tenantId YOKTUR.
 *
 * Açılışta GET /api/admin/v1/auth/me çağrılır:
 * - 200 → profil ve ROL sunucudan tazelenir (rol değişimi anında yansır).
 * - 401 → token temizlenir, /giris.
 * - uç yok / ağ hatası → localStorage'daki profil kullanılır, `apiUnavailable` işaretlenir.
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
  adminApi,
  clearToken,
  getStoredUser,
  getToken,
  isEndpointMissing,
  isUnauthorized,
  setStoredUser,
  type StoredAdminUser,
} from "./api";
import { EP } from "./endpoints";
import { parseRole, type AdminRole } from "./rbac";
import type { AdminUserProfile } from "./types";

export interface AdminSession {
  ready: boolean;
  authenticated: boolean;
  user: StoredAdminUser | null;
  role: AdminRole | null;
  /** /auth/me yanıt vermiyor — panel yerel profil ile çalışıyor. */
  apiUnavailable: boolean;
  logout: () => void;
  refresh: () => void;
}

const DEFAULT_SESSION: AdminSession = {
  ready: false,
  authenticated: false,
  user: null,
  role: null,
  apiUnavailable: false,
  logout: () => undefined,
  refresh: () => undefined,
};

const SessionContext = createContext<AdminSession>(DEFAULT_SESSION);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<StoredAdminUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const logout = useCallback(() => {
    clearToken();
    setAuthenticated(false);
    setUser(null);
    if (typeof window !== "undefined") window.location.href = "/giris";
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

    adminApi<AdminUserProfile>(EP.auth.me)
      .then((profile) => {
        if (cancelled) return;
        const next: StoredAdminUser = {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          role: profile.role,
        };
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
        // Diğer hatalarda oturumu düşürmeyiz; ekranlar kendi hatalarını gösterir.
        setApiUnavailable(false);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo<AdminSession>(
    () => ({
      ready,
      authenticated,
      user,
      role: parseRole(user?.role),
      apiUnavailable,
      logout,
      refresh,
    }),
    [ready, authenticated, user, apiUnavailable, logout, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAdminSession(): AdminSession {
  return useContext(SessionContext);
}
