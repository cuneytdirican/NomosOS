"use client";

/**
 * OFİS İÇİ AVATAR (D1.4) — profil fotoğrafı görüntüleme + yükleme.
 *
 * Görüntüleme: GET /chat/users/:id/avatar → { url } (ön-imzalı, kısa ömürlü).
 * Yükleme (kendi avatarın): POST /chat/avatar/presign → PUT → PATCH /chat/avatar.
 *
 * URL önbelleği modül düzeyinde tutulur; 10 dk sonra yeniden çekilir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const urlCache = new Map<string, { url: string; at: number }>();
const TTL_MS = 10 * 60_000;

export function useAvatar(userId: string | null | undefined, hasAvatar: boolean | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !hasAvatar) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(userId);
    if (cached && Date.now() - cached.at < TTL_MS) {
      setUrl(cached.url);
      return;
    }
    let alive = true;
    void api<{ url: string }>(`/chat/users/${userId}/avatar`)
      .then((res) => {
        urlCache.set(userId, { url: res.url, at: Date.now() });
        if (alive) setUrl(res.url);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [userId, hasAvatar]);

  return url;
}

/** Avatar dairesi — foto varsa foto, yoksa baş harfler. */
export function Avatar({
  fullName,
  url,
  online,
  size = 40,
}: {
  fullName: string;
  url: string | null;
  online?: boolean;
  size?: number;
}) {
  const initials = fullName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {url ? (
        // Ön-imzalı dış URL — Next/Image gerektirmez, img öğesi bilinçli.
        <img
          src={url}
          alt={fullName}
          className="h-full w-full rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
          style={{ width: size, height: size, fontSize: Math.round(size / 3) }}
        >
          {initials}
        </span>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
      )}
    </span>
  );
}

/** Kendi avatarını yükleme düğmesi — dosya seçtirir, yükler, bağlar. */
export function AvatarUploadButton({ onDone }: { onDone?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const presign = await api<{ uploadUrl: string; headers: Record<string, string>; storageKey: string }>(
          "/chat/avatar/presign",
          {
            method: "POST",
            body: {
              fileName: file.name,
              mimeType: file.type || "image/jpeg",
              sizeBytes: file.size,
            },
          },
        );
        await fetch(presign.uploadUrl, { method: "PUT", headers: presign.headers, body: file });
        await api("/chat/avatar", { method: "PATCH", body: { storageKey: presign.storageKey } });
        onDone?.();
      } catch (err) {
        setError("Avatar yüklenemedi (en fazla 5 MB; JPEG/PNG/WebP).");
        void err;
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  return (
    <span className="relative inline-flex flex-col items-end">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="text-[11px] font-medium text-amber-700 underline disabled:text-slate-500"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "yükleniyor…" : "Profil fotoğrafı yükle"}
      </button>
      {error && <span className="text-[10px] text-red-700">{error}</span>}
    </span>
  );
}
