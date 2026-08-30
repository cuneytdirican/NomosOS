/**
 * NomosOS backend'ine gönderilen aktarım DTO'ları ve dönüş tipleri.
 * Sözleşme: docs/05-uyap-entegrasyonu.md § "Backend API sözleşmesi".
 *
 * KVKK/güvenlik notu: bu DTO'ların hiçbiri UYAP oturum çerezi, e-imza/kart bilgisi veya
 * kullanıcının UYAP kimlik bilgilerini TAŞIMAZ. Yalnızca dosya/evrak içerik verisi ve
 * yalnızca kullanıcının kendi tenant'ının deposuna gider.
 */

import type {
  UyapDosyaOzeti,
  UyapDurusmaKaydi,
  UyapSafahatKaydi,
  UyapTaraf,
} from "./uyap";

/** Eklentinin kendini tanıttığı üstveri — teşhis ve parser sürüm takibi içindir. */
export interface ClientInfo {
  /** Eklenti sürümü (manifest.version). */
  readonly extensionVersion: string;
  /** Verinin çıkarıldığı parser selector seti sürümü (ör. "v1"). */
  readonly selectorVersion: string;
  /** Kaynak UYAP alan adı (avukat.uyap.gov.tr / avukatbeta.uyap.gov.tr). */
  readonly sourceHost: string;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/uyap/pair                                                 */
/* ------------------------------------------------------------------ */

export interface PairRequest {
  /** NomosOS web arayüzünden alınan kısa ömürlü eşleştirme kodu. */
  readonly pairingCode: string;
  /** Kullanıcının cihazını popup'ta ayırt etmesi için serbest metin. */
  readonly deviceName: string;
  readonly extensionVersion: string;
}

export interface PairedIdentity {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
}

export interface PairResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Erişim jetonunun bitiş anı — ISO 8601. */
  readonly accessTokenExpiresAt: string;
  readonly identity: PairedIdentity;
  /**
   * Evrak baytlarının yazılabileceği ön-imzalı depo ana bilgisayarları
   * (ör. ["storage.nomosos.com"]). Eklenti `presign.uploadUrl` adresini bu listeye
   * ve API ana bilgisayarına karşı DOĞRULAR; listede olmayan bir hosta bayt GÖNDERMEZ
   * (docs/05 § 7 — "aktarım yalnız tenant'ın kendi deposuna" taahhüdünün istemci yaptırımı).
   * Sunucu bu alanı göndermezse yalnız API ana bilgisayarına yükleme yapılabilir.
   */
  readonly storageHosts?: readonly string[];
}

/** POST /api/v1/uyap/pair/refresh — rotasyonlu yenileme. */
export interface RefreshRequest {
  readonly refreshToken: string;
}

export type RefreshResponse = PairResponse;

/* ------------------------------------------------------------------ */
/* POST /api/v1/uyap/sync/files                                           */
/* ------------------------------------------------------------------ */

export interface SyncFileDto {
  /** UYAP dosya numarası — "2026/145". Backend eşleştirmesinin anahtarı. */
  readonly uyapDosyaNo: string;
  readonly uyapDosyaId: string | null;
  readonly birim: string;
  readonly dosyaTuru: string | null;
  readonly durum: string | null;
  readonly acilisTarihi: string | null;
  readonly konu: string | null;
  readonly taraflar: readonly UyapTaraf[];
  readonly detayUrl: string | null;
}

export interface SyncFilesRequest {
  readonly client: ClientInfo;
  readonly files: readonly SyncFileDto[];
  /** Kullanıcı manuel mi tetikledi, zamanlayıcı mı? */
  readonly trigger: SyncTrigger;
}

export type SyncTrigger = "MANUAL" | "SCHEDULED" | "PAGE_ACTION";

