import type { NextConfig } from "next";

/**
 * Müvekkil portalı (apps/portal) — büro uygulamasından (apps/web) ve platform
 * panelinden (apps/admin) TAMAMEN ayrı bir Next.js uygulamasıdır.
 *
 * Port 3003, ayrı origin, ayrı localStorage anahtarı (`nomosos_portal_token`),
 * ayrı JWT audience (`aud: "portal"`). Hiçbir çerez/oturum paylaşılmaz.
 *
 * `@nomosos/shared` BİLEREK bağımlılık DEĞİLDİR: portal en dar yetkili yüzeydir,
 * büro tarafının AI görev katalogları / sabitleri müvekkil paketine girmemelidir.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Portal kişisel veri gösterir; arama motorlarına asla açılmaz.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
