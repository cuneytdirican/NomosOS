/**
 * NomosOS mobil tema — web panelindeki koyu lacivert + amber paletiyle aynı.
 *
 * SAHA KISITLARI tasarımı belirler:
 *  - Adliye koridoru aydınlık; kontrast oranları yüksek tutulur (gövde metni
 *    #0F172A üzerine beyaz, ikincil metin en açık #475569'da durur).
 *  - Acele edilir; dokunma hedefi minimum 48dp (TOUCH.min) — Apple 44pt /
 *    Android 48dp önerilerinin üstü.
 *  - Ekran uzaktan okunur; gövde 16, başlık 20-28 punto.
 */

export const colors = {
  navy: "#0F172A",
  navyLight: "#1E293B",
  navyLighter: "#334155",

  gold: "#D97706",
  goldLight: "#F59E0B",
  goldSoft: "#FBBF24",

  bg: "#F1F5F9",
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC",
  border: "#CBD5E1",
  borderSoft: "#E2E8F0",

  text: "#0F172A",
  textSoft: "#475569",
  textMuted: "#64748B",
  onNavy: "#F8FAFC",
  onNavySoft: "#CBD5E1",

  danger: "#B91C1C",
  dangerBg: "#FEE2E2",
  warn: "#B45309",
  warnBg: "#FEF3C7",
  ok: "#15803D",
  okBg: "#DCFCE7",
  info: "#1D4ED8",
  infoBg: "#DBEAFE",
} as const;

/** Rozet tonları — web'deki BadgeTone kümesiyle aynı adları taşır. */
export const tones = {
  gray: { bg: "#E2E8F0", fg: "#334155" },
  blue: { bg: colors.infoBg, fg: colors.info },
  green: { bg: colors.okBg, fg: colors.ok },
  yellow: { bg: colors.warnBg, fg: colors.warn },
  red: { bg: colors.dangerBg, fg: colors.danger },
  danger: { bg: colors.danger, fg: "#FFFFFF" },
  navy: { bg: "#E2E8F0", fg: colors.navy },
  gold: { bg: "#FEF3C7", fg: "#92400E" },
} as const;

export type ToneName = keyof typeof tones;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/** Dokunma hedefi alt sınırı — adliyede acele edilir, küçük düğme kabul edilmez. */
export const TOUCH = { min: 48 } as const;

export const font = {
  /** Sayfa başlığı */
  h1: 26,
  /** Bölüm başlığı */
  h2: 20,
  /** Kart başlığı */
  h3: 17,
  /** Gövde */
  body: 16,
  /** İkincil bilgi */
  small: 14,
  /** Etiket / rozet */
  tiny: 12,
} as const;
