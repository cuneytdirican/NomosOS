/**
 * WEBHOOK'LAR (Enterprise++ entegrasyonlar).
 *
 * Olay kaynağı DENETİM İZİDİR: `AuditService.log` her kayıttan sonra
 * dinleyicileri çağırır; bu servis kataloğa (webhook-events.ts) giren
 * eylemleri abone uçlara TESLİMAT olarak kuyruklar. Teslimat zamanlanmış işle
 * (`webhook-dispatch-5dk`) yapılır: HMAC-SHA256 imza, 10 sn zaman aşımı,
 * üstel geri çekilme (1 dk → 5 dk → 30 dk → 2 sa → 12 sa); 5 yeniden deneme de
 * düşerse (6. deneme) BASARISIZ.
 *
 * SSRF: uç adresi kayıtta `validateProviderBaseUrl` ile denetlenir (yalnız
 * http/https, bulut metadata ve özel ağ adresleri reddedilir); https zorunlu.
 * Sır AES-256-GCM ile şifreli saklanır; yalnız oluşturmada düz gösterilir.
 */

import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, validateProviderBaseUrl } from "@nomosos/ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService, type AuditListenerEntry } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_ACTIONS, WEBHOOK_TEST_EVENT } from "./webhook-events";

/** Geri çekilme merdiveni (ms) — deneme sayısına göre bir sonraki zaman. */
export const WEBHOOK_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;
/** Yeniden deneme sayısı (ilk deneme hariç). */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_MS.length;
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Abone uç önbelleği (kiracı başına) — her denetim kaydında sorgu atılmasın. */
const ENDPOINT_CACHE_TTL_MS = 30_000;

