/**
 * İMZACI DOĞRULAMA — sağlayıcıdan ÖNCE, çekirdekte.
 *
 * NEDEN BURADA: hatalı imzacı listesini sağlayıcıya göndermek, hatanın
 * sağlayıcının diline ve HTTP kodlarına gömülmesi demektir. Doğrulama burada
 * yapılınca hem Noop hem gerçek adaptörler AYNI Türkçe hataları verir ve
 * sağlayıcı değişince kullanıcı deneyimi değişmez.
 *
 * KURALLAR (hepsi test edilir):
 *  1. En az bir imzacı.
 *  2. Geçerli e-posta (davet oraya gider).
 *  3. Ad-soyad en az 3 karakter.
 *  4. Aynı e-posta iki kez olamaz.
 *  5. `MOBIL_IMZA` yönteminde GSM numarası ZORUNLU (SIM tabanlı imza).
 *  6. Sıra numarası verilmişse tam sayı, 1'den büyük ve TEKRARSIZ olmalı.
 *  7. Sıralı akışta (`sequential: true`) her imzacının sırası verilmelidir.
 *  8. Sağlayıcının desteklemediği yöntem istenemez.
 */

import { z } from "zod";
import { SignatureValidationError } from "./errors";
import {
  SIGNATURE_METHODS,
  SIGNER_ROLES,
  type CreateRequestOptions,
  type SignatureDocument,
  type SignatureMethod,
  type Signer,
} from "./types";

/** Bir imza sürecindeki azami imzacı sayısı. */
export const MAX_SIGNERS = 20;

/**
 * Türkiye GSM numarası — mobil imzada operatöre giden değer.
 * Kabul edilen biçimler: `+905321234567`, `05321234567`, `5321234567`.
 * Boşluk, tire ve parantez temizlenir.
 */
const TR_GSM = /^(?:\+90|0)?5\d{9}$/;

export const signerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "İmzacı adı en az 3 karakter olmalıdır.")
    .max(200, "İmzacı adı en fazla 200 karakter olabilir."),
  email: z
    .string()
    .trim()
    .email("İmzacı e-posta adresi geçerli değil.")
    .max(320, "E-posta adresi en fazla 320 karakter olabilir."),
  phone: z
    .string()
    .trim()
    .max(30, "Telefon numarası en fazla 30 karakter olabilir.")
    .optional(),
  role: z.enum(SIGNER_ROLES, {
    errorMap: () => ({ message: "İmzacı rolü geçersiz." }),
  }),
  order: z
    .number()
    .int("İmza sırası tam sayı olmalıdır.")
    .min(1, "İmza sırası 1'den küçük olamaz.")
    .max(MAX_SIGNERS, `İmza sırası en fazla ${MAX_SIGNERS} olabilir.`)
    .optional(),
  method: z.enum(SIGNATURE_METHODS).optional(),
});

export const signersSchema = z
  .array(signerSchema)
  .min(1, "İmza süreci başlatmak için en az bir imzacı gereklidir.")
  .max(MAX_SIGNERS, `Bir imza sürecinde en fazla ${MAX_SIGNERS} imzacı olabilir.`);

/** GSM numarasını normalleştirir (`+90...` biçimi) ya da `null` döner. */
export function normalizeGsm(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[\s()\-.]/g, "");
  if (!TR_GSM.test(digits)) return null;
  const bare = digits.replace(/^\+90/, "").replace(/^0/, "");
  return `+90${bare}`;
}

export interface ValidateSignersOptions {
  /** Sürecin varsayılan yöntemi. */
  method: SignatureMethod;
  /** Sıralı imza akışı mı. */
  sequential?: boolean;
  /** Sağlayıcının desteklediği yöntemler. Verilmezse yöntem kontrolü yapılmaz. */
  supportedMethods?: readonly SignatureMethod[];
  /** Hata nesnesine yazılacak sağlayıcı anahtarı. */
  providerKey?: string;
}

/**
 * İmzacı listesini doğrular ve NORMALLEŞTİRİLMİŞ hâlini döndürür.
 *
 * Tüm sorunlar TEK SEFERDE toplanır: kullanıcı listeyi bir kez düzeltir,
 * her turda tek hata görmez.
 *
 * @throws {SignatureValidationError}
 */
