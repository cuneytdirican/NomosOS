/**
 * GİDEN MESAJDA KİŞİSEL VERİ SINIFLANDIRMASI — "kimin verisi?" sorusu.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ Bu, dış LLM kapısından FARKLI bir kapıdır.                                ║
 * ║                                                                          ║
 * ║ LLM kapısı (AiRunnerService.applyPiiGate) "veri BÜRO DIŞINA, sağlayıcıya ║
 * ║ çıkıyor mu?" diye sorar. Burada ise metin zaten müvekkile GİDECEKTİR ve   ║
 * ║ müvekkilin KENDİ TCKN'si, kendi IBAN'ı, kendi telefonu o metinde normal   ║
 * ║ ve çoğu zaman gereklidir ("ödemeyi TR.. numaralı hesabımıza yapınız").    ║
 * ║                                                                          ║
 * ║ RİSK ÜÇÜNCÜ KİŞİ VERİSİDİR: karşı tarafın TCKN'si, tanığın telefonu,      ║
 * ║ bilirkişinin IBAN'ı. Bunlar müvekkile gönderilemez; gönderilecekse        ║
 * ║ avukatın gerekçeli, kayda geçen bir kararı gerekir (Modül 19 kabul        ║
 * ║ kriteri 8).                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Sınıflandırma DEĞER KARŞILAŞTIRMASIYLA yapılır: bulunan değer alıcının kendi
 * kayıtlı değerlerinden biriyse "KENDI", değilse "UCUNCU_KISI". Emin olunamayan
 * her şey ÜÇÜNCÜ KİŞİ sayılır (fail-closed).
 */

import type { PiiFinding, PiiKind } from "@nomosos/ai";
import { normalizeEmail, normalizePhone } from "./inbound-match";

export type PiiOwnership = "KENDI" | "UCUNCU_KISI";

export interface ClassifiedPii {
  kind: PiiKind;
  ownership: PiiOwnership;
  /** Ham değer TAŞINMAZ; kısmi maske saklanır (kayıt gövdesine yazılacak). */
  masked: string;
  count: number;
}

export interface PiiClassification {
  thirdParty: ClassifiedPii[];
  own: ClassifiedPii[];
  /** Kayda (piiScanJson) yazılacak, ham değer içermeyen özet. */
  summary: {
    scannedAt: string;
    hasThirdPartyPii: boolean;
    thirdParty: ClassifiedPii[];
    own: ClassifiedPii[];
    notice: string;
  };
}

/** Alıcının kendi kayıtlı kişisel verileri (Client + iletişim kişileri). */
export interface RecipientIdentity {
  emails: readonly (string | null | undefined)[];
  phones: readonly (string | null | undefined)[];
  tckns: readonly (string | null | undefined)[];
  ibans: readonly (string | null | undefined)[];
}

/** Karşılaştırma için: rakam dışı her şey atılır (IBAN/TCKN boşluk toleransı). */
function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function ibanKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  return cleaned.length >= 16 ? cleaned : null;
}

/** "12345678901" → "123******01" — 409 gövdesinde ve kayıtta ham değer olmaz. */
function partialMask(value: string): string {
  const t = value.trim();
  if (t.length <= 4) return "*".repeat(t.length);
  const head = t.slice(0, Math.min(3, t.length - 2));
  const tail = t.slice(-2);
  return `${head}${"*".repeat(Math.max(1, t.length - head.length - tail.length))}${tail}`;
}

/** Bulgunun değeri alıcının kendi verisi mi? */
function isOwnValue(finding: PiiFinding, identity: RecipientIdentity): boolean {
  switch (finding.kind) {
    case "EPOSTA": {
      const key = normalizeEmail(finding.value);
      if (!key) return false;
      return identity.emails.some((e) => normalizeEmail(e) === key);
    }
    case "TELEFON": {
      const key = normalizePhone(finding.value);
      if (!key) return false;
      return identity.phones.some((p) => normalizePhone(p) === key);
    }
    case "TCKN": {
      const key = digitsOnly(finding.value);
      return key.length === 11 && identity.tckns.some((t) => t && digitsOnly(t) === key);
    }
    case "IBAN": {
      const key = ibanKey(finding.value);
      if (!key) return false;
      return identity.ibans.some((i) => ibanKey(i) === key);
    }
    default:
      // Bilinmeyen tür → ÜÇÜNCÜ KİŞİ sayılır (fail-closed).
      return false;
  }
}

function collapse(
  findings: readonly PiiFinding[],
  ownership: PiiOwnership,
): ClassifiedPii[] {
  const byKind = new Map<PiiKind, { masked: string; count: number }>();
  for (const f of findings) {
    const existing = byKind.get(f.kind);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKind.set(f.kind, { masked: partialMask(f.value), count: 1 });
  }
  return [...byKind.entries()].map(([kind, v]) => ({
    kind,
    ownership,
    masked: v.masked,
    count: v.count,
  }));
}

/**
 * Giden metnin kişisel veri taraması sonucunu "kendi / üçüncü kişi" olarak ayırır.
 *
 * Dönen `summary` doğrudan `OutboundMessage.piiScanJson`'a yazılabilir: ham TCKN
 * veya IBAN İÇERMEZ, yalnızca tür + kısmi maske + adet taşır. Kaydın kendisi
 * kişisel veri deposuna dönüşmez.
 */
export function classifyOutboundPii(
  findings: readonly PiiFinding[],
  identity: RecipientIdentity,
): PiiClassification {
  const own: PiiFinding[] = [];
  const thirdParty: PiiFinding[] = [];
  for (const finding of findings) {
    (isOwnValue(finding, identity) ? own : thirdParty).push(finding);
  }

  const ownSummary = collapse(own, "KENDI");
  const thirdPartySummary = collapse(thirdParty, "UCUNCU_KISI");

  return {
    own: ownSummary,
    thirdParty: thirdPartySummary,
    summary: {
      scannedAt: new Date().toISOString(),
      hasThirdPartyPii: thirdPartySummary.length > 0,
      thirdParty: thirdPartySummary,
      own: ownSummary,
      notice:
        thirdPartySummary.length > 0
          ? "Metinde ALICIYA AİT OLMAYAN kişisel veri tespit edildi. Üçüncü kişinin kimlik/iletişim " +
            "bilgisini müvekkile göndermek KVKK açısından ayrı bir işleme faaliyetidir; " +
            "gönderim ancak avukatın gerekçeli kararıyla yapılabilir."
          : "Metinde üçüncü kişiye ait kişisel veri tespit edilmedi. Alıcının kendi verisi " +
            "(varsa) olağan kabul edilmiştir.",
    },
  };
}
