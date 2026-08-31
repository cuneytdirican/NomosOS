/**
 * Oturum yönetimi + biyometrik kilit durumu.
 *
 * Tek sorumluluk noktası: token'ın nerede durduğu (SecureStore), API
 * istemcisine nasıl verildiği, 401'de ne olduğu ve uygulama arka plandan
 * dönünce kilidin nasıl kapandığı.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { setAuthToken, setUnauthorizedHandler } from "@/api/client";
import { login as loginRequest, revokeDevice } from "@/api/endpoints";
import type { AuthUser } from "@/api/types";
import { clearSnapshot } from "@/cache/today-cache";
import { secureStorage } from "./secure-storage";

/**
 * Arka planda bu süreden uzun kalınırsa kilit devreye girer.
 *
 * 0 SANİYE DEĞİL: avukat duruşma salonunda kamera veya not uygulamasına bir
 * saniyeliğine geçtiğinde her seferinde parmak izi istemek kullanıcıyı kilidi
 * kapatmaya iter — güvenliği artırmaz, azaltır. 45 saniye, telefonu masada
 * bırakma senaryosunu yakalayacak kadar kısa.
 */
const LOCK_AFTER_BACKGROUND_MS = 45_000;

interface SessionValue {
  user: AuthUser | null;
  /** Oturum açık mı? */
  authenticated: boolean;
  /** SecureStore'dan ilk okuma tamamlandı mı? (yönlendirme bunu bekler) */
  ready: boolean;

  biometricEnabled: boolean;
  /** Kilit ekranı gösterilmeli mi? */
  locked: boolean;
  /**
   * Uygulama arka plana geçiyor — ekran OPAK bir kaplamayla örtülmeli.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ GÖREV DEĞİŞTİRİCİ ANLIK GÖRÜNTÜSÜ (denetim bulgusu 16).              ║
   * ║ Kilit mantığı `inactive`/`background`ı doğru yakalıyordu ama yalnız   ║
   * ║ ZAMANI kaydediyor, kilidi `active`e dönünce kuruyordu. İşletim        ║
   * ║ sistemi görev değiştirici anlık görüntüsünü tam da `inactive` anında  ║
   * ║ alır: "Bugün" ekranı, müvekkil adları ve esas numaralarıyla birlikte  ║
   * ║ OS'un anlık görüntü deposuna yazılıyor ve uygulama değiştiricide      ║
   * ║ telefonu eline alan herkese görünüyordu.                              ║
   * ║                                                                       ║
   * ║ `locked`tan AYRI bir bayraktır: kaplama biyometri açık olmasa da      ║
   * ║ gösterilir (anlık görüntü her kullanıcıda alınır) ve geri dönüşte     ║
   * ║ doğrulama İSTEMEDEN kalkar; kilit kararı `locked`ın işidir.           ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   */
  obscured: boolean;
  unlock: () => void;
  /** Kilidi elle devreye sokar (Ayarlar'daki "şimdi kilitle"). */
  lockNow: () => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;

