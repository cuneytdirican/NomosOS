/**
 * E-imza çerçevesinin TİP SÖZLEŞMESİ.
 *
 * TÜRKİYE BAĞLAMI (5070 sayılı Elektronik İmza Kanunu):
 *  - `NES`            → nitelikli elektronik sertifikayla atılan imza. 5070 m.5
 *                       uyarınca elle atılan imzayla AYNI hukuki sonucu doğurur;
 *                       kanunun resmî şekle veya özel merasime tabi tuttuğu
 *                       işlemlerde (ör. taşınmaz satışı, evlenme, teminat
 *                       sözleşmeleri) KULLANILAMAZ.
 *  - `MOBIL_IMZA`     → GSM operatörünün SIM tabanlı NES'i. İmzacının GSM
 *                       numarası ZORUNLUDUR (bkz. validation.ts).
 *  - `E_DEVLET`       → e-Devlet Kapısı üzerinden kimlik doğrulamalı onay akışı.
 *  - `SAGLAYICI_ICI`  → sağlayıcının kendi doğrulama akışı (SMS/OTP + iz kaydı).
 *                       NES DEĞİLDİR; hukuki değeri sözleşmeye ve delil
 *                       değerlendirmesine bağlıdır. Sistem bunu NES gibi sunmaz.
 *
 * HANGİ SAĞLAYICININ HANGİ YÖNTEMİ DESTEKLEDİĞİ YAPILANDIRMADAN GELİR
 * (`ISignatureProvider.supportedMethods`); bu paket hiçbir yöntemi varsayılan
 * olarak "kullanılabilir" saymaz.
 */

/** İmza yöntemi. Desteklenen küme sağlayıcı yapılandırmasından okunur. */
export const SIGNATURE_METHODS = ["NES", "MOBIL_IMZA", "E_DEVLET", "SAGLAYICI_ICI"] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

/** İnsan-okur yöntem etiketleri (UI ve hata mesajları). */
export const SIGNATURE_METHOD_LABELS: Record<SignatureMethod, string> = {
  NES: "Nitelikli elektronik imza (NES)",
  MOBIL_IMZA: "Mobil imza",
  E_DEVLET: "e-Devlet Kapısı onayı",
  SAGLAYICI_ICI: "Sağlayıcı içi onay akışı (NES değildir)",
};

/**
 * 5070 anlamında "elle atılan imza ile aynı hukuki sonucu doğuran" yöntemler.
 * `SAGLAYICI_ICI` bilinçli olarak DIŞARIDADIR.
 */
export const QUALIFIED_SIGNATURE_METHODS: readonly SignatureMethod[] = ["NES", "MOBIL_IMZA"];

/** İmzacının süreçteki rolü. */
export const SIGNER_ROLES = [
  "MUVEKKIL",
  "AVUKAT",
  "KARSI_TARAF",
  "SIRKET_YETKILISI",
  "TANIK",
  "DIGER",
] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

