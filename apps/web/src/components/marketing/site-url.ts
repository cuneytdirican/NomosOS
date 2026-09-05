/**
 * Tanıtım sitesinin kamusal adresi — sitemap/robots/OG için tek kaynak.
 * `NEXT_PUBLIC_SITE_URL` derleme anında gömülür; yoksa üretim varsayılanı.
 */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://nomosos.com").replace(/\/+$/, "");
}