  signIn: (email: string, password: string, remember: boolean) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  rememberedEmail: string | null;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [obscured, setObscured] = useState(false);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);

  const backgroundedAt = useRef<number | null>(null);
  // AppState dinleyicisi bir kez kurulur; güncel değerleri ref üzerinden okur.
  const biometricRef = useRef(false);
  const authenticatedRef = useRef(false);
  biometricRef.current = biometricEnabled;
  authenticatedRef.current = user !== null;

  /**
   * Oturumu kapatır.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ ÖNCE SUNUCU, SONRA YEREL (denetim bulgusu 8).                        ║
   * ║ Cihaz jetonu sunucuda iptal edilmezse satır `isActive=true` kalır ve ║
   * ║ push kanalı açıldığında müvekkil bilgisi taşıyan bildirimler artık   ║
   * ║ kullanılmayan (belki satılmış) telefona düşmeye devam eder.          ║
   * ║                                                                      ║
   * ║ İptal çağrısı ÇIKIŞI BLOKE ETMEZ: ağ yoksa ya da sunucu hata         ║
   * ║ verirse hata yutulur ve yerel temizlik yine yapılır. Kullanıcının    ║
   * ║ "çıkış yap" demesiyle cihazdaki verinin silinmesi arasına bir ağ     ║
   * ║ koşulu koymak, en çok ihtiyaç duyulan anda (telefon elden çıkarken)  ║
   * ║ çıkışı imkânsız kılardı. Jeton yerelde her hâlükârda silinir.        ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   *
   * 401 kancası da aynı yolu izler; orada iptal çağrısı zaten 401 alacağı
   * için sessizce düşer ve akışı etkilemez.
   */
  const wipeLocalSession = useCallback(async () => {
    const deviceToken = await secureStorage.getDeviceToken();
    if (deviceToken) {
      try {
        await revokeDevice(deviceToken);
      } catch {
        /* Sunucuya ulaşılamadı: çıkış yine de tamamlanır. */
      }
    }
    setAuthToken(null);
    setUser(null);
    setLocked(false);
    await Promise.all([
      secureStorage.clearToken(),
      secureStorage.clearUser(),
      secureStorage.clearDeviceToken(),
      clearSnapshot(),
    ]);
  }, []);

  // --- Açılış: SecureStore'dan oturumu geri yükle -------------------------
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [token, storedUser, biometric, email] = await Promise.all([
        secureStorage.getToken(),
        secureStorage.getUser<AuthUser>(),
        secureStorage.isBiometricEnabled(),
        secureStorage.getRememberedEmail(),
      ]);
      if (!alive) return;

      if (token && storedUser) {
        setAuthToken(token);
        setUser(storedUser);
        // Kayıtlı oturumla açılışta kilit HEMEN kapalıdır: uygulamayı ilk açan
        // kişinin kimliği doğrulanmadan müvekkil verisi görünmemelidir.
        setLocked(biometric);
      }
      setBiometricEnabledState(biometric);
      setRememberedEmail(email);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- 401 kancası --------------------------------------------------------
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void wipeLocalSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [wipeLocalSession]);

  // --- Arka plandan dönüşte kilit ----------------------------------------
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        // Kaplama HEMEN kurulur: OS anlık görüntüyü tam bu anda alır.
        // Beklemek, müvekkil adlarını görev değiştiriciye yazdırırdı.
        setObscured(true);
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }
      if (state === "active") {
        setObscured(false);
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (since === null) return;
        if (!biometricRef.current || !authenticatedRef.current) return;
        if (Date.now() - since >= LOCK_AFTER_BACKGROUND_MS) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, []);

  // --- Eylemler -----------------------------------------------------------

  const signIn = useCallback(async (email: string, password: string, remember: boolean): Promise<AuthUser> => {
    const result = await loginRequest(email.trim(), password);
    setAuthToken(result.accessToken);
    await Promise.all([secureStorage.setToken(result.accessToken), secureStorage.setUser(result.user)]);
    if (remember) {
      await secureStorage.setRememberedEmail(email.trim());
      setRememberedEmail(email.trim());
    } else {
      await secureStorage.clearRememberedEmail();
      setRememberedEmail(null);
    }
    // Yeni kullanıcı → eski kullanıcının önbelleği hiçbir koşulda kalmamalı.
    await clearSnapshot();
    setUser(result.user);
    setLocked(false);
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await wipeLocalSession();
  }, [wipeLocalSession]);

  // Kilit ekranı `unlock`'u bir effect bağımlılığı olarak kullanır; kimliği
  // her render'da değişirse biyometri istemi kendini tekrar tetikler.
  const unlock = useCallback(() => setLocked(false), []);
  const lockNow = useCallback(() => setLocked(true), []);

  const setBiometricEnabled = useCallback(async (enabled: boolean) => {
    await secureStorage.setBiometricEnabled(enabled);
    setBiometricEnabledState(enabled);
    if (!enabled) setLocked(false);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      authenticated: user !== null,
      ready,
      biometricEnabled,
      locked,
      obscured,
      unlock,
      lockNow,
      setBiometricEnabled,
      signIn,
      signOut,
      rememberedEmail,
    }),
    [
      user,
      ready,
      biometricEnabled,
      locked,
      obscured,
      unlock,
      lockNow,
      setBiometricEnabled,
      signIn,
      signOut,
      rememberedEmail,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession, SessionProvider içinde kullanılmalıdır.");
  return context;
}
