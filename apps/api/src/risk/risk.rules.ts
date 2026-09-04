/**
 * RİSK MOTORU — KURAL TABANI (deterministik yarı).
 *
 * Bu dosyada HİÇBİR LLM ÇAĞRISI YOKTUR ve olmayacaktır. Yedi boyutun taban
 * skoru yalnızca dosyadaki kayıtlı veriden hesaplanır; her puanın anahtarı,
 * ağırlığı, ham değeri, katkısı ve NASIL bulunduğu `RiskSignal` içinde saklanır
 * (Modül 17, iş kuralı 4: "signals boş olan boyut skoru yazılamaz").
 *
 * BANT DAİMA BU DOSYANIN ÜRETTİĞİ TABAN SKORDAN TÜRER. AI'nin ±25 puanlık
 * düzeltmesi gösterilen skoru oynatabilir ama bandı DEĞİŞTİREMEZ — aksi hâlde
 * bir dil modeli, büronun dosya önceliklendirmesini tek başına yeniden yazardı
 * (`CollectionScore` ile birebir aynı ilke).
 *
 * SKOR YÖNÜ: yüksek = RİSKLİ. `CollectionScore`'un tersidir (orada yüksek =
 * tahsilat ihtimali yüksek); bu yüzden tahsilat skoru buraya 100 - skor olarak
 * çevrilir.
 *
 * SAF FONKSİYONLAR: veri okuma servisin işidir; burası yalnızca hesaplar.
 * Böylece kural seti veri tabanı olmadan da düşünülebilir ve denetlenebilir.
 */

import type { RiskBand, RiskDimension } from "@nomosos/db";

/** AI'nin boyut başına uygulayabileceği azami düzeltme (Modül 17). */
export const MAX_AI_ADJUSTMENT = 25;

/** Bant eşikleri — 🟢 0-39 · 🟡 40-69 · 🔴 70-100. */
export const BAND_THRESHOLDS = { orta: 40, yuksek: 70 } as const;

export const BAND_LABELS: Record<RiskBand, string> = {
  DUSUK: "Düşük",
  ORTA: "Orta",
  YUKSEK: "Yüksek",
};

export const DIMENSION_LABELS: Record<RiskDimension, string> = {
  GENEL: "Genel Risk",
  HUKUKI: "Hukuki Risk",
  SURE: "Süre Riski",
  DELIL: "Delil Riski",
  TAHSILAT: "Tahsilat Riski",
  USUL: "Usul Riski",
  ICTIHAT: "İçtihat Riski",
  KARSI_TARAF: "Karşı Taraf Riski",
};

/** GENEL skorun türetildiği yedi boyut (GENEL hariç). */
export const SCORED_DIMENSIONS: readonly Exclude<RiskDimension, "GENEL">[] = [
  "HUKUKI",
  "SURE",
  "DELIL",
  "TAHSILAT",
  "USUL",
  "ICTIHAT",
  "KARSI_TARAF",
];

/**
 * GENEL skorun ağırlıkları.
 *
 * Modül 17 tenant bazlı `RiskRuleConfig` öngörür; şemada böyle bir tablo
 * YOKTUR, bu yüzden ağırlıklar burada SABİTTİR ve yanıtta açıkça döner.
 * Tenant ayarı eklendiğinde yalnızca bu sabitin kaynağı değişir.
 */
export const DIMENSION_WEIGHTS: Record<Exclude<RiskDimension, "GENEL">, number> = {
  SURE: 1.2,
  HUKUKI: 1.0,
  DELIL: 1.0,
  TAHSILAT: 0.8,
  USUL: 0.8,
  ICTIHAT: 0.6,
  KARSI_TARAF: 0.6,
};

export interface RiskSignal {
  key: string;
  label: string;
  /** Sinyalin boyut skorundaki azami ağırlığı (puan). */
  weight: number;
  /** İnsan okunur ham değer ("2 kaçırılmış süre", "%60 iddia delilsiz"). */
  value: string;
  /** Bu sinyalin taban skora katkısı (puan, tam sayı). RİSK ARTIRIR. */
  contribution: number;
  /** Katkının nasıl bulunduğu — denetlenebilirlik. */
  explanation: string;
}

