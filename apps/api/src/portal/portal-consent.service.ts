/**
 * FAZ 7F — müvekkil rıza kayıtları (KVKK aydınlatma / açık rıza / iletişim izinleri — İYS hazırlığı).
 *
 * Kayıt EKLEME-YALNIZ'dır: her onay/geri çekme yeni satır; güncel durum tür başına son satırdır.
 * Metinler sürümlüdür ve özeti (SHA-256) satıra yazılır — "hangi metne rıza verildi" sonradan
 * değişemez. Metin içeriği ürün kararı gerektirir (avukat onayı): burada YER TUTUCU sürüm 1
 * metinleri vardır; büro kendi metnini platform üzerinden yayınlayana kadar bu sürüm geçerlidir.
 */

import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import type { PortalAuthUser } from "./portal.types";

export const PORTAL_CONSENT_KINDS = ["KVKK_AYDINLATMA", "ACIK_RIZA", "ILETISIM_EPOSTA", "ILETISIM_SMS"] as const;
export type PortalConsentKind = (typeof PORTAL_CONSENT_KINDS)[number];

export interface ConsentText {
  kind: PortalConsentKind;
  version: string;
  title: string;
  /** Zorunlu mu (portalı kullanmak için okunmuş sayılması gereken)? */
  required: boolean;
  /** Geri çekilebilir mi? Aydınlatma metni "okudum" beyanıdır, geri çekilmez. */
  withdrawable: boolean;
  text: string;
}

export const PORTAL_CONSENT_TEXTS: ConsentText[] = [
  {
    kind: "KVKK_AYDINLATMA",
    version: "v1",
    title: "KVKK Aydınlatma Metni",
    required: true,
    withdrawable: false,
    text:
      "6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca: kişisel verileriniz, avukatlık hizmetinin yürütülmesi, " +
      "dava/icra takibi ve yasal yükümlülüklerin yerine getirilmesi amacıyla, veri sorumlusu sıfatıyla büronuz tarafından " +
      "işlenir; yargı mercileri ve yasal zorunluluk hâlinde ilgili kurumlarla paylaşılır; saklama süresi mesleki ve yasal " +
      "sürelerle sınırlıdır. Kanun'un 11. maddesindeki haklarınızı (bilgi talebi, düzeltme, silme, itiraz) büronuza " +
      "başvurarak kullanabilirsiniz. Bu metin bir BİLGİLENDİRMEDİR; okuduğunuzu beyan edersiniz.",
  },
  {
    kind: "ACIK_RIZA",
    version: "v1",
    title: "Açık Rıza (özel nitelikli veriler)",
    required: false,
    withdrawable: true,
    text:
      "Sağlık, ceza mahkûmiyeti ve benzeri özel nitelikli kişisel verilerimin, yalnızca vekâlet ilişkisinin gerektirdiği " +
      "ölçüde ve hukuki hizmetin yürütülmesi amacıyla işlenmesine açık rıza veriyorum. Bu rızayı dilediğim zaman " +
      "portaldan geri çekebilirim; geri çekme, o ana kadar yapılan işlemleri etkilemez.",
  },
  {
    kind: "ILETISIM_EPOSTA",
    version: "v1",
    title: "E-posta ile bilgilendirme izni",
    required: false,
    withdrawable: true,
    text: "Dosyalarımla ilgili gelişmelerin ve randevu/duruşma hatırlatmalarının e-posta ile tarafıma iletilmesine izin veriyorum.",
  },
  {
    kind: "ILETISIM_SMS",
    version: "v1",
    title: "SMS ile bilgilendirme izni",
    required: false,
    withdrawable: true,
    text: "Dosyalarımla ilgili kısa bilgilendirme ve hatırlatmaların SMS ile tarafıma iletilmesine izin veriyorum (İYS kapsamında).",
  },
];

export function consentTextHash(kind: PortalConsentKind, version: string, text: string): string {
  return createHash("sha256").update(`${kind}|${version}|${text}`).digest("hex");
}

export const consentDecisionSchema = z.object({
  kind: z.enum(PORTAL_CONSENT_KINDS),
  version: z.string().trim().min(1).max(20),
  accepted: z.boolean(),
});
export type ConsentDecisionInput = z.infer<typeof consentDecisionSchema>;

@Injectable()
export class PortalConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Müvekkil: metinler + güncel durum (tür başına son kayıt). */
  async status(user: PortalAuthUser) {
    const rows = await this.prisma.client.portalConsent.findMany({
      where: { tenantId: user.tenantId, clientId: user.clientId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.kind)) latest.set(r.kind, r);
    const items = PORTAL_CONSENT_TEXTS.map((t) => {
      const cur = latest.get(t.kind);
      return {
        kind: t.kind,
        version: t.version,
        title: t.title,
        required: t.required,
        withdrawable: t.withdrawable,
        text: t.text,
        accepted: cur ? cur.accepted && cur.version === t.version : false,
        decidedAt: cur?.createdAt ?? null,
        outdated: cur ? cur.accepted && cur.version !== t.version : false,
      };
    });
    return { items, missingRequired: items.filter((i) => i.required && !i.accepted).map((i) => i.kind) };
  }

  /** Müvekkil: karar (kabul / geri çekme) — yeni satır. */
  async decide(user: PortalAuthUser, input: ConsentDecisionInput, meta: { ip: string | null; userAgent: string | null }) {
    const text = PORTAL_CONSENT_TEXTS.find((t) => t.kind === input.kind);
    if (!text) throw new BadRequestException("Bilinmeyen rıza türü.");
    if (text.version !== input.version) throw new BadRequestException("Rıza metninin sürümü değişmiş; sayfayı yenileyip yeniden okuyun.");
    if (!input.accepted && !text.withdrawable) throw new BadRequestException("Aydınlatma metni bir bilgilendirmedir; geri çekilemez.");
    await this.prisma.client.portalConsent.create({
      data: {
        tenantId: user.tenantId,
        clientId: user.clientId,
        portalUserId: user.portalUserId,
        kind: input.kind,
        version: input.version,
        accepted: input.accepted,
        textHash: consentTextHash(text.kind, text.version, text.text),
        ip: meta.ip,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
      },
    });
    return this.status(user);
  }

  /** Büro: müvekkilin rıza geçmişi (denetim/İYS). */
  async historyForOffice(user: AuthUser, clientId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "rıza kayıtlarını görüntüleme");
    const rows = await this.prisma.client.portalConsent.findMany({
      where: { tenantId: user.tenantId, clientId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { portalUser: { select: { email: true, fullName: true } } },
    });
    const latest = new Map<string, boolean>();
    for (const r of rows) if (!latest.has(r.kind)) latest.set(r.kind, r.accepted);
    return {
      current: PORTAL_CONSENT_TEXTS.map((t) => ({ kind: t.kind, title: t.title, accepted: latest.get(t.kind) ?? false })),
      history: rows.map((r) => ({ id: r.id, kind: r.kind, version: r.version, accepted: r.accepted, at: r.createdAt, by: r.portalUser.fullName, email: r.portalUser.email, ip: r.ip })),
    };
  }
}
