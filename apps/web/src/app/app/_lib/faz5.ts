/**
 * Faz 5 API istemcisi — Portal (10), İletişim (19), Vekaletname (12), Sözleşme (20).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ YOLLAR SUNUCUNUN KENDİSİNDEN ALINMIŞTIR, ŞARTNAMEDEN DEĞİL.              ║
 * ║                                                                          ║
 * ║ `docs/moduller/*.md` içindeki uç tabloları taslaktır ve gerçekleşen API  ║
 * ║ ile ÖNEMLİ NOKTALARDA AYRIŞIR:                                          ║
 * ║   şartname            → gerçek                                           ║
 * ║   /poa                → /power-of-attorney                               ║
 * ║   /clients/:id/portal-users → /portal-admin/users?clientId=              ║
 * ║   /portal/publications/:id/retract → DELETE /portal-admin/publications/:id║
 * ║   /communications/:id/link-case → PATCH /inbound-messages/:id/match      ║
 * ║   /cases/:id/communications/draft-status-summary                         ║
 * ║                       → POST /outbound-messages { useAi: true }          ║
 * ║ Bu dosya `apps/api/src/{portal,communication,poa,contracts}` altındaki   ║
 * ║ controller ve Zod şemalarıyla BİREBİR tutulur.                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * YEDEK YOL YOKTUR (Faz 2 dersi): tek uç denenir; meşru 404'ler ("Müvekkil
 * bulunamadı") olduğu gibi gösterilir, gövdesiz 404 "uç henüz yayında değil"
 * olarak ayrılır (`isFeatureMissing`).
 *
 * SÖZLEŞME MODÜLÜ İSTİSNASI: `apps/api/src/contracts` bu tur yazılırken henüz
 * controller'ını yayına almamıştı; oradaki yollar şartnameden, GÖVDE ALANLARI
 * ise yazılmış olan `contracts.dto.ts`ten alınmıştır. Uç açılana kadar ekran
 * "henüz hazır değil" kartına düşer.
 */

import { ApiError, api, asList } from "@/lib/api";
import { isMissingEndpoint } from "@/lib/faz2";
import type {
  CaseRef,
  ClientRef,
  CommChannel,
  CommDirection,
  CommEntry,
  CommKind,
  ContractFinding,
  ContractItem,
  ContractRenewalItem,
  ContractReviewResult,
  ContractSigner,
  ContractStatus,
  ContractType,
  ContractVersionItem,
  MatchStatus,
  MessageTemplateItem,
  OutboundStatus,
  PoaAlert,
  PoaItem,
  PoaMissingPower,
  PoaScopeCheckResult,
  PoaScopeDefinition,
  PoaScopeItem,
  PoaType,
  PoaVerdict,
  PortalInviteResult,
  PortalPublicationItem,
  PortalPublishable,
  PortalResourceType,
  PortalUserItem,
  SignatureMethod,
  SignatureRequestItem,
  SignatureStatus,
  SignerRole,
} from "./faz5-types";

// ------------------------------------------------------------ yol tablosu

export const FAZ5_ROUTES = {
  // ---- Portal, BÜRO tarafı (portal-admin.controller.ts) ----
  // Portalın kendi uçları (/portal/...) apps/portal'ın işidir; büro token'ı
  // orada geçersizdir ve bu dosyadan ÇAĞRILMAZ.
  portalUsers: "/portal-admin/users",
  portalInvite: "/portal-admin/invite",
  portalUserDeactivate: (id: string) => `/portal-admin/users/${id}/deactivate`,
  portalUserActivate: (id: string) => `/portal-admin/users/${id}/activate`,
  portalPublications: "/portal-admin/publications",
  portalPublication: (id: string) => `/portal-admin/publications/${id}`,
  portalPublishable: "/portal-admin/publishable",

  // ---- İletişim (communication.controller.ts) ----
  communications: "/communications",
  /** Üç tabloyu birleştiren kronoloji. `/communications` yalnız LOG döndürür. */
  commTimeline: "/communications/timeline",
  commChannels: "/communications/channels",
  commUnanswered: "/communications/unanswered",
  templates: "/message-templates",
  templateRender: (id: string) => `/message-templates/${id}/render`,
  outboundMessages: "/outbound-messages",
  outboundApprovals: "/outbound-messages/approvals",
  outboundMessage: (id: string) => `/outbound-messages/${id}`,
  outboundSubmit: (id: string) => `/outbound-messages/${id}/submit`,
  outboundApprove: (id: string) => `/outbound-messages/${id}/approve`,
  outboundReject: (id: string) => `/outbound-messages/${id}/reject`,
  outboundSend: (id: string) => `/outbound-messages/${id}/send`,
  inboundMessages: "/inbound-messages",
  inboundSuggest: (id: string) => `/inbound-messages/${id}/suggest-case`,
  inboundMatch: (id: string) => `/inbound-messages/${id}/match`,

  // ---- Vekaletname (poa.controller.ts) ----
  poaScopeCatalog: "/power-of-attorney/scope-catalog",
  poaWarnings: "/power-of-attorney/warnings",
  poaList: "/power-of-attorney",
  poa: (id: string) => `/power-of-attorney/${id}`,
  poaRevoke: (id: string) => `/power-of-attorney/${id}/revoke`,
  poaScopeCheck: (id: string) => `/power-of-attorney/${id}/scope-check`,
  poaScopeChecks: (id: string) => `/power-of-attorney/${id}/scope-checks`,
  casePoaStatus: (caseId: string) => `/cases/${caseId}/poa-status`,

  // ---- Sözleşme (contracts.dto.ts + şartname) ----
  contracts: "/contracts",
  contract: (id: string) => `/contracts/${id}`,
  contractTransition: (id: string) => `/contracts/${id}/transition`,
  contractVersions: (id: string) => `/contracts/${id}/versions`,
  contractReview: (id: string) => `/contracts/${id}/review`,
  signatureRequests: (contractId: string) => `/contracts/${contractId}/signature-requests`,
  signatureCancel: (id: string) => `/signature-requests/${id}/cancel`,
  signatureProviderHealth: "/signature-providers/health",
  contractRenewals: "/contracts/renewals",
} as const;

// ------------------------------------------------------------ hata ayrımı

/** Uç henüz yayında değil mi? (gövdesiz 404 / 405 / 501 ya da ağ kopukluğu) */
export function isFeatureMissing(err: unknown): boolean {
  return isMissingEndpoint(err);
}

