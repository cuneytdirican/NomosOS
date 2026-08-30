/**
 * Panel Türkçe etiketleri, rozet tonları ve biçimlendirme yardımcıları.
 *
 * Enum anahtarları packages/db şemasındaki GERÇEK enum değerleriyle birebirdir
 * (SubscriptionStatus, PlatformPaymentStatus, InvoiceStatus, ApprovalStatus,
 *  SupportScope, AnnouncementSeverity, AnnouncementAudience, PlatformRole).
 *
 * AI görev tipi ve sağlayıcı katalogları `@nomosos/shared`'dan TÜRETİLİR; panel yalnız
 * kendi kısaltılmış gösterim metinlerini geçersiz kılar.
 * `AdminRole` ve `PERMISSION_MATRIX` panele özgüdür ve `rbac.ts` içinde kalır.
 */

import {
  AI_PROVIDER_TYPES,
  AI_TASK_TYPES,
  AI_TASK_TYPE_LABELS as SHARED_AI_TASK_TYPE_LABELS,
  type AiProviderType,
  type AiTaskType,
} from "@nomosos/shared";

import type { AdminRole } from "./rbac";

export type BadgeTone =
  | "gray"
  | "steel"
  | "accent"
  | "blue"
  | "green"
  | "yellow"
  | "red"
  | "danger";

// ---------- Roller ----------

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Süper Yönetici",
  OPS_ADMIN: "Operasyon Yöneticisi",
  BILLING_ADMIN: "Finans Yöneticisi",
  SUPPORT_AGENT: "Destek Uzmanı",
  ANALYST_READONLY: "Analist (salt-okur)",
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Tam yetki, platform kullanıcı/rol yönetimi, dört-göz onaylarının nihai mercii.",
  OPS_ADMIN: "Tenant yaşam döngüsü, sistem ayarları, flag/duyuru. Ödeme ve iade yapamaz.",
  BILLING_ADMIN: "Plan, abonelik, ödeme, fatura, iade. Sistem ayarına ve tenant silmeye dokunamaz.",
  SUPPORT_AGENT: "KVKK-sınırlı, süreli, salt-okur tenant incelemesi. Yıkıcı işlem yapamaz.",
  ANALYST_READONLY:
    "Yatırımcı/ortak. Sıfır yazma; yalnız toplulaştırılmış, tenant kimliği takma adlı yatırımcı görünümü.",
};

export const ROLE_TONES: Record<AdminRole, BadgeTone> = {
  SUPER_ADMIN: "accent",
  OPS_ADMIN: "blue",
  BILLING_ADMIN: "green",
  SUPPORT_AGENT: "yellow",
  ANALYST_READONLY: "steel",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role as AdminRole] ?? role;
}

export function roleTone(role: string | null | undefined): BadgeTone {
  if (!role) return "gray";
  return ROLE_TONES[role as AdminRole] ?? "gray";
}

// ---------- Plan ve abonelik ----------

/** Seed'deki plan anahtarları; gerçek liste API'den gelir, bunlar yalnız gösterim metnidir. */
export const PLAN_LABELS: Record<string, string> = {
  TRIAL: "Deneme",
  SOLO: "Solo",
  BURO: "Büro",
  ENTERPRISE: "Enterprise",
};

export const PLAN_TONES: Record<string, BadgeTone> = {
  TRIAL: "yellow",
  SOLO: "steel",
  BURO: "blue",
  ENTERPRISE: "accent",
};

/** SubscriptionStatus (packages/db) */
export const SUBSCRIPTION_STATUSES = [
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELED",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  TRIAL: "Deneme",
  ACTIVE: "Aktif",
  PAST_DUE: "Ödeme Gecikti",
  SUSPENDED: "Askıda",
  CANCELED: "İptal",
};

export const SUBSCRIPTION_STATUS_TONES: Record<string, BadgeTone> = {
  TRIAL: "yellow",
  ACTIVE: "green",
  PAST_DUE: "red",
  SUSPENDED: "danger",
  CANCELED: "gray",
};

/** Durum makinesi — izin verilen geçişler. CANCELED terminaldir. */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIAL: ["ACTIVE", "SUSPENDED", "CANCELED"],
  ACTIVE: ["PAST_DUE", "SUSPENDED", "CANCELED"],
  PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELED"],
  SUSPENDED: ["ACTIVE", "CANCELED"],
  CANCELED: [],
};

// ---------- Ödeme ve fatura (PLATFORM tarafı) ----------

