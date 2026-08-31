/**
 * Portal JWT gövdesi.
 *
 * `clientId` TOKEN'DA TAŞINIR ama YETKİ KARARINDA KULLANILMAZ: guard her
 * istekte PortalUser kaydını okur ve `clientId`'yi VERİTABANINDAN alır.
 * Token'daki değer yalnızca tutarlılık denetimi içindir — uyuşmazsa oturum
 * geçersiz sayılır. Aksi hâlde imza anahtarı bir gün sızarsa saldırgan
 * `clientId`'yi değiştirerek başka bir müvekkilin dosyalarını okurdu.
 */
export interface PortalJwtPayload {
  sub: string;
  tenantId: string;
  clientId: string;
  aud?: string;
  /**
   * Token'ın üretim anı (saniye). `PortalUser.sessionsValidFrom` damgasıyla
   * karşılaştırılır: çıkıştan/parola sıfırlamadan ÖNCE üretilmiş token ölür.
   */
  iat?: number;
}

/** PortalJwtGuard'ın `request.portalUser` alanına koyduğu kimlik. */
export interface PortalAuthUser {
  /** PortalUser.id */
  portalUserId: string;
  tenantId: string;
  /** Müvekkil kaydı — portalın GÖRÜNÜRLÜK SINIRI budur. */
  clientId: string;
  email: string;
  fullName: string;
  /** Müvekkil (Client) adı — arayüz başlığı için. */
  clientName: string;
  /** İstek IP'si — PortalAuditLog'a yazılır. */
  ip: string;
}
