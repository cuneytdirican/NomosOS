import type { Config } from "tailwindcss";

/**
 * Panel teması bilinçli olarak apps/web'den FARKLIDIR:
 * tenant uygulaması açık zemin + lacivert/altın, panel koyu çelik gri + mor-indigo vurgu.
 * Amaç: operatörün hangi uygulamada olduğunu bir bakışta ayırt etmesi.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Çelik gri — panel zemini ve yüzeyleri
        steel: {
          50: "#f6f7f9",
          100: "#ebedf2",
          200: "#d6dae4",
          300: "#b2b9c9",
          400: "#8791a6",
          500: "#68728a",
          600: "#525b70",
          700: "#434a5c",
          800: "#2f3542",
          900: "#1e222c",
          950: "#12151c",
        },
        // Mor-indigo vurgu
        accent: {
          50: "#f2f0ff",
          100: "#e7e3ff",
          200: "#d0c9ff",
          300: "#b3a5fd",
          400: "#9479f9",
          500: "#7c53f2",
          600: "#6c37e4",
          700: "#5a2ac4",
          800: "#4a259f",
          900: "#3d217f",
          950: "#25124f",
        },
      },
      fontFamily: {
        // Panel monospace sayaçlar için (token/tutar kolonları)
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