export interface DimensionResult {
  dimension: Exclude<RiskDimension, "GENEL">;
  baseScore: number;
  band: RiskBand;
  signals: RiskSignal[];
  /** Skoru okuyanın bilmesi gereken eksik veri uyarıları. */
  warnings: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bandOf(score: number): RiskBand {
  if (score >= BAND_THRESHOLDS.yuksek) return "YUKSEK";
  if (score >= BAND_THRESHOLDS.orta) return "ORTA";
  return "DUSUK";
}

function days(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/* ------------------------------------------------------------------ *
 * Girdi anlık görüntüsü
 * ------------------------------------------------------------------ */

export interface RiskCaseSnapshot {
  now: Date;
  kase: {
    id: string;
    type: string;
    status: string;
    openedAt: Date;
    lastActivityAt: Date | null;
    responsibleUserId: string | null;
  };
  deadlines: { status: string; dueDate: Date; title: string }[];
  hearings: { status: string; date: Date }[];
  documents: { class: string; ocrStatus: string | null; chunkStatus: string | null; createdAt: Date }[];
  timelineEventDates: Date[];
  decisions: { type: string; outcome: string | null; date: Date }[];
  powerOfAttorneyCount: number;
  parties: { role: string; isClient: boolean; lawyerName: string | null }[];
  caseLawRefs: { status: string }[];
  /** Bu dosyanın dilekçelerinde doğrulanamamış atıf sayısı. */
  unverifiedCitationCount: number;
  claims: { side: string; status: string; evidenceLinkCount: number }[];
  evidences: { status: string; claimLinkCount: number }[];
  enforcement: {
    exists: boolean;
    hasOpenObjection: boolean;
    objectionActionCount: number;
    /** En son CollectionScore (0-100, YÜKSEK = tahsilat ihtimali yüksek). */
    latestCollectionScore: number | null;
  };
  finance: {
    /** Faturalanan/tahakkuk eden toplam (kuruş hassasiyetli string). */
    billed: string;
    /** Tahsil edilen + avans toplamı. */
    collected: string;
    hasFeeAgreement: boolean;
  };
  strategy: {
    exists: boolean;
    status: string | null;
    weakPointCount: number;
    riskNodeCount: number;
  };
  /** Son 30 gündeki KAYBETTIREN_HUSUSLAR / HAKIM_GOZU koşularından bulgu sayısı. */
  recentLossFindingCount: number;
  /**
   * HEPO (Modül 28 Faz 5) — dosyanın MÜVEKKİLİNİN uyum yükümlülükleri.
   * Dosya verisi değil, müvekkil şirketin uyum fotoğrafıdır; iş kazası ve
   * idari ceza davalarında müvekkilin hukuki konumunu doğrudan etkiler.
   */
  hepo: {
    /** Müvekkile hiç yükümlülük atanmış mı (hiç atanmamış ≠ uyumlu). */
    clientHasAssignments: boolean;
    /** Vadesi geçmiş ve UYGUN işaretlenmemiş yükümlülük sayısı. */
    overdueOpenCount: number;
  };
}

/* ------------------------------------------------------------------ *
 * Boyut hesapları
 * ------------------------------------------------------------------ */

/**
 * SÜRE RİSKİ.
 *
 * KOŞULSUZ KURAL (Modül 17, iş kuralı 6): kaçırılmış (geçmiş, kapatılmamış)
 * bir süre varsa taban ≥ 70'tir, yani bant KOŞULSUZ 🔴 olur. Bu kural AI'den
 * bağımsızdır ve AI tarafından yumuşatılamaz.
 */
export function computeSure(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];
  const open = s.deadlines.filter((d) => d.status === "BEKLIYOR" || d.status === "ONAYLANDI");

  // Kaçırılmış = açıkça KACIRILDI işaretli VEYA hâlâ açık olup son günü geçmiş.
  // F2-Ö-13 (off-by-one): dueDate alanı @db.Date'tir (gece yarısı). Vade GÜNÜ
  // içindeyken "kaçırılmış" sayılmaz — süre günün SONUNA kadar açıktır. Bu
  // nedenle kıyaslama takvim günüyle yapılır: dueDate < startOfDay(now).
  // sure-performansi.report.ts aynı olguyu `(dueDate + 1 gün)` ile hesaplıyordu;
  // iki modül artık aynı sonucu verir.
  const nowDayStart = new Date(s.now);
  nowDayStart.setUTCHours(0, 0, 0, 0);
  const missed = s.deadlines.filter(
    (d) =>
      d.status === "KACIRILDI" ||
      ((d.status === "BEKLIYOR" || d.status === "ONAYLANDI") &&
        d.dueDate.getTime() < nowDayStart.getTime()),
  );
  signals.push({
    key: "MISSED_DEADLINE",
    label: "Kaçırılmış veya süresi geçmiş açık süre",
    weight: 70,
    value: missed.length > 0 ? `${missed.length} süre: ${missed.map((m) => m.title).join(", ")}` : "yok",
    contribution: missed.length > 0 ? 70 : 0,
    explanation:
      "Kaçırılmış (geçmiş ve kapatılmamış) bir süre, boyut skorunu KOŞULSUZ olarak yüksek " +
      "banda taşır. Bu kural AI düzeltmesiyle yumuşatılamaz.",
  });

  const in3 = open.filter((d) => {
    const remaining = days(s.now, d.dueDate);
    return remaining >= 0 && remaining <= 3;
  });
  signals.push({
    key: "DEADLINE_3_DAYS",
    label: "3 gün içinde dolan açık süre",
    weight: 20,
    value: in3.length > 0 ? `${in3.length} süre` : "yok",
    contribution: Math.min(20, in3.length * 10),
    explanation: "Son üç güne giren her açık süre 10 puan; azami 20 puan.",
  });

  const in7 = open.filter((d) => {
    const remaining = days(s.now, d.dueDate);
    return remaining > 3 && remaining <= 7;
  });
  signals.push({
    key: "DEADLINE_7_DAYS",
    label: "Bir hafta içinde dolan açık süre",
    weight: 10,
    value: in7.length > 0 ? `${in7.length} süre` : "yok",
    contribution: Math.min(10, in7.length * 5),
    explanation: "4-7 gün aralığındaki her açık süre 5 puan; azami 10 puan.",
  });

  const pending = s.deadlines.filter((d) => d.status === "BEKLIYOR");
  signals.push({
    key: "UNAPPROVED_DEADLINE",
    label: "Avukat onayı bekleyen süre önerisi",
    weight: 10,
    value: pending.length > 0 ? `${pending.length} öneri` : "yok",
    contribution: Math.min(10, pending.length * 5),
    explanation:
      "Onaylanmamış süre önerisi takvimde görünmez; onaylanana kadar kaçırılma riski taşır.",
  });

  const activeCase = ["ACIK", "DERDEST", "ISTINAF", "TEMYIZ", "ICRADA"].includes(s.kase.status);
  const noDeadline = activeCase && s.deadlines.length === 0;
  signals.push({
    key: "NO_DEADLINE_RECORD",
    label: "Derdest dosyada hiç süre kaydı olmaması",
    weight: 8,
    value: noDeadline ? "hiç süre kaydı yok" : `${s.deadlines.length} kayıt`,
    contribution: noDeadline ? 8 : 0,
    explanation:
      "Derdest bir dosyada hiç süre kaydı bulunmaması, sürelerin sistem dışında takip " +
      "edildiğini gösterir; bu bir KÖR NOKTA riskidir.",
  });
  if (noDeadline) {
    warnings.push(
      "Bu dosyada hiç süre kaydı yok. Süre riski, olmayan veriden hesaplanamaz; skor gerçek " +
        "durumu yansıtmayabilir.",
    );
  }

  return finalize("SURE", signals, warnings);
}

/** DELİL RİSKİ — iddia × delil matrisi (Modül 14) üzerinden. */
export function computeDelil(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];

