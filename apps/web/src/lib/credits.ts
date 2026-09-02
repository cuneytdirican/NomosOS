/**
 * Modül 26 — kredi istemcisi ve tipleri.
 *
 * İKİ İLKE:
 * 1. İSTEMCİDEKİ GÖSTERİM YALNIZCA BİLGİLENDİRMEDİR (iş kuralı 1). Bakiye
 *    kontrolü sunucudadır; buradaki hiçbir kontrol güvenlik sınırı değildir.
 * 2. UÇ HENÜZ YOKSA EKRAN ÇÖKMEZ. Kredi hattı bağlanmamış bir kurulumda
 *    `null` döner ve gösterge tamamen gizlenir — kredi göstergesinin
 *    eksikliği avukatın işini durdurmaz.
 */

import { ApiError, api } from "./api";

export type BillingMode = "YONETILEN" | "BYO_LLM" | "SINIRSIZ";

export interface CreditWalletDto {
  donemBaslangic: string;
  donemBitis: string;
  dahilKota: number;
  dahilTuketilen: number;
  satinAlinan: number;
  rezerve: number;
  kullanilabilir: number;
  bakiye: number;
  kullanimYuzdesi: number;
  belgeKotasi: number;
  belgeKullanilan: number;
  otomatikYuklemePaketi: string | null;
  guncellendi: string;
}

export interface CreditWalletResponse {
  mod: BillingMode;
  limitsiz: boolean;
  aciklama: string;
  cuzdan: CreditWalletDto | null;
}

export interface CreditCost {
  taskType: string;
  credits: number;
  isFree: boolean;
  description: string | null;
  updatedAt: string;
}

export interface CreditCostsResponse {
  istekBasinaTavan: number;
  items: CreditCost[];
}

export interface CreditPackageDto {
  key: string;
  credits: number;
  price: string;
  currency: string;
  birimFiyat: string;
}

export interface CreditTransactionDto {
  id: string;
  tip: "TAHSIS" | "TUKETIM" | "SATIN_ALMA" | "IADE" | "DUZELTME" | "SURESI_DOLDU";
  miktar: number;
  taskType: string | null;
  caseId: string | null;
  kullanici: string | null;
  userId: string | null;
  bakiyeSonrasi: number;
  not: string | null;
  tarih: string;
}

export interface CreditUsageBreakdown {
  donemBaslangic: string;
  toplamTuketim: number;
  gorevTipineGore: Array<{ taskType: string; kredi: number; adet: number }>;
  kullaniciyaGore: Array<{ userId: string; ad: string; rol: string | null; kredi: number; adet: number }>;
  gunluk: Array<{ tarih: string; kredi: number }>;
}

/** 402 gövdesi — sunucudaki `credit.errors.ts` sözleşmesinin ikizi. */
export interface InsufficientCreditsBody {
  statusCode: 402;
  message: string;
  kalanKredi: number;
  gerekenKredi: number;
  paketler: Array<{ key: string; credits: number; price: string; currency: string }>;
  byoLlmOnerisi: true;
  taskType: string;
  engellenmeyenler: string;
}

/** 400 gövdesi — istek başına 50 kredi tavanı aşıldı. */
export interface RequestTooLargeBody {
  statusCode: 400;
  message: string;
  gerekenKredi: number;
  istekBasinaTavan: number;
  taskType: string;
  oneri: string;
}

// ---------------------------------------------------------------------------
// Hata ayrıştırıcılar — AI çağrısı yapan her ekran bunları kullanır.
// ---------------------------------------------------------------------------

export function asInsufficientCredits(err: unknown): InsufficientCreditsBody | null {
  if (!(err instanceof ApiError) || err.status !== 402) return null;
  const d = err.data as Partial<InsufficientCreditsBody> | null;
  if (!d || typeof d !== "object") return null;
  return {
    statusCode: 402,
    message: d.message ?? "Kredi bakiyeniz bu işlem için yetersiz.",
    kalanKredi: Number(d.kalanKredi ?? 0),
    gerekenKredi: Number(d.gerekenKredi ?? 0),
    paketler: Array.isArray(d.paketler) ? d.paketler : [],
    byoLlmOnerisi: true,
    taskType: d.taskType ?? "",
    engellenmeyenler: d.engellenmeyenler ?? "",
  };
}

export function asRequestTooLarge(err: unknown): RequestTooLargeBody | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const d = err.data as Partial<RequestTooLargeBody> | null;
  if (!d || typeof d !== "object" || d.istekBasinaTavan === undefined) return null;
  return {
    statusCode: 400,
    message: d.message ?? "Bu istek tek başına kredi tavanını aşıyor.",
    gerekenKredi: Number(d.gerekenKredi ?? 0),
    istekBasinaTavan: Number(d.istekBasinaTavan ?? 50),
    taskType: d.taskType ?? "",
    oneri: d.oneri ?? "",
  };
}