/**
 * "SAĞLAYICI YAPILANDIRILMAMIŞ" hatası mı?
 *
 * NEDEN AYRI: gerçek sağlayıcı kimlik bilgisi YOKTUR (ortak karar 4); çekirdek
 * `Noop` adaptörle gelir. İletişim hattı bunu 503 ile döndürür
 * (`channel-providers.ts`: "configured=false olan kanallarda gönderim denemesi
 * 503 döner ve mesaj ONAYLANDI durumunda korunur"); e-imza tarafı 501 de
 * döndürebilir — ve 501 `isMissingEndpoint` için "uç yayında değil" demektir.
 * Ayrım yapılmazsa avukat "özellik henüz hazır değil" görür ve SAĞLAYICI
 * TANIMLANMASI GEREKTİĞİNİ hiç öğrenemez. Çağıranlar ÖNCE bunu sorar.
 */
export function isNotConfigured(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 0) return false;
  if (err.status === 503) return true;
  const data = err.data as Record<string, unknown> | null;
  const code = typeof data?.code === "string" ? data.code.toUpperCase() : "";
  if (code === "NOT_CONFIGURED" || code === "PROVIDER_NOT_CONFIGURED") return true;
  const msg = `${err.message} ${typeof data?.message === "string" ? data.message : ""}`
    .toLocaleLowerCase("tr-TR");
  return (
    msg.includes("yapılandırılmamış") ||
    msg.includes("yapilandirilmamis") ||
    msg.includes("not configured") ||
    msg.includes("sağlayıcı tanımlı değil")
  );
}

/** Sunucunun üçüncü kişi KVKK kapısında döndürdüğü bulgu. */
export interface ThirdPartyPiiFinding {
  kind?: string;
  count?: number;
  sample?: string;
}

export interface ThirdPartyPiiPrompt {
  findings: ThirdPartyPiiFinding[];
  message: string;
}

/**
 * ÜÇÜNCÜ KİŞİ KİŞİSEL VERİSİ KAPISI — 409 gövdesini ayrıştırır.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NEDEN AYRI BİR AYRIŞTIRICI                                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Ekran bu kapıyı `draft.piiScan` alanına bakarak sürüyordu; oysa `piiScanJson`
 * YALNIZCA onay/gönderim anında dolar. İlk onay denemesinde alan daima boş
 * olduğu için (denetim bulgusu 5):
 *
 *   • istek `piiApproved` olmadan gidiyor → sunucu 409 döndürüyor,
 *   • ekranda düz bir hata metni çıkıyor,
 *   • ama gerekçe kutusu aynı boş alana bağlı olduğu için HİÇ GÖRÜNMÜYORDU.
 *
 * Avukat uyarıyı kapatamıyordu: akış ÇIKMAZ SOKAKTI. Ters yönü daha da kötüydü —
 * alan doluysa (müvekkilin KENDİ verisi bulunmuş olsa bile) `piiApproved: true`
 * KOŞULSUZ gönderiliyor, avukat hiç görmediği bir KVKK kapısını önceden
 * onaylamış oluyordu.
 *
 * Doğrusu: istemci `piiApproved`'u ASLA varsayılan olarak göndermez; kapıyı
 * SUNUCUNUN 409 yanıtı açar.
 */
export function extractThirdPartyPii(err: unknown): ThirdPartyPiiPrompt | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const data = (err.data ?? {}) as Record<string, unknown>;
  if (data.requiresPiiApproval !== true) return null;
  return {
    findings: Array.isArray(data.findings) ? (data.findings as ThirdPartyPiiFinding[]) : [],
    message:
      typeof data.message === "string"
        ? data.message
        : "Gönderilecek metinde alıcıya ait olmayan kişisel veri tespit edildi.",
  };
}

export const NOT_CONFIGURED_TEXT =
  "Bu işlem için bir sağlayıcı tanımlı değil. NomosOS sahte entegrasyon çalıştırmaz: " +
  "sağlayıcı yapılandırılana kadar gönderim/imza süreci başlatılamaz.";

// ------------------------------------------------------------ yardımcılar

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** JSON alanları bazen düz metin olarak gelir; ikisini de çözer. */
function parsed(value: unknown): unknown {
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function refOf(nested: unknown, id: unknown): ClientRef | null {
  const o = obj(nested);
  const rid = str(o.id) ?? str(id);
  if (!rid) return null;
  return { id: rid, name: str(o.name) ?? str(o.fullName) ?? str(o.title) };
}

function caseRefOf(nested: unknown, id: unknown): CaseRef | null {
  const o = obj(nested);
  const rid = str(o.id) ?? str(id);
  if (!rid) return null;
  return {
    id: rid,
    title: str(o.title),
    fileNumber: str(o.fileNumber),
    status: str(o.status),
  };
}

/**
 * Boş alanları ayıklar.
 *
 * Sunucu şemaları `nullableText`/`nullableUuid` kullanıyor; boş dizge çoğu
 * alanda doğrulamadan geçmez. Gönderilmeyen alan ise "değiştirme" demektir.
 */
function clean(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

// =====================================================================
// A) Portal — büro tarafı (/portal-admin)
// =====================================================================

function toPortalUser(raw: unknown): PortalUserItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    clientId: str(o.clientId) ?? "",
    email: str(o.email) ?? "",
    fullName: str(o.fullName) ?? str(o.email) ?? "—",
    isActive: bool(o.isActive, true),
    lastLoginAt: str(o.lastLoginAt),
    invitedBy: str(o.invitedBy),
    invitedAt: str(o.invitedAt),
    activatedAt: str(o.activatedAt),
    createdAt: str(o.createdAt) ?? undefined,
  };
}

export function listPortalUsers(clientId: string): Promise<PortalUserItem[]> {
  return api<unknown>(FAZ5_ROUTES.portalUsers, { query: { clientId } }).then((p) =>
    asList<unknown>(p).map(toPortalUser),
  );
}

/**
 * Portal daveti oluşturur.
 *
 * Sunucu `{ invite: { id, email, expiresAt }, token, note }` döndürür. `token`
 * HAM DEĞERDİR ve YALNIZCA BURADA, YALNIZCA BİR KEZ görünür (veritabanında
 * SHA-256 özeti saklanır). Ekran onu bir daha isteyemez.
 */
export async function invitePortalUser(
  clientId: string,
  email: string,
): Promise<PortalInviteResult> {
  const res = await api<unknown>(FAZ5_ROUTES.portalInvite, {
    method: "POST",
    body: { clientId, email: email.trim() },
  });
  const o = obj(res);
  const invite = obj(o.invite);
  return {
    email: str(invite.email) ?? email,
    token: str(o.token),
    expiresAt: str(invite.expiresAt),
    note: str(o.note),
  };
}

export function setPortalUserActive(
  portalUserId: string,
  isActive: boolean,
): Promise<PortalUserItem> {
  const path = isActive
    ? FAZ5_ROUTES.portalUserActivate(portalUserId)
    : FAZ5_ROUTES.portalUserDeactivate(portalUserId);
  return api<unknown>(path, { method: "POST", body: {} }).then(toPortalUser);
}

