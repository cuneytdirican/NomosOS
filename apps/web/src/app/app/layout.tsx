"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getStoredUser, getToken, type StoredUser } from "@/lib/api";
import { countPendingProposals } from "@/lib/faz2";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { getDemoRole } from "@/lib/api";
// Modül 26 — üst çubuktaki kredi göstergesi ve %80 uyarı şeridi.
import { CreditErrorAlert, CreditMeter, CreditWarningBanner, useWallet } from "@/components/credits";
// Faz 6 — üst çubuktaki bildirim zili (tüm /app sayfalarında).
import { NotificationBell } from "./_components/notification-bell";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
  /** Sol menüde bekleyen öneri sayısını gösteren rozet. */
  badge?: "proposals";
  /**
   * Bu menü öğesini görebilen roller. Tanımsız = herkes. GÖRÜNÜM süzmesidir:
   * yetkiyi sunucudaki rol kümeleri belirler (finance-access.ts, ROLE_SETS.ONAY).
   * Kaynaklar arayüz-sunucu hizasını `demo-giris.test.ts` kilitler.
   */
  roles?: readonly string[];
}

/**
 * Menü öğeleri gruplanmıştır (Faz 3'te İcra, Finans, Faturalar, Zaman eklendi;
 * düz liste 13 öğeye çıkınca taranamaz hâle geliyordu).
 */
