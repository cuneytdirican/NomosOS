/**
 * GELEN MESAJ EŞLEŞTİRME — DETERMİNİSTİK KATMAN.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ AI BU KATMANIN ÜSTÜNE ÇIKMAZ, ALTINA GİRER.                              ║
 * ║ Gönderenin numarası müvekkil kaydındaki numaraysa, bu bir ÇIKARIM değil  ║
 * ║ KAYIT EŞLEŞMESİDİR. Metinde "2026/145" yazıyorsa ve o esas numarası      ║
 * ║ büronun tek bir dosyasına aitse, dosya BELLİDİR. Böyle bir eşleşmede     ║
 * ║ LLM'e sormak (a) kredi harcar, (b) kesin bilgiyi tahmine çevirir,        ║
 * ║ (c) müvekkil verisini gereksiz yere dış sağlayıcıya gönderir.            ║
 * ║                                                                          ║
 * ║ Bu yüzden `decideDeterministicMatch` ÖNCE çalışır; `matched` döndüğünde  ║
 * ║ AI hattı hiç açılmaz (bkz. inbound.service.ts).                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Tüm fonksiyonlar SAF'tır: veritabanı okumaz, saat okumaz, rastgelelik
 * içermez. Aynı girdi her zaman aynı çıktıyı verir ve birim testlerle
 * doğrulanır.
 */

export type ContactKind = "EPOSTA" | "TELEFON" | "BILINMIYOR";

/**
 * E-posta normalizasyonu: kırpma + küçük harf.
 *
 * Nokta/`+etiket` sadeleştirmesi YAPILMAZ: bu kurallar sağlayıcıya göre değişir
 * ve `a.b@ornek.com` ile `ab@ornek.com` her yerde aynı kutu değildir. Yanlış
 * müvekkile bağlamaktansa eşleştirmemek tercih edilir.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Türkiye cep/sabit numarasını karşılaştırılabilir biçime indirger.
 *
 * "+90 532 111 22 33", "0532 111 22 33", "532-111-22-33" → "5321112233".
 * Ülke kodu ve baştaki sıfır atılır; kalan 10 hane anahtardır. 10 haneye
 * inmeyen girdi `null` döner (eşleştirme yapılmaz).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/** Gönderen adresinin türü — hangi sütunda aranacağını belirler. */
export function classifyContactRef(raw: string): { kind: ContactKind; value: string | null } {
  const email = normalizeEmail(raw);
  if (email) return { kind: "EPOSTA", value: email };
  const phone = normalizePhone(raw);
  if (phone) return { kind: "TELEFON", value: phone };
  return { kind: "BILINMIYOR", value: null };
}

/**
 * Esas numarası kalıbı: `2026/145`, `2026 / 145`, `E. 2026/145`.
 *
 * Yıl 1900-2099 aralığıyla sınırlıdır; sıra numarası en fazla 6 hanedir. Bu
 * darlık bilinçlidir: `12/34` gibi tarih parçalarını veya `1/2` gibi kesirleri
 * esas numarası sanmamak için.
 */
const FILE_NUMBER_RE = /\b(19|20)(\d{2})\s*\/\s*(\d{1,6})\b/g;

/** `2026/0145` ve `2026 / 145` aynı anahtara iner: `2026/145`. */
export function normalizeFileNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^\s*(\d{4})\s*\/\s*(\d{1,6})\s*$/.exec(raw);
  if (!match) return null;
  const seq = match[2].replace(/^0+(?=\d)/, "");
  return `${match[1]}/${seq}`;
}

