/**
 * DEMO TALEBİ UCU — `POST /api/demo-talebi`
 *
 * NEDEN VAR: Form, hiçbir yere istek atmadan kullanıcıya "Talebiniz alındı."
 * diyordu — gerçekleşmeyecek bir söz. Artık talep SİSTEME YAZILIR.
 *
 * TASARIM (kullanıcı kararı — e-posta/webhook YOK):
 *   1. Talep, NomosOS API'sine iletilir: `POST /api/v1/demo-talepleri` (herkese
 *      açık uç) ve DemoRequest KAYDI olarak düşer. Platform yönetim panelindeki
 *      "Demo Talepleri" sayfasından takip edilir; hiçbir e-posta gönderilmez.
 *   2. API yazımı düşerse `delivered: false` döner ve form kullanıcıyı
 *      doğrudan e-postaya yönlendirir (hazır doldurulmuş `mailto`). Form ASLA
 *      iletilmemiş bir talebi "alındı" diye göstermez.
 *
 * KİŞİSEL VERİ: gövde diske yazılmaz ve günlüğe BASILMAZ. Günlüğe yalnız
 * "talep geldi / kaydedildi mi" bilgisi düşer; ad, e-posta, telefon düşmez.
 */

import { NextResponse } from "next/server";

/** Statik üretimde değil, istek anında çalışır. */
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ *
 * HIZ SINIRI (denetim bulgusu İ-25)
 *
 * Form kimlik istemez (kimlikli uçlara hız sınırı koyan LoginThrottleGuard
 * burada devrede değildir); sınır olmazsa tek bir betik webhook'u doldurur
 * ve satış ekibi gerçek talepleri sahte talepler içinde kaybeder.
 *
 * Süreç-içi sayaç: yığın tek kapsayıcıda koşar (docker-compose.test.yml).
 * Çok örnekli dağıtımda her örnek kendi kovasını sayar — o durumda sayaç
 * Redis'e taşınır (API'deki common/rate-limit deseni).
 * ------------------------------------------------------------------ */
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60_000;

const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Harita sınırsız büyümesin: penceresi kapanmış anahtarları düşür.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

interface DemoRequestBody {
  fullName?: unknown;
  barAssociation?: unknown;
  email?: unknown;
  phone?: unknown;
  lawyerCount?: unknown;
  message?: unknown;
  consent?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  // HIZ SINIRI en başta: gövdeyi okumadan reddet (İ-25).
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "bilinmeyen";
  if (rateLimited(ip)) {
    return NextResponse.json(
      {
        ok: false,
        hata:
          "Kısa sürede çok fazla talep gönderildi. Lütfen 10 dakika sonra tekrar deneyin " +
          // Gerçek demo hattı (content.ts demo.fallback.mailTo ile aynı adres) —
          // ölü adres göstermek hız sınırına takılan kullanıcıyı çıkmaza sokar (F2-Ö-28).
          "veya doğrudan demo@nomosos.com adresine yazın.",
      },
      { status: 429 },
    );
  }

  let body: DemoRequestBody;
  try {
    body = (await request.json()) as DemoRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, hata: "İstek gövdesi okunamadı." },
      { status: 400 },
    );
  }

  // KVKK ONAYI SUNUCUDA DA ZORUNLUDUR. İstemci tarafındaki `required` +
  // `disabled` + handler kontrolü kullanıcı deneyimi içindir; onayın kaydı
  // burada tutulur ve istemciye güvenilmez.
  if (body.consent !== true) {
    return NextResponse.json(
      {
        ok: false,
        hata:
          "Talebi iletebilmek için kişisel verilerinizin işlenmesine ilişkin onay zorunludur.",
      },
      { status: 400 },
    );
  }

  const payload = {
    fullName: text(body.fullName, 200),
    barAssociation: text(body.barAssociation, 200),
    email: text(body.email, 200),
    phone: text(body.phone, 50),
    lawyerCount: text(body.lawyerCount, 20),
    message: text(body.message, 2000),
  };

  if (!payload.fullName || !payload.email) {
    return NextResponse.json(
      { ok: false, hata: "Ad soyad ve e-posta zorunludur." },
      { status: 400 },
    );
  }

  // Talebi SİSTEME YAZ: NomosOS API → DemoRequest kaydı → platform paneli
  // (kullanıcı kararı: e-posta/webhook gönderilmez, kayıt panelden izlenir).
  const apiBase = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:3001";
  try {
    const response = await fetch(`${apiBase}/api/v1/demo-talepleri`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // API kendisi hız sınırına takılmış olabilir (429) — kullanıcıya ilet,
      // sessizce "alındı" deme.
      if (response.status === 429) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        return NextResponse.json(
          {
            ok: false,
            hata:
              data?.message ??
              "Kısa sürede çok fazla talep gönderildi. Lütfen 10 dakika sonra tekrar deneyin.",
          },
          { status: 429 },
        );
      }
      console.error(`[demo-talebi] API ucu ${response.status} döndü.`);
      return NextResponse.json({ ok: true, delivered: false });
    }
    console.info("[demo-talebi] Talep kaydedildi (DemoRequest).");
    return NextResponse.json({ ok: true, delivered: true });
  } catch (err) {
    // Ayrıntı günlüğe düşer, kullanıcıya e-posta yolu gösterilir.
    console.error(`[demo-talebi] Kayit basarisiz: ${(err as Error).message}`);
    return NextResponse.json({ ok: true, delivered: false });
  }
}
