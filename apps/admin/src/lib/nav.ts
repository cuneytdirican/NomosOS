/**
 * Panel menüsü — her giriş bir yetki işlemine bağlıdır; yetkisiz rol menüde göremez.
 * Gizleme yalnız ergonomidir; asıl yaptırım API katmanındadır (PlatformRoleGuard).
 */

import type { AdminAction } from "./rbac";

export interface NavItem {
  href: string;
  label: string;
  action: AdminAction;
  exact?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Genel Bakış", action: "metrics.overview.view", exact: true },
  { href: "/demo-talepleri", label: "Demo Talepleri", action: "demoRequests.view" },
  { href: "/tenantlar", label: "Tenantlar", action: "tenant.view" },
  { href: "/abonelikler", label: "Abonelikler", action: "subscription.view" },
  { href: "/odemeler", label: "Ödemeler", action: "payment.view" },
  { href: "/kullanim", label: "AI Kullanımı", action: "ai.analytics.platform" },
  { href: "/krediler", label: "Kredi & Fiyatlar", action: "credits.tenant.view" },
  { href: "/onaylar", label: "Onay Kuyruğu", action: "approval.view" },
  { href: "/sistem", label: "Sistem", action: "system.settings" },
  { href: "/yoneticiler", label: "Yöneticiler", action: "platform_user.view" },
  { href: "/denetim", label: "Denetim İzi", action: "audit.view" },
];

/**
 * ANALYST_READONLY için menü: yalnız yatırımcı görünümü (/metrics/investor).
 * Spec: "bu rolün tek ekranı".
 */
export const ANALYST_NAV: readonly NavItem[] = [
  { href: "/", label: "Yatırımcı Görünümü", action: "board_report.view", exact: true },
];
