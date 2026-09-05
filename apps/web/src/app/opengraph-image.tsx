import { ImageResponse } from "next/og";

/** Faz 8A — varsayılan OG görseli (1200×630). Tokmak/gavel görseli KULLANILMAZ (Türk mahkemelerinde yoktur). */
export const runtime = "nodejs";
export const alt = "NomosOS — Büronuzun bütün işi. Tek sistemde.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 84px",
          background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
          color: "#F8FAFC",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", color: "#0F172A", fontSize: 34, fontWeight: 700 }}>N</div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
            Nomos<span style={{ color: "#F59E0B" }}>OS</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>Büronuzun bütün işi. Tek sistemde.</div>
          <div style={{ fontSize: 28, color: "#CBD5E1", lineHeight: 1.4, maxWidth: 980, fontFamily: "Arial, Helvetica, sans-serif" }}>
            Müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay zekâ katmanı. Kendi yapay zekânızı bağlayın, verileriniz büronuzdan çıkmasın.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#94A3B8", fontFamily: "Arial, Helvetica, sans-serif" }}>
          <span>Türk hukuk büroları için AI-Native Legal OS</span>
          <span>nomosos.com</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
