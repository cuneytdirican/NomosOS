/**
 * Portal menüsü.
 *
 * Yedi giriş — daha fazlası müvekkili yorar. Sıralama, "davam ne oldu?"
 * sorusunun cevabına giden en kısa yola göre kurulmuştur.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Alt gezinme çubuğunda (mobil) kullanılan kısa ad. */
  short: string;
  /** Sadece tam eşleşmede etkin sayılır (kök sayfa için). */
  exact?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Ana Sayfa", short: "Ana Sayfa", exact: true },
  { href: "/dosyalarim", label: "Dosyalarım", short: "Dosyalar" },
  { href: "/belgelerim", label: "Belgelerim", short: "Belgeler" },
  { href: "/durusmalarim", label: "Duruşmalarım", short: "Duruşmalar" },
  { href: "/odemelerim", label: "Ödemelerim", short: "Ödemeler" },
  { href: "/mesajlar", label: "Mesajlar", short: "Mesajlar" },
  { href: "/avukatim", label: "Avukatım", short: "Avukatım" },
] as const;

export function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
