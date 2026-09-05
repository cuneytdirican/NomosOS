/**
 * İletişim Merkezi Zod şemaları — modül yereli.
 */

import { z } from "zod";
import { nullableText, nullableUuid } from "../common/zod";

export const COMM_CHANNELS = [
  "EPOSTA",
  "SMS",
  "WHATSAPP",
  "TELEFON",
  "PORTAL",
  "YUZ_YUZE",
  "DIGER",
] as const;

/**
 * GİDEN mesajın kullanabileceği kanallar.
 *
 * TELEFON ve YUZ_YUZE kasten YOKTUR: bunlar bir sistemin "gönderebileceği"
 * kanallar değildir, insanın yaptığı ve sonradan NOT EDİLDİĞİ olaylardır.
 * Onay/gönderim makinesine sokulsalardı "onaylandı ama gönderilmedi" gibi
 * anlamsız durumlar üretirlerdi; bunlar `POST /communications` ile kaydedilir.
 */
export const OUTBOUND_CHANNELS = ["EPOSTA", "SMS", "WHATSAPP", "PORTAL"] as const;

export const COMM_DIRECTIONS = ["GELEN", "GIDEN"] as const;

const channelEnum = z.enum(COMM_CHANNELS, {
  errorMap: () => ({ message: `Kanal şunlardan biri olmalıdır: ${COMM_CHANNELS.join(", ")}.` }),
});

const outboundChannelEnum = z.enum(OUTBOUND_CHANNELS, {
  errorMap: () => ({
    message:
      `Giden mesaj kanalı şunlardan biri olmalıdır: ${OUTBOUND_CHANNELS.join(", ")}. ` +
      "Telefon ve yüz yüze görüşmeler gönderilmez, /communications ucundan kaydedilir.",
  }),
});

/* -------------------------------------------------------------------------- *
 * 1) İletişim geçmişi (CommunicationLog)
 * -------------------------------------------------------------------------- */

export const createCommunicationSchema = z
  .object({
    clientId: nullableUuid("Müvekkil"),
    caseId: nullableUuid("Dosya"),
    direction: z.enum(COMM_DIRECTIONS, {
      errorMap: () => ({ message: "Yön GELEN veya GIDEN olmalıdır." }),
    }),
    channel: channelEnum,
    subject: nullableText(300, "Konu"),
    body: z
      .string()
      .trim()
      .min(1, "Görüşme içeriği boş olamaz.")
      .max(20_000, "Görüşme içeriği en fazla 20.000 karakter olabilir."),
    /** Karşı tarafın adresi/numarası. */
    contactRef: nullableText(200, "İletişim adresi"),
    /** Görüşmenin GERÇEKTEN olduğu an; verilmezse şimdi. */
    occurredAt: z.coerce.date().optional(),
  })
  .refine((v) => Boolean(v.clientId) || Boolean(v.caseId), {
    message: "İletişim kaydı en az bir müvekkile veya dosyaya bağlanmalıdır.",
    path: ["clientId"],
  });
export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

export const updateCommunicationSchema = z.object({
  clientId: nullableUuid("Müvekkil"),
  caseId: nullableUuid("Dosya"),
  subject: nullableText(300, "Konu"),
  body: z.string().trim().min(1).max(20_000).optional(),
  contactRef: nullableText(200, "İletişim adresi"),
  occurredAt: z.coerce.date().optional(),
});
export type UpdateCommunicationInput = z.infer<typeof updateCommunicationSchema>;

/* -------------------------------------------------------------------------- *
 * 2) Şablonlar (MessageTemplate)
 * -------------------------------------------------------------------------- */

/** Şablon anahtarı: BÜYÜK_HARF_ALT_ÇİZGİ. */
const templateKey = z
  .string()
  .trim()
  .min(3, "Şablon anahtarı en az 3 karakter olmalıdır.")
  .max(64, "Şablon anahtarı en fazla 64 karakter olabilir.")
  .regex(/^[A-Z0-9_]+$/, "Şablon anahtarı yalnızca BÜYÜK harf, rakam ve alt çizgi içerebilir.");

