import { NextRequest, NextResponse } from "next/server";

/**
 * İ-55: /app kabuğu istemci tarafında oturumu localStorage'dan okur —
 * sunucu ilk HTML'de korumasız kabuk render eder. Bu middleware, token'sız
 * isteklerde /app/** yolunu /giris'e yönlendirir; oturum kontrolü İSTEMCİDE
 * de yapılır ama sunucu ilk HTML'i boş göstermez.
 *
 * NOT: Token localStorage'dadır (httpOnly cookie değil — İ-46); middleware
 * yalnız ÇEREZ varlığına bakabilir, token geçerliliğini DOĞRULAYAMAZ
 * (API ayrı origin'de koşar). Bu İLK SATIR savunmadır; gerçek yetki
 * denetimi API tarafındadır.
 */

export function middleware(request: NextRequest) {
  // Yalnızca /app/** yolları (kabuk); giriş, pazarlama, demo serbesttir.
  if (!request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.next();
  }

  // Token çereği var mı? (İstemci localStorage'da tuttuğu için middleware
  // yalnızca bir proxy cookie'si varlığına bakabilir — istemci bunu login'de
  // ayarlar.) Çerez yoksa yönlendir.
  const hasTokenCookie = request.cookies.has("nomosos_session");
  if (!hasTokenCookie) {
    // SPA isteklerinde (fetch) yönlendirme yerine 401 dönmek daha doğru ama
    // Next.js middleware sayfa gezinmelerinde çalışır; API çağrıları buradan
    // geçmez. Sayfa gezinmesi için /giris'e yönlendirmek yeterlidir.
    const loginUrl = new URL("/giris", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
