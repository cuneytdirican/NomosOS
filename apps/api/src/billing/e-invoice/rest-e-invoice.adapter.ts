/**
 * REST ENTEGRATÖR ADAPTÖRÜ (Faz 3) — `providerKey = "rest"`.
 *
 * Özel entegratörlerin (Logo, Sovos/Foriba, Uyumsoft, Paraşüt…) API'leri birbirinden
 * farklıdır; sözleşme yapılan entegratörün uçları bu adaptörün "köprü" sözleşmesine
 * eşlenir (çoğu entegratör böyle bir REST köprüsü sunar ya da bizim tarafta ince bir
 * eşleyici gerektirir). Sözleşme:
 *
 *   GET  {baseUrl}/taxpayers/{vkn}                → { isEInvoiceUser, alias?, title? }
 *   POST {baseUrl}/invoices                       (UblInvoicePayload JSON; Idempotency-Key: uuid)
 *                                                 → { providerRef, gibUuid, status }
 *   GET  {baseUrl}/invoices/{providerRef}/status  → { status }
 *   POST {baseUrl}/invoices/{providerRef}/cancel  { reason }
 *   GET  {baseUrl}/invoices/{providerRef}/pdf     → application/pdf
 *
 * Kimlik: `Authorization: Bearer {apiKey}` (+ isteğe bağlı `X-Sender-Alias`).
 * Yanıt 2xx değilse hata fırlatır; çağıran fatura alanlarını değiştirmez
 * (Modül 09 idempotens kuralı: zaman aşımında yeniden gönderme yok, önce durum sor).
 */

import { fetchWithTimeout } from "@nomosos/ai";
import type { EInvoiceAdapter, GibStatus, SendInvoiceResult, TaxpayerCheckResult, UblInvoicePayload } from "./e-invoice.types";

export interface RestEInvoiceConfig {
  baseUrl: string;
  apiKey: string;
  senderAlias?: string | null;
}

const TIMEOUT_MS = 20_000;
const GIB_STATUSES: GibStatus[] = ["TASLAK", "GONDERILDI", "KABUL", "RED", "IPTAL", "BILINMIYOR"];

export class RestEInvoiceAdapter implements EInvoiceAdapter {
  readonly key = "rest";
  readonly isConfigured = true;

  constructor(private readonly cfg: RestEInvoiceConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.cfg.apiKey}`,
      ...(this.cfg.senderAlias ? { "x-sender-alias": this.cfg.senderAlias } : {}),
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async expectJson<T>(res: Response, op: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) throw new Error(`e-Fatura entegratörü ${op} başarısız (HTTP ${res.status}): ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`e-Fatura entegratörü ${op}: JSON olmayan yanıt.`);
    }
  }

  async checkTaxpayer(vkn: string): Promise<TaxpayerCheckResult> {
    const res = await fetchWithTimeout(this.url(`/taxpayers/${encodeURIComponent(vkn)}`), { headers: this.headers() }, TIMEOUT_MS);
    const json = await this.expectJson<{ isEInvoiceUser?: boolean; alias?: string; title?: string }>(res, "mükellef sorgusu");
    return { isEInvoiceUser: Boolean(json.isEInvoiceUser), alias: json.alias, title: json.title };
  }

  async sendInvoice(payload: UblInvoicePayload): Promise<SendInvoiceResult> {
    const res = await fetchWithTimeout(
      this.url("/invoices"),
      { method: "POST", headers: this.headers({ "content-type": "application/json", "idempotency-key": payload.uuid }), body: JSON.stringify(payload) },
      TIMEOUT_MS,
    );
    const json = await this.expectJson<{ providerRef?: string; gibUuid?: string; status?: string }>(res, "fatura gönderimi");
    if (!json.providerRef) throw new Error("e-Fatura entegratörü providerRef döndürmedi.");
    return { providerRef: json.providerRef, gibUuid: json.gibUuid ?? payload.uuid, status: this.toStatus(json.status) };
  }

  async getStatus(providerRef: string): Promise<GibStatus> {
    const res = await fetchWithTimeout(this.url(`/invoices/${encodeURIComponent(providerRef)}/status`), { headers: this.headers() }, TIMEOUT_MS);
    const json = await this.expectJson<{ status?: string }>(res, "durum sorgusu");
    return this.toStatus(json.status);
  }

  async cancelInvoice(providerRef: string, reason: string): Promise<void> {
    const res = await fetchWithTimeout(
      this.url(`/invoices/${encodeURIComponent(providerRef)}/cancel`),
      { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify({ reason }) },
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`e-Fatura entegratörü iptal başarısız (HTTP ${res.status}).`);
  }

  async downloadPdf(providerRef: string): Promise<Buffer> {
    const res = await fetchWithTimeout(this.url(`/invoices/${encodeURIComponent(providerRef)}/pdf`), { headers: { ...this.headers(), accept: "application/pdf" } }, TIMEOUT_MS);
    if (!res.ok) throw new Error(`e-Fatura entegratörü PDF indirme başarısız (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  private toStatus(raw: string | undefined): GibStatus {
    const s = (raw ?? "").toUpperCase();
    return (GIB_STATUSES as string[]).includes(s) ? (s as GibStatus) : "BILINMIYOR";
  }
}
