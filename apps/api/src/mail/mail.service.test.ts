import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailService, smtpConfigFromEnv } from "./mail.service";

describe("smtpConfigFromEnv", () => {
  it("HOST/PORT/FROM üçlüsü yoksa null; 465 portu secure", () => {
    expect(smtpConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_PORT: "587" } as NodeJS.ProcessEnv)).toBeNull();
    const c = smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_PORT: "465", SMTP_FROM: "a@b.c", SMTP_USER: "u", SMTP_PASSWORD: "p" } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ host: "h", port: 465, secure: true, from: "a@b.c", auth: { user: "u", pass: "p" } });
    const c2 = smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_PORT: "1025", SMTP_FROM: "a@b.c" } as NodeJS.ProcessEnv);
    expect(c2?.secure).toBe(false);
    expect(c2?.auth).toBeUndefined();
  });
});

describe("MailService", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.SMTP_HOST = "mailpit";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "NomosOS <t@nomosos.test>";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("yapılandırılmışsa taşıyıcıya from/to/subject/text ile gönderir ve messageId döner", async () => {
    const svc = new MailService();
    const sendMail = vi.fn(async () => ({ messageId: "<m1@test>" }));
    svc.setTransportForTests({ sendMail });
    const res = await svc.send({ to: ["a@x.tr", "b@x.tr"], subject: "S", text: "T" });
    expect(res).toEqual({ sent: true, messageId: "<m1@test>" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "NomosOS <t@nomosos.test>", to: "a@x.tr, b@x.tr", subject: "S", text: "T" }));
  });

  it("taşıyıcı hatasını yutmaz: sent=false + reason", async () => {
    const svc = new MailService();
    svc.setTransportForTests({ sendMail: async () => { throw new Error("ECONNREFUSED"); } });
    const res = await svc.send({ to: "a@x.tr", subject: "S", text: "T" });
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("ECONNREFUSED");
  });

  it("SMTP tanımsızsa configured=false ve gönderim yapılmadan reason döner", async () => {
    delete process.env.SMTP_HOST;
    const svc = new MailService();
    expect(svc.configured).toBe(false);
    const res = await svc.send({ to: "a@x.tr", subject: "S", text: "T" });
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("SMTP yapılandırılmamış");
  });
});