const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Dosya",
    items: [
  {
    href: "/app/ajanda",
    label: "Ajanda",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.75A2.25 2.25 0 0 1 18 6.25v10.5A2.25 2.25 0 0 1 15.75 19H4.25A2.25 2.25 0 0 1 2 16.75V6.25A2.25 2.25 0 0 1 4.25 4H5V2.75A.75.75 0 0 1 5.75 2ZM3.5 8.5v8.25c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75V8.5h-13Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    href: "/app",
    label: "Panel",
    exact: true,
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M2 4.25A2.25 2.25 0 0 1 4.25 2h3.5A2.25 2.25 0 0 1 10 4.25v3.5A2.25 2.25 0 0 1 7.75 10h-3.5A2.25 2.25 0 0 1 2 7.75v-3.5ZM12 4.25A2.25 2.25 0 0 1 14.25 2h1.5A2.25 2.25 0 0 1 18 4.25v3.5A2.25 2.25 0 0 1 15.75 10h-1.5A2.25 2.25 0 0 1 12 7.75v-3.5ZM2 14.25A2.25 2.25 0 0 1 4.25 12h1.5A2.25 2.25 0 0 1 8 14.25v1.5A2.25 2.25 0 0 1 5.75 18h-1.5A2.25 2.25 0 0 1 2 15.75v-1.5ZM10 14.25A2.25 2.25 0 0 1 12.25 12h3.5A2.25 2.25 0 0 1 18 14.25v1.5A2.25 2.25 0 0 1 15.75 18h-3.5A2.25 2.25 0 0 1 10 15.75v-1.5Z" />
      </svg>
    ),
  },
  {
    href: "/app/muvekkiller",
    label: "Müvekkiller",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
      </svg>
    ),
  },
  {
    href: "/app/dosyalar",
    label: "Dosyalar",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4.379a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .44 1.061V16.5A1.5 1.5 0 0 1 12 18H4.5A1.5 1.5 0 0 1 3 16.5v-13ZM4.5 3.5v13h7.5V7h-3V3.5H4.5Z" />
      </svg>
    ),
  },
  {
    href: "/app/asistan",
    label: "Asistan",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M10 2a6 6 0 0 1 6 6v2.586l1.707 1.707A1 1 0 0 1 17 14h-2.268A2 2 0 0 1 13 15.732v.002a3 3 0 0 1-5.998 0A2 2 0 0 1 5.266 14H3a1 1 0 0 1-.707-1.707L4 10.586V8a6 6 0 0 1 6-6Z" />
      </svg>
    ),
  },
  {
    href: "/app/mesajlar",
    label: "Mesajlar",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M3.5 3A1.5 1.5 0 0 0 2 4.5v9A1.5 1.5 0 0 0 3.5 15H6v2.25a.75.75 0 0 0 1.22.583L11.24 15h5.26A1.5 1.5 0 0 0 18 13.5v-9A1.5 1.5 0 0 0 16.5 3h-13Z" />
      </svg>
    ),
  },
      {
        href: "/app/durusmalar",
        label: "Duruşmalar",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M5.25 3A2.25 2.25 0 0 0 3 5.25v9.5A2.25 2.25 0 0 0 5.25 17h9.5A2.25 2.25 0 0 0 17 14.75v-9.5A2.25 2.25 0 0 0 14.75 3h-9.5ZM6 5h1.5v1.5H6V5Zm3.25 0h1.5v1.5h-1.5V5Zm3.25 0H12v1.5h-.5V5ZM6 8h1.5v1.5H6V8Zm3.25 0h1.5v1.5h-1.5V8ZM12 8h1.5v1.5H12V8ZM6 11h1.5v1.5H6V11Zm3.25 0h1.5v1.5h-1.5V11Zm3.25 0H12v1.5h.5V11Z" />
          </svg>
        ),
      },
      {
        href: "/app/randevular",
        label: "Randevular",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.25 2.25 0 0 1 17.5 6.25v9.5A2.25 2.25 0 0 1 15.25 18H4.75A2.25 2.25 0 0 1 2.5 15.75v-9.5A2.25 2.25 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2ZM4 7.5v8.25c0 .414.336.75.75.75h10.5a.75.75 0 0 0 .75-.75V7.5H4Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
  {
    href: "/app/icra",
    label: "İcra",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M10 1.5a.75.75 0 0 1 .75.75v.62l5.06 1.35a.75.75 0 0 1-.14 1.48l-.36-.02 2.16 4.9a.75.75 0 0 1-.2.88 3.6 3.6 0 0 1-4.62 0 .75.75 0 0 1-.2-.88l2.14-4.86-3.84-1.02V15.5h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5V4.7L5.37 5.72l2.14 4.86a.75.75 0 0 1-.2.88 3.6 3.6 0 0 1-4.62 0 .75.75 0 0 1-.2-.88l2.16-4.9-.36.02a.75.75 0 0 1-.14-1.48l5.1-1.36v-.61A.75.75 0 0 1 10 1.5Z" />
      </svg>
    ),
  },
  {
    // Risk Motoru (Modül 17) — partnerin "bugün hangi dosyalar yanıyor" görünümü.
    href: "/app/riskli-dosyalar",
    label: "Riskli Dosyalar",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    // Conflict Check (Modül 11) — iş kabulünden ÖNCE bakılan ekran.
    href: "/app/cakisma",
    label: "Çakışma Kontrolü",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M7 4a3 3 0 1 1 6 0 3 3 0 0 1-6 0ZM5.5 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM14.5 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 17a3.5 3.5 0 0 1 6.9-.8.75.75 0 0 0 1.2 0A3.5 3.5 0 0 1 17.5 17a.75.75 0 0 1-.75.75H3.25A.75.75 0 0 1 2.5 17Z" />
      </svg>
    ),
  },
    ],
  },
  {
    title: "Takvim",
    items: [
  {
    href: "/app/durusmalar",
    label: "Duruşmalar",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    href: "/app/sureler",
    label: "Süreler",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    href: "/app/gorevler",
    label: "Görevler",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
    ],
  },
  {
    title: "Üretim",
    items: [
  {
    href: "/app/oneriler",
    label: "Öneriler",
    badge: "proposals",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M10 1a6 6 0 0 0-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 0 0 .572.729 6.016 6.016 0 0 0 2.856 0A.75.75 0 0 0 12 15.1v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0 0 10 1ZM8.863 17.414a.75.75 0 0 0-.226 1.483 9.066 9.066 0 0 0 2.726 0 .75.75 0 0 0-.226-1.483 7.553 7.553 0 0 1-2.274 0Z" />
      </svg>
    ),
  },
  {
    href: "/app/ictihat",
    label: "İçtihat",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M9.293 2.293a1 1 0 0 1 1.414 0l.5.5a1 1 0 0 1 0 1.414l-.379.379 4.293 4.293a.75.75 0 0 1-.53 1.28h-1.44l1.69 3.38a.75.75 0 0 1-.67 1.086h-4.5a.75.75 0 0 1-.67-1.086l1.69-3.38H9.25a.75.75 0 0 1-.53-1.28l1.72-1.72-1.5-1.5-1.72 1.72a.75.75 0 0 1-1.28.53v1.44l-3.38 1.69a.75.75 0 0 1-1.086-.67v-4.5a.75.75 0 0 1 1.086-.67l3.38 1.69V7.75a.75.75 0 0 1 1.28-.53l.379-.379-.379-.378a1 1 0 0 1 0-1.415l.5-.5ZM3.75 16.5a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H3.75Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
    ],
  },
  {
    // Faz 5 — Modül 19. Müvekkille yapılan yazışmanın tek adresi; onay bekleyen
    // giden mesajlar da buradan yönetilir.
    title: "İletişim",
    items: [
      {
        href: "/app/iletisim",
        label: "İletişim Merkezi",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M3 4a2 2 0 0 0-2 2v.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 6.161V6a2 2 0 0 0-2-2H3Z" />
            <path d="m19 7.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 7.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7.839Z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Para",
    items: [
      {
        href: "/app/finans",
        label: "Finans",
        // FINANCE_ACCESS.READ (finance-access.ts): STAJYER dışarıda — menü de
        // öyle. Süzme yalnızca GÖRÜNÜMDÜR; gerçek kapı sunucudadadır.
        roles: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"],
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M1 4.25A2.25 2.25 0 0 1 3.25 2h13.5A2.25 2.25 0 0 1 19 4.25v11.5A2.25 2.25 0 0 1 16.75 18H3.25A2.25 2.25 0 0 1 1 15.75V4.25Zm4.75 8.5a.75.75 0 0 0 1.5 0V9.31l1.72 1.72a.75.75 0 0 0 1.06 0l2-2 2.72 2.72a.75.75 0 1 0 1.06-1.06l-3.25-3.25a.75.75 0 0 0-1.06 0l-2 2-2.5-2.5a.75.75 0 0 0-1.25.56v5.25Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
      {
        href: "/app/faturalar",
        label: "Faturalar",
        // Fatura okuma FINANCE_ACCESS.READ: STAJYER dışarıda.
        roles: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"],
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M4 2.75A1.75 1.75 0 0 1 5.75 1h8.5A1.75 1.75 0 0 1 16 2.75v15.06a.75.75 0 0 1-1.14.64L13 17.29l-1.86 1.16a.75.75 0 0 1-.79 0L8.5 17.29l-1.86 1.16a.75.75 0 0 1-.79 0L4 17.29l-.86.54A.75.75 0 0 1 2 17.19V2.75A1.75 1.75 0 0 1 3.75 1H4v1.75Zm3 2a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H7Zm0 3.5a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H7Zm0 3.5a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5H7Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
      {
        href: "/app/zaman",
        label: "Zaman Kaydı",
        // TIME_WRITE (finance-access.ts): STAJYER zaman kaydı yazamaz.
        roles: ["ADMIN", "PARTNER", "AVUKAT", "SEKRETER"],
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M7.5 1.75A.75.75 0 0 1 8.25 1h3.5a.75.75 0 0 1 0 1.5h-1v1.29a7 7 0 0 1 3.36 1.4l.94-.94a.75.75 0 1 1 1.06 1.06l-.93.93A7 7 0 1 1 9.25 3.79V2.5h-1a.75.75 0 0 1-.75-.75ZM10.75 8a.75.75 0 0 0-1.5 0v3.25c0 .2.08.39.22.53l2 2a.75.75 0 1 0 1.06-1.06l-1.78-1.78V8Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
      {
        href: "/app/uyap",
        label: "UYAP Eklentisi",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M5.5 2.5A1.5 1.5 0 0 0 4 4v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 10.378 2H5.5Zm2.75 7.75a.75.75 0 0 1 .75-.75h2.5a.75.75 0 1 1 0 1.5h-.69l-1.22 2.44 1.06 1.06a.75.75 0 0 1-.53 1.28H8.25a.75.75 0 0 1 0-1.5h1.19l-.94-.94a.75.75 0 0 1-.14-.85l.86-1.74H9a.75.75 0 0 1-.75-.75Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
    ],
  },
  {
    // Faz 6 — Kurumsal raporlama. Rapor kataloğu SUNUCUDA rol süzgecinden
    // geçtiği için menü öğesi herkese görünür; içeride kimin ne göreceğine
    // sunucu karar verir (STAJYER finans, SEKRETER kârlılık kısıtı).
    title: "Raporlama",
    items: [
      {
        href: "/app/raporlar",
        label: "Raporlar",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M3 3.75A1.75 1.75 0 0 1 4.75 2h10.5A1.75 1.75 0 0 1 17 3.75v12.5A1.75 1.75 0 0 1 15.25 18H4.75A1.75 1.75 0 0 1 3 16.25V3.75ZM6.5 13.5a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-1.5 0v3Zm3-6a.75.75 0 0 1 1.5 0v6a.75.75 0 0 1-1.5 0v-6Zm3.75 2.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3a.75.75 0 0 0-.75-.75Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
      {
        href: "/app/araclar/vekalet-ucreti",
        label: "Vekalet Ücreti Hesabı",
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM4.34 4.34a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1-1.06 1.06L4.34 5.4a.75.75 0 0 1 0-1.06Zm11.32 0a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.06ZM10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM10 12.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Z"
              clipRule="evenodd"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Ayarlar",
    items: [
      {
        // Büro personeli — lisans kapsamındaki kullanıcılar (K-03 uçları, UI).
        href: "/app/ayarlar/kullanicilar",
        label: "Kullanıcılar",
        roles: ["ADMIN", "PARTNER"],
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
          </svg>
        ),
      },
  {
    // Modül 26 — dönemsel kredi tüketimi, paketler, otomatik yükleme.
    href: "/app/ayarlar/ai-kullanim",
    label: "AI Kullanımı",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M15.98 1.804a1 1 0 0 0-1.196.15l-9.5 9.5A1 1 0 0 0 6 13.25h3.19l-1.16 4.63a1 1 0 0 0 1.68.97l9.5-9.5A1 1 0 0 0 18.5 7.75h-3.19l1.16-4.63a1 1 0 0 0-.49-1.316Z" />
      </svg>
    ),
  },
  {
    // Disk kotası — plan dahili + satın alınan ek paketler.
    href: "/app/ayarlar/disk-kotasi",
    label: "Disk Kotası",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
      </svg>
    ),
  },
  {
    href: "/app/ayarlar/ai-saglayici",
    label: "AI Sağlayıcı",
    // K-9: sağlayıcı uçları ROLE_SETS.ONAY (ADMIN/PARTNER) — menü de öyle.
    roles: ["ADMIN", "PARTNER"],
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
        <path
          fillRule="evenodd"
          d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [pendingProposals, setPendingProposals] = useState(0);
  /**
   * Kredi göstergesi. Uç yoksa `wallet` null kalır ve gösterge tamamen gizlenir
   * — kredi hattının eksikliği panelde hata göstermez.
   */
  const { wallet } = useWallet();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/giris");
      return;
    }
    setUser(getStoredUser());
    setReady(true);
  }, [router]);

  /**
   * Bekleyen öneri rozeti. Uç henüz yayında değilse 0 döner ve rozet gizlenir;
   * öneri onaylandığında sayfalar `nomosos:proposals-changed` olayını yayar.
   */
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const refresh = () => {
      void countPendingProposals().then((n) => {
        if (alive) setPendingProposals(n);
      });
    };
    refresh();
    window.addEventListener("nomosos:proposals-changed", refresh);
    const timer = window.setInterval(refresh, 120_000);
    return () => {
      alive = false;
      window.removeEventListener("nomosos:proposals-changed", refresh);
      window.clearInterval(timer);
    };
  }, [ready, pathname]);

  function handleLogout() {
    clearToken();
    router.replace("/giris");
  }

  /**
   * Rol bazlı menü süzmesi. `roles` alanı taşıyan öğeler yalnız o rollere
   * gösterilir; alan taşımayanlar herkese açıktır. Bu GÖRÜNÜM süzmesidir —
   * yetkiyi SUNUCU belirler: süzülmeyen bir sayfaya girmeye çalışan yetkisiz
   * rol sunucudan 403 alır, menü bunu "saklamaz".
   */
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !("roles" in item && item.roles) ||
        !user?.role ||
        (item.roles as readonly string[]).includes(user.role),
    ),
  })).filter((group) => group.items.length > 0);

  /** Demo gezinti şeridi: /demo-giris'ten gelindiyse rolü her ekranda göster. */
  const demoRole = getDemoRole();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Oturum doğrulanıyor…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/*
        Sol menü. `print:hidden` — yazdırmada menü kâğıda basılmaz; rapor
        sayfaları A4'e tam genişlikte çıksın diye içerik sarmalayıcısının sol
        boşluğu da (`ml-60`) baskıda sıfırlanır.
      */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-slate-900 print:hidden">
        <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
            <rect width="32" height="32" rx="7" className="fill-amber-500" />
            <path
              d="M16 6l2.1 4.6 4.9.6-3.6 3.4.9 4.9L16 17l-4.3 2.5.9-4.9L9 11.2l4.9-.6L16 6z"
              className="fill-slate-900"
            />
            <rect x="8" y="23" width="16" height="2.5" rx="1.25" className="fill-slate-900" />
          </svg>
          <span className="text-lg font-bold text-white">
            Nomos<span className="text-amber-400">OS</span>
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3" aria-label="Ana menü">
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.title} className={groupIndex > 0 ? "mt-5" : ""}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(item.href + "/");
                  const badgeCount = item.badge === "proposals" ? pendingProposals : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-amber-500 text-slate-900"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      {item.icon}
                      <span className="flex-1">{item.label}</span>
                      {badgeCount > 0 && (
                        <span
                          title={`${badgeCount} öneri onayınızı bekliyor`}
                          className={`inline-flex min-w-[1.35rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                            active ? "bg-slate-900 text-amber-400" : "bg-amber-500 text-slate-900"
                          }`}
                        >
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        {/* F2-Ö-26: slate-900 zemin üzerinde slate-500 (3.7:1) AA altındaydı;
            slate-300 (9.2:1) koyu zemin için doğru tondur ve açık-zemin
            yasağına takılmaz. */}
        <div className="border-t border-slate-800 px-5 py-3 text-[11px] text-slate-300">
          <p>NomosOS · AI-Native Legal OS</p>
          <p className="mt-1">
            <a
              href="https://mindaeon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 transition-colors hover:text-amber-400 hover:underline"
            >
              Developed by MindAeon AI
            </a>
          </p>
        </div>
      </aside>

      {/* İçerik */}
      <div className="ml-60 flex min-h-screen flex-1 flex-col print:ml-0">
        {demoRole && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-6 py-2 text-sm text-amber-900 print:hidden"
          >
            <p className="font-medium">
              🎯 Demo gezinti —{" "}
              {USER_ROLE_LABELS[user?.role ?? demoRole] ?? demoRole} olarak
              inceliyorsunuz. Menü ve yetkiler bu role göre süzüldü.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => router.push("/demo-giris")}
                className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-50"
              >
                Rol değiştir
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
              >
                Demodan çık
              </button>
            </div>
          </div>
        )}
        <header className="sticky top-0 z-20 flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3 print:hidden">
          <CreditMeter wallet={wallet} />
          <NotificationBell />
          <div className="text-right">
            <p className="text-sm font-medium text-slate-900">{user?.fullName ?? user?.email ?? "Kullanıcı"}</p>
            {/* İ-20: ham enum basılmaz — Türkçe rol etiketi (biçim: "Avukat"). */}
            {user?.role && (
              <p className="text-xs text-slate-500">{USER_ROLE_LABELS[user.role] ?? "Kullanıcı"}</p>
            )}
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-amber-400">
            {(user?.fullName ?? user?.email ?? "?").charAt(0).toUpperCase()}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            Çıkış
          </button>
        </header>
        <main className="flex-1 space-y-4 p-6 print:p-0">
          <CreditWarningBanner wallet={wallet} />
          <CreditErrorAlert />
          {children}
        </main>
      </div>
    </div>
  );
}