export interface WebhookPayload {
  id: string;
  event: string;
  occurredAt: string;
  tenantId: string;
  entity: string | null;
  entityId: string | null;
  detail: string | null;
  actorUserId: string | null;
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Bir sonraki deneme zamanı; merdiven bitince null (BASARISIZ). */
export function nextAttemptAfter(attempts: number, now: Date): Date | null {
  const delay = WEBHOOK_BACKOFF_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

interface CachedEndpoints {
  items: Array<{ id: string; events: Set<string> }>;
  expiresAt: number;
}

@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly cache = new Map<string, CachedEndpoints>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Denetim izine abone ol — olaylar buradan akar. */
  onModuleInit(): void {
    this.audit.subscribe((entry) => this.fanOut(entry));
  }

  /** Denetim kaydı → katalogdaysa abone uçlara teslimat kuyruğu. */
  async fanOut(entry: AuditListenerEntry): Promise<number> {
    if (!WEBHOOK_EVENT_ACTIONS.has(entry.action)) return 0;
    const endpoints = await this.activeEndpoints(entry.tenantId);
    const targets = endpoints.filter((e) => e.events.has(entry.action));
    if (targets.length === 0) return 0;
    const payloadBase = {
      event: entry.action,
      occurredAt: new Date().toISOString(),
      tenantId: entry.tenantId,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? null,
      actorUserId: entry.userId ?? null,
    };
    let created = 0;
    for (const t of targets) {
      try {
        const id = randomBytes(12).toString("hex");
        await this.prisma.client.webhookDelivery.create({
          data: {
            id,
            tenantId: entry.tenantId,
            endpointId: t.id,
            event: entry.action,
            payloadJson: JSON.stringify({ id, ...payloadBase } satisfies WebhookPayload),
          },
        });
        created += 1;
      } catch (err) {
        this.logger.warn(`Webhook teslimatı kuyruklanamadı (${t.id}): ${(err as Error).message}`);
      }
    }
    return created;
  }

  private async activeEndpoints(tenantId: string) {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.items;
    const rows = await this.prisma.client.webhookEndpoint.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, events: true },
    });
    const items = rows.map((r) => ({ id: r.id, events: new Set(r.events.split(",").filter(Boolean)) }));
    this.cache.set(tenantId, { items, expiresAt: Date.now() + ENDPOINT_CACHE_TTL_MS });
    return items;
  }

  private invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  // ------------------------------------------------------------------ //
  // Yönetim uçları
  // ------------------------------------------------------------------ //

  events() {
    return WEBHOOK_EVENTS;
  }

  async list(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "webhook'ları görüntüleme");
    const rows = await this.prisma.client.webhookEndpoint.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true, url: true, description: true, events: true, isActive: true, createdAt: true, updatedAt: true },
    });
    const stats = await this.prisma.client.webhookDelivery.groupBy({
      by: ["endpointId", "status"],
      where: { tenantId: user.tenantId },
      _count: { _all: true },
    });
    const byEndpoint = new Map<string, Record<string, number>>();
    for (const s of stats) {
      const m = byEndpoint.get(s.endpointId) ?? {};
      m[s.status] = s._count._all;
      byEndpoint.set(s.endpointId, m);
    }
    return {
      items: rows.map((r) => ({ ...r, events: r.events.split(",").filter(Boolean), deliveries: byEndpoint.get(r.id) ?? {} })),
      events: WEBHOOK_EVENTS,
    };
  }

  async create(user: AuthUser, input: { url: string; events: string[]; description?: string }) {
    assertRole(user, ROLE_SETS.ONAY, "webhook tanımlama");
    this.assertUrl(input.url);
    const events = this.normalizeEvents(input.events);
    const secret = randomBytes(24).toString("hex");
    const row = await this.prisma.client.webhookEndpoint.create({
      data: {
        tenantId: user.tenantId,
        url: input.url.trim(),
        description: input.description?.trim() || null,
        encryptedSecret: encryptSecret(secret),
        events: events.join(","),
        createdBy: user.userId,
      },
    });
    this.invalidate(user.tenantId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "WEBHOOK_CREATE",
      entity: "WebhookEndpoint",
      entityId: row.id,
      detail: `${row.url} — ${events.length} olay`,
    });
    // SIR YALNIZ BURADA DÖNER — alıcı imzayı bununla doğrular.
    return { id: row.id, url: row.url, events, secret };
  }

  async update(user: AuthUser, id: string, input: { url?: string; events?: string[]; description?: string | null; isActive?: boolean }) {
    assertRole(user, ROLE_SETS.ONAY, "webhook güncelleme");
    const row = await this.requireEndpoint(user.tenantId, id);
    if (input.url) this.assertUrl(input.url);
    const events = input.events ? this.normalizeEvents(input.events) : null;
    const updated = await this.prisma.client.webhookEndpoint.update({
      where: { id: row.id },
      data: {
        ...(input.url ? { url: input.url.trim() } : {}),
        ...(events ? { events: events.join(",") } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, url: true, events: true, isActive: true, description: true },
    });
    this.invalidate(user.tenantId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "WEBHOOK_UPDATE",
      entity: "WebhookEndpoint",
      entityId: row.id,
      detail: `${updated.url} aktif=${updated.isActive}`,
    });
    return { ...updated, events: updated.events.split(",").filter(Boolean) };
  }

  async remove(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "webhook silme");
    const row = await this.requireEndpoint(user.tenantId, id);
    await this.prisma.client.webhookEndpoint.delete({ where: { id: row.id } });
    this.invalidate(user.tenantId);
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "WEBHOOK_DELETE",
      entity: "WebhookEndpoint",
      entityId: row.id,
      detail: row.url,
    });
    return { ok: true as const };
  }

  /** Test teslimatı kuyruklar (bir sonraki dağıtım turunda gider). */
  async enqueueTest(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "webhook testi");
    const row = await this.requireEndpoint(user.tenantId, id);
    const deliveryId = randomBytes(12).toString("hex");
    await this.prisma.client.webhookDelivery.create({
      data: {
        id: deliveryId,
        tenantId: user.tenantId,
        endpointId: row.id,
        event: WEBHOOK_TEST_EVENT,
        payloadJson: JSON.stringify({
          id: deliveryId,
          event: WEBHOOK_TEST_EVENT,
          occurredAt: new Date().toISOString(),
          tenantId: user.tenantId,
          entity: null,
          entityId: null,
          detail: "NomosOS webhook testi",
          actorUserId: user.userId,
        } satisfies WebhookPayload),
      },
    });
    return { ok: true as const, deliveryId };
  }

  async deliveries(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.ONAY, "webhook teslimatlarını görüntüleme");
    const row = await this.requireEndpoint(user.tenantId, id);
    const items = await this.prisma.client.webhookDelivery.findMany({
      where: { tenantId: user.tenantId, endpointId: row.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, event: true, status: true, attempts: true, nextAttemptAt: true, lastResponseCode: true, lastError: true, deliveredAt: true, createdAt: true },
    });
    return { items };
  }

  // ------------------------------------------------------------------ //
  // Dağıtım (zamanlanmış iş çağırır)
  // ------------------------------------------------------------------ //

  /** Vadesi gelen teslimatları gönderir; sonuçları yazar. */
  async dispatchDue(now: Date, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; retried: number; failed: number }> {
    const due = await this.prisma.client.webhookDelivery.findMany({
      where: { status: "BEKLIYOR", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: 200,
      include: { endpoint: { select: { url: true, encryptedSecret: true, isActive: true } } },
    });
    let sent = 0;
    let retried = 0;
    let failed = 0;
    for (const d of due) {
      if (!d.endpoint.isActive) {
        await this.prisma.client.webhookDelivery.update({ where: { id: d.id }, data: { status: "BASARISIZ", lastError: "uç pasif" } });
        failed += 1;
        continue;
      }
      const attempts = d.attempts + 1;
      let code: number | null = null;
      let error: string | null = null;
      try {
        const secret = decryptSecret(d.endpoint.encryptedSecret);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        try {
          const res = await fetchImpl(d.endpoint.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "user-agent": "NomosOS-Webhook/1.0",
              "x-nomosos-event": d.event,
              "x-nomosos-delivery": d.id,
              "x-nomosos-signature": signWebhookBody(secret, d.payloadJson),
            },
            body: d.payloadJson,
            signal: controller.signal,
          });
          code = res.status;
          if (!(res.status >= 200 && res.status < 300)) error = `HTTP ${res.status}`;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        error = (err as Error)?.name === "AbortError" ? `zaman aşımı (${WEBHOOK_TIMEOUT_MS / 1000} sn)` : (err as Error).message;
      }

      if (!error) {
        await this.prisma.client.webhookDelivery.update({
          where: { id: d.id },
          data: { status: "GONDERILDI", attempts, lastResponseCode: code, lastError: null, deliveredAt: now },
        });
        sent += 1;
        continue;
      }
      const next = nextAttemptAfter(attempts, now);
      await this.prisma.client.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: next ? "BEKLIYOR" : "BASARISIZ",
          attempts,
          lastResponseCode: code,
          lastError: error.slice(0, 500),
          ...(next ? { nextAttemptAt: next } : {}),
        },
      });
      if (next) retried += 1;
      else failed += 1;
    }
    return { sent, retried, failed };
  }

  // ------------------------------------------------------------------ //

  private assertUrl(url: string): void {
    const check = validateProviderBaseUrl(url);
    if (!check.ok) throw new BadRequestException(check.message);
    if (!url.trim().toLowerCase().startsWith("https://")) {
      throw new BadRequestException("Webhook adresi HTTPS olmalıdır — imzalı yükler düz HTTP ile taşınmaz.");
    }
  }

  private normalizeEvents(events: string[]): string[] {
    const unique = [...new Set(events)];
    if (unique.length === 0) throw new BadRequestException("En az bir olay seçin.");
    for (const e of unique) {
      if (!WEBHOOK_EVENT_ACTIONS.has(e)) throw new BadRequestException(`Katalog dışı olay: ${e}`);
    }
    return unique;
  }

  private async requireEndpoint(tenantId: string, id: string) {
    const row = await this.prisma.client.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Webhook bulunamadı.");
    return row;
  }
}