function toPublication(raw: unknown): PortalPublicationItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    clientId: str(o.clientId) ?? "",
    resourceType: (str(o.resourceType) ?? "DOSYA") as PortalResourceType,
    resourceId: str(o.resourceId) ?? "",
    publishedBy: str(o.publishedBy),
    publishedAt: str(o.publishedAt),
    unpublishedAt: str(o.unpublishedAt),
    note: str(o.note),
  };
}

/**
 * Yayın listesi. Varsayılan olarak YALNIZ YAYINDA OLANLAR döner
 * (`includeUnpublished` gönderilmez): yayından kaldırılan kayıt silinmediği
 * için (`@@unique` kısıtı) bu süzgeç olmadan liste yanıltıcı olurdu.
 */
export function listPublications(
  clientId: string,
  resourceType?: PortalResourceType,
): Promise<PortalPublicationItem[]> {
  return api<unknown>(FAZ5_ROUTES.portalPublications, {
    query: { clientId, resourceType },
  }).then((p) => asList<unknown>(p).map(toPublication));
}

export function isPublished(p: PortalPublicationItem | null | undefined): boolean {
  return Boolean(p) && !p!.unpublishedAt;
}

/**
 * Yayın adayları — müvekkilin bir türdeki kaynakları + "yayında mı" işareti.
 *
 * Bu uç sayesinde arayüz belge/duruşma listelerini ayrı ayrı çekmez ve
 * "yayında mı" sorusunu istemcide eşleştirmeye çalışmaz: tek kaynak sunucudur.
 */
export function listPublishable(
  clientId: string,
  resourceType: PortalResourceType,
  limit = 100,
): Promise<PortalPublishable[]> {
  return api<unknown>(FAZ5_ROUTES.portalPublishable, {
    query: { clientId, resourceType, limit },
  }).then((p) =>
    asList<unknown>(p).map((raw): PortalPublishable => {
      const o = obj(raw);
      return {
        id: str(o.id) ?? "",
        label: str(o.label) ?? "Kayıt",
        at: str(o.at),
        isPublished: bool(o.isPublished),
      };
    }),
  );
}

export function publishResource(body: {
  clientId: string;
  resourceType: PortalResourceType;
  resourceId: string;
  note?: string;
}): Promise<PortalPublicationItem> {
  return api<unknown>(FAZ5_ROUTES.portalPublications, {
    method: "POST",
    body: clean({
      clientId: body.clientId,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      note: body.note?.trim(),
    }),
  }).then(toPublication);
}

/** Yayından kaldırır — kayıt SİLİNMEZ, `unpublishedAt` damgalanır. */
export function unpublishResource(publicationId: string): Promise<PortalPublicationItem> {
  return api<unknown>(FAZ5_ROUTES.portalPublication(publicationId), {
    method: "DELETE",
  }).then(toPublication);
}

// =====================================================================
// B) İletişim merkezi
// =====================================================================

/**
 * Birleşik kutu satırını tek biçime indirger.
 *
 * TÜR TESPİTİ alan varlığına bakar, `direction`a DEĞİL: giden bir mesajın da
 * `direction: "GIDEN"` olan bir CommunicationLog karşılığı vardır, ama yalnız
 * OutboundMessage'ın onay durumu (`status` + `draftBody`) olur. Onay akışının
 * doğru satırda görünmesi buna bağlıdır.
 */
export function toCommEntry(raw: unknown): CommEntry {
  const o = obj(raw);
  const explicit = str(o.kind) ?? str(o.entryType) ?? str(o.recordType) ?? str(o.source);

  const hasOutbound = o.draftBody !== undefined;
  const hasInbound = o.matchStatus !== undefined || o.fromRef !== undefined;

  let kind: CommKind = "LOG";
  if (explicit === "GIDEN" || explicit === "OUTBOUND" || explicit === "OutboundMessage") {
    kind = "GIDEN";
  } else if (explicit === "GELEN" || explicit === "INBOUND" || explicit === "InboundMessage") {
    kind = "GELEN";
  } else if (hasOutbound) kind = "GIDEN";
  else if (hasInbound) kind = "GELEN";

  const draftBody = str(o.draftBody);
  const finalBody = str(o.finalBody);
  const body = finalBody ?? draftBody ?? str(o.body) ?? str(o.content) ?? "";

  const direction: CommDirection =
    (str(o.direction) as CommDirection | null) ?? (kind === "GELEN" ? "GELEN" : "GIDEN");

  return {
    kind,
    id: str(o.id) ?? "",
    channel: (str(o.channel) ?? "DIGER") as CommChannel,
    direction,
    subject: str(o.subject),
    body,
    occurredAt:
      str(o.occurredAt) ??
      str(o.sentAt) ??
      str(o.receivedAt) ??
      str(o.createdAt) ??
      str(o.updatedAt),
    client: refOf(o.client, o.clientId),
    case: caseRefOf(o.case, o.caseId),

    status: kind === "GIDEN" ? ((str(o.status) as OutboundStatus | null) ?? "TASLAK") : null,
    draftBody: kind === "GIDEN" ? (draftBody ?? body) : null,
    finalBody: kind === "GIDEN" ? finalBody : null,
    approvedBy: str(o.approvedBy),
    approvedAt: str(o.approvedAt),
    sentAt: str(o.sentAt),
    failureReason: str(o.failureReason),
    templateId: str(o.templateId),
    piiScan: parsed(o.piiScanJson ?? o.piiScan),

    matchStatus:
      kind === "GELEN" ? ((str(o.matchStatus) as MatchStatus | null) ?? "BEKLIYOR") : null,
    matchConfidence: num(o.matchConfidence),
    fromRef: str(o.fromRef),

    contactRef: str(o.contactRef),
    recordedBy: str(o.recordedBy),

    raw: o,
  };
}

/**
 * BİRLEŞİK KRONOLOJİ — üç tabloyu birlikte döndüren tek uç.
 *
 * DİKKAT: `GET /communications` yalnızca `CommunicationLog` satırlarını verir;
 * giden taslaklar ve gelen mesajlar ORADA GÖRÜNMEZ. Onay akışının kronolojide
 * görünmesi için `/communications/timeline` kullanılır.
 */
export function listTimeline(
  query: { clientId?: string; caseId?: string; limit?: number } = {},
): Promise<CommEntry[]> {
  return api<unknown>(FAZ5_ROUTES.commTimeline, {
    query: { clientId: query.clientId, caseId: query.caseId, limit: query.limit ?? 200 },
  }).then((p) => asList<unknown>(p).map(toCommEntry));
}