export function validateSigners(
  signers: readonly Signer[],
  options: ValidateSignersOptions,
): Signer[] {
  const providerKey = options.providerKey ?? "-";
  const issues: string[] = [];

  const parsed = signersSchema.safeParse(signers);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = typeof issue.path[0] === "number" ? `${issue.path[0] + 1}. imzacı: ` : "";
      issues.push(`${at}${issue.message}`);
    }
    throw new SignatureValidationError(issues, providerKey);
  }

  const rows = parsed.data;

  // (4) Aynı e-posta iki kez olamaz — sağlayıcılar aynı adrese iki davet
  // gönderemez ve kim imzaladı sorusu belirsizleşir.
  const seenEmails = new Set<string>();
  for (const [i, s] of rows.entries()) {
    const key = s.email.toLocaleLowerCase("tr-TR");
    if (seenEmails.has(key)) {
      issues.push(`${i + 1}. imzacı: "${s.email}" adresi listede birden fazla kez geçiyor.`);
    }
    seenEmails.add(key);
  }

  // (5) Mobil imzada GSM zorunlu, (8) desteklenmeyen yöntem reddedilir.
  const supported = options.supportedMethods;
  for (const [i, s] of rows.entries()) {
    const method = s.method ?? options.method;
    if (supported && !supported.includes(method)) {
      issues.push(
        `${i + 1}. imzacı: seçilen e-imza sağlayıcısı "${method}" yöntemini desteklemiyor.`,
      );
    }
    if (method === "MOBIL_IMZA") {
      const gsm = normalizeGsm(s.phone);
      if (!gsm) {
        issues.push(
          `${i + 1}. imzacı: mobil imza için geçerli bir GSM numarası zorunludur ` +
            "(örn. +905321234567).",
        );
      }
    }
  }

  // (6)-(7) Sıra numarası tutarlılığı.
  const withOrder = rows.filter((s) => s.order !== undefined);
  if (withOrder.length > 0) {
    const seenOrders = new Set<number>();
    for (const s of withOrder) {
      if (seenOrders.has(s.order as number)) {
        issues.push(`İmza sırası ${s.order} birden fazla imzacıya verilmiş.`);
      }
      seenOrders.add(s.order as number);
    }
  }
  if (options.sequential && withOrder.length !== rows.length) {
    issues.push(
      "Sıralı imza akışında her imzacının imza sırası belirtilmelidir; " +
        `${rows.length - withOrder.length} imzacıda sıra numarası yok.`,
    );
  }

  if (issues.length > 0) throw new SignatureValidationError(issues, providerKey);

  return rows.map((s) => ({
    ...s,
    email: s.email.toLocaleLowerCase("tr-TR"),
    phone: normalizeGsm(s.phone) ?? s.phone,
  }));
}

/**
 * İmzalanacak belgeyi doğrular: içerik ya gömülü ya da depo anahtarıyla
 * verilmelidir. Boş belgeyi imzaya göndermek sessiz bir veri kaybıdır.
 */
export function validateDocument(doc: SignatureDocument, providerKey = "-"): void {
  const issues: string[] = [];
  if (!doc.fileName?.trim()) issues.push("İmzalanacak belgenin dosya adı boş olamaz.");
  if (!doc.mimeType?.trim()) issues.push("İmzalanacak belgenin içerik tipi (MIME) belirtilmemiş.");
  const hasContent = doc.content !== undefined && doc.content.byteLength > 0;
  const hasKey = typeof doc.storageKey === "string" && doc.storageKey.trim().length > 0;
  if (!hasContent && !hasKey) {
    issues.push(
      "İmzalanacak belgenin içeriği bulunamadı: ya belge içeriği ya da depo anahtarı verilmelidir.",
    );
  }
  if (issues.length > 0) throw new SignatureValidationError(issues, providerKey);
}

/** Süreç seçeneklerini doğrular. */
export function validateOptions(options: CreateRequestOptions, providerKey = "-"): void {
  const issues: string[] = [];
  if (!SIGNATURE_METHODS.includes(options.method)) {
    issues.push("İmza yöntemi geçersiz.");
  }
  if (
    options.expiresInDays !== undefined &&
    (!Number.isInteger(options.expiresInDays) || options.expiresInDays < 1 || options.expiresInDays > 365)
  ) {
    issues.push("İmza sürecinin geçerlilik süresi 1 ile 365 gün arasında bir tam sayı olmalıdır.");
  }
  if (issues.length > 0) throw new SignatureValidationError(issues, providerKey);
}