export const createTemplateSchema = z.object({
  key: templateKey,
  name: z.string().trim().min(2, "Şablon adı en az 2 karakter olmalıdır.").max(120),
  channel: channelEnum,
  subject: nullableText(300, "Konu"),
  body: z
    .string()
    .trim()
    .min(10, "Şablon gövdesi en az 10 karakter olmalıdır.")
    .max(20_000, "Şablon gövdesi en fazla 20.000 karakter olabilir."),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = createTemplateSchema.partial().omit({ key: true });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

/** Serbest değişkenler: {{belgeListesi}} gibi kayıttan türetilemeyen alanlar. */
const variablesRecord = z
  .record(z.string().max(2000, "Değişken değeri en fazla 2.000 karakter olabilir."))
  .optional();

export const renderTemplateSchema = z.object({
  clientId: z.string().uuid("Geçerli bir müvekkil kimliği giriniz."),
  caseId: nullableUuid("Dosya"),
  variables: variablesRecord,
});
export type RenderTemplateInput = z.infer<typeof renderTemplateSchema>;

/* -------------------------------------------------------------------------- *
 * 3) Giden mesaj (OutboundMessage)
 * -------------------------------------------------------------------------- */

export const createOutboundSchema = z
  .object({
    clientId: z.string().uuid("Geçerli bir müvekkil kimliği giriniz."),
    caseId: nullableUuid("Dosya"),
    channel: outboundChannelEnum,
    /** Şablondan üret. */
    templateId: nullableUuid("Şablon"),
    /** Elle yazılmış taslak. */
    draftBody: nullableText(20_000, "Taslak metni"),
    subject: nullableText(300, "Konu"),
    variables: variablesRecord,
    /**
     * AI taslağı iste (MESSAGE_DRAFT — kredili). `caseId` ZORUNLU olur: dosya
     * bağlamı olmadan durum özeti yazmak, uydurmaya davettir.
     */
    useAi: z.boolean().optional().default(false),
    /** AI'a özel talimat (ör. "bilirkişi raporunu da özetle"). */
    instruction: nullableText(1000, "Talimat"),
    /** KVKK 409 akışının ikinci turu (dosya bağlamı dış sağlayıcıya çıkarken). */
    piiApproved: z.boolean().optional(),
  })
  .refine(
    (v) => v.useAi === true || Boolean(v.templateId) || Boolean(v.draftBody),
    {
      message:
        "Taslak kaynağı belirtilmedi. `templateId` (şablondan), `draftBody` (elle) veya " +
        "`useAi: true` (AI taslağı) alanlarından en az biri gereklidir.",
      path: ["draftBody"],
    },
  )
  .refine((v) => !(v.useAi === true && !v.caseId), {
    message: "AI taslağı için `caseId` zorunludur; dosya bağlamı olmadan durum özeti yazılamaz.",
    path: ["caseId"],
  });
export type CreateOutboundInput = z.infer<typeof createOutboundSchema>;

export const updateOutboundSchema = z
  .object({
    /** Avukatın düzenlediği NİHAİ metin. `draftBody` DEĞİŞMEZ (iş kuralı 3). */
    finalBody: z
      .string()
      .trim()
      .min(1, "Mesaj metni boş olamaz.")
      .max(20_000, "Mesaj metni en fazla 20.000 karakter olabilir.")
      .optional(),
    subject: nullableText(300, "Konu"),
  })
  .refine((v) => v.finalBody !== undefined || v.subject !== undefined, {
    message: "Güncellenecek bir alan gönderilmedi.",
  });
export type UpdateOutboundInput = z.infer<typeof updateOutboundSchema>;

export const approveOutboundSchema = z.object({
  /**
   * Üçüncü kişi kişisel verisi tespit edilmesine rağmen devam kararı.
   * `piiOverrideNote` olmadan verilemez — gerekçesiz karar denetim değeri taşımaz.
   */
  piiApproved: z.boolean().optional(),
  piiOverrideNote: nullableText(1000, "KVKK gerekçesi"),
});
export type ApproveOutboundInput = z.infer<typeof approveOutboundSchema>;

export const sendOutboundSchema = approveOutboundSchema;
export type SendOutboundInput = ApproveOutboundInput;

export const rejectOutboundSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Ret gerekçesi en az 5 karakter olmalıdır.")
    .max(1000, "Ret gerekçesi en fazla 1.000 karakter olabilir."),
});
export type RejectOutboundInput = z.infer<typeof rejectOutboundSchema>;

