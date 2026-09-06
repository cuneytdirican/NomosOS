"use client";

import { useEffect, useState } from "react";

/**
 * Üst reklam şeridi — "Powered by MindAeon AI" + dönen pazarlama sloganları.
 *
 * - Her açılışta RASTGELE bir slogandan başlar (istemcide seçilir; sunucu 0. sloganı
 *   render eder, mount sonrası rastgele indekse geçer → hidrasyon uyuşmazlığı olmaz).
 * - Slogan ~5 sn'de bir yumuşak geçişle döner; altın "shimmer" zemin akar.
 * - Tüm şerit https://mindaeon.com'a gider (yeni sekme).
 * - `prefers-reduced-motion` açıksa animasyonlar durur (globals.css).
 */

const SLOGANS: readonly string[] = [
  "Yapay zekâ ile geleceği inşa ediyoruz",
  "Kurumunuza özel yapay zekâ çözümleri",
  "Fikirden ürüne, yapay zekâ hızıyla",
  "Veriniz sizde kalsın: kendi yapay zekânız",
  "İşinizi otomatikleştirin, zekâyı büyütün",
  "Akıllı yazılım, MindAeon AI imzasıyla",
  "Sektörünüze özel yapay zekâ ajanları",
  "NomosOS'u geliştiren ekip: MindAeon AI",
];

export function MindAeonBanner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(Math.floor(Math.random() * SLOGANS.length));
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % SLOGANS.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <a
      href="https://mindaeon.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="MindAeon AI — mindaeon.com (yeni sekmede açılır)"
      className="mindaeon-banner group relative block overflow-hidden text-[var(--paper)]"
      style={{
        backgroundImage:
          "linear-gradient(90deg,#0b1428 0%,#16264a 22%,#b8963e 50%,#16264a 78%,#0b1428 100%)",
        backgroundSize: "220% 100%",
      }}
    >
      {/* akan altın parıltı */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 animate-[mindaeon-shimmer_9s_linear_infinite]"
        style={{
          backgroundImage:
            "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.14) 45%,rgba(255,255,255,0.28) 50%,rgba(255,255,255,0.14) 55%,transparent 100%)",
          backgroundSize: "220% 100%",
        }}
      />
      <div className="relative mx-auto flex max-w-[1200px] items-center justify-center gap-3 px-4 py-2 text-[13px] sm:justify-between">
        {/* Sol: kalıcı marka */}
        <span className="flex items-center gap-2 font-medium tracking-wide">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#f4e4b8] opacity-75 animate-[mindaeon-ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#f7edc9]" />
          </span>
          <span>
            Powered by{" "}
            <span className="font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
              MindAeon&nbsp;AI
            </span>
          </span>
        </span>

        {/* Sağ: dönen slogan + CTA */}
        <span className="hidden items-center gap-2 sm:flex">
          <span
            key={index}
            className="animate-[mindaeon-slogan-in_0.6s_ease-out] text-white/95"
          >
            {SLOGANS[index]}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white transition-colors group-hover:bg-white/25">
            Keşfet
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </span>
        </span>
      </div>
    </a>
  );
}
