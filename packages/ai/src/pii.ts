import { isValidTckn } from "@nomosos/shared";

/**
 * KVKK ön-filtre: dış LLM sağlayıcısına gönderilecek metinde kişisel veri (PII) taraması.
 *
 * Akış (docs/04-kvkk-veri-guvenligi.md):
 *   Tespit → "Kişisel veri tespit edildi" uyarısı → Maskele → Kullanıcı onayı → AI'a gönder.
 *
 * OLLAMA ve büro-içi CUSTOM sağlayıcılarda veri dışarı çıkmadığı için maskeleme
 * zorunlu değildir; dış sağlayıcılarda (ANTHROPIC / OPENAI_COMPAT / GEMINI) onaysız
 * gönderim engellenir. Bu iskelet regex tabanlıdır; tam kapsam (adres, sağlık verisi,
 * çocuk bilgisi) NER tabanlı tespit ile Faz 2'de genişletilir.
 */

export type PiiKind = "TCKN" | "IBAN" | "TELEFON" | "EPOSTA";

export interface PiiFinding {
  kind: PiiKind;
  value: string;
  start: number;
  end: number;
}

export interface PiiScanResult {
  findings: PiiFinding[];
  maskedText: string;
  hasPii: boolean;
}

const PATTERNS: Array<{ kind: PiiKind; regex: RegExp; validate?: (v: string) => boolean }> = [
  { kind: "TCKN", regex: /\b[1-9]\d{10}\b/g, validate: isValidTckn },
  { kind: "IBAN", regex: /\bTR\d{2}[ ]?(\d[ ]?){22}\b/gi },
  { kind: "TELEFON", regex: /(?:\+90|0)[\s-]?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  { kind: "EPOSTA", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

const MASK_LABEL: Record<PiiKind, string> = {
  TCKN: "[TCKN-MASKELİ]",
  IBAN: "[IBAN-MASKELİ]",
  TELEFON: "[TELEFON-MASKELİ]",
  EPOSTA: "[EPOSTA-MASKELİ]",
};

export function scanPii(text: string): PiiScanResult {
  const findings: PiiFinding[] = [];
  for (const { kind, regex, validate } of PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      if (validate && !validate(value.replace(/\D/g, ""))) continue;
      findings.push({ kind, value, start: match.index, end: match.index + value.length });
    }
  }
  // Önce başlangıca, eşitlikte UZUN olana öncelik ver: "05551234567@ornek.com"
  // hem TELEFON hem EPOSTA kalıbına uyar; kapsayan bulgu kazanmalıdır.
  findings.sort((a, b) => a.start - b.start || b.end - a.end);

  // ÇAKIŞMA ELEME (denetim bulgusu İ-17).
  //
  // Eskiden çakışan bulgular üst üste maskeleniyordu ve maske ETİKETİ bozuluyordu:
  //   "İletişim: 05551234567@ornek.com" → "İletişim: [TELEFON-MASKELİ]KELİ]"
  // Sızıntı yoktu (kalan metin de maskenin altındaydı) ama çekirdek promptun 6.
  // kuralı maske etiketlerinin BOZULMADAN korunmasını istiyor; bozuk etiket
  // modelin maskeyi tanımasını engeller. Artık çakışan bulgu ELENİR; eleneni
  // kapsayan bulgu zaten maskelemektedir.
  const kept: PiiFinding[] = [];
  let coveredUntil = -1;
  for (const finding of findings) {
    if (finding.start < coveredUntil) continue; // önceki bulgunun içinde kalıyor
    kept.push(finding);
    coveredUntil = Math.max(coveredUntil, finding.end);
  }

  // Sondan başa maskele (indeksler kaymasın)
  let maskedText = text;
  for (let i = kept.length - 1; i >= 0; i--) {
    const f = kept[i];
    maskedText = maskedText.slice(0, f.start) + MASK_LABEL[f.kind] + maskedText.slice(f.end);
  }

  return { findings: kept, maskedText, hasPii: kept.length > 0 };
}

/* -------------------------------------------------------------------------- *
 * Sözlük tabanlı ad/unvan maskeleme (denetim bulgusu Ö-22)
 * -------------------------------------------------------------------------- */

/**
 * Kaçırılan bir metin parçasını regex için güvenli hâle getirir.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface DictionaryMaskResult {
  maskedText: string;
  /** Metinde gerçekten bulunup maskelenen terim sayısı. */
  replaced: number;
}

/**
 * SÖZLÜK TABANLI MASKELEME — ad, unvan ve dosya künyesi için.
 *
 * `scanPii` yalnız TCKN/IBAN/telefon/e-posta kalıplarını tanır; KVKK m.3
 * anlamında kişisel veri olan AD-SOYAD ve ŞİRKET UNVANI hiçbir kalıba girmez.
 * Regex ile ad tespiti (NER) güvenilir değildir — ama dosya bağlamını KURAN
 * taraf zaten adları elinde tutar: müvekkil adı, taraf adları, karşı vekil.
 * Bu fonksiyon o BİLİNEN terimleri deterministik olarak değiştirir.
 *
 * Kurallar:
 * - Terimler UZUNDAN KISAYA uygulanır ("Ahmet Yılmaz Ltd. Şti." önce, "Ahmet"
 *   sonra) — aksi hâlde kısa terim uzun terimin içini delerdi.
 * - Zaten yerleştirilmiş maske etiketleri korunur (etiket içinde arama yapılmaz;
 *   etiketler `[...]` biçimindedir ve terimler harf/rakamla başlar).
 * - 3 karakterden kısa terimler yok sayılır (yanlış pozitif üretir).
 */
export function maskTerms(
  text: string,
  terms: ReadonlyArray<{ value: string; label: string }>,
): DictionaryMaskResult {
  let out = text;
  let replaced = 0;
  const ordered = [...terms]
    .filter((t) => t.value && t.value.trim().length >= 3)
    .sort((a, b) => b.value.trim().length - a.value.trim().length);

  for (const term of ordered) {
    const needle = term.value.trim();
    const regex = new RegExp(escapeRegExp(needle), "gi");
    let hit = false;
    out = out.replace(regex, () => {
      hit = true;
      return term.label;
    });
    if (hit) replaced += 1;
  }
  return { maskedText: out, replaced };
}

/**
 * Sağlayıcı TİPİNE göre dışsallık (geriye dönük uyumluluk için korunur).
 *
 * DİKKAT: Tek başına YETERSİZDİR. `CUSTOM` ve `OLLAMA` tipleri "büro içi"
 * varsayılır, oysa ikisinin de `baseUrl`'i kiracının serbestçe girdiği bir
 * adrestir; `type=CUSTOM, baseUrl=https://herhangi-bir-sunucu/` tanımlayan bir
 * büro maskesiz veriyi dışarı gönderebilirdi. Yeni kodda
 * {@link isExternalDestination} kullanılmalıdır.
 */
export function isExternalProvider(type: string): boolean {
  return type === "ANTHROPIC" || type === "OPENAI_COMPAT" || type === "GEMINI";
}

/* -------------------------------------------------------------------------- *
 * Adres tabanlı dışsallık ve SSRF koruması
 * -------------------------------------------------------------------------- */

/** Sağlayıcı tipine göre, baseUrl verilmediğinde kullanılan varsayılan adres. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  ANTHROPIC: "https://api.anthropic.com",
  OPENAI_COMPAT: "https://api.openai.com/v1",
  GEMINI: "https://generativelanguage.googleapis.com",
  OLLAMA: "http://localhost:11434",
};

/** Büro-içi kabul edilen ek ana makineler (virgülle ayrılmış, env ile genişletilir). */
function configuredInternalHosts(): string[] {
  const raw =
    (typeof process !== "undefined" ? process.env?.AI_INTERNAL_HOSTS : undefined) ?? "";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostOf(url: string | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/** RFC1918 / loopback / .local — verinin büro ağından çıkmadığı adresler. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (configuredInternalHosts().includes(h)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // 169.254/16 link-local: teknik olarak "dış" değildir ama bulut metadata
    // servisinin adresidir; SSRF kapısı bunu ayrıca REDDEDER (aşağıda).
    if (a === 169 && b === 254) return true;
    return false;
  }
  // IPv6 benzersiz yerel adresler (fc00::/7) ve link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

/**
 * Veri BÜRO DIŞINA çıkıyor mu? Karar TİPE değil ADRESE bakar.
 *
 * - Adres çözülemiyorsa (bozuk/eksik URL) FAIL-CLOSED: dış sayılır.
 * - localhost / RFC1918 / .local / AI_INTERNAL_HOSTS listesi → iç.
 * - Diğer her şey → dış; KVKK 409 onay akışı zorunludur.
 */
export function isExternalDestination(type: string, baseUrl?: string | null): boolean {
  const effective = baseUrl?.trim() || DEFAULT_BASE_URLS[type];
  const host = hostOf(effective);
  if (!host) return true; // fail-closed
  return !isPrivateHost(host);
}

export interface BaseUrlValidation {
  ok: boolean;
  /** Reddedildiyse kullanıcıya gösterilecek Türkçe gerekçe. */
  message?: string;
}

/**
 * Sağlayıcı kaydı oluşturulurken `baseUrl` denetimi (SSRF kapısı).
 *
 * Sunucu, kiracının girdiği adrese KENDİ AĞINDAN istek atar; bulut metadata
 * uçları (169.254.169.254) ve http/https dışı şemalar bu yüzden reddedilir.
 */
export function validateProviderBaseUrl(baseUrl: string | undefined | null): BaseUrlValidation {
  if (!baseUrl || !baseUrl.trim()) return { ok: true };
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, message: "Sağlayıcı adresi geçerli bir URL değil (örn. https://ornek/v1)." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      message: `Sağlayıcı adresinde yalnızca http/https kullanılabilir (verilen: ${url.protocol}).`,
    };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^169\.254\./.test(host) || host === "metadata.google.internal" || host === "metadata") {
    return {
      ok: false,
      message:
        "Bu adres bulut metadata servisine işaret ediyor (link-local 169.254.0.0/16) ve " +
        "güvenlik nedeniyle kullanılamaz.",
    };
  }
  return { ok: true };
}

/** Kısmi maske: "12345678901" → "123******01" (409 gövdesinde ham değer taşımamak için). */
export function partiallyMask(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "*".repeat(trimmed.length);
  const head = trimmed.slice(0, Math.min(3, trimmed.length - 2));
  const tail = trimmed.slice(-2);
  return `${head}${"*".repeat(Math.max(1, trimmed.length - head.length - tail.length))}${tail}`;
}

/** 409 gövdesine konacak güvenli bulgu özeti (ham TCKN/IBAN taşımaz). */
export function summarizeFindings(
  findings: readonly PiiFinding[],
): Array<{ kind: PiiKind; masked: string; count: number }> {
  const byKind = new Map<PiiKind, { masked: string; count: number }>();
  for (const finding of findings) {
    const existing = byKind.get(finding.kind);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKind.set(finding.kind, { masked: partiallyMask(finding.value), count: 1 });
  }
  return [...byKind.entries()].map(([kind, v]) => ({ kind, masked: v.masked, count: v.count }));
}