  const ourClaims = s.claims.filter((c) => c.side === "BIZ");
  const uncovered = ourClaims.filter((c) => c.evidenceLinkCount === 0);
  const ratio = ourClaims.length > 0 ? uncovered.length / ourClaims.length : 0;
  signals.push({
    key: "CLAIM_WITHOUT_EVIDENCE",
    label: "Delili bağlanmamış kendi iddialarımız",
    weight: 40,
    value:
      ourClaims.length === 0
        ? "iddia kaydı yok"
        : `${uncovered.length}/${ourClaims.length} iddia (%${Math.round(ratio * 100)})`,
    contribution: Math.round(ratio * 40),
    explanation:
      "Kendi iddialarımızın delil bağlanmamış oranı doğrudan puana çevrilir; ispat yükü " +
      "bizdeyken dayanaksız kalan her iddia risktir.",
  });

  const noMatrix = s.claims.length === 0;
  signals.push({
    key: "NO_CLAIM_MATRIX",
    label: "İddia–delil matrisinin hiç kurulmamış olması",
    weight: 25,
    value: noMatrix ? "matris yok" : `${s.claims.length} iddia kayıtlı`,
    contribution: noMatrix ? 25 : 0,
    explanation:
      "Matris kurulmamışsa delil boşluğu GÖRÜLEMEZ. Bilinmeyen boşluk, bilinen boşluktan " +
      "daha risklidir; bu yüzden puanlanır.",
  });
  if (noMatrix) {
    warnings.push(
      "Dosyada iddia–delil matrisi yok. Delil riski yalnızca matrisin yokluğu üzerinden " +
        "hesaplanmıştır; gerçek boşluklar bilinmiyor.",
    );
  }

  const planned = s.evidences.filter((e) => e.status === "PLANLANAN");
  const plannedRatio = s.evidences.length > 0 ? planned.length / s.evidences.length : 0;
  signals.push({
    key: "EVIDENCE_NOT_COLLECTED",
    label: "Henüz toplanmamış (planlanan) deliller",
    weight: 20,
    value:
      s.evidences.length === 0
        ? "delil kaydı yok"
        : `${planned.length}/${s.evidences.length} delil planlama aşamasında`,
    contribution: Math.round(plannedRatio * 20),
    explanation: "Planlanan ama toplanmamış delil oranı puana çevrilir.",
  });

  const rejected = s.evidences.filter((e) => e.status === "RED");
  signals.push({
    key: "EVIDENCE_REJECTED",
    label: "Mahkemece reddedilen deliller",
    weight: 15,
    value: rejected.length > 0 ? `${rejected.length} delil reddedildi` : "yok",
    contribution: Math.min(15, rejected.length * 5),
    explanation: "Reddedilen her delil 5 puan; azami 15 puan.",
  });

