/**
 * EXPO PUSH SAĞLAYICISI (Faz 2) — mobil uygulama Expo push jetonu
 * (`ExponentPushToken[...]`) kaydeder; sunucu Expo Push API'sine gönderir, Expo
 * FCM/APNs'e iletir. Etkinleştirme: `PUSH_PROVIDER=expo` (isteğe bağlı
 * `EXPO_ACCESS_TOKEN`). 100'lük parçalarla gönderim; `DeviceNotRegistered`
 * dönen jetonlar sonuçta bildirilir (çağıran pasifleştirir).
 */

import { Injectable, Logger } from "@nestjs/common";
import { fetchWithTimeout } from "@nomosos/ai";
import { buildPushPayload, type PushMessage, type PushProvider, type PushSendResult, type PushTarget } from "./push-provider";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

@Injectable()
export class ExpoPushProvider implements PushProvider {
  readonly name = "expo";
  readonly configured = true;
  private readonly logger = new Logger(ExpoPushProvider.name);
  /** Son gönderimde `DeviceNotRegistered` alan jetonlar — çağıran pasifleştirir. */
  invalidTokens: string[] = [];

  async send(messages: PushMessage[], targets: PushTarget[]): Promise<PushSendResult> {
    this.invalidTokens = [];
    const valid = targets.filter((t) => isExpoPushToken(t.token));
    if (messages.length === 0 || valid.length === 0) {
      return { delivered: 0, skipped: messages.length, reason: valid.length === 0 ? "Geçerli Expo push jetonu yok." : "mesaj yok" };
    }
    const payloads = messages.flatMap((m) => {
      const p = buildPushPayload(m.kind);
      return valid.map((t) => ({ to: t.token, title: p.title, body: p.body, sound: "default", data: { kind: m.kind, ...(m.data ?? {}) } }));
    });
    let delivered = 0;
    let failed = 0;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const chunk = payloads.slice(i, i + CHUNK);
      try {
        const res = await fetchWithTimeout(
          EXPO_PUSH_URL,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
            },
            body: JSON.stringify(chunk),
          },
          15_000,
        );
        const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
        (json.data ?? []).forEach((ticket, idx) => {
          if (ticket.status === "ok") delivered += 1;
          else {
            failed += 1;
            if (ticket.details?.error === "DeviceNotRegistered") this.invalidTokens.push(chunk[idx].to);
          }
        });
      } catch (err) {
        failed += chunk.length;
        this.logger.warn(`Expo push gönderimi başarısız: ${(err as Error).message}`);
      }
    }
    return { delivered, skipped: failed, reason: failed ? `${failed} bildirim iletilemedi` : "ok" };
  }
}
