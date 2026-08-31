/**
 * Portal API yanıt tipleri.
 *
 * TASARIM KARARI — alanların çoğu isteğe bağlıdır (`?`). Portal API'si hazırlanırken
 * ekranın çökmemesi ve "yayınlanmamış alan hiç gelmez" ilkesi bunu gerektirir:
 * bir alan gelmiyorsa yayınlanmamıştır ve ekranda "—" yerine BÖLÜM HİÇ ÇİZİLMEZ.
 *
 * Para alanları `string | number` olarak alınır (Prisma.Decimal string döner) ve
 * yalnızca GÖSTERİLİR. Portalda hiçbir tutar toplanmaz/çarpılmaz — mahsuplaşma
 * ve bakiye sunucunun deterministik hesabıdır.
 */

export type Money = string | number;

/**
 * `GET /auth/me` yanıtı.
 *
 * ALAN ADLARI SUNUCUNUNKİLERDİR (denetim bulgusu G): müvekkil kaydı `client`
 * nesnesi olarak, büro adı `officeName` olarak gelir. Arayüz eskiden düz
 * `clientName`/`tenantName` bekliyordu ve başlıkta müvekkil/büro adı boş
 * kalıyordu. Eski adlar UYUMLULUK İÇİN isteğe bağlı bırakıldı; okuma
 * `toStoredUser()` üzerinden yapılır.
 */
export interface PortalProfile {
  id: string;
  email: string;
  fullName?: string;
  /** Müvekkil kaydı — sunucunun döndürdüğü biçim. */
  client?: { id?: string; name?: string; type?: string } | null;
  /** Büronun adı (white-label başlık). */
  officeName?: string | null;
  lastLoginAt?: string;
  activatedAt?: string;
}

/**
 * Giriş ve davet kabulü AYNI biçimi döndürür — iki akış tek kod yolundan geçer.
 * (`accessToken`, `token` DEĞİL: sunucu alanı böyle adlandırır ve arayüz
 * `res.token` beklediği için giriş hiç çalışmıyordu.)
 */
export interface LoginResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: string;
  portalUser?: {
    id?: string;
    email?: string;
    fullName?: string;
    clientId?: string;
    clientName?: string | null;
  };
}

/** `POST /auth/invite/check` yanıtı. */
export interface InviteInfo {
  valid: boolean;
  email?: string;
  clientName?: string;
  officeName?: string | null;
  expiresAt?: string;
  message?: string;
}

/** Panel özeti — dört kart. Uç yoksa kartlar tek tek kendi kaynağından beslenir. */
export interface DashboardSummary {
  activeCaseCount?: number;
  nextHearing?: PortalHearing | null;
  openBalance?: Money | null;
  openInvoiceCount?: number;
  unreadMessageCount?: number;
  lastMessageAt?: string | null;
  clientName?: string;
  lawyerName?: string;
}

export interface PortalCase {
  id: string;
  /** Mahkeme esas numarası — "2026/145". */
  fileNumber?: string;
  caseNumber?: string;
  title?: string;
  subject?: string;
  courtName?: string;
  court?: string;
  /** Şema enum'u (CaseStatus). Ekranda sade karşılığı gösterilir. */
  status?: string;
  type?: string;
  openedAt?: string;
  /** Avukatın yayınladığı, müvekkil diline çevrilmiş güncel durum cümlesi. */
  statusSummary?: string;
  summary?: string;
  lastUpdateAt?: string;
  nextHearing?: PortalHearing | null;
  parties?: PortalParty[];
  documents?: PortalDocument[];
  timeline?: PortalTimelineEntry[];
  lawyerName?: string;
}

export interface PortalParty {
  id?: string;
  name?: string;
  /** PartyRole enum'u — DAVACI / DAVALI / ALACAKLI … */
  role?: string;
  /** Bu taraf müvekkilin kendisi mi? ("Siz" olarak işaretlenir.) */
  isSelf?: boolean;
}

