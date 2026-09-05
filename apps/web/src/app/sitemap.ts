import type { MetadataRoute } from "next";
import { blogPosts } from "@/components/marketing/blog-content";
import { CONTRACT_DOCS } from "@nomosos/shared";
import { siteUrl } from "@/components/marketing/site-url";

/** Faz 8A — tanıtım sitesi haritası. Uygulama (/app, /giris) ve portal yolları girmez. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  const staticPages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/", priority: 1, changeFrequency: "weekly" },
    { path: "/fiyatlandirma", priority: 0.9, changeFrequency: "monthly" },
    { path: "/guvenlik", priority: 0.8, changeFrequency: "monthly" },
    { path: "/hakkimizda", priority: 0.6, changeFrequency: "monthly" },
    { path: "/iletisim", priority: 0.6, changeFrequency: "yearly" },
    { path: "/eklenti", priority: 0.7, changeFrequency: "monthly" },
    { path: "/blog", priority: 0.7, changeFrequency: "weekly" },
    { path: "/demo", priority: 0.8, changeFrequency: "yearly" },
    { path: "/durum", priority: 0.3, changeFrequency: "always" },
    { path: "/sozlesmeler", priority: 0.3, changeFrequency: "yearly" },
    { path: "/kvkk-aydinlatma", priority: 0.3, changeFrequency: "yearly" },
    { path: "/kullanim-kosullari", priority: 0.3, changeFrequency: "yearly" },
    { path: "/cerez-politikasi", priority: 0.2, changeFrequency: "yearly" },
  ];
  return [
    ...staticPages.map((p) => ({ url: `${base}${p.path}`, lastModified: now, changeFrequency: p.changeFrequency, priority: p.priority })),
    ...CONTRACT_DOCS.map((d) => ({ url: `${base}/sozlesmeler/${d.slug}`, lastModified: new Date(d.updatedAt), changeFrequency: "yearly" as const, priority: 0.3 })),
    ...blogPosts.map((post) => ({ url: `${base}/blog/${post.slug}`, lastModified: new Date(post.date), changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