/** PlatformPaymentStatus (packages/db) */
export const PLATFORM_PAYMENT_STATUSES = ["BEKLIYOR", "BASARILI", "BASARISIZ", "IADE"] as const;

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Bekliyor",
  BASARILI: "Başarılı",
  BASARISIZ: "Başarısız",
  IADE: "İade Edildi",
};

export const PAYMENT_STATUS_TONES: Record<string, BadgeTone> = {
  BEKLIYOR: "yellow",
  BASARILI: "green",
  BASARISIZ: "danger",
  IADE: "gray",
};

/** InvoiceStatus (packages/db) — platform faturaları tenant tarafıyla aynı enum'u kullanır. */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  TASLAK: "Taslak",
  GONDERILDI: "Gönderildi",
  KISMI_ODENDI: "Kısmi Ödendi",
  ODENDI: "Ödendi",
  IPTAL: "İptal",
  IADE: "İade",
};

export const INVOICE_STATUS_TONES: Record<string, BadgeTone> = {
  TASLAK: "gray",
  GONDERILDI: "blue",
  KISMI_ODENDI: "yellow",
  ODENDI: "green",
  IPTAL: "red",
  IADE: "steel",
};

// ---------- Dört-göz onay ----------

/** ApprovalStatus (packages/db) */
export const APPROVAL_STATUSES = [
  "BEKLIYOR",
  "ONAYLANDI",
  "REDDEDILDI",
  "SURESI_DOLDU",
] as const;

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  BEKLIYOR: "Bekliyor",
  ONAYLANDI: "Onaylandı",
  REDDEDILDI: "Reddedildi",
  SURESI_DOLDU: "Süresi Doldu",
};

export const APPROVAL_STATUS_TONES: Record<string, BadgeTone> = {
  BEKLIYOR: "yellow",
  ONAYLANDI: "green",
  REDDEDILDI: "red",
  SURESI_DOLDU: "gray",
};

/** Onay talebi zaman aşımı — spec: 72 saat. */
export const APPROVAL_TIMEOUT_HOURS = 72;

/** PlatformApprovalRequest.action serbest metindir; bilinen değerler için Türkçe karşılık. */
export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  "tenant.suspend": "Tenant askıya alma",
  "tenant.activate": "Tenant aktifleştirme",
  "tenant.reactivate": "Tenant aktifleştirme",
  "tenant.delete": "Tenant kalıcı silme / veri imhası",
  "tenant.plan_change": "Plan değiştirme",
  "tenant.custom_price": "Özel fiyat / manuel indirim",
  "payment.refund": "Ödeme iadesi",
  "subscription.cancel": "Abonelik iptali",
  "subscription.update": "Abonelik güncelleme",
  "support_grant.request": "Destek erişim penceresi",
  "support_access.create": "Destek erişim penceresi",
  "system.maintenance_lock": "Bakım modu tam kilidi",
  "system.flag_global_write": "Platform geneli flag değişikliği",
  "platform_user.assign_super_admin": "SUPER_ADMIN atama / düşürme",
  "platform_user.delete": "Platform kullanıcısı pasifleştirme",
  "audit.export": "Denetim izi dışa aktarımı",
};

// ---------- Destek erişimi ----------

/** SupportScope (packages/db) */
export const GRANT_SCOPES = ["SADECE_USTVERI", "YAPILANDIRMA", "ICERIK_MASKELI"] as const;

export const GRANT_SCOPE_LABELS: Record<string, string> = {
  SADECE_USTVERI: "SADECE_ÜSTVERİ — yalnız sayaç ve teknik metadata",
  YAPILANDIRMA: "YAPILANDIRMA — ayar/sağlayıcı yapılandırması (anahtar hariç)",
  ICERIK_MASKELI: "İÇERİK_MASKELİ — PII maskeli salt-okur içerik",
};

export const GRANT_SCOPE_SHORT: Record<string, string> = {
  SADECE_USTVERI: "Yalnız üstveri",
  YAPILANDIRMA: "Yapılandırma",
  ICERIK_MASKELI: "İçerik (maskeli)",
};

export const GRANT_SCOPE_TONES: Record<string, BadgeTone> = {
  SADECE_USTVERI: "steel",
  YAPILANDIRMA: "blue",
  ICERIK_MASKELI: "red",
};

/** Süre seçenekleri — varsayılan 4 saat, azami 24 saat (sunucuda da zorlanır). */
export const GRANT_DURATIONS = [
  { hours: 1, label: "1 saat" },
  { hours: 2, label: "2 saat" },
  { hours: 4, label: "4 saat (varsayılan)" },
  { hours: 8, label: "8 saat" },
  { hours: 12, label: "12 saat" },
  { hours: 24, label: "24 saat (azami)" },
] as const;

