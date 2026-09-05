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
  { href: "/destek", label: "Destek Talepleri", action: "support.tickets.view" },
  { href: "/tenantlar", label: "Tenantlar", action: "tenant.view" },
  { href: "/abonelikler", label: "Abonelikler", action: "subscription.view" },
  { href: "/odemeler", label: "Ödemeler", action: "payment.view" },
  { href: "/faturalar", label: "Platform Faturaları", action: "invoice.view" },
  { href: "/kuponlar", label: "Kuponlar", action: "coupon.view" },
  { href: "/kullanim", label: "AI Kullanımı", action: "ai.analytics.platform" },
  { href: "/krediler", label: "Kredi & Fiyatlar", action: "credits.tenant.view" },
  { href: "/yargi", label: "Yargı & Noter Kataloğu", action: "judicial.view" },
  { href: "/yargi/havuz", label: "İçtihat Havuzu", action: "aiProvider.view" },
  { href: "/ictihat/onay", label: "İçtihat Onay Masası", action: "aiProvider.view" },
  { href: "/yargi/mevzuat", label: "Mevzuat Onay Masası", action: "aiProvider.view" },
  { href: "/yargi/aaut", label: "AAÜT Tarifesi", action: "judicial.view" },
  { href: "/ai-saglayicilar", label: "Platform AI Sağlayıcıları", action: "aiProvider.view" },
  { href: "/egitim", label: "Model Eğitim İşleri", action: "aiProvider.view" },
  { href: "/onaylar", label: "Onay Kuyruğu", action: "approval.view" },
  { href: "/isler", label: "Zamanlanmış İşler", action: "system.settings" },
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