export interface SyncFilesResponse {
  /** Backend'in kabul ettiği dosya sayısı. */
  readonly accepted: number;
  /** NomosOS dosyasıyla eşleşenler. */
  readonly matched: readonly { readonly uyapDosyaNo: string; readonly caseId: string }[];
  /** Eşleşmeyip "eşleştirme kuyruğuna" düşenler. */
  readonly unmatched: readonly string[];
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/uyap/sync/events                                          */
/* ------------------------------------------------------------------ */

export interface SyncEventDto {
  /** UYAP kaydının içerik hash'i — backend idempotens anahtarı. */
  readonly externalHash: string;
  readonly tarih: string;
  readonly islem: string;
  readonly aciklama: string | null;
  readonly birim: string | null;
  readonly sira: number | null;
}

export interface SyncEventsRequest {
  readonly client: ClientInfo;
  readonly uyapDosyaNo: string;
  readonly events: readonly SyncEventDto[];
  /** Aynı gövdede duruşma kayıtları da taşınabilir (opsiyonel). */
  readonly hearings?: readonly SyncHearingDto[];
  readonly trigger: SyncTrigger;
}

export interface SyncHearingDto {
  /**
   * Duruşmanın ait olduğu UYAP dosya numarası.
   *
   * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 1): bu alan olmadığı için "Duruşmalarım"
   * gibi ÇOK DOSYALI ekranlarda tüm duruşmalar gövdedeki tek `uyapDosyaNo` altına
   * yazılabiliyordu. İstemci artık duruşmaları dosya numarasına göre gruplar; sunucu
   * bu alan ile gövdedeki `uyapDosyaNo`yu ÇAPRAZ DOĞRULAMALI, uyuşmazsa kaydı
   * reddetmelidir (ajandaya yanlış duruşma = meslek riski, docs/05 § 7).
   */
  readonly uyapDosyaNo: string;
  readonly externalHash: string;
  readonly tarih: string;
  readonly salon: string | null;
  readonly tur: string | null;
  readonly aciklama: string | null;
}

export interface SyncEventsResponse {
  readonly accepted: number;
  /** Zaten var olduğu için atlanan kayıt sayısı. */
  readonly duplicates: number;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/uyap/documents/presign                                    */
/* ------------------------------------------------------------------ */

export interface PresignRequest {
  readonly client: ClientInfo;
  readonly uyapDosyaNo: string;
  readonly uyapEvrakId: string | null;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** SHA-256 (hex) — sunucu tarafı yinelenen kontrolü bununla yapılır. */
  readonly contentHash: string;
}

export interface PresignResponse {
  /** Sunucu aynı hash'i biliyorsa true döner ve yükleme atlanır. */
  readonly duplicate: boolean;
  /** duplicate=true iken null olabilir. */
  readonly uploadUrl: string | null;
  readonly method: "PUT" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  /** Commit çağrısında geri gönderilecek depo anahtarı. */
  readonly storageKey: string;
  readonly expiresAt: string;
}

/* ------------------------------------------------------------------ */
/* POST /api/v1/uyap/documents/commit                                     */
/* ------------------------------------------------------------------ */

export interface CommitRequest {
  readonly client: ClientInfo;
  readonly storageKey: string;
  readonly uyapDosyaNo: string;
  readonly uyapEvrakId: string | null;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
  /** Evrak türü metni — backend sınıflandırmaya ipucu olarak alır. */
  readonly evrakTuru: string | null;
  /** UYAP'taki evrak tarihi — ISO 8601. */
  readonly evrakTarihi: string | null;
  readonly gonderen: string | null;
}

export interface CommitResponse {
  readonly documentId: string;
  /** Aynı hash daha önce commit edilmişse true; yeni pipeline koşumu açılmaz. */
  readonly duplicate: boolean;
  /** Modül 06 otomatik aksiyon hattı koşum kimliği (varsa). */
  readonly pipelineRunId: string | null;
}

/* ------------------------------------------------------------------ */
/* GET /api/v1/uyap/status                                                */
/* ------------------------------------------------------------------ */

export interface StatusResponse {
  readonly identity: PairedIdentity;
  /** Backend'in izlediği (senkronu açık) UYAP dosya sayısı. */
  readonly watchedFileCount: number;
  /** Backend tarafındaki son başarılı senkron anı — ISO 8601 veya null. */
  readonly lastSyncAt: string | null;
  /** Eşleştirme kuyruğunda bekleyen dosya sayısı. */
  readonly pendingMatchCount: number;
  /** Onay bekleyen belge aksiyon kartı sayısı (Modül 06). */
  readonly pendingApprovalCount: number;
}

/** Aktarım için hazırlanmış, henüz gönderilmemiş evrak (content script → service worker). */
export interface PendingDocument {
  readonly uyapDosyaNo: string;
  readonly uyapEvrakId: string | null;
  readonly fileName: string;
  readonly mimeType: string;
  readonly evrakTuru: string | null;
  readonly evrakTarihi: string | null;
  readonly gonderen: string | null;
  /** Evrak içeriği base64 — yalnızca eklenti içi mesajlaşmada kullanılır. */
  readonly base64: string;
  readonly sizeBytes: number;
}

/** Dosya listesi/detay çıktısını aktarım DTO'suna çevirir. */
export function toSyncFileDto(
  ozet: UyapDosyaOzeti,
  extras?: { readonly konu?: string | null; readonly taraflar?: readonly UyapTaraf[] },
): SyncFileDto {
  return {
    uyapDosyaNo: ozet.dosyaNo,
    uyapDosyaId: ozet.uyapDosyaId,
    birim: ozet.birim,
    dosyaTuru: ozet.dosyaTuru,
    durum: ozet.durum,
    acilisTarihi: ozet.acilisTarihi,
    konu: extras?.konu ?? null,
    taraflar: extras?.taraflar ?? [],
    detayUrl: ozet.detayUrl,
  };
}

/** Safahat kaydını, hash'i hesaplanmış aktarım DTO'suna çevirir. */
export function toSyncEventDto(kayit: UyapSafahatKaydi, externalHash: string): SyncEventDto {
  return {
    externalHash,
    tarih: kayit.tarih,
    islem: kayit.islem,
    aciklama: kayit.aciklama,
    birim: kayit.birim,
    sira: kayit.sira,
  };
}

/**
 * Duruşma kaydını aktarım DTO'suna çevirir.
 * `uyapDosyaNo` ZORUNLUDUR: kaydın hangi dosyaya yazılacağı tahmin edilmez.
 */
export function toSyncHearingDto(
  kayit: UyapDurusmaKaydi,
  externalHash: string,
  uyapDosyaNo: string,
): SyncHearingDto {
  return {
    uyapDosyaNo,
    externalHash,
    tarih: kayit.tarih,
    salon: kayit.salon,
    tur: kayit.tur,
    aciklama: kayit.aciklama,
  };
}
