/**
 * Faz 5 arayüz tipleri — Müvekkil Portalı (10), İletişim Merkezi (19),
 * Vekaletname (12), Sözleşme + e-imza (20).
 *
 * KAYNAK: `packages/db/prisma/schema.prisma` Faz 5 modelleri. Alan adları
 * şemadaki camelCase adlarla BİREBİRDİR; şemada olmayan bir alan burada da
 * yoktur. API bu tipleri üstlenerek daha zengin bir gövde dönebilir — bu
 * yüzden çoğu alan opsiyoneldir ve normalleştiriciler (`faz5.ts`) eksik alanı
 * `null`'a indirger; hiçbir ekran alanın varlığına GÜVENMEZ.
 */

// ------------------------------------------------------------------ ortak

export interface ClientRef {
  id: string;
  name?: string | null;
}

export interface CaseRef {
  id: string;
  title?: string | null;
  fileNumber?: string | null;
  status?: string | null;
}

export interface UserRef {
  id?: string;
  fullName?: string | null;
  email?: string | null;
}

// =====================================================================
// A) Müvekkil portalı (Modül 10)
// =====================================================================

export interface PortalUserItem {
  id: string;
  clientId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  invitedBy?: string | null;
  invitedAt?: string | null;
  activatedAt?: string | null;
  createdAt?: string;
}

/**
 * Davet yanıtı — `POST /portal-admin/invite`.
 *
 * `token` HAM DEĞERDİR ve yalnızca bu yanıtta görünür: veritabanında SHA-256
 * özeti saklanır, bu yüzden bir daha üretilemez. Kaybolursa yeni davet açılır.
 * Bağlantı adresini müvekkil portalı uygulaması (ayrı uygulama) kurar.
 */
export interface PortalInviteResult {
  email: string;
  token: string | null;
  expiresAt: string | null;
  note: string | null;
}

/** `GET /portal-admin/publishable` satırı — kaynak + "yayında mı" işareti. */
export interface PortalPublishable {
  id: string;
  /** Sunucunun ürettiği okunur etiket ("2024/123 — Alacak Davası"). */
  label: string;
  at: string | null;
  isPublished: boolean;
}

export type PortalResourceType =
  | "DOSYA"
  | "BELGE"
  | "DURUSMA"
  | "SAFAHAT_KAYDI"
  | "FATURA"
  | "MESAJ"
  | "ODEME";

export interface PortalPublicationItem {
  id: string;
  clientId: string;
  resourceType: PortalResourceType;
  resourceId: string;
  publishedBy?: string | null;
  publishedAt?: string | null;
  /** Dolu = yayından kaldırılmış. Portal sorgusunun ZORUNLU süzgeci. */
  unpublishedAt?: string | null;
  note?: string | null;
}

// =====================================================================
// B) İletişim merkezi (Modül 19)
// =====================================================================

export type CommChannel =
  | "EPOSTA"
  | "SMS"
  | "WHATSAPP"
  | "TELEFON"
  | "PORTAL"
  | "YUZ_YUZE"
  | "DIGER";

export type CommDirection = "GELEN" | "GIDEN";

export type OutboundStatus =
  | "TASLAK"
  | "ONAY_BEKLIYOR"
  | "ONAYLANDI"
  | "GONDERILDI"
  | "BASARISIZ"
  | "IPTAL";

export type MatchStatus = "BEKLIYOR" | "ESLESTI" | "ELLE_ESLESTI" | "ESLESMEDI";

export interface MessageTemplateItem {
  id: string;
  /** null = SİSTEM şablonu (tüm kiracılara açık, salt okunur). */
  tenantId?: string | null;
  key: string;
  name: string;
  channel: CommChannel;
  subject?: string | null;
  body: string;
  isSystem?: boolean;
}

/**
 * BİRLEŞİK KRONOLOJİ SATIRI.
 *
 * `GET /communications` üç ayrı tabloyu (CommunicationLog, OutboundMessage,
 * InboundMessage) tek kutuda döndürür. Ekranın bu üçünü ayırt etmesi ZORUNLUDUR:
 * yalnız GİDEN satırların onay/gönderim durumu, yalnız GELEN satırların
 * eşleştirme durumu vardır. `kind` bu ayrımı taşır ve `toCommEntry()` tarafından
 * gövdedeki alanlara bakılarak türetilir.
 */
export type CommKind = "LOG" | "GIDEN" | "GELEN";

export interface CommEntry {
  kind: CommKind;
  id: string;
  channel: CommChannel;
  direction: CommDirection;
  subject: string | null;
  /** Gösterilecek metin: giden mesajda onaylanmışsa finalBody, yoksa draftBody. */
  body: string;
  occurredAt: string | null;
  client: ClientRef | null;
  case: CaseRef | null;

