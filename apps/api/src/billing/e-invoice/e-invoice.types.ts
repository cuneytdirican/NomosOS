/**
 * SAĞLAYICI-BAĞIMSIZ e-FATURA / e-ARŞİV ADAPTÖR SÖZLEŞMESİ (Modül 09).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NomosOS GİB'e DOĞRUDAN BAĞLANMAZ ve bu depoda GERÇEK BİR ENTEGRASYON    ║
 * ║  YOKTUR. Kimlik bilgisi (özel entegratör hesabı) bulunmadığı için sahte  ║
 * ║  bir bağlantı taklit edilmez: yapılandırılmamış kurulumda tek gerçek     ║
 * ║  adaptör `NoopEInvoiceAdapter`'dır ve faturayı TASLAK/`eInvoiceStatus =  ║
 * ║  YOK` durumunda bırakıp anlamlı bir Türkçe hata döndürür.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Her tenant kendi özel entegratörünü (Logo, Sovos/Foriba, Uyumsoft, Paraşüt…)
 * bağlar; her sağlayıcı bu arayüzün bir implementasyonudur. Böylece yeni
 * sağlayıcı eklemek çekirdek koda dokunmadan mümkündür — `AiProviderConfig`'in
 * BYO-LLM desenine paraleldir.
 */

/** GİB tarafındaki belge durumu. */
export type GibStatus = "TASLAK" | "GONDERILDI" | "KABUL" | "RED" | "IPTAL" | "BILINMIYOR";

export interface TaxpayerCheckResult {
  /** Alıcı e-Fatura mükellefi mi? false ise belge e-ARŞİV olarak kesilir. */
  isEInvoiceUser: boolean;
  /** e-Fatura posta kutusu etiketi (urn:mail:...). */
  alias?: string;
  title?: string;
}

export interface SendInvoiceResult {
  /** Sağlayıcının kendi referansı (idempotency ve durum sorgusu için). */
  providerRef: string;
  /** GİB ETTN'si (UUID). */
  gibUuid: string;
  status: GibStatus;
}

/** Sağlayıcıya gönderilen, UBL-TR alanlarına birebir eşlenmiş yük. */
export interface UblInvoicePayload {
  /** cbc:UUID — ETTN. Idempotency anahtarı olarak da kullanılır. */
  uuid: string;
  /** cbc:ID — fatura numarası (16 hane: 3 harf seri + 4 hane yıl + 9 hane sıra). */
  invoiceNumber: string | null;
  /** cbc:IssueDate (YYYY-MM-DD) */
  issueDate: string;
  /** cbc:IssueTime (hh:mm:ss) */
  issueTime: string;
  /** cbc:InvoiceTypeCode — SATIS | IADE | TEVKIFAT | ISTISNA ... */
  invoiceTypeCode: "SATIS" | "IADE";
  /** e-Fatura (mükellef) mi, e-Arşiv mi. `profileId` seçimini belirler. */
  documentKind: "E_FATURA" | "E_ARSIV";
  /** cbc:ProfileID — TEMELFATURA | TICARIFATURA | EARSIVFATURA */
  profileId: "TEMELFATURA" | "TICARIFATURA" | "EARSIVFATURA";
  /** cbc:DocumentCurrencyCode */
  currencyCode: string;
  supplier: UblParty;
  customer: UblParty;
  lines: UblInvoiceLine[];
  /** cac:TaxTotal / cac:TaxSubtotal kırılımı. */
  taxSubtotals: { taxRatePercent: string; taxableAmount: string; taxAmount: string }[];
  /** cac:LegalMonetaryTotal */
  legalMonetaryTotal: {
    lineExtensionAmount: string;
    taxExclusiveAmount: string;
    taxInclusiveAmount: string;
    payableAmount: string;
  };
  note?: string;
  /** cbc:PaymentDueDate */
  dueDate?: string;
}

export interface UblParty {
  /** cac:PartyIdentification/cbc:ID — schemeID "VKN" (10 hane) veya "TCKN" (11 hane). */
  identification: { schemeId: "VKN" | "TCKN"; value: string } | null;
  /** cac:PartyName/cbc:Name veya cac:Person */
  name: string;
  /** cac:PartyTaxScheme/cac:TaxScheme/cbc:Name — vergi dairesi */
  taxOffice?: string;
  /** cac:PostalAddress */
  address?: string;
  email?: string;
  phone?: string;
}

export interface UblInvoiceLine {
  /** cbc:ID — satır sırası (1'den başlar). */
  id: string;
  /** cbc:InvoicedQuantity (unitCode: "C62" adet, "HUR" saat) */
  quantity: string;
  unitCode: "C62" | "HUR";
  /** cac:Item/cbc:Name */
  itemName: string;
  /** cac:Price/cbc:PriceAmount */
  unitPrice: string;
  /** cbc:LineExtensionAmount */
  lineExtensionAmount: string;
  /** cac:TaxTotal/cac:TaxSubtotal/cbc:Percent + cbc:TaxAmount */
  taxRatePercent: string;
  taxAmount: string;
}

/**
 * Adaptör arayüzü.
 *
 * İDEMPOTENS (Modül 09, iş kuralı 9): `sendInvoice` zaman aşımına uğrarsa
 * çağıran taraf YENİDEN GÖNDERMEZ; önce `getStatus(providerRef)` ile mutabakat
 * yapar. `UblInvoicePayload.uuid` sabit kalır ve sağlayıcı tarafında idempotency
 * anahtarı olarak kullanılır — böylece çift fatura oluşmaz.
 */
export interface EInvoiceAdapter {
  /** Sağlayıcının anahtarı (`noop`, `logo`, `sovos`, ...). */
  readonly key: string;
  /** Yapılandırma tam mı? false ise gönderim uçları anlamlı hata döndürür. */
  readonly isConfigured: boolean;

  checkTaxpayer(vkn: string): Promise<TaxpayerCheckResult>;
  sendInvoice(payload: UblInvoicePayload): Promise<SendInvoiceResult>;
  getStatus(providerRef: string): Promise<GibStatus>;
  cancelInvoice(providerRef: string, reason: string): Promise<void>;
  downloadPdf(providerRef: string): Promise<Buffer>;
}