/** Elle kaydedilmiş görüşmeler (telefon, yüz yüze). */
export function listCommunicationLogs(
  query: {
    clientId?: string;
    caseId?: string;
    channel?: string;
    direction?: string;
    limit?: number;
  } = {},
): Promise<CommEntry[]> {
  return api<unknown>(FAZ5_ROUTES.communications, {
    query: { ...query, limit: query.limit ?? 200 },
  }).then((p) => asList<unknown>(p).map(toCommEntry));
}

/** Telefon / yüz yüze görüşme kaydı — gönderilmez, NOT EDİLİR. */
export function createCommunicationLog(body: {
  clientId?: string | null;
  caseId?: string | null;
  direction: CommDirection;
  channel: CommChannel;
  subject?: string;
  body: string;
  contactRef?: string;
  occurredAt?: string;
}): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.communications, {
    method: "POST",
    body: clean({
      clientId: body.clientId ?? undefined,
      caseId: body.caseId ?? undefined,
      direction: body.direction,
      channel: body.channel,
      subject: body.subject,
      body: body.body,
      contactRef: body.contactRef,
      occurredAt: body.occurredAt,
    }),
  }).then(toCommEntry);
}

export interface ChannelStatus {
  channel: CommChannel;
  provider: string;
  /** false → gönderim denemesi 503 döner; mesaj ONAYLANDI durumunda korunur. */
  configured: boolean;
  requires: string[];
}

/**
 * KANAL YAPILANDIRMA DURUMU.
 *
 * "Sağlayıcı yapılandırılmamışsa net bilgilendirme" gereğinin KAYNAĞI budur:
 * arayüz tahmin yürütmez, hangi kanalın gerçekten gönderebildiğini sunucuya
 * sorar ve gönderilemeyecek kanalda düğmeyi baştan kapatır.
 */
export function listChannelStatus(): Promise<ChannelStatus[]> {
  return api<unknown>(FAZ5_ROUTES.commChannels).then((p) =>
    asList<unknown>(p).map((raw): ChannelStatus => {
      const o = obj(raw);
      return {
        channel: (str(o.channel) ?? "DIGER") as CommChannel,
        provider: str(o.provider) ?? "noop",
        configured: bool(o.configured),
        requires: asList<unknown>(o.requires).map((r) => String(r)),
      };
    }),
  );
}

export function listMessageTemplates(): Promise<MessageTemplateItem[]> {
  return api<unknown>(FAZ5_ROUTES.templates).then((p) =>
    asList<unknown>(p).map((raw): MessageTemplateItem => {
      const o = obj(raw);
      return {
        id: str(o.id) ?? "",
        tenantId: str(o.tenantId),
        key: str(o.key) ?? "",
        name: str(o.name) ?? str(o.key) ?? "Şablon",
        channel: (str(o.channel) ?? "EPOSTA") as CommChannel,
        subject: str(o.subject),
        body: str(o.body) ?? "",
        isSystem: bool(o.isSystem, !str(o.tenantId)),
      };
    }),
  );
}

/**
 * Şablonu ÖNİZLER — değişkenleri sunucu çözer.
 *
 * Değişken çözümünü istemcide taklit etmek iki kayıt üretirdi: ekranda görünen
 * metin ile sunucunun ürettiği metin. Çözülemeyen değişken kalıp kalmadığını
 * da sunucu bilir (iş kuralı 9), bu yüzden önizleme oradan alınır.
 */
export function renderTemplate(
  templateId: string,
  input: { clientId: string; caseId?: string | null; variables?: Record<string, string> },
): Promise<{ subject: string | null; body: string; missingVariables: string[] }> {
  return api<unknown>(FAZ5_ROUTES.templateRender(templateId), {
    method: "POST",
    body: clean({
      clientId: input.clientId,
      caseId: input.caseId ?? undefined,
      variables: input.variables,
    }),
  }).then((res) => {
    const o = obj(res);
    return {
      subject: str(o.subject),
      body: str(o.body) ?? "",
      missingVariables: asList<unknown>(
        o.missingVariables ?? o.missing ?? o.unresolved,
      ).map((v) => String(v)),
    };
  });
}

export interface OutboundQuery {
  status?: string;
  clientId?: string;
  caseId?: string;
  channel?: string;
  limit?: number;
}

export function listOutboundMessages(query: OutboundQuery = {}): Promise<CommEntry[]> {
  return api<unknown>(FAZ5_ROUTES.outboundMessages, {
    query: { ...query, limit: query.limit ?? 100 },
  }).then((p) => asList<unknown>(p).map(toCommEntry));
}

/** ONAY KUYRUĞU — panel kartının ve merkez sayfasının kaynağı. */
export function listApprovalQueue(limit = 50): Promise<CommEntry[]> {
  return api<unknown>(FAZ5_ROUTES.outboundApprovals, { query: { limit } }).then((p) =>
    asList<unknown>(p).map(toCommEntry),
  );
}

/**
 * Taslak oluşturur. TASLAK KAYNAĞI ÜÇ TÜRLÜDÜR ve biri ZORUNLUDUR:
 *  - `templateId` → şablondan (sunucu değişkenleri çözer),
 *  - `draftBody`  → elle yazılmış,
 *  - `useAi: true`→ AI taslağı (MESSAGE_DRAFT, KREDİLİ; `caseId` zorunlu).
 *
 * KREDİ YALNIZ `useAi` İKEN tüketilir: şablon/elle taslak sağlayıcıya hiç
 * gitmez. Kayıt her hâlükârda `TASLAK` doğar — onaysız gönderilemez.
 */
export function createOutboundMessage(
  body: {
    clientId: string;
    caseId?: string | null;
    channel: CommChannel;
    templateId?: string | null;
    draftBody?: string;
    subject?: string;
    variables?: Record<string, string>;
    useAi?: boolean;
    instruction?: string;
  },
  piiApproved = false,
): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.outboundMessages, {
    method: "POST",
    body: clean({
      clientId: body.clientId,
      caseId: body.caseId ?? undefined,
      channel: body.channel,
      templateId: body.templateId ?? undefined,
      draftBody: body.draftBody,
      subject: body.subject,
      variables: body.variables,
      useAi: body.useAi === true ? true : undefined,
      instruction: body.instruction,
      ...(piiApproved ? { piiApproved: true } : {}),
    }),
  }).then(toCommEntry);
}

/**
 * Metni düzenler.
 *
 * `draftBody` DEĞİŞMEZ (iş kuralı 3): AI/şablon ne önerdiyse o kalır, avukatın
 * metni `finalBody`ye yazılır. ONAYLANMIŞ bir mesajda bu çağrı ONAYI DÜŞÜRÜR —
 * onaylanandan farklı bir metin gönderilemesin diye.
 */