  const orphan = s.evidences.filter((e) => e.claimLinkCount === 0);
  signals.push({
    key: "ORPHAN_EVIDENCE",
    label: "Hiçbir iddiaya bağlanmamış deliller",
    weight: 10,
    value: orphan.length > 0 ? `${orphan.length} delil boşta` : "yok",
    contribution: Math.min(10, orphan.length * 3),
    explanation:
      "Hangi vakıayı taşıdığı belirlenmemiş delil, duruşmada kullanılamayan delildir; " +
      "her biri 3 puan, azami 10 puan.",
  });

  return finalize("DELIL", signals, warnings);
}

/**
 * TAHSİLAT RİSKİ.
 *
 * PARA HESABI DETERMİNİSTİKTİR ve burada YAPILMAZ: tutarlar servis katmanında
 * `Prisma.Decimal` ile toplanır, buraya string olarak gelir ve YALNIZCA ORAN
 * çıkarmak için sayıya çevrilir. Skor bir tam sayıdır, para değildir.
 */
export function computeTahsilat(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];

  const collectionScore = s.enforcement.latestCollectionScore;
  signals.push({
    key: "COLLECTION_SCORE",
    label: "İcra dosyasının tahsilat ihtimali skoru",
    weight: 45,
    value:
      collectionScore === null
        ? s.enforcement.exists
          ? "icra dosyası var, skor hesaplanmamış"
          : "icra dosyası yok"
        : `tahsilat skoru ${collectionScore}/100`,
    contribution: collectionScore === null ? 0 : Math.round(((100 - collectionScore) / 100) * 45),
    explanation:
      "İcra modülünün DETERMİNİSTİK tahsilat skoru tersine çevrilir (100 - skor): tahsilat " +
      "ihtimali düştükçe tahsilat riski yükselir. Yeniden hesaplanmaz, olduğu gibi alınır.",
  });
  if (s.enforcement.exists && collectionScore === null) {
    warnings.push(
      "İcra dosyası var ancak hiç tahsilat skoru hesaplanmamış. Tahsilat riski eksik veriyle " +
        "hesaplanmıştır; İcra → Tahsilat İhtimali komutunu çalıştırın.",
    );
  }

  const billed = Number(s.finance.billed);
  const collected = Number(s.finance.collected);
  const outstandingRatio = billed > 0 ? clamp((billed - collected) / billed, 0, 1) : 0;
  signals.push({
    key: "CLIENT_OUTSTANDING",
    label: "Müvekkil bakiyesi (tahakkuk - tahsilat)",
    weight: 30,
    value:
      billed > 0
        ? `${s.finance.collected} / ${s.finance.billed} tahsil edildi (kalan %${Math.round(outstandingRatio * 100)})`
        : "dosyada tahakkuk kaydı yok",
    contribution: Math.round(outstandingRatio * 30),
    explanation:
      "Dosyaya işlenen tahakkuk/masraf toplamının tahsil edilmemiş oranı puana çevrilir. " +
      "Tutarlar finans modülünde Decimal ile toplanır; burada yalnızca oran kullanılır.",
  });

  signals.push({
    key: "NO_FEE_AGREEMENT",
    label: "Ücret sözleşmesinin bulunmaması",
    weight: 12,
    value: s.finance.hasFeeAgreement ? "sözleşme var" : "sözleşme yok",
    contribution: s.finance.hasFeeAgreement ? 0 : 12,
    explanation:
      "Yazılı ücret sözleşmesi olmayan dosyada vekalet ücretinin tahsili ihtilaflı hâle gelebilir.",
  });

  const shouldHaveEnforcement =
    (s.kase.status === "KESINLESTI" || s.kase.status === "ICRADA") && !s.enforcement.exists;
  signals.push({
    key: "ENFORCEMENT_MISSING",
    label: "İcraya konu aşamada icra dosyasının açılmamış olması",
    weight: 13,
    value: shouldHaveEnforcement ? "dosya kesinleşmiş, icra takibi yok" : "uygulanmıyor",
    contribution: shouldHaveEnforcement ? 13 : 0,
    explanation:
      "Kesinleşmiş bir ilamın icraya konulmaması, alacağın tahsilini geciktirir ve zamanaşımı " +
      "riskini büyütür.",
  });

  return finalize("TAHSILAT", signals, warnings);
}

