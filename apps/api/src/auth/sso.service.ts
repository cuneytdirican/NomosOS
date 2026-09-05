/**
 * SSO — OIDC KURUMSAL GİRİŞ (Enterprise++).
 *
 * Büro, kendi kimlik sağlayıcısını (Microsoft Entra ID, Google Workspace, Okta,
 * Keycloak… — OpenID Connect discovery destekleyen her IdP) tanımlar;
 * kullanıcılar e-posta alan adıyla "Kurumsal giriş"e yönlendirilir.
 *
 * Akış (Authorization Code, gizli istemci):
 *   1. `start(email)` — alan adı → büro; imzalı `state` (JWT, 10 dk, nonce)
 *      üretilir; IdP authorization_endpoint adresi döner.
 *   2. IdP → `callback(code, state)` — state doğrulanır; kod token_endpoint'te
 *      (client_secret_post) takas edilir; ID token BACK-CHANNEL'dan geldiği
 *      için imza yerine iss/aud/nonce/exp denetlenir (OIDC Core §3.1.3.7/6);
 *      e-posta yoksa userinfo'dan alınır.
 *   3. Kullanıcı eşleme: e-posta alanı büronun alanıyla eşleşmeli; mevcut
 *      kullanıcı `ssoSubject` ile bağlanır (farklı sub → red); yoksa ve
 *      otomatik açma açıksa varsayılan rolle açılır.
 *   4. Oturum `SessionService.issue(…, "sso")` — 2FA challenge'ı ATLANIR:
 *      çok faktör IdP'nin sorumluluğudur (belgede açık).
 *
 * `ssoEnforced`: parola girişi kapatılır (AuthService.login) — ADMIN hariç
 * (IdP arızasında "cam kır" erişimi).
 * SSRF: issuer `validateProviderBaseUrl` + HTTPS zorunlu. SAML kapsam dışıdır.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { UserRole } from "@nomosos/shared";
import { decryptSecret, encryptSecret, fetchWithTimeout, validateProviderBaseUrl } from "@nomosos/ai";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import { apiPublicUrl } from "../common/public-urls";
import { SessionService, type IssuedSession } from "./session.service";

export const SSO_STATE_AUDIENCE = "tenant-sso";
const STATE_TTL = "10m";
const HTTP_TIMEOUT_MS = 10_000;
const DISCOVERY_TTL_MS = 10 * 60_000;
const PASSWORD_HASH_ROUNDS = 10;
const SSO_ROLES: readonly UserRole[] = ["PARTNER", "AVUKAT", "STAJYER", "SEKRETER"];

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
}

interface StatePayload {
  tenantId: string;
  nonce: string;
  email: string;
}

export interface SsoConfigInput {
  enabled?: boolean;
  issuer?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  emailDomain?: string | null;
  enforced?: boolean;
  autoProvision?: boolean;
  defaultRole?: UserRole;
}

/** JWT gövdesini (imza DOĞRULAMADAN) çözer — yalnız back-channel ID token için. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new UnauthorizedException("Kimlik sağlayıcı geçersiz bir ID token döndürdü.");
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedException("Kimlik sağlayıcı geçersiz bir ID token döndürdü.");
  }
}

export function normalizeIssuer(iss: string): string {
  return iss.trim().replace(/\/+$/, "");
}

export function emailDomainOf(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly discoveryCache = new Map<string, { doc: OidcDiscovery; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly session: SessionService,
  ) {}

  /** IdP'ye kaydedilecek geri dönüş adresi. */
  callbackUrl(): string {
    return `${apiPublicUrl()}/api/v1/auth/sso/callback`;
  }

  // ------------------------------------------------------------------ //
  // Yapılandırma (büro yöneticisi)
  // ------------------------------------------------------------------ //

  async getConfig(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "SSO yapılandırmasını görüntüleme");
    const t = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        ssoEnabled: true,
        ssoIssuer: true,
        ssoClientId: true,
        ssoClientSecret: true,
        ssoEmailDomain: true,
        ssoEnforced: true,
        ssoAutoProvision: true,
        ssoDefaultRole: true,
      },
    });
    const linkedUsers = await this.prisma.client.user.count({ where: { tenantId: user.tenantId, ssoSubject: { not: null } } });
    return {
      enabled: t?.ssoEnabled ?? false,
      issuer: t?.ssoIssuer ?? null,
      clientId: t?.ssoClientId ?? null,
      clientSecretSet: Boolean(t?.ssoClientSecret),
      emailDomain: t?.ssoEmailDomain ?? null,
      enforced: t?.ssoEnforced ?? false,
      autoProvision: t?.ssoAutoProvision ?? false,
      defaultRole: t?.ssoDefaultRole ?? "STAJYER",
      callbackUrl: this.callbackUrl(),
      linkedUsers,
      roles: SSO_ROLES,
    };
  }

  async updateConfig(user: AuthUser, input: SsoConfigInput) {
    assertRole(user, ["ADMIN"], "SSO yapılandırmasını değiştirme");
    const current = await this.prisma.client.tenant.findUnique({
      where: { id: user.tenantId },
      select: { ssoEnabled: true, ssoIssuer: true, ssoClientId: true, ssoClientSecret: true, ssoEmailDomain: true, ssoEnforced: true },
    });
    if (!current) throw new NotFoundException("Büro bulunamadı.");

    const data: Record<string, unknown> = {};
    if (input.issuer !== undefined) {
      if (input.issuer) {
        const iss = normalizeIssuer(input.issuer);
        const check = validateProviderBaseUrl(iss);
        if (!check.ok) throw new BadRequestException(check.message);
        if (!iss.toLowerCase().startsWith("https://")) throw new BadRequestException("Kimlik sağlayıcı adresi HTTPS olmalıdır.");
        data.ssoIssuer = iss;
      } else {
        data.ssoIssuer = null;
      }
    }
    if (input.clientId !== undefined) data.ssoClientId = input.clientId?.trim() || null;
    if (input.clientSecret !== undefined && input.clientSecret !== null && input.clientSecret !== "") {
      data.ssoClientSecret = encryptSecret(input.clientSecret.trim());
    }
    if (input.emailDomain !== undefined) {
      if (input.emailDomain) {
        const d = input.emailDomain.trim().toLowerCase().replace(/^@/, "");
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new BadRequestException("E-posta alan adı geçersiz (örn. ornekhukuk.com).");
        data.ssoEmailDomain = d;
      } else {
        data.ssoEmailDomain = null;
      }
    }
    if (input.defaultRole !== undefined) {
      if (!SSO_ROLES.includes(input.defaultRole)) throw new BadRequestException("Varsayılan rol ADMIN olamaz.");
      data.ssoDefaultRole = input.defaultRole;
    }
    if (input.autoProvision !== undefined) data.ssoAutoProvision = input.autoProvision;

    const enabled = input.enabled ?? current.ssoEnabled;
    // Alan bu istekte GÖNDERİLDİYSE (null = temizleme dahil) yeni değer geçerlidir.
    const issuer = ("ssoIssuer" in data ? data.ssoIssuer : current.ssoIssuer) as string | null;
    const clientId = ("ssoClientId" in data ? data.ssoClientId : current.ssoClientId) as string | null;
    const secretSet = Boolean(data.ssoClientSecret ?? current.ssoClientSecret);
    const domain = ("ssoEmailDomain" in data ? data.ssoEmailDomain : current.ssoEmailDomain) as string | null;
    if (enabled && (!issuer || !clientId || !secretSet || !domain)) {
      throw new BadRequestException("SSO'yu açmak için sağlayıcı adresi, istemci kimliği, istemci sırrı ve e-posta alan adı zorunludur.");
    }
    data.ssoEnabled = enabled;
    const enforced = input.enforced ?? current.ssoEnforced;
    if (enforced && !enabled) throw new BadRequestException("Parola girişini kapatmak için önce SSO açık olmalıdır.");
    data.ssoEnforced = enforced;

    await this.prisma.client.tenant.update({ where: { id: user.tenantId }, data });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "SSO_CONFIG_UPDATE",
      entity: "Tenant",
      entityId: user.tenantId,
      detail: `SSO ${enabled ? "açık" : "kapalı"}; zorunlu=${enforced}; alan=${domain ?? "-"}; sağlayıcı=${issuer ?? "-"}${data.ssoClientSecret ? "; sır güncellendi" : ""}`,
    });
    return this.getConfig(user);
  }

  /** Discovery belgesini çeker — yapılandırmayı IdP'ye karşı sınar. */
  async testConnection(user: AuthUser) {
    assertRole(user, ROLE_SETS.ONAY, "SSO bağlantı testi");
    const t = await this.prisma.client.tenant.findUnique({ where: { id: user.tenantId }, select: { ssoIssuer: true } });
    if (!t?.ssoIssuer) throw new BadRequestException("Önce kimlik sağlayıcı adresini kaydedin.");
    const doc = await this.discover(t.ssoIssuer, true);
    return {
      ok: true as const,
      issuer: doc.issuer,
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      userinfoEndpoint: doc.userinfo_endpoint ?? null,
    };
  }

  // ------------------------------------------------------------------ //
  // Giriş akışı
  // ------------------------------------------------------------------ //

  /** E-posta alanına göre büroyu bulur; IdP yetkilendirme adresini üretir. */
  async start(email: string): Promise<{ authorizationUrl: string }> {
    const domain = emailDomainOf(email);
    if (!domain) throw new BadRequestException("Geçerli bir e-posta adresi girin.");
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { ssoEnabled: true, ssoEmailDomain: domain },
      select: { id: true, ssoIssuer: true, ssoClientId: true },
    });
    if (!tenant?.ssoIssuer || !tenant.ssoClientId) {
      throw new NotFoundException("Bu e-posta alanı için kurumsal giriş (SSO) tanımlı değil.");
    }
    const doc = await this.discover(tenant.ssoIssuer);
    const nonce = randomBytes(16).toString("hex");
    const state = await this.jwt.signAsync(
      { tenantId: tenant.id, nonce, email: email.trim().toLowerCase() } satisfies StatePayload,
      { audience: SSO_STATE_AUDIENCE, expiresIn: STATE_TTL },
    );
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", tenant.ssoClientId);
    url.searchParams.set("redirect_uri", this.callbackUrl());
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("login_hint", email.trim().toLowerCase());
    return { authorizationUrl: url.toString() };
  }

  /** IdP geri dönüşü: kod takası → kimlik → kullanıcı → oturum. */
  async callback(code: string, state: string): Promise<IssuedSession> {
    let payload: StatePayload;
    try {
      payload = await this.jwt.verifyAsync<StatePayload>(state, { audience: SSO_STATE_AUDIENCE });
    } catch {
      throw new UnauthorizedException("SSO oturumu geçersiz ya da süresi dolmuş; girişi yeniden başlatın.");
    }
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: payload.tenantId },
      select: {
        id: true,
        ssoEnabled: true,
        ssoIssuer: true,
        ssoClientId: true,
        ssoClientSecret: true,
        ssoEmailDomain: true,
        ssoAutoProvision: true,
        ssoDefaultRole: true,
      },
    });
    if (!tenant?.ssoEnabled || !tenant.ssoIssuer || !tenant.ssoClientId || !tenant.ssoClientSecret || !tenant.ssoEmailDomain) {
      throw new UnauthorizedException("Bu büro için SSO artık etkin değil.");
    }
    const doc = await this.discover(tenant.ssoIssuer);

    // Kod takası — client_secret_post (en yaygın kabul gören yöntem).
    const tokenRes = await fetchWithTimeout(
      doc.token_endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: this.callbackUrl(),
          client_id: tenant.ssoClientId,
          client_secret: decryptSecret(tenant.ssoClientSecret),
        }).toString(),
      },
      HTTP_TIMEOUT_MS,
    );
    if (!tokenRes.ok) {
      this.logger.warn(`SSO kod takası başarısız (${tenant.id}): HTTP ${tokenRes.status}`);
      throw new UnauthorizedException("Kimlik sağlayıcı yetkilendirme kodunu kabul etmedi.");
    }
    const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token) throw new UnauthorizedException("Kimlik sağlayıcı ID token döndürmedi (openid kapsamı eksik olabilir).");

    const claims = decodeJwtPayload(tokens.id_token);
    const iss = typeof claims.iss === "string" ? normalizeIssuer(claims.iss) : "";
    if (iss !== normalizeIssuer(tenant.ssoIssuer)) throw new UnauthorizedException("ID token beklenen sağlayıcıdan gelmiyor (iss).");
    const aud = Array.isArray(claims.aud) ? (claims.aud as unknown[]) : [claims.aud];
    if (!aud.includes(tenant.ssoClientId)) throw new UnauthorizedException("ID token bu uygulama için düzenlenmemiş (aud).");
    if (claims.nonce !== payload.nonce) throw new UnauthorizedException("ID token nonce eşleşmiyor.");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new UnauthorizedException("ID token süresi dolmuş.");
    const sub = typeof claims.sub === "string" ? claims.sub : "";
    if (!sub) throw new UnauthorizedException("ID token kullanıcı kimliği (sub) taşımıyor.");

    let email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    let name = typeof claims.name === "string" ? claims.name.trim() : "";
    if ((!email || !name) && doc.userinfo_endpoint && tokens.access_token) {
      try {
        const ui = await fetchWithTimeout(
          doc.userinfo_endpoint,
          { headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" } },
          HTTP_TIMEOUT_MS,
        );
        if (ui.ok) {
          const info = (await ui.json()) as Record<string, unknown>;
          if (!email && typeof info.email === "string") email = info.email.trim().toLowerCase();
          if (!name && typeof info.name === "string") name = info.name.trim();
        }
      } catch (err) {
        this.logger.warn(`SSO userinfo alınamadı: ${(err as Error).message}`);
      }
    }
    if (!email) throw new UnauthorizedException("Kimlik sağlayıcı e-posta adresi vermedi (email kapsamı gerekli).");
    if (claims.email_verified === false) throw new UnauthorizedException("Kimlik sağlayıcıda e-posta doğrulanmamış.");
    if (emailDomainOf(email) !== tenant.ssoEmailDomain) {
      await this.audit.log({ tenantId: tenant.id, action: "LOGIN_FAILED", entity: "User", detail: `${email} — SSO alan adı uyuşmazlığı` });
      throw new ForbiddenException("Bu e-posta adresi büronun SSO alan adına ait değil.");
    }

    const user = await this.resolveUser(tenant, { sub, email, name });

    const subscription = await this.prisma.client.subscription.findUnique({ where: { tenantId: tenant.id }, select: { status: true } });
    if (subscription && (subscription.status === "SUSPENDED" || subscription.status === "CANCELED")) {
      throw new ForbiddenException("Büronuzun aboneliği askıda ya da sona ermiş.");
    }
    return this.session.issue({ id: user.id, tenantId: user.tenantId, email: user.email, fullName: user.fullName, role: user.role }, "sso");
  }

  // ------------------------------------------------------------------ //

  private async resolveUser(
    tenant: { id: string; ssoAutoProvision: boolean; ssoDefaultRole: UserRole },
    identity: { sub: string; email: string; name: string },
  ) {
    const existing = await this.prisma.client.user.findUnique({
      where: { email: identity.email },
      select: { id: true, tenantId: true, email: true, fullName: true, role: true, isActive: true, ssoSubject: true },
    });
    if (existing) {
      if (existing.tenantId !== tenant.id) throw new ForbiddenException("Bu e-posta adresi başka bir büroya kayıtlı.");
      if (!existing.isActive) {
        await this.audit.log({ tenantId: tenant.id, userId: existing.id, action: "LOGIN_FAILED", entity: "User", entityId: existing.id, detail: `${identity.email} — SSO, hesap pasif` });
        throw new ForbiddenException("Hesabınız pasif; büro yöneticinize başvurun.");
      }
      if (existing.ssoSubject && existing.ssoSubject !== identity.sub) {
        await this.audit.log({ tenantId: tenant.id, userId: existing.id, action: "LOGIN_FAILED", entity: "User", entityId: existing.id, detail: `${identity.email} — SSO kimliği (sub) uyuşmuyor` });
        throw new ForbiddenException("Bu hesap farklı bir kurumsal kimlikle bağlı; büro yöneticinize başvurun.");
      }
      if (!existing.ssoSubject) {
        await this.prisma.client.user.update({ where: { id: existing.id }, data: { ssoSubject: identity.sub } });
        await this.audit.log({ tenantId: tenant.id, userId: existing.id, action: "SSO_LINK", entity: "User", entityId: existing.id, detail: `${identity.email} kurumsal kimliğe bağlandı` });
      }
      return existing;
    }
    if (!tenant.ssoAutoProvision) {
      await this.audit.log({ tenantId: tenant.id, action: "LOGIN_FAILED", entity: "User", detail: `${identity.email} — SSO, NomosOS hesabı yok (otomatik açma kapalı)` });
      throw new ForbiddenException("Bu e-posta için NomosOS hesabı yok; büro yöneticiniz sizi kullanıcı olarak eklemeli.");
    }
    // Otomatik açma: parola RASTGELE ve bilinmez — hesap yalnız SSO ile girer
    // (yönetici isterse parola sıfırlayabilir).
    const created = await this.prisma.client.user.create({
      data: {
        tenantId: tenant.id,
        email: identity.email,
        fullName: identity.name || identity.email.split("@")[0],
        role: tenant.ssoDefaultRole,
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), PASSWORD_HASH_ROUNDS),
        ssoSubject: identity.sub,
      },
      select: { id: true, tenantId: true, email: true, fullName: true, role: true, isActive: true, ssoSubject: true },
    });
    await this.audit.log({
      tenantId: tenant.id,
      userId: created.id,
      action: "USER_CREATE",
      entity: "User",
      entityId: created.id,
      detail: `${created.email} (${created.role}) — SSO otomatik açma`,
    });
    return created;
  }

  /** OIDC discovery (10 dk önbellek). */
  async discover(issuer: string, force = false): Promise<OidcDiscovery> {
    const key = normalizeIssuer(issuer);
    const cached = this.discoveryCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.doc;
    let res: Response;
    try {
      res = await fetchWithTimeout(`${key}/.well-known/openid-configuration`, { headers: { accept: "application/json" } }, HTTP_TIMEOUT_MS);
    } catch (err) {
      throw new BadRequestException(`Kimlik sağlayıcıya ulaşılamadı: ${(err as Error).message}`);
    }
    if (!res.ok) throw new BadRequestException(`Kimlik sağlayıcı discovery belgesi alınamadı (HTTP ${res.status}).`);
    const doc = (await res.json()) as Partial<OidcDiscovery>;
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.issuer) {
      throw new BadRequestException("Discovery belgesi eksik (authorization_endpoint / token_endpoint / issuer).");
    }
    for (const ep of [doc.authorization_endpoint, doc.token_endpoint, doc.userinfo_endpoint]) {
      if (!ep) continue;
      const check = validateProviderBaseUrl(ep);
      if (!check.ok || !ep.toLowerCase().startsWith("https://")) {
        throw new BadRequestException("Discovery belgesindeki uç adresleri HTTPS ve genel ağda olmalıdır.");
      }
    }
    const full = doc as OidcDiscovery;
    this.discoveryCache.set(key, { doc: full, expiresAt: Date.now() + DISCOVERY_TTL_MS });
    return full;
  }
}