export function updateOutboundMessage(
  id: string,
  patch: { finalBody?: string; subject?: string | null },
): Promise<CommEntry> {
  const body: Record<string, unknown> = {};
  if (patch.finalBody !== undefined) body.finalBody = patch.finalBody;
  if (patch.subject !== undefined) body.subject = patch.subject;
  return api<unknown>(FAZ5_ROUTES.outboundMessage(id), { method: "PATCH", body }).then(
    toCommEntry,
  );
}

/** Taslağı onay kuyruğuna sunar (sekreter → avukat). */
export function submitOutboundMessage(id: string): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.outboundSubmit(id), { method: "POST", body: {} }).then(
    toCommEntry,
  );
}

/**
 * ONAY — `approvedBy` burada dolar; AVUKAT ve üstü.
 *
 * `piiOverrideNote`: üçüncü kişi kişisel verisi tespitine rağmen devam kararı.
 * Sunucu gerekçesiz devam kararını kabul etmez — gerekçesiz karar denetim
 * değeri taşımaz.
 */
export function approveOutboundMessage(
  id: string,
  options: { piiApproved?: boolean; piiOverrideNote?: string } = {},
): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.outboundApprove(id), {
    method: "POST",
    body: clean({
      piiApproved: options.piiApproved ? true : undefined,
      piiOverrideNote: options.piiOverrideNote,
    }),
  }).then(toCommEntry);
}

export function rejectOutboundMessage(id: string, reason: string): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.outboundReject(id), {
    method: "POST",
    body: { reason: reason.trim() },
  }).then(toCommEntry);
}

/**
 * GÖNDERİM. `approvedBy` boşsa sunucu 409 döner; yapılandırılmamış kanalda 503.
 * Arayüz de aynı kuralı uygular — istemcideki kontrol GÜVENLİK SINIRI DEĞİLDİR.
 */
export function sendOutboundMessage(
  id: string,
  options: { piiApproved?: boolean; piiOverrideNote?: string } = {},
): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.outboundSend(id), {
    method: "POST",
    body: clean({
      piiApproved: options.piiApproved ? true : undefined,
      piiOverrideNote: options.piiOverrideNote,
    }),
  }).then(toCommEntry);
}

export function listInboundMessages(
  query: { matchStatus?: string; channel?: string; clientId?: string; caseId?: string; limit?: number } = {},
): Promise<CommEntry[]> {
  return api<unknown>(FAZ5_ROUTES.inboundMessages, {
    query: { ...query, limit: query.limit ?? 100 },
  }).then((p) => asList<unknown>(p).map(toCommEntry));
}

/** AI dosya önerisi — avukatın AÇIKÇA istediği, kredili çağrı. */
export function suggestInboundCase(id: string, piiApproved = false): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.inboundSuggest(id), {
    method: "POST",
    body: piiApproved ? { piiApproved: true } : {},
  }).then(toCommEntry);
}

/**
 * İNSAN KARARI — eşleştirmeyi kesinleştirir veya reddeder.
 * `matched: false` → "bu mesaj hiçbir dosyayla ilgili değil" (ESLESMEDI).
 */
export function matchInboundMessage(
  id: string,
  body: { clientId?: string | null; caseId?: string | null; matched?: boolean },
): Promise<CommEntry> {
  return api<unknown>(FAZ5_ROUTES.inboundMatch(id), {
    method: "PATCH",
    body: clean({
      clientId: body.clientId ?? undefined,
      caseId: body.caseId ?? undefined,
      matched: body.matched === false ? false : undefined,
    }),
  }).then(toCommEntry);
}

/** Eşleştirilmemiş gelen mesajlar — listenin EN ÜSTÜNE çıkarılır. */
export function unmatchedInbound(entries: CommEntry[]): CommEntry[] {
  return entries.filter(
    (e) => e.kind === "GELEN" && (e.matchStatus === "BEKLIYOR" || e.matchStatus === "ESLESMEDI"),
  );
}

// =====================================================================
// C) Vekaletname (/power-of-attorney)
// =====================================================================

/**
 * ÖZEL YETKİ KATALOĞU — SUNUCUDAN gelir, istemcide sabitlenmez.
 *
 * Katalog 30'dan fazla koddan oluşur ve her maddenin hukuki dayanağı vardır
 * (`poa-scope-catalog.ts`). İstemcide ikinci bir kopya tutulsaydı, kod listesi
 * ayrıştığı anda ekran sunucunun tanımadığı bir `code` gönderir ve kayıt
 * doğrulamadan geçmezdi.
 */
export function fetchScopeCatalog(): Promise<PoaScopeDefinition[]> {
  return api<unknown>(FAZ5_ROUTES.poaScopeCatalog).then((p) =>
    asList<unknown>(p).map((raw): PoaScopeDefinition => {
      const o = obj(raw);
      return {
        code: str(o.code) ?? "",
        label: str(o.label) ?? str(o.code) ?? "Yetki",
        description: str(o.description),
        requiresSpecialAuthority: bool(o.requiresSpecialAuthority),
        legalBasis: str(o.legalBasis),
      };
    }),
  );
}

function toScopeItems(raw: unknown): PoaScopeItem[] {
  const list = parsed(raw);
  if (!Array.isArray(list)) return [];
  return list
    .map((entry): PoaScopeItem | null => {
      if (typeof entry === "string") return { code: entry, label: null, present: true, note: null };
      const o = obj(entry);
      const code = str(o.code) ?? str(o.scopeCode);
      if (!code) return null;
      return {
        code,
        label: str(o.label),
        present: bool(o.present, true),
        note: str(o.note),
      };
    })
    .filter((x): x is PoaScopeItem => x !== null);
}

export function toPoaItem(raw: unknown): PoaItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    clientId: str(o.clientId) ?? "",
    client: refOf(o.client, o.clientId),
    caseId: str(o.caseId),
    case: caseRefOf(o.case, o.caseId),
    notary: str(o.notary),
    number: str(o.number),
    issuedAt: str(o.issuedAt) ?? "",
    expiresAt: str(o.expiresAt),
    revokedAt: str(o.revokedAt),
    revokeReason: str(o.revokeReason),
    scope: str(o.scope),
    documentId: str(o.documentId),
    type: (str(o.type) as PoaType | null) ?? null,
    isActive: bool(o.isActive, true),
    warningSentAt: str(o.warningSentAt),
    scopeItems: toScopeItems(o.scopeItems ?? o.scopeItemsJson),
    createdAt: str(o.createdAt) ?? undefined,
  };
}

export function listPoa(
  query: { clientId?: string; caseId?: string; status?: string } = {},
): Promise<PoaItem[]> {
  return api<unknown>(FAZ5_ROUTES.poaList, { query: { ...query, limit: 200 } }).then((p) =>
    asList<unknown>(p).map(toPoaItem),
  );
}

