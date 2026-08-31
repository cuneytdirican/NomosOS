import type { Config } from "tailwindcss";

/**
 * Müvekkil portalı teması.
 *
 * Bilinçli olarak üç uygulamadan da FARKLIDIR:
 *   apps/web   → açık zemin, lacivert/amber, yoğun bilgi (avukat ekranı)
 *   apps/admin → koyu çelik gri, mor-indigo (operatör ekranı)
 *   apps/portal→ FİLDİŞİ KAĞIT zemin, yumuşak lacivert, ölçülü altın (müvekkil ekranı)
 *
 * Palet, pazarlama sitesinin kağıt estetiğinden türetilmiş ama yumuşatılmıştır:
 * kontrast biraz düşürülmüş, satır yüksekliği ve punto büyütülmüştür. Bu ekranı
 * hukuk bilmeyen biri, çoğu zaman telefondan kullanacak.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Kağıt zeminler
        paper: {
          DEFAULT: "#FBF9F5",
          alt: "#F4F1EA",
          deep: "#EBE6DA",
        },
        // Yumuşatılmış lacivert — apps/web'in #0F172A'sından daha sıcak
        ink: {
          DEFAULT: "#1B2A47",
          soft: "#40506D",
          faint: "#6E7B94",
        },
        // Ölçülü altın. `deep` yazı rengi olarak kağıt üzerinde AA kontrast sağlar.
        gold: {
          DEFAULT: "#B08D42",
          soft: "#E9DFC6",
          deep: "#7A6220",
        },
        rule: "#E3DDD1",
        // Durum renkleri de yumuşatıldı: portalda hiçbir şey "alarm" gibi durmaz.
        calm: {
          green: "#2F6B4F",
          greenSoft: "#E4F0E9",
          amber: "#8A6414",
          amberSoft: "#F8EFD9",
          rose: "#9B3B3B",
          roseSoft: "#F7E6E4",
        },
      },
      fontFamily: {
        serif: [
          "Lora",
          "Source Serif 4",
          "Georgia",
          "Times New Roman",
          "Times",
          "serif",
        ],
        sans: [
          "Inter",
          "Segoe UI",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        // Müvekkil ekranı büro panelinden bir kademe büyüktür.
        base: ["1.0625rem", { lineHeight: "1.75" }],
        lg: ["1.1875rem", { lineHeight: "1.7" }],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        paper: "0 1px 2px rgba(27, 42, 71, 0.04), 0 8px 24px -16px rgba(27, 42, 71, 0.18)",
      },
      maxWidth: {
        reading: "68ch",
      },
    },
  },
  plugins: [],
};

export default config;
