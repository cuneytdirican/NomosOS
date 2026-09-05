/**
 * ÖDEME SAĞLAYICI SOYUTLAMASI (rakip analizi — E8; Faz 3 gelir hattı).
 *
 * NomosOS KENDİ sanal POS'u İŞLETMEZ. İki ayrı kullanım vardır:
 *   1. PORTAL ödeme bağlantısı (büro → müvekkil): `charge()` — yalnız SIMULASYON.
 *   2. PLATFORM tahsilatı (NomosOS → büro; abonelik + kredi paketi): `createCheckout()`
 *      — SIMULASYON anında başarılı; IYZICO ödeme sayfası (Checkout Form) döner,
 *      sonuç `callback`/`webhook` ile gelir.
 *
 * Yapılandırma: `ODEME_SAGLAYICI`
 *   - `SIMULASYON` → test/demo: gerçek para hareketi yok, kayıt düşer.
 *   - `IYZICO`     → `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL`
 *                    (sandbox: https://sandbox-api.iyzipay.com).
 *   - tanımsız     → 503 "yapılandırılmadı" (sahte "ödendi" ASLA üretilmez).
 *
 * PARA DİSİPLİNİ: sağlayıcıdan dönen referans kayda yazılır; tutar/para birimi
 * bizim kaydımızla birebir eşleşmek zorundadır — çelişkide ödeme REDDEDİLİR.
 */

import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { IyzicoAdapter, iyzicoConfigFromEnv } from "./iyzico.adapter";

export interface OdemeSonucu {
  ok: true;
  /** Sağlayıcı referansı — Payment.reference alanına yazılır. */
  ref: string;
}

export type OdemeSaglayiciTuru = "SIMULASYON" | "IYZICO" | "YOK";

export function odemeSaglayiciTuru(): OdemeSaglayiciTuru {
  const v = process.env.ODEME_SAGLAYICI?.trim().toUpperCase();
  if (v === "SIMULASYON") return "SIMULASYON";
  if (v === "IYZICO") return iyzicoConfigFromEnv() ? "IYZICO" : "YOK";
  return "YOK";
}

export interface CheckoutInput {
  /** Bizim ödeme kaydımızın jetonu — sağlayıcıda conversationId olarak kullanılır. */
  checkoutToken: string;
  amount: string;
  currency: string;
  description: string;
  buyer: { id: string; name: string; email: string; ip: string; address?: string | null; taxNumber?: string | null };
  /** Sağlayıcı ödeme sonrası tarayıcıyı buraya POST'lar. */
  callbackUrl: string;
}

export interface CheckoutResult {
  /** SIMULASYON: anında tahsil edildi (paymentPageUrl yok). */
  immediate: boolean;
  ref: string;
  paymentPageUrl: string | null;
  /** Sağlayıcı checkout jetonu (iyzico `token`) — sonuç sorgusu için. */
  providerToken: string | null;
}

export interface CheckoutOutcome {
  status: "BASARILI" | "BASARISIZ" | "BEKLIYOR";
  ref: string;
  /** Sağlayıcının bildirdiği tutar/para birimi — bizimkiyle eşleşmek zorunda. */
  paidPrice: string | null;
  currency: string | null;
  conversationId: string | null;
  raw: Record<string, unknown>;
}

function notConfigured(): never {
  throw new HttpException(
    "Ödeme sağlayıcısı yapılandırılmadı (ODEME_SAGLAYICI tanımsız). Şu an çevrimiçi ödeme " +
      "alınamıyor; havale/EFT ile ödeyip dekontu iletebilirsiniz, platform ekibi faturayı " +
      "ödendi olarak işaretler. Tutara ilişkin bir tahsilat yapılmadı.",
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function simRef(): string {
  return `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

@Injectable()
export class OdemeSaglayici {
  private iyzico: IyzicoAdapter | null = null;

  /** Testler için sağlayıcı enjekte edilebilir. */
  setIyzicoForTests(adapter: IyzicoAdapter | null): void {
    this.iyzico = adapter;
  }

  get turu(): OdemeSaglayiciTuru {
    return odemeSaglayiciTuru();
  }

  private requireIyzico(): IyzicoAdapter {
    if (this.iyzico) return this.iyzico;
    const cfg = iyzicoConfigFromEnv();
    if (!cfg) notConfigured();
    this.iyzico = new IyzicoAdapter(cfg);
    return this.iyzico;
  }

  /**
   * PORTAL ödeme bağlantısı tahsilatı. Yalnızca SIMULASYON modu başarılı döner;
   * aksi hâlde 503 — kullanıcıya asla sahte "ödendi" verilmez. (Müvekkil kartı
   * için iyzico checkout akışı ayrı iş; bu uç büro→müvekkil tahsilatıdır.)
   */
  async charge(_input: { amount: string; currency: string }): Promise<OdemeSonucu> {
    if (this.turu === "SIMULASYON") return { ok: true, ref: simRef() };
    throw new HttpException(
      `Ödeme sağlayıcısı yapılandırılmadı (ODEME_SAGLAYICI tanımsız). Bu ödeme bağlantısı ` +
        "şu an ödeme alamaz; büronun sanal POS/ödeme kuruluşu sözleşmesi bağlandıktan sonra " +
        "aktif olur. Tutara ilişkin bir tahsilat yapılmadı.",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** PLATFORM tahsilatı: checkout başlat. */
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const tur = this.turu;
    if (tur === "SIMULASYON") return { immediate: true, ref: simRef(), paymentPageUrl: null, providerToken: null };
    if (tur === "IYZICO") {
      const res = await this.requireIyzico().initializeCheckoutForm(input);
      return { immediate: false, ref: res.token, paymentPageUrl: res.paymentPageUrl, providerToken: res.token };
    }
    notConfigured();
  }

  /** Sağlayıcı geri dönüşü (callback POST `token`) → sonuç. */
  async retrieveCheckout(providerToken: string): Promise<CheckoutOutcome> {
    if (this.turu !== "IYZICO") notConfigured();
    return this.requireIyzico().retrieveCheckoutForm(providerToken);
  }

  /** Webhook imzası (yalnız IYZICO). */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): boolean {
    if (this.turu !== "IYZICO") return false;
    return this.requireIyzico().verifyWebhookSignature(headers, body);
  }
}