  // ---- yalnız kind === "GIDEN" ----
  status: OutboundStatus | null;
  draftBody: string | null;
  finalBody: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  templateId: string | null;
  /** Gönderim öncesi KVKK taraması (serbest biçimli JSON). */
  piiScan: unknown;

  // ---- yalnız kind === "GELEN" ----
  matchStatus: MatchStatus | null;
  matchConfidence: number | null;
  fromRef: string | null;

  // ---- yalnız kind === "LOG" ----
  contactRef: string | null;
  recordedBy: string | null;

  /** Ham gövde — ekranın bilmediği alanlar için kaçış kapısı. */
  raw: Record<string, unknown>;
}

// =====================================================================
// C) Vekaletname (Modül 12)
// =====================================================================

export type PoaType = "GENEL" | "OZEL" | "BOSANMA" | "CEZA" | "ICRA" | "SIRKET" | "DIGER";

export type PoaVerdict = "YETERLI" | "YETERSIZ" | "BELIRSIZ";

/**
 * Özel yetki KATALOĞU satırı — `GET /power-of-attorney/scope-catalog`.
 *
 * Katalog SUNUCUDADIR (30'dan fazla kod, her birinin hukuki dayanağıyla);
 * istemci onu yalnızca gösterir. İkinci bir kopya tutmak, kod listeleri
 * ayrıştığı anda doğrulamadan geçmeyen kayıt üretirdi.
 */
export interface PoaScopeDefinition {
  code: string;
  label: string;
  description: string | null;
  /** Açık yetki verilmedikçe kullanılamayan bir yetki mi (özel yetki). */
  requiresSpecialAuthority: boolean;
  /** Yetkinin düzenlendiği madde. Uydurma atıf YOKTUR; belirsizse null. */
  legalBasis: string | null;
}

/** `scopeItemsJson` satırı: [{ code, present, note? }] */
export interface PoaScopeItem {
  code: string;
  label?: string | null;
  present: boolean;
  /** `DIGER` seçildiğinde ZORUNLU serbest açıklama. */
  note?: string | null;
}

export interface PoaItem {
  id: string;
  clientId: string;
  client?: ClientRef | null;
  caseId?: string | null;
  case?: CaseRef | null;
  notary?: string | null;
  number?: string | null;
  issuedAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  scope?: string | null;
  documentId?: string | null;
  type?: PoaType | null;
  isActive?: boolean;
  warningSentAt?: string | null;
  /** Normalleştirilmiş kapsam maddeleri (ham `scopeItemsJson` çözülmüş hâli). */
  scopeItems: PoaScopeItem[];
  createdAt?: string;
}

/** Analiz sonucundaki eksik yetki satırı. */
export interface PoaMissingPower {
  code: string;
  label: string | null;
  why: string | null;
  /** Vekaletname metninden alıntı (varsa) — uydurma yasağının görünür yüzü. */
  quote: string | null;
}

/**
 * POA_SCOPE_ANALYSIS çıktısı — ÖNERİDİR.
 * Şema yorumu: "verdict avukatı bağlamaz, dosyaya rapor olarak düşer."
 */
export interface PoaScopeCheckResult {
  id: string | null;
  powerOfAttorneyId: string | null;
  caseId: string | null;
  question: string | null;
  verdict: PoaVerdict;
  missingPowers: PoaMissingPower[];
  aiCommentary: string | null;
  /** Vekaletname metninden genel alıntılar (dayanak gösterme zorunluluğu). */
  quotes: string[];
  /**
   * SİSTEMİN KARARI NEDEN DÜŞÜRDÜĞÜ.
   *
   * Sunucu, modelin "YETERLI" kararını doğrulanmış bulgu kalmadığında ya da
   * iç tutarsızlıkta zorla BELIRSIZ'e çeker. Bu gerekçe kayda yazılıyor ama
   * ekrana hiç taşınmıyordu: avukat `BELIRSIZ` rozetinin yanında "yeterli
   * görünmektedir" diyen bir metin okuyordu (denetim bulgusu 8).
   */
  verdictDowngradeNote: string | null;
  /** Alıntısı vekaletname metninde doğrulanamadığı için ELENEN bulgular. */
  droppedQuotes: { label: string; reasonLabel: string | null; quote: string | null }[];
  model: string | null;
  checkedAt: string | null;
}

/** `GET /poa/alerts` satırı — süresi yaklaşan / azilli vekaletnameler. */
export interface PoaAlert {
  id: string;
  poaId: string | null;
  clientId: string | null;
  client: ClientRef | null;
  case: CaseRef | null;
  /** "SURE_YAKLASIYOR" | "SURESI_DOLDU" | "AZIL" | "KAPSAM_YETERSIZ" … */
  kind: string | null;
  message: string;
  expiresAt: string | null;
  daysLeft: number | null;
}

