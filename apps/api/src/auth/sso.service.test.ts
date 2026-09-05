/**
 * SSO / OIDC: yapılandırma kapıları (ADMIN, HTTPS/SSRF, açma ön koşulları),
 * start (alan adı → büro, state + nonce, yetkilendirme adresi), callback
 * (state, iss/aud/nonce/exp, alan adı, kullanıcı bağlama, otomatik açma,
 * farklı sub reddi), discovery önbelleği.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@nomosos/ai", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s.replace(/^enc:/, ""),
  validateProviderBaseUrl: (url: string) => (/localhost|127\.0\.0\.1|169\.254|10\.\d+/.test(url) ? { ok: false, message: "Özel ağ adresi reddedildi." } : { ok: true }),
  fetchWithTimeout: (...args: unknown[]) => fetchMock(...args),
}));

import { SSO_STATE_AUDIENCE, SsoService, decodeJwtPayload, emailDomainOf, normalizeIssuer } from "./sso.service";

const ISSUER = "https://idp.example.com/realms/buro";
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  userinfo_endpoint: `${ISSUER}/protocol/openid-connect/userinfo`,
};
const admin = { userId: "u-admin", tenantId: "t1", role: "ADMIN" as const };
const partner = { userId: "u-p", tenantId: "t1", role: "PARTNER" as const };

const jsonRes = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;

function build(tenantOverrides: Record<string, unknown> = {}) {
  const tenant: Record<string, unknown> = {
    id: "t1",
    ssoEnabled: true,
    ssoIssuer: ISSUER,
    ssoClientId: "nomosos-client",
    ssoClientSecret: "enc:s3cret",
    ssoEmailDomain: "buro.com",
    ssoEnforced: false,
    ssoAutoProvision: false,
    ssoDefaultRole: "STAJYER",
    ...tenantOverrides,
  };
  const users: any[] = [];
  const prisma = {
    client: {
      tenant: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === "t1" ? tenant : null)),
        findFirst: vi.fn(async ({ where }: any) => (tenant.ssoEnabled === true && where.ssoEmailDomain === tenant.ssoEmailDomain ? tenant : null)),
        update: vi.fn(async ({ data }: any) => Object.assign(tenant, data)),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => users.find((u) => u.email === where.email) ?? null),
        update: vi.fn(async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data)),
        create: vi.fn(async ({ data }: any) => {
          const u = { id: `u${users.length + 1}`, isActive: true, ...data };
          users.push(u);
          return u;
        }),
        count: vi.fn(async () => users.filter((u) => u.ssoSubject).length),
      },
      subscription: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
    },
  };
  const states = new Map<string, any>();
  const jwt = {
    signAsync: vi.fn(async (payload: any, opts: any) => {
      const token = `state-${states.size + 1}`;
      states.set(token, { payload, opts });
      return token;
    }),
    verifyAsync: vi.fn(async (token: string, opts: any) => {
      const s = states.get(token);
      if (!s || s.opts.audience !== opts.audience) throw new Error("bad state");
      return s.payload;
    }),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const session = { issue: vi.fn(async (u: any, via: string) => ({ accessToken: `tok-${u.id}`, cookieMaxAgeMs: 1000, user: u, via })) };
  const svc = new SsoService(prisma as any, jwt as any, audit as any, session as any);
  return { svc, prisma, jwt, audit, session, tenant, users, states };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/.well-known/openid-configuration")) return jsonRes(DISCOVERY);
    throw new Error(`beklenmeyen istek: ${url}`);
  });
});

describe("yardımcılar", () => {
  it("decodeJwtPayload / normalizeIssuer / emailDomainOf", () => {
    expect(decodeJwtPayload(idToken({ sub: "x" }))).toEqual({ sub: "x" });
    expect(() => decodeJwtPayload("bozuk")).toThrow(/geçersiz/);
    expect(normalizeIssuer("https://a.com/x/")).toBe("https://a.com/x");
    expect(emailDomainOf("Ali@Buro.COM")).toBe("buro.com");
    expect(emailDomainOf("bozuk")).toBe("");
  });
});

describe("yapılandırma", () => {
  it("getConfig sırrı geri vermez; callbackUrl API_PUBLIC_URL'den", async () => {
    const { svc } = build();
    const c = await svc.getConfig(partner);
    expect(c.clientSecretSet).toBe(true);
    expect(JSON.stringify(c)).not.toContain("s3cret");
    expect(c.callbackUrl).toMatch(/\/api\/v1\/auth\/sso\/callback$/);
  });

  it("yalnız ADMIN yazar; issuer HTTPS + SSRF; alan adı biçimi; ADMIN varsayılan rol olamaz", async () => {
    const { svc } = build();
    await expect(svc.updateConfig(partner, { enabled: false })).rejects.toThrow();
    await expect(svc.updateConfig(admin, { issuer: "http://idp.com" })).rejects.toThrow(/HTTPS/);
    await expect(svc.updateConfig(admin, { issuer: "https://127.0.0.1/realm" })).rejects.toThrow(/Özel ağ/);
    await expect(svc.updateConfig(admin, { emailDomain: "buro" })).rejects.toThrow(/alan adı/);
    await expect(svc.updateConfig(admin, { defaultRole: "ADMIN" as any })).rejects.toThrow(/ADMIN olamaz/);
  });

  it("SSO açmak için dört alan zorunlu; zorlama SSO kapalıyken reddedilir; sır şifreli yazılır", async () => {
    const { svc, tenant, audit } = build({ ssoEnabled: false, ssoClientSecret: null, ssoIssuer: null });
    await expect(svc.updateConfig(admin, { enabled: true })).rejects.toThrow(/zorunludur/);
    await expect(svc.updateConfig(admin, { enforced: true })).rejects.toThrow(/önce SSO açık/);
    // Açıkken bir zorunlu alanı temizlemek reddedilir (null = temizleme, "gönderilmedi" değil).
    const on = build();
    await expect(on.svc.updateConfig(admin, { emailDomain: null })).rejects.toThrow(/zorunludur/);
    const c = await svc.updateConfig(admin, { enabled: true, issuer: "https://idp.example.com/realms/buro/", clientSecret: "yeni-sir" });
    expect(c.enabled).toBe(true);
    expect(tenant.ssoIssuer).toBe(ISSUER);
    expect(tenant.ssoClientSecret).toBe("enc:yeni-sir");
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "SSO_CONFIG_UPDATE" }));
  });

  it("testConnection discovery'yi çeker; eksik belge reddedilir", async () => {
    const { svc } = build();
    const r = await svc.testConnection(partner);
    expect(r.tokenEndpoint).toBe(DISCOVERY.token_endpoint);
    fetchMock.mockImplementationOnce(async () => jsonRes({ issuer: ISSUER }));
    await expect(svc.testConnection(partner)).rejects.toThrow(/eksik/);
  });
});

describe("start", () => {
  it("bilinmeyen alan adı / SSO kapalı → 404", async () => {
    const { svc } = build();
    await expect(svc.start("ali@baska.com")).rejects.toThrow(/tanımlı değil/);
    await expect(svc.start("bozuk")).rejects.toThrow(/e-posta/i);
    const off = build({ ssoEnabled: false });
    await expect(off.svc.start("ali@buro.com")).rejects.toThrow(/tanımlı değil/);
  });

  it("yetkilendirme adresi: code akışı, redirect_uri, scope, state (JWT tenant-sso) ve nonce", async () => {
    const { svc, states } = build();
    const { authorizationUrl } = await svc.start("Ali@Buro.com");
    const u = new URL(authorizationUrl);
    expect(u.origin + u.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("nomosos-client");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/v1\/auth\/sso\/callback$/);
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("login_hint")).toBe("ali@buro.com");
    const state = u.searchParams.get("state")!;
    const stored = states.get(state);
    expect(stored.opts).toEqual({ audience: SSO_STATE_AUDIENCE, expiresIn: "10m" });
    expect(stored.payload.tenantId).toBe("t1");
    expect(stored.payload.nonce).toBe(u.searchParams.get("nonce"));
  });
});

describe("callback", () => {
  const exp = Math.floor(Date.now() / 1000) + 300;

  async function begin(ctx: ReturnType<typeof build>) {
    const { authorizationUrl } = await ctx.svc.start("ali@buro.com");
    const u = new URL(authorizationUrl);
    return { state: u.searchParams.get("state")!, nonce: u.searchParams.get("nonce")! };
  }
  function tokenEndpoint(claims: Record<string, unknown>, access = "at") {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.endsWith("/.well-known/openid-configuration")) return jsonRes(DISCOVERY);
      if (url === DISCOVERY.token_endpoint) {
        const body = new URLSearchParams(init.body);
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("client_secret")).toBe("s3cret");
        return jsonRes({ id_token: idToken(claims), access_token: access });
      }
      if (url === DISCOVERY.userinfo_endpoint) return jsonRes({ email: "ali@buro.com", name: "Ali Veli" });
      throw new Error(`beklenmeyen: ${url}`);
    });
  }

  it("geçersiz state → 401", async () => {
    const { svc } = build();
    await expect(svc.callback("code", "yok")).rejects.toThrow(/geçersiz ya da süresi/);
  });

  it("iss / aud / nonce / exp denetimleri", async () => {
    const ctx = build();
    const { state, nonce } = await begin(ctx);
    const base = { iss: ISSUER, aud: "nomosos-client", nonce, exp, sub: "sub-1", email: "ali@buro.com" };
    tokenEndpoint({ ...base, iss: "https://kotu.com" });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/iss/);
    tokenEndpoint({ ...base, aud: ["baska"] });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/aud/);
    tokenEndpoint({ ...base, nonce: "x" });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/nonce/);
    tokenEndpoint({ ...base, exp: 1 });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/süresi dolmuş/);
  });

  it("alan adı uyuşmazlığı → 403 + LOGIN_FAILED izi", async () => {
    const ctx = build();
    const { state, nonce } = await begin(ctx);
    tokenEndpoint({ iss: `${ISSUER}/`, aud: "nomosos-client", nonce, exp, sub: "s", email: "ali@baska.com" });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/alan adına ait değil/);
    expect(ctx.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "LOGIN_FAILED" }));
  });

  it("mevcut kullanıcı: ilk girişte sub bağlanır (SSO_LINK), oturum 'sso' ile üretilir; e-posta userinfo'dan", async () => {
    const ctx = build();
    ctx.users.push({ id: "u1", tenantId: "t1", email: "ali@buro.com", fullName: "Ali", role: "AVUKAT", isActive: true, ssoSubject: null });
    const { state, nonce } = await begin(ctx);
    tokenEndpoint({ iss: ISSUER, aud: ["nomosos-client", "other"], nonce, exp, sub: "sub-1" }); // email yok → userinfo
    const r = await ctx.svc.callback("c", state);
    expect(r.accessToken).toBe("tok-u1");
    expect(ctx.session.issue).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", role: "AVUKAT" }), "sso");
    expect(ctx.users[0].ssoSubject).toBe("sub-1");
    expect(ctx.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "SSO_LINK" }));
  });

  it("farklı sub ile bağlı hesap → 403; pasif hesap → 403; başka büro → 403", async () => {
    const ctx = build();
    ctx.users.push({ id: "u1", tenantId: "t1", email: "ali@buro.com", fullName: "Ali", role: "AVUKAT", isActive: true, ssoSubject: "eski-sub" });
    const { state, nonce } = await begin(ctx);
    tokenEndpoint({ iss: ISSUER, aud: "nomosos-client", nonce, exp, sub: "yeni-sub", email: "ali@buro.com" });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/farklı bir kurumsal kimlik/);
    ctx.users[0].ssoSubject = "yeni-sub";
    ctx.users[0].isActive = false;
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/pasif/);
    ctx.users[0].isActive = true;
    ctx.users[0].tenantId = "t2";
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/başka bir büroya/);
  });

  it("hesap yok: otomatik açma kapalı → 403; açık → varsayılan rolle, rastgele parolayla, sub bağlı açılır", async () => {
    const off = build();
    let s = await begin(off);
    tokenEndpoint({ iss: ISSUER, aud: "nomosos-client", nonce: s.nonce, exp, sub: "s9", email: "yeni@buro.com", name: "Yeni Kişi" });
    await expect(off.svc.callback("c", s.state)).rejects.toThrow(/hesabı yok/);

    const on = build({ ssoAutoProvision: true, ssoDefaultRole: "SEKRETER" });
    s = await begin(on);
    tokenEndpoint({ iss: ISSUER, aud: "nomosos-client", nonce: s.nonce, exp, sub: "s9", email: "yeni@buro.com", name: "Yeni Kişi" });
    const r = await on.svc.callback("c", s.state);
    expect(r.accessToken).toBe("tok-u1");
    expect(on.users[0]).toMatchObject({ email: "yeni@buro.com", fullName: "Yeni Kişi", role: "SEKRETER", ssoSubject: "s9" });
    expect(on.users[0].passwordHash).toMatch(/^\$2[aby]\$/);
    expect(on.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "USER_CREATE", detail: expect.stringContaining("SSO otomatik") }));
  });

  it("abonelik askıda → 403; kod takası reddi → 401; email_verified=false → 401", async () => {
    const ctx = build();
    ctx.users.push({ id: "u1", tenantId: "t1", email: "ali@buro.com", fullName: "Ali", role: "AVUKAT", isActive: true, ssoSubject: null });
    const { state, nonce } = await begin(ctx);
    ctx.prisma.client.subscription.findUnique.mockResolvedValueOnce({ status: "SUSPENDED" });
    tokenEndpoint({ iss: ISSUER, aud: "nomosos-client", nonce, exp, sub: "s", email: "ali@buro.com" });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/askıda/);
    fetchMock.mockImplementation(async (url: string) => (url.endsWith("openid-configuration") ? jsonRes(DISCOVERY) : jsonRes({ error: "invalid_grant" }, 400)));
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/kabul etmedi/);
    tokenEndpoint({ iss: ISSUER, aud: "nomosos-client", nonce, exp, sub: "s", email: "ali@buro.com", email_verified: false });
    await expect(ctx.svc.callback("c", state)).rejects.toThrow(/doğrulanmamış/);
  });
});

describe("discovery", () => {
  it("10 dk önbellek; force ile yenilenir; HTTP uçları reddedilir", async () => {
    const { svc } = build();
    await svc.discover(ISSUER);
    await svc.discover(`${ISSUER}/`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await svc.discover(ISSUER, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementationOnce(async () => jsonRes({ ...DISCOVERY, token_endpoint: "http://idp.example.com/token" }));
    await expect(svc.discover("https://baska.example.com")).rejects.toThrow(/HTTPS/);
  });
});
