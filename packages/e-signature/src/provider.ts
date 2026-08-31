/**
 * `ISignatureProvider` — E-İMZA ADAPTÖR SÖZLEŞMESİ.
 *
 * Çekirdek (apps/api/src/contracts) YALNIZ bu beş metodu bilir. Yeni bir NES
 * sağlayıcısı ya da mobil imza operatörü eklemek çekirdeğe DOKUNMAZ: yeni bir
 * sınıf bu arayüzü uygular ve kayıt defterine (registry.ts) eklenir.
 *
 * SÖZLEŞME KURALLARI (uygulayıcılar için bağlayıcıdır):
 *
 *  1. HİÇBİR METOT SAHTE VERİ ÜRETMEZ. Sağlayıcıya ulaşılamıyorsa
 *     `SignatureProviderError("SAGLAYICI_HATASI")`, yapılandırma yoksa
 *     `SignatureProviderNotConfiguredError` fırlatılır. "İmzalandı" varsayımı
 *     ASLA yapılmaz.
 *  2. `createRequest` ÇAĞRIDAN ÖNCE `validateSigners` / `validateDocument` /
 *     `validateOptions` çalıştırır; böylece her adaptör aynı Türkçe hataları verir.
 *  3. `getStatus` YAN ETKİSİZDİR (yalnız okur).
 *  4. Durum değişimleri `assertSignatureTransition`'a uygun olmalıdır; sağlayıcı
 *     tabloya uymayan bir durum bildirirse hata fırlatılır, kayıt sessizce ezilmez.
 *  5. `downloadSignedDocument` YALNIZCA `IMZALANDI` durumunda içerik döndürür;
 *     aksi hâlde `BELGE_HAZIR_DEGIL` kodlu hata fırlatır.
 *  6. Sağlayıcıya giden kişisel veri asgaridir: ad, e-posta ve (mobil imzada)
 *     GSM. Sözleşme metni dışında müvekkil verisi gönderilmez (KVKK m.4/ç).
 */

import type {
  CreateRequestOptions,
  ProviderHealth,
  SignatureDocument,
  SignatureMethod,
  SignatureRequestResult,
  SignatureStatusResult,
  SignedDocumentResult,
  Signer,
} from "./types";

export interface ISignatureProvider {
  /** Adaptör anahtarı — `SignatureRequest.provider` alanına yazılır. */
  readonly key: string;
  /** Ayarlar ekranında gösterilecek ad. */
  readonly displayName: string;
  /** Bu sağlayıcının desteklediği imza yöntemleri (yapılandırmadan gelir). */
  readonly supportedMethods: readonly SignatureMethod[];

  /**
   * İmza sürecini başlatır.
   * @throws {SignatureValidationError} imzacı/belge/seçenek geçersizse
   * @throws {SignatureProviderNotConfiguredError} sağlayıcı tanımlı değilse
   * @throws {SignatureProviderError} sağlayıcı hata döndürürse
   */
  createRequest(
    doc: SignatureDocument,
    signers: readonly Signer[],
    options: CreateRequestOptions,
  ): Promise<SignatureRequestResult>;

  /** Sürecin güncel durumunu okur. YAN ETKİSİZDİR. */
  getStatus(providerRef: string): Promise<SignatureStatusResult>;

  /** Süreci iptal eder. Nihai durumdaki süreç iptal EDİLEMEZ. */
  cancel(providerRef: string, reason?: string): Promise<SignatureStatusResult>;

  /** İmzalı nüshayı indirir. Yalnız `IMZALANDI` durumunda içerik döner. */
  downloadSignedDocument(providerRef: string): Promise<SignedDocumentResult>;

  /** Yapılandırma/erişilebilirlik raporu. HATA FIRLATMAZ, rapor döndürür. */
  healthCheck(): Promise<ProviderHealth>;
}

/**
 * Adaptörlerin ortak yapılandırması. Gerçek bir sağlayıcı eklendiğinde
 * `credentials` alanı ŞİFRELİ saklanır (bkz. @nomosos/ai `decryptSecret`
 * deseni); bu paket şifre çözme yapmaz, çözülmüş değeri alır.
 */
export interface SignatureProviderConfig {
  /** Adaptör anahtarı. Tanımsız/`"noop"` → yapılandırılmamış sağlayıcı. */
  provider?: string | null;
  displayName?: string;
  baseUrl?: string | null;
  /** Çözülmüş kimlik bilgileri. Bu paket şifre ÇÖZMEZ. */
  credentials?: Record<string, string>;
  /** Bu kurulumda izin verilen yöntemler. */
  supportedMethods?: readonly SignatureMethod[];
  /** Sağlayıcının durum bildirimi göndereceği adres. */
  callbackUrl?: string | null;
}
