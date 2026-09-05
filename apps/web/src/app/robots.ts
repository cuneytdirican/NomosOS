import type { MetadataRoute } from "next";
import { siteUrl } from "@/components/marketing/site-url";

/** Faz 8A — uygulama, giriş ve API vekili taranmaz; tanıtım sayfaları açık. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/app", "/app/", "/giris", "/demo-giris", "/sifre-unuttum", "/sifre-sifirla", "/api/"] },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
