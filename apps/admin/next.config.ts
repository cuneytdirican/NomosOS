import type { NextConfig } from "next";

/**
 * Platform yönetim paneli (apps/admin) — tenant uygulamasından (apps/web) tamamen ayrı.
 * Port 3002, ayrı origin, ayrı JWT. Tenant uygulamasıyla hiçbir cookie/oturum paylaşmaz.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // AI görev tipi / sağlayıcı katalogları @nomosos/shared'dan gelir (apps/web ile aynı desen).
  transpilePackages: ["@nomosos/shared"],
  // Panel yalnız iç ağdan/VPN üzerinden yayınlanır; arama motorlarına asla açılmaz.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