/** Metinde geçen esas numaraları (tekrarsız, normalize edilmiş). */
export function extractFileNumbers(text: string): string[] {
  const out: string[] = [];
  FILE_NUMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_NUMBER_RE.exec(text)) !== null) {
    const seq = match[3].replace(/^0+(?=\d)/, "");
    const key = `${match[1]}${match[2]}/${seq}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** Eşleştirme adayı müvekkil — e-posta/telefonları normalize edilmiş hâlde. */
export interface ClientContactIndex {
  clientId: string;
  emails: readonly string[];
  phones: readonly string[];
}

/** Eşleştirme adayı dosya. */
export interface CaseIndexRow {
  caseId: string;
  clientId: string;
  /** Normalize edilmiş esas numarası (`2026/145`) veya null. */
  fileNumber: string | null;
}

export interface DeterministicMatch {
  clientId: string | null;
  caseId: string | null;
  /**
   * DOSYA eşleşmesinin güveni. Deterministik eşleşmede daima 1 — bu bir tahmin
   * değil, kayıt üzerinden doğrulanmış bir olgudur. Dosya çözülemediyse null.
   */
  confidence: number | null;
  /** Kararın insan-okur gerekçesi; denetim ve arayüz için. */
  reason: string;
  /**
   * `true` ise dosya kesinleşmiştir ve AI KATMANI HİÇ ÇALIŞTIRILMAZ.
   * `false` ise gerekirse `MESSAGE_CASE_MATCH` önerisi istenebilir.
   */
  matched: boolean;
  /**
   * GÖNDEREN KİMLİĞİ KAYITLA OTURDU MU?
   *
   * `matched`'in ön koşuludur (aşağıdaki açıklamaya bakın). Gönderen tanınmıyorsa
   * metindeki esas numarası yalnızca bir İPUCUDUR, kayıt eşleşmesi değildir.
   */
  senderResolved: boolean;
}

/**
 * Gönderen adresi + mesaj metninden müvekkil ve dosyayı çözer.
 *
 * BELİRSİZLİK EŞLEŞTİRMEME SEBEBİDİR: iki müvekkilde aynı telefon kayıtlıysa
 * ya da metindeki esas numarası iki dosyaya uyuyorsa hiçbiri seçilmez. Yanlış
 * müvekkilin dosyasına yazışma bağlamak, bağlamamaktan çok daha ağır bir
 * hatadır (KVKK açısından da: iki farklı ilgili kişinin verisi karışır).
 */
export function decideDeterministicMatch(input: {
  fromRef: string;
  /** Konu + gövde, birleşik. */
  text: string;
  clients: readonly ClientContactIndex[];
  cases: readonly CaseIndexRow[];
  /**
   * Gönderen kimliği DIŞARIDAN kesin olarak biliniyor mu?
   *
   * Portal oturumundan gelen mesajlarda gönderen, kimlik doğrulamasından geçmiş
   * bir `PortalUser`'dır; `fromRef` müvekkil kartındaki adresle birebir
   * eşleşmese de gönderen KİMLİĞİ kesindir. Webhook / elle giriş / e-posta
   * başlığı için bu bayrak `false`'tır.
   */
  senderVerified?: boolean;
}): DeterministicMatch {
  const contact = classifyContactRef(input.fromRef);
  const reasons: string[] = [];

  // --- 1) Müvekkil: gönderen adresi kayıtla birebir eşleşiyor mu? -----------
  let clientId: string | null = null;
  if (contact.kind === "EPOSTA" && contact.value) {
    const hits = input.clients.filter((c) => c.emails.includes(contact.value as string));
    if (hits.length === 1) {
      clientId = hits[0].clientId;
      reasons.push(`Gönderen e-posta adresi müvekkil kaydıyla birebir eşleşti.`);
    } else if (hits.length > 1) {
      reasons.push(
        `Gönderen e-posta adresi ${hits.length} müvekkil kaydında birden geçiyor; belirsizlik nedeniyle bağlanmadı.`,
      );
    }
  } else if (contact.kind === "TELEFON" && contact.value) {
    const hits = input.clients.filter((c) => c.phones.includes(contact.value as string));
    if (hits.length === 1) {
      clientId = hits[0].clientId;
      reasons.push(`Gönderen telefon numarası müvekkil kaydıyla birebir eşleşti.`);
    } else if (hits.length > 1) {
      reasons.push(
        `Gönderen telefon numarası ${hits.length} müvekkil kaydında birden geçiyor; belirsizlik nedeniyle bağlanmadı.`,
      );
    }
  } else {
    reasons.push("Gönderen adresi e-posta veya telefon olarak tanınamadı.");
  }

  /**
   * GÖNDEREN KİMLİĞİ BU NOKTADA ÇÖZÜLDÜ MÜ?
   *
   * DİKKAT: aşağıda `clientId`, dosyadan da türetilebiliyor ("esas numarası tek
   * bir dosyayla eşleşti → müvekkil o dosyanın sahibidir"). O türetme
   * GÖNDERENİ DOĞRULAMAZ; tam tersine, doğrulanmamış bir alandan gelen bir
   * numaraya dayanır. Bu yüzden bayrak, türetmeden ÖNCE dondurulur.
   */
  const senderResolved = input.senderVerified === true || clientId !== null;

  // --- 2) Dosya: metinde esas numarası var mı? ------------------------------
  const fileNumbers = extractFileNumbers(input.text);
  let caseId: string | null = null;

  if (fileNumbers.length > 0) {
    // Müvekkil çözüldüyse arama ONUN dosyalarıyla sınırlanır: aynı esas
    // numarası farklı mahkemelerde tekrar edebilir.
    const scope = clientId ? input.cases.filter((c) => c.clientId === clientId) : input.cases;
    const hits = scope.filter((c) => c.fileNumber !== null && fileNumbers.includes(c.fileNumber));
    const uniqueIds = [...new Set(hits.map((h) => h.caseId))];

    if (uniqueIds.length === 1) {
      caseId = uniqueIds[0];
      const owner = hits.find((h) => h.caseId === caseId)?.clientId ?? null;
      reasons.push(`Mesaj metnindeki esas numarası (${fileNumbers.join(", ")}) tek bir dosyayla eşleşti.`);
      // Dosya çözüldüyse müvekkil de bellidir — dosyanın sahibi.
      if (!clientId && owner) {
        clientId = owner;
        reasons.push("Müvekkil, eşleşen dosyanın sahibi olarak belirlendi.");
      }
    } else if (uniqueIds.length > 1) {
      reasons.push(
        `Metindeki esas numarası ${uniqueIds.length} dosyaya uyuyor; belirsizlik nedeniyle dosya bağlanmadı.`,
      );
    } else {
      reasons.push("Metinde esas numarası geçiyor ancak büro kayıtlarında karşılığı bulunamadı.");
    }
  } else {
    reasons.push("Mesaj metninde esas numarası kalıbı bulunamadı.");
  }

  /* ═══════════════════════════════════════════════════════════════════════ *
   * KESİN EŞLEŞMENİN İKİ AYAĞI: GÖNDEREN **VE** DOSYA
   * ═══════════════════════════════════════════════════════════════════════ *
   *
   * Burada eskiden yalnızca `caseId !== null` aranıyordu. Yani gönderen HİÇBİR
   * müvekkil kaydıyla eşleşmese bile, metinde tek bir esas numarası geçiyorsa
   * mesaj `matchStatus: "ESLESTI"`, `confidence: 1`, `processedBy: null` olarak
   * kaydediliyordu — insan onayı hiç görmeden.
   *
   * `fromRef` KİMLİK DOĞRULAMASINDAN GEÇMEMİŞ bir alandır: webhook gövdesi,
   * elle giriş ya da e-posta başlığı; üçü de sahtelenebilir. Sonuç şuydu:
   * karşı taraf vekilinin ya da spoof edilmiş bir adresin "2026/145 dosyasında…"
   * diyen mesajı, müvekkilin dosyasına KESİN EŞLEŞME olarak düşüyor ve iletişim
   * geçmişinde müvekkil yazışması gibi görünüyordu. (KVKK açısından da ağır:
   * iki farklı ilgili kişinin verisi tek dosyada karışır.)
   *
   * Doğrusu: "kayıt eşleşmesi" sayılabilmesi için GÖNDEREN KİMLİĞİNİN DE kayda
   * oturması gerekir. Gönderen tanınmıyorken esas numarası bir ipucudur; dosya
   * ÖNERİ olarak yazılır ama durum BEKLIYOR kalır ve kararı insan verir.
   */
  if (caseId !== null && !senderResolved) {
    reasons.push(
      "ANCAK gönderen kimliği hiçbir müvekkil kaydıyla eşleşmedi; gönderen adresi " +
        "doğrulanmamış bir alandır. Esas numarası bir İPUCU sayıldı, kesin eşleşme " +
        "sayılmadı: dosya bağlantısı öneri olarak kaydedildi ve onayınızı bekliyor.",
    );
  }

  return {
    clientId,
    caseId,
    confidence: caseId ? 1 : null,
    reason: reasons.join(" "),
    matched: caseId !== null && senderResolved,
    senderResolved,
  };
}

/* -------------------------------------------------------------------------- *
 * AI önerisinin kabul kapısı
 * -------------------------------------------------------------------------- */

/** Öneri metinde gerçekten geçiyor mu? Boşluk/büyük-küçük fark etmez. */
export function quoteAppearsIn(haystack: string, quote: string | undefined | null): boolean {
  if (!quote || quote.trim().length < 3) return false;
  const fold = (s: string): string =>
    s
      .replace(/\s+/g, " ")
      .trim()
      .replace(/I/g, "ı")
      .replace(/İ/g, "i")
      .toLowerCase();
  return fold(haystack).includes(fold(quote));
}

/**
 * `MESSAGE_CASE_MATCH` güven eşikleri (görev tanımı + Modül 19 iş kuralı 5).
 *
 *   >= 0.80  → öneri kaydedilir, arayüzde ÖN SEÇİLİ gelir. Durum yine BEKLIYOR.
 *   >= 0.50  → öneri kaydedilir ama ön seçili gelmez.
 *   <  0.50  → öneri HİÇ KAYDEDİLMEZ; durum ESLESMEDI olur.
 *
 * HER ÜÇ HALDE DE `matchStatus` insan kararıyla değişir. AI'ın güveni ne olursa
 * olsun `matchStatus = ESLESTI` yazılmaz (ortak ürün ilkesi: AI çıktısı öneridir).
 *
 * EŞİKLER `@nomosos/shared`TAN GELİR ve buradan yeniden dışa aktarılır.
 * Arayüz de aynı sabitleri okur; iki tarafın eşiği ayrışamaz (denetim
 * bulgusu 12: sunucu 0,80 derken arayüz 0,85 kullanıyordu).
 */
import { AI_MATCH_MIN_THRESHOLD, AI_MATCH_PRESELECT_THRESHOLD } from "@nomosos/shared";
export { AI_MATCH_MIN_THRESHOLD, AI_MATCH_PRESELECT_THRESHOLD };

export interface AiMatchDecision {
  /** Kayda yazılacak öneri; `null` ise öneri reddedildi. */
  caseId: string | null;
  confidence: number | null;
  preselect: boolean;
  reason: string;
  /** Öneri reddedildiyse gerekçe (uydurma referans, kaynaksız, düşük güven). */
  rejectedBecause?: string;
}

/**
 * Modelin önerisini kabul kapısından geçirir.
 *
 * ÜÇ ELEME:
 *  1. Bilinmeyen referans — modele verilmeyen bir dosyayı işaret ediyorsa atılır.
 *  2. Kaynaksız öneri — `sourceQuote` mesaj metninde geçmiyorsa atılır
 *     (çekirdek prompt kuralı 1: kaynaksız yazmak, yazmamakla aynıdır).
 *  3. Düşük güven — 0,50 altı öneri gösterilmez.
 */
export function decideAiMatch(input: {
  /** Modelin döndüğü referans (ör. "dosya-2"). */
  caseRef: string | null;
  confidence: number;
  reason: string;
  sourceQuote?: string;
  /** Modele verilen referans → gerçek dosya kimliği. */
  refIndex: ReadonlyMap<string, string>;
  /** Kaynak alıntısının aranacağı metin (modele giden hâliyle). */
  messageText: string;
}): AiMatchDecision {
  const base = { caseId: null, confidence: null, preselect: false } as const;

  if (!input.caseRef) {
    return { ...base, reason: input.reason, rejectedBecause: "Model eşleşen dosya bulamadı." };
  }
  const caseId = input.refIndex.get(input.caseRef.trim());
  if (!caseId) {
    return {
      ...base,
      reason: input.reason,
      rejectedBecause: `Model, kendisine verilmeyen bir dosya referansı (${input.caseRef}) döndürdü; öneri reddedildi.`,
    };
  }
  if (!quoteAppearsIn(input.messageText, input.sourceQuote)) {
    return {
      ...base,
      reason: input.reason,
      rejectedBecause:
        "Öneri, mesaj metninde bulunmayan bir alıntıya dayanıyor; kaynaksız öneri kaydedilmez.",
    };
  }
  if (input.confidence < AI_MATCH_MIN_THRESHOLD) {
    return {
      ...base,
      reason: input.reason,
      rejectedBecause: `Güven skoru ${input.confidence.toFixed(2)} eşiğin (0,50) altında; öneri gösterilmiyor.`,
    };
  }
  return {
    caseId,
    confidence: input.confidence,
    preselect: input.confidence >= AI_MATCH_PRESELECT_THRESHOLD,
    reason: input.reason,
  };
}
