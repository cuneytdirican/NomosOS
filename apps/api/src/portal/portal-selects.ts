/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PORTALIN GÖRDÜĞÜ ALANLARIN TAM LİSTESİ — TEK DENETİM NOKTASI            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Portal uçlarının HİÇBİRİ `include` kullanmaz; hepsi buradaki `select`
 * nesnelerini kullanır. Bunun iki sonucu vardır:
 *
 *   1. Şemaya yeni bir alan eklendiğinde portal onu KENDİLİĞİNDEN göstermez.
 *      "Gizlenmesi unutulan alan" hatası yapısal olarak oluşamaz; en fazla
 *      "gösterilmesi unutulan alan" olur ki bu zararsızdır.
 *   2. "Müvekkil ne görüyor?" sorusunu denetlemek isteyen biri, on ayrı
 *      servis metodunu değil YALNIZCA BU DOSYAYI okur.
 *
 * `portal-selects.test.ts` bu nesneleri yasaklı alan listesine karşı sınar:
 * biri yanlışlıkla `ocrText` ya da `amount` eklerse test kırılır.
 */

/**
 * Dosya alanları.
 *
 * DIŞARIDA BIRAKILANLAR ve NEDENLERİ:
 *   - `amount`            → dava değeri, strateji açısından hassas; müvekkile
 *                           gösterilecekse avukat bunu yayın notuna yazar.
 *   - `judgeName`         → hâkim adı büro içi bilgidir.
 *   - `responsibleUserId` → /portal/lawyer ucundan ayrıca ve süzülerek döner.
 *   - `lastActivityAt`    → yayınlanmamış hareketleri de yansıtır (sızıntı).
 *   - `nextHearingAt`     → aynı sebep; YAYINLANMIŞ duruşmalardan hesaplanır.
 *   - `tenantId` / `clientId` / `createdAt` / `updatedAt` → iç üstveri.
 */
export const PORTAL_CASE_SELECT = {
  id: true,
  title: true,
  type: true,
  status: true,
  courtName: true,
  fileNumber: true,
  subject: true,
  openedAt: true,
  closedAt: true,
} as const;

/**
 * Belge alanları.
 *
 * DIŞARIDA: `storageKey` (depo anahtarı — indirme yalnız kısa ömürlü imzalı
 * URL ile), `ocrText` (ham, maskesiz metin), `aiSummary` (AI özeti müvekkile
 * doğrudan gitmez — ürün ilkesi: AI çıktısı avukat onayından geçer),
 * `uploadedBy`, `hash`, `classSource`, `ocrStatus`, `chunkStatus`, `source`.
 */
export const PORTAL_DOCUMENT_SELECT = {
  id: true,
  name: true,
  class: true,
  mimeType: true,
  sizeBytes: true,
  pageCount: true,
  caseId: true,
  createdAt: true,
} as const;

/**
 * Duruşma alanları.
 *
 * DIŞARIDA: `note` (ara karar / sonuç özeti — büro içi kayıt), `prepSummary`
 * (duruşma hazırlık brifingi — kesinlikle iç kayıt), `preparedAt`.
 * Müvekkile gösterilen açıklama YALNIZCA `PortalPublication.note`'tur.
 */
export const PORTAL_HEARING_SELECT = {
  id: true,
  caseId: true,
  type: true,
  status: true,
  date: true,
  courtroom: true,
} as const;

/**
 * Safahat alanları.
 *
 * DIŞARIDA: `detail` (teknik ayrıntı — büro içi), `userId`, `source`.
 * Müvekkilin gördüğü metin, yayın notundaki DONDURULMUŞ özettir; not yoksa
 * kaydın başlığı gösterilir.
 */
export const PORTAL_TIMELINE_SELECT = {
  id: true,
  caseId: true,
  date: true,
  title: true,
} as const;