/** Dosyanın vekalet durumu — bağlar ve yeterlilik özeti. */
export function getCasePoaStatus(caseId: string): Promise<PoaItem[]> {
  return api<unknown>(FAZ5_ROUTES.casePoaStatus(caseId)).then((p) => {
    const o = obj(p);
    const list = Array.isArray(p) ? p : asList<unknown>(o.items ?? o.poas ?? p);
    return (list as unknown[]).map(toPoaItem);
  });
}

export interface PoaCreateInput {
  clientId: string;
  caseId?: string | null;
  type?: PoaType;
  notary?: string;
  number?: string;
  issuedAt: string;
  expiresAt?: string | null;
  scope?: string;
  scopeItems: PoaScopeItem[];
}

export function createPoa(input: PoaCreateInput): Promise<PoaItem> {
  return api<unknown>(FAZ5_ROUTES.poaList, {
    method: "POST",
    body: clean({
      clientId: input.clientId,
      caseId: input.caseId ?? undefined,
      type: input.type,
      notary: input.notary,
      number: input.number,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt ?? undefined,
      scope: input.scope,
      // Sunucu şeması `{ code, present, note? }` bekler; `label` göndermeye
      // gerek yoktur (katalogdan çözülür) ama fazlalık alan da elenmez.
      scopeItems: input.scopeItems.map((s) => ({
        code: s.code,
        present: s.present,
        ...(s.note ? { note: s.note } : {}),
      })),
    }),
  }).then(toPoaItem);
}

/** AZİL / İSTİFA / SÜRE DOLUMU — geri alınamaz hukuki sonuç doğurur. */
export function revokePoa(
  poaId: string,
  body: { reason: string; revokedAt?: string; terminationType?: "AZIL" | "ISTIFA" | "SURE_DOLUMU" },
): Promise<PoaItem> {
  return api<unknown>(FAZ5_ROUTES.poaRevoke(poaId), {
    method: "POST",
    body: clean({
      reason: body.reason.trim(),
      revokedAt: body.revokedAt,
      terminationType: body.terminationType ?? "AZIL",
    }),
  }).then(toPoaItem);
}

function toMissingPowers(raw: unknown): PoaMissingPower[] {
  const list = parsed(raw);
  if (!Array.isArray(list)) return [];
  return list.map((entry): PoaMissingPower => {
    if (typeof entry === "string") {
      return { code: entry, label: null, why: null, quote: null };
    }
    const o = obj(entry);
    return {
      code: str(o.code) ?? str(o.scopeCode) ?? "DIGER",
      label: str(o.label),
      why: str(o.why) ?? str(o.reason) ?? str(o.detail),
      quote: str(o.quote) ?? str(o.evidence) ?? str(o.excerpt),
    };
  });
}

export function toScopeCheck(raw: unknown): PoaScopeCheckResult {
  const o = obj(raw);
  const inner = obj(o.result ?? o.check ?? o.scopeCheck);
  const src = Object.keys(inner).length > 0 ? inner : o;
  const quotes = asList<unknown>(src.quotes ?? src.excerpts ?? src.evidence)
    .map((q) => (typeof q === "string" ? q : (str(obj(q).quote) ?? str(obj(q).text))))
    .filter((q): q is string => Boolean(q));

  return {
    id: str(src.id),
    powerOfAttorneyId: str(src.powerOfAttorneyId) ?? str(src.poaId),
    caseId: str(src.caseId),
    question: str(src.question),
    verdict: (str(src.verdict) as PoaVerdict | null) ?? "BELIRSIZ",
    missingPowers: toMissingPowers(src.missingPowers ?? src.missingPowersJson ?? src.missingScopes),
    aiCommentary: str(src.aiCommentary) ?? str(src.commentary),
    quotes,
    // Düşürme gerekçesi üst düzeyde de dönüyor; geçmiş kayıtlarında yalnız
    // `ai.*` altında olabilir, ikisi de okunur.
    verdictDowngradeNote:
      str(src.verdictDowngradeNote) ?? str(obj(src.ai).verdictDowngradeNote),
    droppedQuotes: asList<unknown>(obj(src.ai).droppedQuotes).map((d) => {
      const q = obj(d);
      return {
        label: str(q.label) ?? "(bulgu)",
        reasonLabel: str(q.reasonLabel) ?? str(q.reason),
        quote: str(q.quote),
      };
    }),
    model: str(src.model),
    checkedAt: str(src.checkedAt) ?? str(src.createdAt),
  };
}

/**
 * POA_SCOPE_ANALYSIS — "bu dava için yeterli mi?".
 *
 * Uç VEKALETNAME kapsamlıdır (`/power-of-attorney/:id/scope-check`), dosya
 * gövdede gider. Çıktı ÖNERİDİR: şema yorumunun deyişiyle "verdict avukatı
 * bağlamaz, dosyaya rapor olarak düşer".
 */
export function analyzePoaScope(
  poaId: string,
  input: { caseId: string; question?: string },
  piiApproved = false,
): Promise<PoaScopeCheckResult> {
  return api<unknown>(FAZ5_ROUTES.poaScopeCheck(poaId), {
    method: "POST",
    body: clean({
      caseId: input.caseId,
      question: input.question?.trim(),
      ...(piiApproved ? { piiApproved: true } : {}),
    }),
  }).then(toScopeCheck);
}

export function listScopeChecks(poaId: string): Promise<PoaScopeCheckResult[]> {
  return api<unknown>(FAZ5_ROUTES.poaScopeChecks(poaId)).then((p) =>
    asList<unknown>(p).map(toScopeCheck),
  );
}

/**
 * Süre/azil uyarıları. HESAP DETERMİNİSTİKTİR — AI kullanılmaz, kredi
 * tüketilmez (bkz. `poa-warnings.service.ts`).
 */
export function listPoaWarnings(days?: number): Promise<PoaAlert[]> {
  return api<unknown>(FAZ5_ROUTES.poaWarnings, { query: { days } }).then((p) =>
    asList<unknown>(p).map((raw): PoaAlert => {
      const o = obj(raw);
      const poa = obj(o.poa ?? o.powerOfAttorney);
      const src = Object.keys(poa).length > 0 ? poa : o;
      return {
        id: str(o.id) ?? str(src.id) ?? "",
        poaId: str(o.poaId) ?? str(src.id),
        clientId: str(o.clientId) ?? str(src.clientId),
        client: refOf(o.client ?? src.client, o.clientId ?? src.clientId),
        case: caseRefOf(o.case ?? src.case, o.caseId ?? src.caseId),
        kind: str(o.kind) ?? str(o.type) ?? str(o.severity),
        message: str(o.message) ?? str(o.title) ?? "Vekaletname uyarısı",
        expiresAt: str(o.expiresAt) ?? str(src.expiresAt),
        daysLeft: num(o.daysLeft) ?? num(o.remainingDays),
      };
    }),
  );
}