export interface PortalTimelineEntry {
  id: string;
  /** Avukat onayından geçmiş, sade dille yazılmış özet. Ham safahat metni DEĞİL. */
  summary?: string;
  title?: string;
  description?: string;
  occurredAt?: string;
  date?: string;
  publishedAt?: string;
}

export interface PortalDocument {
  id: string;
  name?: string;
  fileName?: string;
  title?: string;
  /** DocumentClass enum'u — DILEKCE, TENSIP_ZAPTI … */
  documentClass?: string;
  mimeType?: string;
  sizeBytes?: number | string;
  publishedAt?: string;
  createdAt?: string;
  caseId?: string;
  caseTitle?: string;
  caseFileNumber?: string;
  /** Sunucu hazır bir indirme adresi döndürebilir; yoksa download ucu çağrılır. */
  downloadUrl?: string;
}

export interface PortalHearing {
  id: string;
  scheduledAt?: string;
  date?: string;
  courtName?: string;
  court?: string;
  courtRoom?: string;
  /** HearingType enum'u — DURUSMA, ON_INCELEME, KESIF … */
  type?: string;
  /** HearingStatus enum'u — PLANLANDI, YAPILDI … */
  status?: string;
  caseId?: string;
  caseTitle?: string;
  caseFileNumber?: string;
  /** Avukatın yayınladığı duruşma sonucu özeti (geçmiş duruşmalarda). */
  resultSummary?: string;
  /** Müvekkilin duruşmaya katılması gerekiyor mu? */
  clientAttendanceRequired?: boolean;
  note?: string;
}

export interface PortalInvoice {
  id: string;
  invoiceNumber?: string;
  number?: string;
  issuedAt?: string;
  issueDate?: string;
  dueDate?: string;
  /** InvoiceStatus enum'u — TASLAK, GONDERILDI, KISMI_ODENDI, ODENDI … */
  status?: string;
  total?: Money;
  grandTotal?: Money;
  paidAmount?: Money;
  remainingAmount?: Money;
  currency?: string;
  description?: string;
  caseId?: string;
  caseTitle?: string;
  documentId?: string;
}

export interface PortalPayment {
  id: string;
  paidAt?: string;
  date?: string;
  amount?: Money;
  currency?: string;
  /** PaymentMethod enum'u — HAVALE, KREDI_KARTI … */
  method?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  note?: string;
}

export interface PaymentsResponse {
  openBalance?: Money;
  balance?: Money;
  currency?: string;
  invoices?: PortalInvoice[];
  payments?: PortalPayment[];
}

export interface PortalMessage {
  id: string;
  body?: string;
  subject?: string | null;
  /** Sunucunun yönü: "BENDEN" = müvekkil yazdı, "BURODAN" = büro gönderdi. */
  direction?: "BENDEN" | "BURODAN";
  /** Sunucunun zaman damgası (gönderim/geliş anı). */
  at?: string | null;
  /** "MUVEKKIL" | "BURO" — kimin yazdığı. Sunucu farklı adlandırırsa senderRole'a bakılır. */
  sender?: string;
  senderRole?: string;
  senderName?: string;
  /** true → müvekkilin kendi mesajı. */
  fromClient?: boolean;
  createdAt?: string;
  sentAt?: string;
  readAt?: string | null;
  caseId?: string;
  caseTitle?: string;
  /** TASLAK / ONAY_BEKLIYOR mesajlar portala DÜŞMEZ; yalnız gönderilmiş olanlar gelir. */
  status?: string;
}

export interface PortalLawyer {
  id?: string;
  fullName?: string;
  name?: string;
  title?: string;
  role?: string;
  email?: string;
  phone?: string;
  /** Büro bilgileri */
  tenantName?: string;
  officeName?: string;
  officeAddress?: string;
  officePhone?: string;
  workingHours?: string;
  photoUrl?: string;
}