// =====================================================================
// D) Sözleşme + e-imza (Modül 20)
// =====================================================================

export type ContractType = "VEKALET_UCRET" | "DANISMANLIK" | "GIZLILIK" | "HIZMET" | "DIGER";

export type ContractStatus =
  | "TASLAK"
  | "MUZAKERE"
  | "IMZAYA_HAZIR"
  | "IMZADA"
  | "YURURLUKTE"
  | "SONA_ERDI"
  | "FESIH";

export type SignatureStatus =
  | "OLUSTURULDU"
  | "GONDERILDI"
  | "IMZALANDI"
  | "REDDEDILDI"
  | "SURESI_DOLDU"
  | "IPTAL";

export interface ContractVersionItem {
  id: string;
  contractId?: string;
  versionNo: number;
  contentText?: string | null;
  documentId?: string | null;
  changeNote?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export interface ContractItem {
  id: string;
  clientId?: string | null;
  client?: ClientRef | null;
  caseId?: string | null;
  case?: CaseRef | null;
  title: string;
  type: ContractType;
  status: ContractStatus;
  currentVersionId?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  renewalNoticeDays?: number | null;
  autoRenew?: boolean;
  createdAt?: string;
  updatedAt?: string;
  versions?: ContractVersionItem[];
  signatureRequests?: SignatureRequestItem[];
}

/** İmza yöntemi — `@nomosos/e-signature` kataloğuyla birebir. */
export type SignatureMethod = "NES" | "MOBIL_IMZA" | "E_DEVLET" | "SAGLAYICI_ICI";

export type SignerRole =
  | "MUVEKKIL"
  | "AVUKAT"
  | "KARSI_TARAF"
  | "SIRKET_YETKILISI"
  | "TANIK"
  | "DIGER";

/** İmzacı — sunucu şeması `fullName` + `email` + `role` ZORUNLU tutar. */
export interface ContractSigner {
  fullName: string;
  email: string;
  phone?: string | null;
  role?: SignerRole;
  order?: number;
  status?: string | null;
  signedAt?: string | null;
}

export interface SignatureRequestItem {
  id: string;
  contractId?: string;
  versionId?: string;
  /** Adaptör anahtarı. "noop" = yapılandırılmamış. */
  provider: string;
  method: SignatureMethod | null;
  providerRef?: string | null;
  status: SignatureStatus;
  signers: ContractSigner[];
  sentAt?: string | null;
  completedAt?: string | null;
  signedDocumentId?: string | null;
  failureReason?: string | null;
  createdAt?: string;
}

/** CONTRACT_REVIEW bulgusu — her bulgu ALINTI taşımak zorundadır. */
export interface ContractFinding {
  /** "RISK" | "EKSIK" | "ONERI" */
  kind: string;
  severity: string | null;
  clause: string | null;
  title: string;
  detail: string | null;
  /** Versiyon metninde BİREBİR bulunan alıntı (sunucu doğrular). */
  quote: string | null;
  suggestion: string | null;
}

export interface ContractReviewResult {
  contractId: string | null;
  versionId: string | null;
  findings: ContractFinding[];
  summary: string | null;
  /**
   * ELENEN BULGULAR — "sessiz eleme yok" vaadinin arayüz karşılığı.
   *
   * Sunucu iki tür eleme yapar ve ikisini de yanıtta bildirir: alıntısı
   * sözleşme metninde bulunamayan riskli maddeler, ve konusu metinde geçtiği
   * için çürütülen "eksik hüküm" iddiaları. Bunlar ekrana taşınmazsa avukat,
   * gördüğü listeyi modelin söylediğinin tamamı sanar (denetim bulgusu 8).
   */
  droppedQuotes: { label: string; reasonLabel: string | null; quote: string | null }[];
  droppedMissingClaims: { topic: string; reason: string | null }[];
  /** Metinde bulunamadığı için temizlenen madde referansları ("m.14" gibi). */
  unverifiedClauseRefs: string[];
  model: string | null;
  createdAt: string | null;
}

/** `GET /contracts/renewals?days=` satırı. */
export interface ContractRenewalItem {
  id: string;
  contractId: string | null;
  title: string;
  client: ClientRef | null;
  status: ContractStatus | null;
  effectiveTo: string | null;
  renewalNoticeDays: number | null;
  autoRenew: boolean;
  /** İhbar son gününe kalan gün — SUNUCU hesabı (deterministik süre motoru). */
  daysLeft: number | null;
  /** İhbarın son günü (Deadline üretiminin kaynağı). */
  noticeDeadline: string | null;
}