/**
 * Fatura alanları + satırları.
 *
 * DIŞARIDA: `note` (büro içi açıklama), `createdBy`, `eInvoiceUuid`,
 * `eInvoiceStatus`; satırlarda `sourceType`/`sourceId` (hangi zaman
 * kaydından/masraftan geldiği büro içi bağdır — spec §İş Kuralları 10:
 * büro içi masraf detayı yayınlanamaz).
 */
export const PORTAL_INVOICE_SELECT = {
  id: true,
  invoiceNo: true,
  issueDate: true,
  dueDate: true,
  subtotal: true,
  vatAmount: true,
  total: true,
  currency: true,
  status: true,
  lines: {
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      vatRate: true,
      lineTotal: true,
    },
  },
} as const;

/** Tahsilat alanları. DIŞARIDA: `note` (büro içi), `createdBy`. */
export const PORTAL_PAYMENT_SELECT = {
  id: true,
  amount: true,
  date: true,
  method: true,
  reference: true,
  invoiceId: true,
} as const;

/**
 * Giden mesaj alanları.
 *
 * DIŞARIDA ve KRİTİK: `draftBody` (AI'ın/şablonun ÖNERİSİ — avukatın
 * onayladığı metinden farklı olabilir), `piiScanJson` (KVKK tarama çıktısı),
 * `createdBy`, `approvedBy`, `failureReason`, `providerRef`.
 * Müvekkil yalnızca GÖNDERİLEN metni (`finalBody`) görür.
 */
export const PORTAL_OUTBOUND_SELECT = {
  id: true,
  subject: true,
  finalBody: true,
  channel: true,
  sentAt: true,
  caseId: true,
} as const;

/** Müvekkilin kendi yazdığı mesaj. DIŞARIDA: `matchConfidence`, `matchStatus`, `processedBy`, `fromRef`. */
export const PORTAL_INBOUND_SELECT = {
  id: true,
  subject: true,
  body: true,
  receivedAt: true,
  caseId: true,
} as const;

/**
 * PORTALA ASLA ÇIKMAYACAK ALAN ADLARI.
 *
 * `portal-selects.test.ts` yukarıdaki her seçim nesnesini bu listeye karşı
 * tarar. Liste tam değildir (tam liste tüm şemadır) ama en pahalı sızıntıları
 * kapsar: iç metinler, AI çıktıları, depo anahtarları, hazırlık notları.
 */
export const PORTAL_FORBIDDEN_FIELDS: readonly string[] = [
  // Belge iç verisi
  "ocrText",
  "aiSummary",
  "storageKey",
  "hash",
  "uploadedBy",
  "classSource",
  // Dosya iç verisi
  //
  // NOT: `amount` bu listede DEĞİLDİR ve olamaz — alan adı modele göre anlam
  // değiştirir: `Case.amount` dava değeridir (iç bilgi), `Payment.amount` ise
  // müvekkilin kendi ödediği tutardır (görmemesi düşünülemez). Bu liste model
  // ayrımı yapmadığı için `amount` yasağı, dosya seçimine ait ayrı bir testte
  // uygulanır (bkz. portal-selects.test.ts → "dosya seçimi dava değerini...").
  "judgeName",
  "responsibleUserId",
  "lastActivityAt",
  "nextHearingAt",
  // Duruşma / fatura / tahsilat iç notu. Müvekkile gösterilen tek açıklama
  // `PortalPublication.note`'tur; kayıtların kendi `note` alanı büro içidir.
  "note",
  "prepSummary",
  "preparedAt",
  // Safahat iç verisi
  "detail",
  // Mesaj iç verisi
  "draftBody",
  "piiScanJson",
  "approvedBy",
  "failureReason",
  "providerRef",
  "matchConfidence",
  "matchStatus",
  "processedBy",
  // Ortak iç üstveri
  "tenantId",
  "createdBy",
  "passwordHash",
  "tokenHash",
  "sourceType",
  "sourceId",
];