/** USUL RİSKİ — dosya yaşı, durgunluk, erteleme, evrak eksikliği. */
export function computeUsul(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];

  const ageDays = Math.max(0, days(s.kase.openedAt, s.now));
  const ageContribution =
    ageDays >= 1095 ? 25 : ageDays >= 730 ? 18 : ageDays >= 365 ? 10 : 0;
  signals.push({
    key: "CASE_AGE",
    label: "Dosya yaşı",
    weight: 25,
    value: `${ageDays} gün`,
    contribution: ageContribution,
    explanation: "1 yıla kadar 0, 1-2 yıl 10, 2-3 yıl 18, 3 yıl ve üzeri 25 puan.",
  });

  const lastActivity = s.kase.lastActivityAt;
  const idleDays = lastActivity ? Math.max(0, days(lastActivity, s.now)) : null;
  const idleContribution =
    idleDays === null ? 25 : idleDays > 365 ? 25 : idleDays > 180 ? 16 : idleDays > 90 ? 8 : 0;
  signals.push({
    key: "CASE_IDLE",
    label: "Son hareketten bu yana geçen süre",
    weight: 25,
    value: idleDays === null ? "hiç hareket kaydı yok" : `${idleDays} gün`,
    contribution: idleContribution,
    explanation:
      "90 güne kadar 0, 90-180 gün 8, 180-365 gün 16, 365 günden fazla (veya hiç hareket " +
      "yoksa) 25 puan. Durmuş dosya, dosyanın kendisinden bağımsız bir usul riskidir.",
  });

  const postponed = s.hearings.filter((h) => h.status === "ERTELENDI");
  signals.push({
    key: "HEARING_POSTPONED",
    label: "Ertelenen duruşmalar",
    weight: 20,
    value: postponed.length > 0 ? `${postponed.length} erteleme` : "yok",
    contribution: Math.min(20, postponed.length * 7),
    explanation:
      "Her erteleme 7 puan (azami 20). Tekrarlanan erteleme, eksik evrak veya tamamlanmamış " +
      "usul işlemine işaret eder.",
  });

  const failedDocs = s.documents.filter(
    (d) => d.ocrStatus === "BASARISIZ" || d.chunkStatus === "BASARISIZ",
  );
  const noDocs = s.documents.length === 0;
  signals.push({
    key: "DOCUMENT_GAPS",
    label: "Belge eksikliği veya işlenememiş belge",
    weight: 15,
    value: noDocs
      ? "dosyada hiç belge yok"
      : failedDocs.length > 0
        ? `${failedDocs.length} belge işlenemedi`
        : `${s.documents.length} belge işlendi`,
    contribution: noDocs ? 15 : Math.min(10, failedDocs.length * 4),
    explanation:
      "Hiç belgesi olmayan dosya 15 puan; metni çıkarılamamış her belge 4 puan (azami 10). " +
      "İşlenememiş belge, hem analizden hem süre tespitinden düşer.",
  });
  if (noDocs) {
    warnings.push(
      "Dosyada hiç belge yok. Usul ve delil riski büyük ölçüde belgelerden okunur; skorun " +
        "güvenilirliği düşüktür.",
    );
  }

  signals.push({
    key: "NO_POA",
    label: "Vekaletname kaydının bulunmaması",
    weight: 15,
    value: s.powerOfAttorneyCount > 0 ? `${s.powerOfAttorneyCount} vekaletname` : "kayıt yok",
    contribution: s.powerOfAttorneyCount > 0 ? 0 : 15,
    explanation:
      "Vekaletname kaydı olmayan dosyada temsil yetkisinin kapsamı denetlenemez; yetki " +
      "itirazı ve işlem geçersizliği riski doğar.",
  });

  return finalize("USUL", signals, warnings);
}

/** İÇTİHAT RİSKİ — emsal desteği ve atıf güvenilirliği. */
export function computeIctihat(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];

  const accepted = s.caseLawRefs.filter((r) => r.status === "KABUL").length;
  const rejected = s.caseLawRefs.filter((r) => r.status === "RED").length;
  const candidates = s.caseLawRefs.filter((r) => r.status === "ADAY").length;
  const total = s.caseLawRefs.length;

  signals.push({
    key: "NO_PRECEDENT",
    label: "Dosyaya bağlı onaylı emsal bulunmaması",
    weight: 40,
    value: accepted > 0 ? `${accepted} onaylı emsal` : "onaylı emsal yok",
    contribution: accepted > 0 ? 0 : 40,
    explanation:
      "Onaylı emsali olmayan dosyada hukuki argümanın içtihat desteği gösterilemez. Bu, " +
      "boyutun en ağır sinyalidir.",
  });

  const rejectedRatio = total > 0 ? rejected / total : 0;
  signals.push({
    key: "REJECTED_PRECEDENT_RATIO",
    label: "Reddedilen emsal önerisi oranı",
    weight: 25,
    value: total > 0 ? `${rejected}/${total} (%${Math.round(rejectedRatio * 100)})` : "emsal önerisi yok",
    contribution: Math.round(rejectedRatio * 25),
    explanation:
      "Taranan emsallerin yüksek oranda reddedilmesi, dosyanın lehe içtihat bulmakta " +
      "zorlandığını gösterir.",
  });

  signals.push({
    key: "PENDING_PRECEDENT",
    label: "Karar verilmemiş emsal önerileri",
    weight: 15,
    value: candidates > 0 ? `${candidates} aday emsal` : "yok",
    contribution: Math.min(15, candidates * 5),
    explanation:
      "Avukatın kabul/red kararı vermediği her aday emsal 5 puan (azami 15): taranmış ama " +
      "değerlendirilmemiş içtihat, kullanılmayan içtihattır.",
  });

  signals.push({
    key: "UNVERIFIED_CITATION",
    label: "Doğrulanamamış atıflar",
    weight: 20,
    value:
      s.unverifiedCitationCount > 0
        ? `${s.unverifiedCitationCount} atıf kayıt üzerinden doğrulanamadı`
        : "yok",
    contribution: Math.min(20, s.unverifiedCitationCount * 5),
    explanation:
      "Dilekçelerdeki her doğrulanamamış künye 5 puan (azami 20). Teyit deterministiktir: " +
      "künye kayıt havuzunda aranır, LLM'e sorulmaz.",
  });

  if (total === 0) {
    warnings.push(
      "Dosyada hiç emsal taraması yapılmamış. İçtihat riski, taramanın yokluğu üzerinden " +
        "hesaplanmıştır.",
    );
  }

  return finalize("ICTIHAT", signals, warnings);
}