// =====================================================================
// D) Sözleşme + e-imza
// =====================================================================

function toSigners(raw: unknown): ContractSigner[] {
  const list = parsed(raw);
  if (!Array.isArray(list)) return [];
  return list.map((entry): ContractSigner => {
    if (typeof entry === "string") return { fullName: entry, email: "" };
    const o = obj(entry);
    return {
      fullName: str(o.fullName) ?? str(o.name) ?? "İmzacı",
      email: str(o.email) ?? "",
      phone: str(o.phone),
      role: (str(o.role) as SignerRole | null) ?? undefined,
      order: num(o.order) ?? undefined,
      status: str(o.status),
      signedAt: str(o.signedAt),
    };
  });
}

export function toSignatureRequest(raw: unknown): SignatureRequestItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    contractId: str(o.contractId) ?? undefined,
    versionId: str(o.versionId) ?? undefined,
    provider: str(o.provider) ?? "noop",
    method: (str(o.method) as SignatureMethod | null) ?? null,
    providerRef: str(o.providerRef),
    status: (str(o.status) as SignatureStatus | null) ?? "OLUSTURULDU",
    signers: toSigners(o.signers ?? o.signersJson),
    sentAt: str(o.sentAt),
    completedAt: str(o.completedAt),
    signedDocumentId: str(o.signedDocumentId),
    failureReason: str(o.failureReason),
    createdAt: str(o.createdAt) ?? undefined,
  };
}

function toVersion(raw: unknown): ContractVersionItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    contractId: str(o.contractId) ?? undefined,
    versionNo: num(o.versionNo) ?? 1,
    contentText: str(o.contentText),
    documentId: str(o.documentId),
    changeNote: str(o.changeNote),
    createdBy: str(o.createdBy),
    createdAt: str(o.createdAt) ?? undefined,
  };
}

export function toContract(raw: unknown): ContractItem {
  const o = obj(raw);
  return {
    id: str(o.id) ?? "",
    clientId: str(o.clientId),
    client: refOf(o.client, o.clientId),
    caseId: str(o.caseId),
    case: caseRefOf(o.case, o.caseId),
    title: str(o.title) ?? "Sözleşme",
    type: (str(o.type) as ContractType | null) ?? "DIGER",
    status: (str(o.status) as ContractStatus | null) ?? "TASLAK",
    currentVersionId: str(o.currentVersionId),
    effectiveFrom: str(o.effectiveFrom),
    effectiveTo: str(o.effectiveTo),
    renewalNoticeDays: num(o.renewalNoticeDays),
    autoRenew: bool(o.autoRenew),
    createdAt: str(o.createdAt) ?? undefined,
    updatedAt: str(o.updatedAt) ?? undefined,
    versions: asList<unknown>(o.versions).map(toVersion),
    signatureRequests: asList<unknown>(o.signatureRequests).map(toSignatureRequest),
  };
}

export function listContracts(
  query: { clientId?: string; caseId?: string; status?: string } = {},
): Promise<ContractItem[]> {
  return api<unknown>(FAZ5_ROUTES.contracts, { query: { ...query, limit: 200 } }).then((p) =>
    asList<unknown>(p).map(toContract),
  );
}

export function getContract(id: string): Promise<ContractItem> {
  return api<unknown>(FAZ5_ROUTES.contract(id)).then(toContract);
}

export interface ContractCreateInput {
  clientId?: string | null;
  caseId?: string | null;
  title: string;
  type: ContractType;
  contentText?: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  renewalNoticeDays?: number | null;
  autoRenew?: boolean;
}

export function createContract(input: ContractCreateInput): Promise<ContractItem> {
  return api<unknown>(FAZ5_ROUTES.contracts, {
    method: "POST",
    body: clean({
      clientId: input.clientId ?? undefined,
      caseId: input.caseId ?? undefined,
      title: input.title.trim(),
      type: input.type,
      contentText: input.contentText?.trim(),
      effectiveFrom: input.effectiveFrom ?? undefined,
      effectiveTo: input.effectiveTo ?? undefined,
      renewalNoticeDays: input.renewalNoticeDays ?? undefined,
      autoRenew: input.autoRenew === true ? true : undefined,
    }),
  }).then(toContract);
}

/** Durum makinesi geçişi — geçersiz geçişi SUNUCU reddeder. */
/**
 * Sözleşme durum geçişi.
 *
 * `manualApproval` PARAMETRESİ ZORUNLUYDU AMA YOKTU (denetim bulgusu 6).
 * Sunucu `FESIH`/`SONA_ERDI` için gerekçe, `YURURLUKTE` için `manualApproval`
 * + gerekçe arıyor; imza sağlayıcısı yapılandırılmadığı için tamamlanmış bir
 * e-imza süreci de hiç oluşmuyor. Sonuç: ÜRÜNÜN SEVK EDİLEN HÂLİNDE HİÇBİR
 * SÖZLEŞME ARAYÜZDEN YÜRÜRLÜĞE ALINAMIYOR, FESHEDİLEMİYOR, SONA ERDİRİLEMİYORDU;
 * kullanıcı yalnızca "Durum değiştirilemedi" görüyordu.
 */
export function transitionContract(
  id: string,
  toStatus: ContractStatus,
  options: { note?: string; manualApproval?: boolean } = {},
): Promise<ContractItem> {
  return api<unknown>(FAZ5_ROUTES.contractTransition(id), {
    method: "POST",
    body: clean({
      toStatus,
      note: options.note?.trim() || undefined,
      manualApproval: options.manualApproval ? true : undefined,
    }),
  }).then(toContract);
}

export function listContractVersions(id: string): Promise<ContractVersionItem[]> {
  return api<unknown>(FAZ5_ROUTES.contractVersions(id)).then((p) =>
    asList<unknown>(p).map(toVersion),
  );
}

/** Yeni sürüm — sürümler DEĞİŞTİRİLEMEZ, her müzakere turu yeni satırdır. */
export function createContractVersion(
  id: string,
  body: { contentText: string; changeNote?: string; makeCurrent?: boolean },
): Promise<ContractVersionItem> {
  return api<unknown>(FAZ5_ROUTES.contractVersions(id), {
    method: "POST",
    body: clean({
      contentText: body.contentText,
      changeNote: body.changeNote?.trim(),
      makeCurrent: body.makeCurrent === false ? undefined : true,
    }),
  }).then(toVersion);
}

