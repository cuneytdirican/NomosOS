"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

interface StatusPayload {
  status: "operational" | "degraded" | "major_outage";
  time: string;
  version: string;
  components: Array<{ name: string; status: "operational" | "not_configured" | "outage"; durationMs: number | null }>;
  announcements: Array<{ id: string; title: string; severity: string; publishedAt: string }>;
}

const LABELS: Record<string, string> = { postgres: "Veritabanı", redis: "Kuyruk / önbellek", s3: "Belge deposu", api: "API" };
const OVERALL: Record<StatusPayload["status"], { text: string; cls: string }> = {
  operational: { text: "Tüm sistemler çalışıyor", cls: "bg-[#e4efe8] text-[#1f5a3a]" },
  degraded: { text: "Kısmi yavaşlama", cls: "bg-[#f6efd8] text-[#7a6220]" },
  major_outage: { text: "Kesinti var", cls: "bg-[#f4dede] text-[#8a2b2b]" },
};

export function StatusBoard() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/public/status`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as StatusPayload;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(`Durum ucu okunamadı (${(err as Error).message}). API erişilemez olabilir.`);
      }
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (error && !data) {
    return (
      <div className="mt-10 rounded-[5px] border border-[#e6c9c9] bg-[#f4dede] p-6 text-[#8a2b2b]" data-testid="durum-hata">
        <p className="font-semibold">Kesinti şüphesi</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }
  if (!data) return <p className="mt-10 text-sm text-[var(--ink-soft)]">Durum okunuyor…</p>;
  const overall = OVERALL[data.status];
  return (
    <div className="mt-10 space-y-6" data-testid="durum-panosu">
      <div className={`rounded-[5px] px-5 py-4 text-[1.05rem] font-semibold ${overall.cls}`}>{overall.text}</div>
      <ul className="overflow-hidden rounded-[5px] border border-[var(--rule)] bg-white">
        {data.components.map((c) => (
          <li key={c.name} className="flex items-center justify-between border-b border-[var(--rule)] px-5 py-3 last:border-b-0">
            <span className="text-[var(--ink)]">{LABELS[c.name] ?? c.name}</span>
            <span className="flex items-center gap-3 text-sm">
              {c.durationMs !== null && <span className="tnum text-[var(--ink-soft)]">{c.durationMs} ms</span>}
              <span className={c.status === "operational" ? "text-[#1f5a3a]" : c.status === "not_configured" ? "text-[var(--ink-soft)]" : "text-[#8a2b2b]"}>
                {c.status === "operational" ? "Çalışıyor" : c.status === "not_configured" ? "Yapılandırılmamış" : "Kesinti"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {data.announcements.length > 0 && (
        <div className="rounded-[5px] border border-[var(--rule)] bg-white p-5">
          <p className="serif font-semibold">Duyurular</p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ink-soft)]">
            {data.announcements.map((a) => (
              <li key={a.id}>
                <span className="tnum">{new Date(a.publishedAt).toLocaleDateString("tr-TR")}</span> · {a.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="tnum text-xs text-[var(--ink-soft)]">
        Son okuma {new Date(data.time).toLocaleTimeString("tr-TR")} · sürüm {data.version}
      </p>
    </div>
  );
}