/** KARŞI TARAF RİSKİ — temsil, çokluk, itiraz ve dosya hareketliliği. */
export function computeKarsiTaraf(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];

  const opponents = s.parties.filter((p) => !p.isClient);
  const withCounsel = opponents.filter((p) => (p.lawyerName ?? "").trim().length > 0);
  signals.push({
    key: "OPPOSING_COUNSEL",
    label: "Karşı tarafın vekille temsili",
    weight: 20,
    value:
      opponents.length === 0
        ? "karşı taraf kaydı yok"
        : withCounsel.length > 0
          ? `${withCounsel.length} karşı taraf vekille temsil ediliyor`
          : "karşı taraf vekilsiz görünüyor",
    contribution: withCounsel.length > 0 ? 20 : opponents.length > 0 ? 5 : 0,
    explanation:
      "Vekille temsil edilen karşı taraf, usulî imkânları eksiksiz kullanır; bu bir zorluk " +
      "göstergesidir (kusur değil).",
  });
  if (opponents.length === 0) {
    warnings.push(
      "Dosyada karşı taraf kaydı yok. Karşı taraf riski eksik veriyle hesaplanmıştır; " +
        "tarafları dosyaya işleyin.",
    );
  }

  signals.push({
    key: "MULTIPLE_OPPONENTS",
    label: "Karşı taraf sayısı",
    weight: 15,
    value: `${opponents.length} karşı taraf`,
    contribution: Math.min(15, Math.max(0, opponents.length - 1) * 7),
    explanation:
      "Birden çok karşı taraf, tebligat ve usul yükünü artırır; ilk taraftan sonraki her " +
      "taraf 7 puan (azami 15).",
  });

  signals.push({
    key: "OPPONENT_OBJECTIONS",
    label: "Karşı tarafın itirazları",
    weight: 25,
    value: s.enforcement.hasOpenObjection
      ? `açık itiraz var (${s.enforcement.objectionActionCount} itiraz işlemi)`
      : s.enforcement.objectionActionCount > 0
        ? `${s.enforcement.objectionActionCount} itiraz işlemi (çözülmüş)`
        : "itiraz yok",
    contribution: s.enforcement.hasOpenObjection
      ? 25
      : Math.min(15, s.enforcement.objectionActionCount * 8),
    explanation:
      "Açık (çözülmemiş) itiraz süreci durdurur ve 25 puandır; çözülmüş her itiraz 8 puan " +
      "(azami 15) — mücadeleci bir karşı tarafın göstergesi olarak kalır.",
  });

  const last90 = s.timelineEventDates.filter((d) => days(d, s.now) <= 90).length;
  signals.push({
    key: "CASE_ACTIVITY_PRESSURE",
    label: "Son 90 gündeki safahat yoğunluğu",
    weight: 20,
    value: `${last90} kayıt`,
    contribution: Math.min(20, Math.max(0, last90 - 3) * 2),
    explanation:
      "Son 90 günde 3'ten fazla her safahat kaydı 2 puan (azami 20). YOĞUN hareket, karşı " +
      "tarafın aktif usul stratejisine işaret eder — VEKİL AKTİFLİĞİ İÇİN DOLAYLI bir " +
      "göstergedir; dosyadaki hareketin kimden geldiği ayrıştırılamadığı için tek başına " +
      "belirleyici sayılmamalıdır.",
  });

  return finalize("KARSI_TARAF", signals, warnings);
}