function toFindings(raw: unknown): ContractFinding[] {
  const list = parsed(raw);
  if (!Array.isArray(list)) return [];
  return list.map((entry): ContractFinding => {
    const o = obj(entry);
    return {
      kind: str(o.kind) ?? str(o.category) ?? str(o.type) ?? "RISK",
      severity: str(o.severity) ?? str(o.risk),
      clause: str(o.clause) ?? str(o.article) ?? str(o.madde),
      title: str(o.title) ?? str(o.issue) ?? str(o.summary) ?? "Bulgu",
      detail: str(o.detail) ?? str(o.description) ?? str(o.explanation),
      quote: str(o.quote) ?? str(o.excerpt) ?? str(o.evidence),
      suggestion: str(o.suggestion) ?? str(o.recommendation) ?? str(o.fix),
    };
  });
}

/**
 * CONTRACT_REVIEW — riskli/eksik madde raporu.
 *
 * Sürüm GÖVDEDE gider (`reviewContractSchema.versionId`); boş bırakılırsa
 * güncel sürüm incelenir. Her bulgunun alıntısı sürüm metninde BİREBİR bulunur;
 * bulunamayan alıntıyı sunucu eler (`quote-guard.ts`). Arayüz alıntısız bulguyu
 * ayrıca işaretler — kaynak gösterme zorunluluğunun görünür yüzü.
 */
export async function reviewContract(
  contractId: string,
  input: { versionId?: string; ourParty?: string; focus?: string } = {},
  piiApproved = false,
): Promise<ContractReviewResult> {
  const res = await api<unknown>(FAZ5_ROUTES.contractReview(contractId), {
    method: "POST",
    body: clean({
      versionId: input.versionId,
      ourParty: input.ourParty,
      focus: input.focus,
      ...(piiApproved ? { piiApproved: true } : {}),
    }),
  });
  const o = obj(res);
  const inner = obj(o.review ?? o.result);
  const src = Object.keys(inner).length > 0 ? inner : o;
  const guard = obj(src.guard);
  return {
    contractId: str(src.contractId) ?? contractId,
    versionId: str(src.versionId) ?? input.versionId ?? null,
    findings: toFindings(src.findings ?? src.items ?? src.issues),
    summary: str(src.summary) ?? str(src.overview),
    droppedQuotes: asList<unknown>(guard.droppedQuotes).map((d) => {
      const q = obj(d);
      return {
        label: str(q.label) ?? "(bulgu)",
        reasonLabel: str(q.reasonLabel) ?? str(q.reason),
        quote: str(q.quote),
      };
    }),
    droppedMissingClaims: asList<unknown>(guard.droppedMissingClaims).map((d) => {
      const q = obj(d);
      return { topic: str(q.topic) ?? "(konu)", reason: str(q.reason) };
    }),
    unverifiedClauseRefs: asList<unknown>(guard.unverifiedClauseRefs)
      .map((r) => (typeof r === "string" ? r : null))
      .filter((r): r is string => Boolean(r)),
    model: str(src.model),
    createdAt: str(src.createdAt),
  };
}

export interface SignatureProviderHealth {
  configured: boolean;
  provider: string | null;
  note: string | null;
  configuredVia: string | null;
}

/**
 * E-İMZA SAĞLAYICI DURUMU — `/communications/channels`in sözleşme tarafındaki eşi.
 *
 * "Sağlayıcı yoksa net bilgilendirme" gereğini ÖNCEDEN karşılar: ekran, avukat
 * imzacıları tek tek girip düğmeye bastıktan SONRA hata almak yerine, formu
 * açar açmaz durumu söyler.
 */
export function signatureProviderHealth(): Promise<SignatureProviderHealth> {
  return api<unknown>(FAZ5_ROUTES.signatureProviderHealth).then((res) => {
    const o = obj(res);
    return {
      configured: bool(o.configured),
      provider: str(o.provider) ?? str(o.name),
      note: str(o.note),
      configuredVia: str(o.configuredVia),
    };
  });
}

/**
 * İmza süreci başlatır.
 *
 * SUNUCU İKİ ÖN KOŞUL ARAR (Modül 20, iş kuralı 3): sözleşme `IMZAYA_HAZIR`
 * olmalı ve imzalanacak SÜRÜM belirtilmelidir. Sağlayıcı yapılandırılmamışsa
 * "yapılandırılmamış" hatası döner — `isNotConfigured()` bunu yakalar ve ekran
 * SAHTE BİR BAŞARI GÖSTERMEZ.
 */
export function createSignatureRequest(
  contractId: string,
  body: {
    versionId: string;
    method: SignatureMethod;
    signers: ContractSigner[];
    sequential?: boolean;
  },
): Promise<SignatureRequestItem> {
  return api<unknown>(FAZ5_ROUTES.signatureRequests(contractId), {
    method: "POST",
    body: clean({
      versionId: body.versionId,
      method: body.method,
      sequential: body.sequential === true ? true : undefined,
      signers: body.signers.map((s, i) => ({
        fullName: s.fullName.trim(),
        email: (s.email ?? "").trim(),
        role: s.role ?? "MUVEKKIL",
        order: s.order ?? i + 1,
        ...(s.phone ? { phone: s.phone } : {}),
      })),
    }),
  }).then(toSignatureRequest);
}

export function cancelSignatureRequest(id: string, reason?: string): Promise<SignatureRequestItem> {
  return api<unknown>(FAZ5_ROUTES.signatureCancel(id), {
    method: "POST",
    body: clean({ reason }),
  }).then(toSignatureRequest);
}

/** Yaklaşan yenileme / fesih ihbar takvimi — süreler DETERMİNİSTİKTİR (sunucu). */
export function listContractRenewals(days = 90): Promise<ContractRenewalItem[]> {
  return api<unknown>(FAZ5_ROUTES.contractRenewals, { query: { days } }).then((p) =>
    asList<unknown>(p).map((raw): ContractRenewalItem => {
      const o = obj(raw);
      const contract = obj(o.contract);
      const src = Object.keys(contract).length > 0 ? contract : o;
      return {
        id: str(o.id) ?? str(src.id) ?? "",
        contractId: str(o.contractId) ?? str(src.id),
        title: str(src.title) ?? str(o.title) ?? "Sözleşme",
        client: refOf(src.client ?? o.client, src.clientId ?? o.clientId),
        status: (str(src.status) as ContractStatus | null) ?? null,
        effectiveTo: str(src.effectiveTo) ?? str(o.effectiveTo),
        renewalNoticeDays: num(src.renewalNoticeDays) ?? num(o.renewalNoticeDays),
        autoRenew: bool(src.autoRenew),
        daysLeft: num(o.daysLeft) ?? num(o.remainingDays),
        noticeDeadline: str(o.noticeDeadline) ?? str(o.dueDate) ?? str(o.noticeDate),
      };
    }),
  );
}