export const GRANT_MAX_HOURS = 24;
export const GRANT_DEFAULT_HOURS = 4;

// ---------- Sistem ----------

export const HEALTH_STATUS_LABELS: Record<string, string> = {
  OK: "Sağlıklı",
  UP: "Sağlıklı",
  DEGRADED: "Yavaşlama",
  DOWN: "Kesinti",
  ERROR: "Kesinti",
  UNKNOWN: "Bilinmiyor",
};

export const HEALTH_STATUS_TONES: Record<string, BadgeTone> = {
  OK: "green",
  UP: "green",
  DEGRADED: "yellow",
  DOWN: "danger",
  ERROR: "danger",
  UNKNOWN: "gray",
};

/** "up"/"ok"/"healthy" → OK ; "down"/"error" → DOWN */
export function normalizeHealthStatus(raw: string | null | undefined): string {
  if (!raw) return "UNKNOWN";
  const v = raw.toUpperCase();
  if (v === "UP" || v === "OK" || v === "HEALTHY") return "OK";
  if (v === "DOWN" || v === "ERROR" || v === "UNHEALTHY") return "DOWN";
  if (v === "DEGRADED" || v === "WARN" || v === "WARNING") return "DEGRADED";
  return v;
}

/** AnnouncementSeverity (packages/db) */
export const ANNOUNCEMENT_SEVERITIES = ["BILGI", "UYARI", "KRITIK"] as const;

export const ANNOUNCEMENT_SEVERITY_LABELS: Record<string, string> = {
  BILGI: "Bilgi",
  UYARI: "Uyarı",
  KRITIK: "Kritik",
};

export const ANNOUNCEMENT_SEVERITY_TONES: Record<string, BadgeTone> = {
  BILGI: "blue",
  UYARI: "yellow",
  KRITIK: "danger",
};

/** AnnouncementAudience (packages/db) */
export const ANNOUNCEMENT_AUDIENCES = ["TUM", "PLAN_BAZLI", "TENANT_BAZLI"] as const;

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<string, string> = {
  TUM: "Tüm tenantlar",
  PLAN_BAZLI: "Plan bazlı",
  TENANT_BAZLI: "Seçili tenantlar",
};

// ---------- AI ----------

const PROVIDER_LABEL_TEXT: Record<AiProviderType, string> = {
  ANTHROPIC: "Anthropic (Claude)",
  OPENAI_COMPAT: "OpenAI / OpenAI-uyumlu",
  OLLAMA: "Ollama (yerel)",
  GEMINI: "Google Gemini",
  CUSTOM: "Özel Endpoint",
};

export const AI_PROVIDER_TYPE_LABELS: Record<string, string> = AI_PROVIDER_TYPES.reduce<
  Record<string, string>
>((acc, type) => {
  acc[type] = PROVIDER_LABEL_TEXT[type];
  return acc;
}, {});

export const AI_PROVIDER_TYPE_TONES: Record<string, BadgeTone> = {
  ANTHROPIC: "accent",
  OPENAI_COMPAT: "green",
  OLLAMA: "blue",
  GEMINI: "yellow",
  CUSTOM: "steel",
};

/** Yerelde çalışan sağlayıcılar — "Private AI benimseme" metriğinin tabanı. */
export const LOCAL_PROVIDER_TYPES = ["OLLAMA", "CUSTOM"] as const;

const ADMIN_TASK_LABEL_OVERRIDES: Partial<Record<AiTaskType, string>> = {
  CASE_CHAT: "Dosya sohbeti",
  CASE_FULL_ANALYSIS: "Tam dosya analizi",
  SMART_NOTE: "Akıllı not",
  DOCUMENT_EXTRACT: "Belgeden veri çıkarma",
  DEADLINE_DETECT: "Süre tespiti",
  HEARING_PREP: "Duruşma hazırlığı",
  ENFORCEMENT_ANALYSIS: "İcra analizi",
  COLLECTION_LIKELIHOOD: "Tahsilat ihtimali",
  PETITION_DRAFT: "Dilekçe taslağı",
  PETITION_SECTION_REWRITE: "Dilekçe bölüm revizyonu",
  CASELAW_SEARCH: "İçtihat arama",
  CASELAW_SUMMARIZE: "Karar özeti",
  CITATION_VERIFY: "Atıf doğrulama",
  CLIENT_STATUS_SUMMARY: "Müvekkil durum özeti",
  CONFLICT_INFERENCE: "Çıkar çatışması çıkarımı",
  POA_SCOPE_ANALYSIS: "Vekaletname kapsamı",
  EXPERT_REPORT_DIFF: "Bilirkişi raporu karşılaştırma",
  STRATEGY_BUILD: "Strateji oluşturma",
  OPPONENT_SIMULATION: "Karşı taraf simülasyonu",
  JUDGE_SIMULATION: "Hakim gözüyle analiz",
  RISK_ASSESS: "Risk değerlendirmesi",
  DAILY_PRIORITIZE: "Günlük öncelik",
  CLIENT_FINANCIAL_SUMMARY: "Müvekkil finans özeti",
  CONTRACT_REVIEW: "Sözleşme incelemesi",
};