/** Tek imzacının durumu. */
export const SIGNER_STATUSES = ["BEKLIYOR", "IMZALADI", "REDDETTI", "SURESI_DOLDU", "IPTAL"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

/**
 * Sürecin durumu.
 *
 * DEĞERLER `SignatureStatus` PRISMA ENUM'UYLA BİREBİR AYNIDIR — çekirdek,
 * sağlayıcıdan gelen durumu çevirmeden kaydedebilsin diye. Yeni bir değer
 * eklenecekse migration ile birlikte eklenmelidir.
 */
export const SIGNATURE_REQUEST_STATUSES = [
  "OLUSTURULDU",
  "GONDERILDI",
  "IMZALANDI",
  "REDDEDILDI",
  "SURESI_DOLDU",
  "IPTAL",
] as const;
export type SignatureRequestStatus = (typeof SIGNATURE_REQUEST_STATUSES)[number];

/** İmzacı — sağlayıcıya YALNIZCA bu alanlar gider (KVKK: veri minimizasyonu). */
export interface Signer {
  fullName: string;
  /** İmza davetinin gönderileceği adres. Zorunludur. */
  email: string;
  /** GSM numarası. `MOBIL_IMZA` yönteminde ZORUNLUDUR. */
  phone?: string;
  role: SignerRole;
  /** Sıralı imza akışında imzalama sırası (1'den başlar). */
  order?: number;
  /**
   * İmzacıya özel yöntem. Verilmezse süreç yöntemi (`CreateRequestOptions.method`)
   * geçerlidir — ör. müvekkil mobil imza, avukat NES kullanabilir.
   */
  method?: SignatureMethod;
}

/** Sağlayıcıdan dönen imzacı durumu. */
export interface SignerState extends Signer {
  status: SignerStatus;
  signedAt?: Date;
  /** Ret gerekçesi (imzacı reddettiyse). */
  rejectionReason?: string;
}

/** İmzaya gönderilecek belge. İçerik ya gömülü ya da depo anahtarıyla verilir. */
export interface SignatureDocument {
  /** Sağlayıcıda ve indirilen nüshada görünecek ad. */
  fileName: string;
  mimeType: string;
  /** Belge içeriği. `storageKey` verilmişse boş bırakılabilir. */
  content?: Uint8Array;
  /** Nesne deposundaki anahtar (içerik sağlayıcıya çekirdek tarafından iletilir). */
  storageKey?: string;
  /** İçeriğin SHA-256 özeti — imzalanan metnin bütünlük kanıtı. */
  sha256?: string;
  /** İnsan-okur başlık (sözleşme adı). */
  title?: string;
}

/** Süreç başlatma seçenekleri. */
export interface CreateRequestOptions {
  /** Sürecin varsayılan imza yöntemi. İmzacı bazında ezilebilir. */
  method: SignatureMethod;
  /** İmzacılar sırayla mı imzalasın (true) yoksa aynı anda mı (false). */
  sequential?: boolean;
  /** Sürecin geçerlilik süresi (gün). Sağlayıcı desteklemiyorsa yok sayılır. */
  expiresInDays?: number;
  /** Davet e-postasının konusu. */
  subject?: string;
  /** Davet e-postasının gövdesi. */
  message?: string;
  /** Sağlayıcının durum bildirimi göndereceği adres (webhook). */
  callbackUrl?: string;
  /** Arayüz dili. Varsayılan "tr". */
  language?: string;
}

/** `createRequest` sonucu. */
export interface SignatureRequestResult {
  /** Sağlayıcıdaki süreç kimliği — sonraki tüm çağrıların anahtarı. */
  providerRef: string;
  status: SignatureRequestStatus;
  providerKey: string;
  method: SignatureMethod;
  signers: SignerState[];
  createdAt: Date;
  /** İmzacıların yönlendirileceği adresler (varsa). */
  signerUrls?: Record<string, string>;
  /** Sağlayıcının ham yanıtı — denetim izi için saklanabilir. */
  raw?: unknown;
}

/** `getStatus` / `cancel` sonucu. */
export interface SignatureStatusResult {
  providerRef: string;
  status: SignatureRequestStatus;
  providerKey: string;
  signers: SignerState[];
  completedAt?: Date;
  failureReason?: string;
  raw?: unknown;
}

/** `downloadSignedDocument` sonucu. */
export interface SignedDocumentResult {
  providerRef: string;
  fileName: string;
  mimeType: string;
  content: Uint8Array;
  sha256?: string;
  /**
   * Sağlayıcının imza kanıt paketi (zaman damgası, sertifika zinciri özeti).
   * Silinmez; belge yönetiminde imzalı nüshanın yanında saklanır.
   */
  evidence?: unknown;
}

/** `healthCheck` sonucu — Ayarlar → E-imza ekranının veri kaynağı. */
export interface ProviderHealth {
  providerKey: string;
  displayName: string;
  /** Sağlayıcı kullanılabilir durumda mı (kimlik bilgileri tanımlı mı). */
  configured: boolean;
  supportedMethods: readonly SignatureMethod[];
  /** Kullanıcıya gösterilecek Türkçe durum cümlesi. */
  message: string;
  /**
   * Uç noktaya erişilebildi mi. Yapılandırılmamış sağlayıcıda `undefined`
   * kalır — "erişilemedi" ile "hiç denenmedi" karıştırılmaz.
   */
  reachable?: boolean;
}