/** HUKUKİ RİSK — strateji zayıflıkları, aleyhe kararlar, simülasyon bulguları. */
export function computeHukuki(s: RiskCaseSnapshot): DimensionResult {
  const signals: RiskSignal[] = [];
  const warnings: string[] = [];

  const strategyContribution = !s.strategy.exists ? 25 : s.strategy.status === "BAYAT" ? 15 : 0;
  signals.push({
    key: "STRATEGY_STATE",
    label: "Strateji durumu",
    weight: 25,
    value: !s.strategy.exists ? "strateji yok" : `strateji ${s.strategy.status}`,
    contribution: strategyContribution,
    explanation:
      "Stratejisi olmayan dosya 25 puan; dosyadaki yeni gelişmeler nedeniyle BAYAT olan " +
      "strateji 15 puan. Güncel strateji puan getirmez.",
  });
  if (!s.strategy.exists) {
    warnings.push(
      "Bu dosyada strateji ağacı yok. Hukuki risk, zayıf nokta analizinden yoksun olarak " +
        "hesaplanmıştır.",
    );
  }

  signals.push({
    key: "STRATEGY_WEAK_POINTS",
    label: "Stratejide tespit edilmiş zayıf noktalar",
    weight: 30,
    value: `${s.strategy.weakPointCount} zayıf nokta`,
    contribution: Math.min(30, s.strategy.weakPointCount * 8),
    explanation:
      "Her zayıf nokta düğümü 8 puan (azami 30). Bu sinyal, zayıflığı TESPİT ETMİŞ olmayı " +
      "cezalandırmaz — riski görünür kılar; strateji hiç yoksa yukarıdaki sinyal devrededir.",
  });

  signals.push({
    key: "STRATEGY_RISK_NODES",
    label: "Stratejideki risk düğümleri",
    weight: 20,
    value: `${s.strategy.riskNodeCount} risk düğümü`,
    contribution: Math.min(20, s.strategy.riskNodeCount * 7),
    explanation: "Her risk düğümü 7 puan; azami 20 puan.",
  });

  signals.push({
    key: "SIMULATION_LOSS_FACTORS",
    label: "Son 30 gündeki simülasyon risk bulguları",
    weight: 25,
    value: `${s.recentLossFindingCount} bulgu`,
    contribution: Math.min(25, s.recentLossFindingCount * 6),
    explanation:
      "KAYBETTIREN_HUSUSLAR ve HAKIM_GOZU koşularındaki her bulgu 6 puan (azami 25). " +
      "Bulgular AI ÜRETİMİDİR ama SAYILARI deterministik bir sinyaldir: burada yorumlanmaz, " +
      "yalnızca sayılır.",
  });

  // HEPO (Modül 28 Faz 5): müvekkilin uyum fotoğrafı dosyanın hukuki konumudur —
  // iş kazası, meslek hastalığı ve İSG/çevre ceza davalarında ihlal, işverenin
  // özensizliğinin DOĞRUDAN ispat aracıdır. Yükümlülük hiç atanmamışsa puan
  // ÜRETİLMEZ (hiç atanmamış ≠ uyumlu; sinyal yalnız VAROLAN veriden türer).
  signals.push({
    key: "HEPO_CLIENT_OVERDUE",
    label: "Müvekkilin vadesi geçmiş İSG/uyum yükümlülüğü",
    weight: 20,
    value: !s.hepo.clientHasAssignments
      ? "müvekkile atanmış yükümlülük yok"
      : s.hepo.overdueOpenCount > 0
        ? `${s.hepo.overdueOpenCount} vadesi geçmiş, uyumlu işaretlenmemiş yükümlülük`
        : "vadesi geçmiş yükümlülük yok",
    contribution: s.hepo.clientHasAssignments ? Math.min(20, s.hepo.overdueOpenCount * 10) : 0,
    explanation:
      "Müvekkil şirketin vadesi geçmiş ve UYGUN işaretlenmemiş İSG/çevre/sağlık " +
      "yükümlülüğü, iş kazası ve idari ceza davalarında müvekkilin hukuki konumunu " +
      "zayıflatır; her biri 10 puan (azami 20). Veri HEPO → Müvekkil Takibi modülünden gelir.",
  });

  const adverse = s.decisions.filter((d) => {
    const outcome = (d.outcome ?? "").toLocaleLowerCase("tr-TR");
    return outcome.includes("red") || outcome.includes("ret") || outcome.includes("aleyh");
  });
  signals.push({
    key: "ADVERSE_DECISION",
    label: "Aleyhe sonuçlanan kararlar",
    weight: 20,
    value: adverse.length > 0 ? `${adverse.length} aleyhe karar` : "yok",
    contribution: Math.min(20, adverse.length * 10),
    explanation:
      "Sonuç alanında red/aleyhe ibaresi geçen her karar 10 puan (azami 20). Metin eşleşmesine " +
      "dayanır; serbest yazılan sonuç alanları gözden kaçabilir.",
  });

  return finalize("HUKUKI", signals, warnings);
}

function finalize(
  dimension: Exclude<RiskDimension, "GENEL">,
  signals: RiskSignal[],
  warnings: string[],
): DimensionResult {
  const baseScore = clamp(
    signals.reduce((acc, s) => acc + s.contribution, 0),
    0,
    100,
  );
  return { dimension, baseScore, band: bandOf(baseScore), signals, warnings };
}

/** Yedi boyutun tamamı. */
export function computeAllDimensions(s: RiskCaseSnapshot): DimensionResult[] {
  return [
    computeHukuki(s),
    computeSure(s),
    computeDelil(s),
    computeTahsilat(s),
    computeUsul(s),
    computeIctihat(s),
    computeKarsiTaraf(s),
  ];
}

