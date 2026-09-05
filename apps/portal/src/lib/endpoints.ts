/**
 * PORTAL UÇ TABLOSU — istemci tarafındaki TEK kaynak.
 *
 * Yollar `/api/v1/portal` ÖNEĞİ OLMADAN yazılır; öneki `portalApi()` ekler.
 * Yani `EP.cases` → `GET {API_BASE}/api/v1/portal/cases`.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BU TABLO SUNUCUNUN GERÇEK UÇLARIYLA HİZALIDIR                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Denetim bulgusu G: arayüz ile `apps/api/src/portal` birbirinden habersiz
 * yazılmıştı ve tablo, var olmayan uçlara işaret ediyordu (`/my-lawyer`,
 * `/cases/:id/timeline`, `GET /auth/invite/:token`). Giriş bile çalışmıyordu:
 * ekran `res.token` bekliyor, sunucu `accessToken` döndürüyordu. Artık her
 * satır `apps/api/src/portal/portal.controller.ts` ve `portal-auth.controller.ts`
 * içindeki gerçek bir uca karşılık gelir.
 */

export const EP = {
  auth: {
    /** POST { email, password } → { accessToken, portalUser } */
    login: "/auth/login",
    /** GET → oturum sahibinin profili (müvekkil ve büro adı sunucudan tazelenir). */
    me: "/auth/me",
    /**
     * POST → SUNUCU TARAFI ÇIKIŞ. Hesabın oturum damgası tazelenir ve bu andan
     * önce üretilmiş TÜM portal token'ları geçersizleşir — yalnız bu
     * tarayıcıdaki değil, kopyalanmış olabilecek her biri.
     */
    logout: "/auth/logout",
    /**
     * POST { token } → { valid, email, clientName, officeName, expiresAt }
     *
     * TOKEN GÖVDEDE TAŞINIR, YOLDA DEĞİL. Yol parametresi olsaydı ham davet
     * token'ı tarayıcı geçmişine, ters vekil/CDN erişim günlüklerine ve
     * `Referer` başlığına düşerdi; o günlüğü okuyabilen biri daveti kendi
     * belirlediği parolayla kullanabilirdi.
     */
    inviteCheck: "/auth/invite/check",
    /** POST { token, fullName, password } → { accessToken, portalUser } */
    acceptInvite: "/auth/accept-invite",
  },

  /** GET → panelin kartları tek istekte (özet). */
  dashboard: "/dashboard",

  /** GET → yayınlanmış dosyalar. Yayınlanmamış dosya bu listede HİÇ yer almaz. */
  cases: "/cases",
  case: (id: string) => `/cases/${id}`,

  /**
   * GET ?caseId= → yayınlanmış safahat özetleri (avukatın dondurduğu metin).
   * Dosya detayı bunu zaten içinde döndürür; bu uç yedek yoldur.
   */
  timeline: "/timeline",

  /** Faz 7F — yapılacaklar, belge yükleme, rızalar. */
  todos: "/todos",
  todoComplete: (id: string) => `/todos/${id}/complete`,
  documentUpload: "/documents",
  consents: "/consents",
  /** GET → yayınlanmış belgeler (`?caseId=` ile daraltılabilir). */
  documents: "/documents",
  /** GET → kısa ömürlü imzalı indirme adresi ({ url, expiresIn, name }). */
  documentDownload: (id: string) => `/documents/${id}/download`,

  /** GET → yayınlanmış duruşmalar. */
  hearings: "/hearings",
  /** E9 (rakip analizi) — portal randevu self-servisi. */
  randevular: "/randevular",
  randevuIptal: (id: string) => `/randevular/${encodeURIComponent(id)}/iptal`,

  /**
   * GET → yayınlanmış faturalar / tahsilatlar. AYRI UÇLARDIR: sunucuda tek bir
   * "ödemeler" birleşimi yoktur, bakiye ise panel özetinden gelir (tutarlar
   * `Prisma.Decimal` ile SUNUCUDA hesaplanır; portal hiçbir tutarı toplamaz).
   */
  invoices: "/invoices",
  payments: "/payments",

  /** GET → yazışma geçmişi · POST { body, caseId? } → yeni mesaj. */
  messages: "/messages",

  /** GET → sorumlu avukat kartı ({ officeName, lawyers[] }). */
  myLawyer: "/lawyer",
} as const;
