/**
 * GET /api/admin/v1/health yanıtını tek bir kontrol listesine indirger.
 *
 * Üç biçim desteklenir:
 *  - PlatformHealthService (asıl): { status, checkedAt, uptimeSeconds,
 *    components: [{ component, status, latencyMs, detail }] }
 *  - { checks: [{ key, label, status, value, detail, checkedAt }] }
 *  - Nest Terminus: { status, info: { db: { status: "up" } }, details: {...}, error: {...} }
 *
 * Bilinmeyen bir biçim gelirse boş liste döner — uydurma satır üretilmez.
 */

import { normalizeHealthStatus } from "./labels";
import type { AdminHealthCheck, AdminHealthResponse } from "./types";

const CHECK_LABELS: Record<string, string> = {
  db: "PostgreSQL",
  database: "PostgreSQL",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  prisma: "PostgreSQL",
  redis: "Redis",
  cache: "Redis",
  storage: "MinIO / Depo",
  s3: "MinIO / Depo",
  minio: "MinIO / Depo",
  queue: "Kuyruk (BullMQ)",
  bullmq: "Kuyruk (BullMQ)",
  api: "API",
  memory_heap: "Bellek (heap)",
  memory_rss: "Bellek (RSS)",
  disk: "Disk",
};

function detailText(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null;
  const parts = Object.entries(raw)
    .filter(([k]) => k !== "status")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function normalizeHealth(payload: AdminHealthResponse | null): AdminHealthCheck[] {
  if (!payload) return [];

  // PlatformHealthService biçimi: components: [{ component, status, latencyMs, detail }]
  if (Array.isArray(payload.components) && payload.components.length > 0) {
    return payload.components.map((c) => ({
      key: c.component,
      label: CHECK_LABELS[c.component] ?? c.component,
      status: normalizeHealthStatus(c.status),
      value: typeof c.latencyMs === "number" ? `${c.latencyMs} ms` : null,
      detail: c.detail ?? null,
      checkedAt: payload.checkedAt ?? null,
    }));
  }

  if (Array.isArray(payload.checks) && payload.checks.length > 0) {
    return payload.checks.map((c) => ({
      ...c,
      label: c.label ?? CHECK_LABELS[c.key] ?? c.key,
      status: normalizeHealthStatus(c.status),
    }));
  }

  const merged: Record<string, Record<string, unknown>> = {
    ...(payload.details ?? {}),
    ...(payload.info ?? {}),
    ...(payload.error ?? {}),
  };

  const keys = Object.keys(merged);
  if (keys.length === 0) return [];

  return keys.map((key) => {
    const entry = merged[key] ?? {};
    return {
      key,
      label: CHECK_LABELS[key] ?? key,
      status: normalizeHealthStatus(
        typeof entry.status === "string" ? entry.status : undefined,
      ),
      value: null,
      detail: detailText(entry),
      checkedAt: payload.checkedAt ?? null,
    } satisfies AdminHealthCheck;
  });
}
