import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Kurumsal lacivert — slate-900 (#0F172A) temel marka rengidir.
        navy: {
          DEFAULT: "#0F172A",
          light: "#1E293B",
          lighter: "#334155",
        },
        gold: {
          DEFAULT: "#D97706",
          light: "#F59E0B",
          soft: "#FBBF24",
        },
      },
    },
  },
  plugins: [],
};

export default config;