// ---------------------------------------------------------------------------
// Uçlar
// ---------------------------------------------------------------------------

/**
 * Uç yoksa/erişilemezse `null` döner — gösterge sessizce gizlenir.
 *
 * İ-52: "uç yok" (404/501) ile GERÇEK ARIZA ayrılır. 500/ağ hatasında da null
 * dönülüyordu ve kredi göstergesi, altyapı çökmüşken "kredi hattı yok"
 * görünüyordu — avukat limitsiz modda sanıp harcayabiliyordu. Arıza artık
 * fırlar; yalnız BİLİNÇLI "yok" yanıtları gizlenir.
 */
export async function fetchWallet(): Promise<CreditWalletResponse | null> {
  try {
    return await api<CreditWalletResponse>("/credits/wallet");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return null;
    }
    throw err;
  }
}

export async function fetchCosts(): Promise<CreditCostsResponse | null> {
  try {
    return await api<CreditCostsResponse>("/credits/costs");
  } catch {
    return null;
  }
}

export function fetchPackages(): Promise<CreditPackageDto[]> {
  return api<CreditPackageDto[]>("/credits/packages");
}

export function fetchUsage(): Promise<CreditUsageBreakdown> {
  return api<CreditUsageBreakdown>("/credits/usage");
}

export function fetchTransactions(query: {
  type?: string;
  taskType?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: CreditTransactionDto[]; total: number; page: number; totalPages: number }> {
  return api("/credits/transactions", { query });
}

export function purchasePackage(packageKey: string) {
  return api<{ paket: { key: string; credits: number }; cuzdan: CreditWalletDto; fatura: Record<string, unknown>; mesaj: string }>(
    "/credits/purchase",
    { method: "POST", body: { packageKey } },
  );
}

export function setAutoTopUp(packageKey: string | null) {
  return api<{ cuzdan: CreditWalletDto; mesaj: string }>("/credits/auto-topup", {
    method: "PATCH",
    body: { packageKey, onay: packageKey ? true : undefined },
  });
}

export function estimateCredits(taskType: string, caseId?: string) {
  return api<{
    taskType: string;
    tabanKredi: number;
    ucretsiz: boolean;
    tahminiKredi: number;
    istekBasinaTavan: number;
    tavaniAsiyor: boolean;
  }>("/credits/estimate", { method: "POST", body: { taskType, caseId } });
}

// ---------------------------------------------------------------------------
// Gösterim yardımcıları
// ---------------------------------------------------------------------------

/** %80 amber, %100 kırmızı (spec §Limit Davranışı). */
export function meterTone(percent: number): "green" | "amber" | "red" {
  if (percent >= 100) return "red";
  if (percent >= 80) return "amber";
  return "green";
}

export const CREDIT_TX_LABELS: Record<CreditTransactionDto["tip"], string> = {
  TAHSIS: "Dönem tahsisi",
  TUKETIM: "Tüketim",
  SATIN_ALMA: "Satın alma",
  IADE: "İade",
  DUZELTME: "Düzeltme",
  SURESI_DOLDU: "Dönem sonu sıfırlama",
};

/**
 * Cüzdan değiştiğinde göstergeyi tazelemek için yayılan olay.
 * (Sol menüdeki öneri rozetiyle aynı desen.)
 */
export const CREDITS_CHANGED_EVENT = "nomosos:credits-changed";

export function notifyCreditsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
  }
}

/**
 * Kredi hatası olayı.
 *
 * NEDEN OLAY: 402 gövdesi (kalan/gereken/paketler/BYO-LLM önerisi) hiçbir
 * ekranın kendi hata satırına sığmaz ve on beş AI ekranına ayrı ayrı kart
 * yerleştirmek, yeni bir AI ekranı eklendiğinde unutulacak bir adım doğurur.
 * Olay yayınlanır, açıklayıcı kartı `/app` kabuğu TEK yerde gösterir.
 */
export const CREDIT_ERROR_EVENT = "nomosos:credit-error";

/** 402 / 50-kredi-tavanı hatasını kabuğa bildirir. Diğer hatalarda sessizdir. */
export function notifyCreditError(err: unknown): boolean {
  const body = asInsufficientCredits(err) ?? asRequestTooLarge(err);
  if (!body || typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent(CREDIT_ERROR_EVENT, { detail: err }));
  return true;
}