/* -------------------------------------------------------------------------- *
 * 4) Gelen mesaj (InboundMessage)
 * -------------------------------------------------------------------------- */

export const createInboundSchema = z.object({
  channel: channelEnum,
  /** Gönderenin e-posta adresi veya telefon numarası. */
  fromRef: z
    .string()
    .trim()
    .min(3, "Gönderen adresi en az 3 karakter olmalıdır.")
    .max(200, "Gönderen adresi en fazla 200 karakter olabilir."),
  subject: nullableText(300, "Konu"),
  body: z
    .string()
    .trim()
    .min(1, "Mesaj içeriği boş olamaz.")
    .max(20_000, "Mesaj içeriği en fazla 20.000 karakter olabilir."),
  receivedAt: z.coerce.date().optional(),
  /**
   * MÜVEKKİL KİMLİĞİ ÖNCEDEN BİLİNİYORSA.
   *
   * Müvekkil Portalı'ndan (channel = PORTAL) düşen mesajda gönderen zaten
   * KİMLİK DOĞRULAMASINDAN GEÇMİŞTİR: portal oturumu hangi müvekkile aitse
   * mesaj da onundur. Böyle bir mesajda müvekkili `fromRef` üzerinden yeniden
   * "tahmin etmek" hem gereksiz hem de yanlıştır — portal kullanıcısının
   * e-postası müvekkil kaydındakinden farklı olabilir ve mesaj sahipsiz kalırdı.
   *
   * Verildiğinde müvekkil KESİNDİR; deterministik katman yalnızca DOSYAYI
   * çözmeye çalışır.
   */
  clientId: nullableUuid("Müvekkil"),
  /**
   * Deterministik eşleşme BULUNAMAZSA AI önerisi istensin mi (kredili).
   * Varsayılan KAPALI: webhook hattı sessizce kredi harcamamalıdır.
   */
  useAi: z.boolean().optional().default(false),
  piiApproved: z.boolean().optional(),
});
export type CreateInboundInput = z.infer<typeof createInboundSchema>;

export const suggestInboundCaseSchema = z.object({
  piiApproved: z.boolean().optional(),
});
export type SuggestInboundCaseInput = z.infer<typeof suggestInboundCaseSchema>;

export const matchInboundSchema = z
  .object({
    clientId: nullableUuid("Müvekkil"),
    caseId: nullableUuid("Dosya"),
    /** `false` → "bu mesaj hiçbir dosyayla ilgili değil" (ESLESMEDI). */
    matched: z.boolean().optional().default(true),
  })
  .refine((v) => v.matched === false || Boolean(v.clientId) || Boolean(v.caseId), {
    message: "Eşleştirme için müvekkil veya dosya belirtilmelidir.",
    path: ["caseId"],
  });
export type MatchInboundInput = z.infer<typeof matchInboundSchema>;

/** Faz 7F — POST /outbound-messages/client-status-summary */
export const clientStatusSummarySchema = z.object({
  caseId: z.string().uuid(),
  channel: z.enum(["PORTAL", "EMAIL", "WHATSAPP", "SMS"]).default("PORTAL"),
  instruction: z.string().trim().max(500).nullable().optional(),
  piiApproved: z.boolean().optional(),
});
export type ClientStatusSummaryInput = z.infer<typeof clientStatusSummarySchema>;