/**
 * GENEL skor — YALNIZCA boyutlardan türetilir (Modül 17, iş kuralı 5).
 * Doğrudan yazılamaz ve AI ondan ayrıca düzeltme İSTENMEZ; boyutlara uygulanan
 * düzeltmelerin ağırlıklı ortalaması taşınır.
 */
export function computeGenel(
  dimensions: readonly { dimension: Exclude<RiskDimension, "GENEL">; baseScore: number }[],
  appliedAdjustments: ReadonlyMap<Exclude<RiskDimension, "GENEL">, number>,
): { baseScore: number; band: RiskBand; aiAdjustment: number; signals: RiskSignal[] } {
  const totalWeight = dimensions.reduce((acc, d) => acc + DIMENSION_WEIGHTS[d.dimension], 0);
  if (totalWeight === 0) {
    return { baseScore: 0, band: "DUSUK", aiAdjustment: 0, signals: [] };
  }

  const weightedBase = dimensions.reduce(
    (acc, d) => acc + d.baseScore * DIMENSION_WEIGHTS[d.dimension],
    0,
  );
  const weightedAdjustment = dimensions.reduce(
    (acc, d) => acc + (appliedAdjustments.get(d.dimension) ?? 0) * DIMENSION_WEIGHTS[d.dimension],
    0,
  );

  const baseScore = clamp(Math.round(weightedBase / totalWeight), 0, 100);
  const aiAdjustment = clamp(
    Math.round(weightedAdjustment / totalWeight),
    -MAX_AI_ADJUSTMENT,
    MAX_AI_ADJUSTMENT,
  );

  const signals: RiskSignal[] = dimensions.map((d) => ({
    key: `DIMENSION_${d.dimension}`,
    label: DIMENSION_LABELS[d.dimension],
    weight: DIMENSION_WEIGHTS[d.dimension],
    value: `${d.baseScore}/100 (ağırlık ${DIMENSION_WEIGHTS[d.dimension]})`,
    contribution: Math.round((d.baseScore * DIMENSION_WEIGHTS[d.dimension]) / totalWeight),
    explanation:
      "GENEL skor, yedi boyutun KURAL TABANLARININ ağırlıklı ortalamasıdır; doğrudan " +
      "yazılamaz ve AI'den ayrıca istenmez.",
  }));

  return { baseScore, band: bandOf(baseScore), aiAdjustment, signals };
}

/* ------------------------------------------------------------------ *
 * AI düzeltmesinin sınırlandırılması
 * ------------------------------------------------------------------ */

export interface AdjustmentOutcome {
  requested: number;
  applied: number;
  clamped: boolean;
  finalScore: number;
  /** BANT DAİMA KURAL TABANINDAN. */
  band: RiskBand;
  /** AI'ın işaret ettiği bant kural bandından farklıysa gösterilecek uyarı. */
  bandConflictNote: string | null;
}

/**
 * AI düzeltmesini kurala tabi kılar.
 *
 *  - Düzeltme ±MAX_AI_ADJUSTMENT ile SINIRLANIR (şema da sınırlar; burada
 *    ikinci kez uygulanır çünkü şemayı atlatan bir yol kalmamalıdır).
 *  - Nihai skor 0-100'e kırpılır.
 *  - BANT KURAL TABANINDAN gelir. Kural tabanı ile AI'nin işaret ettiği skor
 *    FARKLI bantlara düşüyorsa bant DEĞİŞMEZ; ayrım bir "dikkat" notu olarak
 *    kayda ve yanıta yazılır (Modül 17, iş kuralı 1 ve kabul kriteri 3).
 */
export function applyAiAdjustment(baseScore: number, rawAdjustment: number | undefined): AdjustmentOutcome {
  const requested = Number.isFinite(rawAdjustment) ? Math.round(rawAdjustment as number) : 0;
  const applied = clamp(requested, -MAX_AI_ADJUSTMENT, MAX_AI_ADJUSTMENT);
  const finalScore = clamp(baseScore + applied, 0, 100);
  const band = bandOf(baseScore);
  const impliedBand = bandOf(finalScore);

  return {
    requested,
    applied,
    clamped: applied !== requested,
    finalScore,
    band,
    bandConflictNote:
      impliedBand === band
        ? null
        : `DİKKAT: Kural tabanı ${baseScore} puan (${BAND_LABELS[band]} bant), yapay zekâ ` +
          `düzeltmesiyle skor ${finalScore} puana taşındı (${BAND_LABELS[impliedBand]} banda ` +
          "işaret ediyor). BANT DEĞİŞTİRİLMEDİ: bant daima deterministik kural tabanından " +
          "türer. AI'nin işaret ettiği yön bir uyarı olarak dikkate alınmalı, gerekiyorsa " +
          "gerekçeli override ile bant elle ayarlanmalıdır.",
  };
}
