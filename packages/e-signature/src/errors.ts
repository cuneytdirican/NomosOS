/**
 * E-imza hata sınıfları.
 *
 * TASARIM: bu paket NestJS'e bağımlı DEĞİLDİR (HttpException kullanmaz).
 * apps/api katmanı `code` alanına bakarak HTTP karşılığını seçer:
 *   SAGLAYICI_YAPILANDIRILMAMIS → 503 / anlamlı 409
 *   IMZACI_DOGRULAMA            → 400
 *   GECERSIZ_DURUM_GECISI       → 400
 *   SAGLAYICI_HATASI            → 502
 *
 * MESAJLAR TÜRKÇEDİR ve doğrudan kullanıcıya gösterilebilir; sağlayıcı ham
 * yanıtı (anahtar ipucu, iç hata izi taşıyabilir) `cause`ta kalır, mesaja girmez.
 */

export type SignatureErrorCode =
  | "SAGLAYICI_YAPILANDIRILMAMIS"
  | "IMZACI_DOGRULAMA"
  | "GECERSIZ_DURUM_GECISI"
  | "SAGLAYICI_HATASI"
  | "SUREC_BULUNAMADI"
  | "BELGE_HAZIR_DEGIL";

export class SignatureProviderError extends Error {
  readonly code: SignatureErrorCode;
  readonly providerKey: string;
  /** Sağlayıcının ham yanıtı — LOG'a yazılır, kullanıcıya GÖSTERİLMEZ. */
  readonly cause?: unknown;

  constructor(
    code: SignatureErrorCode,
    message: string,
    providerKey: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SignatureProviderError";
    this.code = code;
    this.providerKey = providerKey;
    this.cause = cause;
  }
}

/**
 * Sağlayıcı tanımlı değil.
 *
 * BU HATA BİR ÖZELLİK EKSİKLİĞİ DEĞİL, BİLİNÇLİ BİR SÖZLEŞMEDİR: gerçek bir
 * NES/mobil imza sağlayıcısına ait kimlik bilgisi olmadan sistem SAHTE İMZA
 * ÜRETMEZ. Sözleşme IMZAYA_HAZIR durumunda kalır, imzalıymış gibi işaretlenmez.
 */
export class SignatureProviderNotConfiguredError extends SignatureProviderError {
  constructor(providerKey: string, detail?: string) {
    super(
      "SAGLAYICI_YAPILANDIRILMAMIS",
      detail
        ? `E-imza sağlayıcısı yapılandırılmamış. Ayarlar → E-imza bölümünden bir sağlayıcı tanımlayın. (${detail})`
        : "E-imza sağlayıcısı yapılandırılmamış. Ayarlar → E-imza bölümünden bir sağlayıcı tanımlayın.",
      providerKey,
    );
    this.name = "SignatureProviderNotConfiguredError";
  }
}

/** İmzacı listesi geçersiz (boş liste, hatalı e-posta, eksik GSM vb.). */
export class SignatureValidationError extends SignatureProviderError {
  /** Her biri kullanıcıya gösterilebilir Türkçe cümle. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[], providerKey = "-") {
    super(
      "IMZACI_DOGRULAMA",
      issues.length === 1
        ? issues[0]
        : `İmza talebi doğrulanamadı: ${issues.join(" ")}`,
      providerKey,
    );
    this.name = "SignatureValidationError";
    this.issues = issues;
  }
}

/** Durum makinesinin izin vermediği geçiş denendi. */
export class SignatureStateError extends SignatureProviderError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string, message: string, providerKey = "-") {
    super("GECERSIZ_DURUM_GECISI", message, providerKey);
    this.name = "SignatureStateError";
    this.from = from;
    this.to = to;
  }
}

/** Bir hatanın bu paketten çıkıp çıkmadığını güvenle söyler. */
export function isSignatureProviderError(err: unknown): err is SignatureProviderError {
  return err instanceof SignatureProviderError;
}