export const AI_TASK_TYPE_LABELS: Record<string, string> = AI_TASK_TYPES.reduce<
  Record<string, string>
>((acc, type) => {
  acc[type] = ADMIN_TASK_LABEL_OVERRIDES[type] ?? SHARED_AI_TASK_TYPE_LABELS[type];
  return acc;
}, {});

/** /metrics/ai?groupBy= seçenekleri. */
export const AI_GROUP_BY_OPTIONS = [
  { key: "tenant", label: "Tenant" },
  { key: "taskType", label: "Görev tipi" },
  { key: "provider", label: "Sağlayıcı" },
  { key: "model", label: "Model" },
] as const;

export type AiGroupBy = (typeof AI_GROUP_BY_OPTIONS)[number]["key"];

// ---------- Denetim izi ----------

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ADMIN_LOGIN: "Panel girişi",
  ADMIN_LOGIN_FAILED: "Başarısız panel girişi",
  PLATFORM_LOGIN: "Panel girişi",
  TENANT_CREATE: "Tenant oluşturma",
  TENANT_SUSPEND: "Tenant askıya alma",
  TENANT_ACTIVATE: "Tenant aktifleştirme",
  TENANT_REACTIVATE: "Tenant aktifleştirme",
  TENANT_DELETE: "Tenant silme / veri imhası",
  PLAN_CHANGE: "Plan değişikliği",
  CUSTOM_PRICE: "Özel fiyat tanımı",
  SUBSCRIPTION_UPDATE: "Abonelik güncelleme",
  SUBSCRIPTION_CANCEL: "Abonelik iptali",
  SUBSCRIPTION_TRANSITION: "Abonelik durum geçişi",
  REFUND_REQUEST: "İade talebi",
  REFUND_APPROVE: "İade onayı",
  PAYMENT_VIEW: "Ödeme detayı görüntüleme",
  SETTING_UPDATE: "Sistem ayarı güncelleme",
  FLAG_CREATE: "Feature flag oluşturma",
  FLAG_UPDATE: "Feature flag değişikliği",
  FLAG_TOGGLE: "Feature flag değişikliği",
  MAINTENANCE_MODE: "Bakım modu değişikliği",
  ANNOUNCEMENT_CREATE: "Duyuru oluşturma",
  ANNOUNCEMENT_UPDATE: "Duyuru güncelleme",
  ANNOUNCEMENT_DELETE: "Duyuru silme",
  ANNOUNCEMENT_PUBLISH: "Duyuru yayını",
  SUPPORT_GRANT_REQUEST: "Destek erişim talebi",
  SUPPORT_GRANT_APPROVE: "Destek erişim onayı",
  SUPPORT_ACCESS_CREATE: "Destek erişim penceresi açma",
  SUPPORT_ACCESS_REVOKE: "Destek erişimi iptali",
  PLATFORM_DESTEK_ERISIMI: "Destek erişimiyle görüntüleme",
  SUPPORT_VIEW: "Destek erişimiyle görüntüleme",
  PLATFORM_USER_CREATE: "Platform kullanıcısı oluşturma",
  PLATFORM_USER_INVITE: "Platform kullanıcısı daveti",
  PLATFORM_USER_UPDATE: "Platform kullanıcısı güncelleme",
  PLATFORM_USER_ROLE_CHANGE: "Rol değişikliği",
  PLATFORM_USER_DISABLE: "Platform kullanıcısı devre dışı",
  APPROVAL_CREATE: "Dört-göz talebi",
  APPROVAL_APPROVE: "Dört-göz onayı",
  APPROVAL_REJECT: "Dört-göz reddi",
  APPROVAL_DECIDE: "Dört-göz kararı",
  ANALYST_EXPORT: "Analist dışa aktarımı",
  AUDIT_EXPORT: "Denetim izi dışa aktarımı",
};

