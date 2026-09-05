"use client";

/** Faz 8B — zorunlu sözleşmeler güncel sürümde kabul edilmemişse şerit (işi durdurmaz). */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { TERMS_ROUTES } from "@nomosos/shared";

export function TermsBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    api<{ missingRequired: string[] }>(TERMS_ROUTES.status)
      .then((r) => setMissing(r.missingRequired ?? []))
      .catch(() => setMissing([]));
  }, []);
  if (missing.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status" data-testid="sozlesme-seridi">
      Büronuz adına kabul edilmesi gereken {missing.length} sözleşme metni var (
      {missing.map((m) => (m === "HIZMET_SOZLESMESI" ? "Hizmet sözleşmesi" : m === "DPA" ? "Veri işleme protokolü" : m === "MESAFELI_SATIS" ? "Mesafeli satış" : m)).join(", ")}).{" "}
      <Link href="/app/ayarlar/sozlesmeler" className="font-semibold underline">
        Sözleşmeler sayfasına gidin
      </Link>
      .
    </div>
  );
}