/** Kritik aksiyonlar — denetim izinde vurgulanır. */
export const CRITICAL_AUDIT_ACTIONS = [
  "TENANT_DELETE",
  "TENANT_SUSPEND",
  "REFUND_APPROVE",
  "SUPPORT_VIEW",
  "SUPPORT_ACCESS_CREATE",
  "PLATFORM_DESTEK_ERISIMI",
  "PLATFORM_USER_ROLE_CHANGE",
  "MAINTENANCE_MODE",
  "AUDIT_EXPORT",
  "ADMIN_LOGIN_FAILED",
];

// ---------- Yardımcılar ----------

export function labelOf(map: Record<string, string>, key: string | undefined | null): string {
  if (!key) return "—";
  return map[key] ?? key;
}

export function toneOf(
  map: Record<string, BadgeTone>,
  key: string | undefined | null,
  fallback: BadgeTone = "gray",
): BadgeTone {
  if (!key) return fallback;
  return map[key] ?? fallback;
}

export function fmtDate(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(value: string | Date | undefined | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Para biçimlendirme. Prisma Decimal STRING olarak gelebilir ("40000.00");
 * burada yalnız GÖSTERİM yapılır, aritmetik yapılmaz.
 */
export function fmtMoney(
  value: string | number | null | undefined,
  currency = "TRY",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 });
}

export function fmtNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("tr-TR");
}

export function fmtPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `%${value.toLocaleString("tr-TR", { maximumFractionDigits: digits })}`;
}

/** Büyük sayılar: 1.240.000 → 1,24 M */
export function fmtCompact(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000_000)
    return `${(n / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} Mr`;
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} M`;
  if (Math.abs(n) >= 1_000)
    return `${(n / 1_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} B`;
  return n.toLocaleString("tr-TR");
}

/** BigInt olarak saklanan bayt değerleri string gelebilir. */
export function fmtBytes(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  if (n >= 1024 ** 4)
    return `${(n / 1024 ** 4).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} TB`;
  if (n >= 1024 ** 3)
    return `${(n / 1024 ** 3).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} GB`;
  if (n >= 1024 ** 2)
    return `${(n / 1024 ** 2).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  if (n >= 1024) return `${(n / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
  return `${n.toLocaleString("tr-TR")} B`;
}

/** Kalan süre metni — destek erişimi ve onay zaman aşımı için. */
export function remainingLabel(until: string | Date | undefined | null): string {
  if (!until) return "—";
  const d = typeof until === "string" ? new Date(until) : until;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "Süresi doldu";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins} dk kaldı`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa ${mins % 60} dk kaldı`;
  return `${Math.floor(hours / 24)} gün ${hours % 24} sa kaldı`;
}

export function isExpired(until: string | Date | undefined | null): boolean {
  if (!until) return false;
  const d = typeof until === "string" ? new Date(until) : until;
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= Date.now();
}

/** ISO tarih → <input type="date"> değeri. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bugünden N gün önce. */
export function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * KVKK: tenant kimliği yerine TAKMA AD — ANALYST_READONLY görünümünde son savunma hattı.
 * Takma adlar OTURUM KAPSAMLIDIR ve gerçek kimlikten türetilmez; sayfa yenilenince değişir.
 * Asıl gereklilik sunucudadır: /metrics/investor yanıtı tenant kimliği taşıyan kolon içermez.
 */
const PSEUDONYM_BY_KEY = new Map<string, string>();

export function pseudoTenant(key: string): string {
  const k = key ?? "";
  const existing = PSEUDONYM_BY_KEY.get(k);
  if (existing) return existing;
  const label = `Tenant #${String(PSEUDONYM_BY_KEY.size + 1).padStart(3, "0")}`;
  PSEUDONYM_BY_KEY.set(k, label);
  return label;
}

/** E-posta maskeleme (destek/analist görünümleri). */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return "—";
  const [name, domain] = value.split("@");
  if (!domain) return "•••";
  const head = name.slice(0, 2);
  return `${head}${"•".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

/** JSON string alanlarını (payloadJson, enabledTenantIdsJson, targetJson) güvenle ayrıştırır. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Onay talebi payload'ını insan-okunur satırlara çevirir (dört-göz ekranı). */
export function payloadRows(raw: unknown): Array<{ key: string; value: string }> {
  let obj: unknown = raw;
  if (typeof raw === "string") obj = parseJson<unknown>(raw, null);
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).map(([key, value]) => ({
    key,
    value:
      value === null || value === undefined
        ? "—"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
  }));
}
