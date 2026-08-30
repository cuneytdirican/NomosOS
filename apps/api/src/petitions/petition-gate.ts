/**
 * TEYİT KAPISI — Modül 22'nin en sıkı iş kuralı.
 *
 * Bir dilekçe HAZIR statüsüne YALNIZCA metnindeki her atıf hesabını verdiğinde
 * geçebilir. Kapı saf fonksiyondur (yan etkisiz, test edilebilir); karar verirken
 * SADECE deterministik teyit sonuçlarına bakar, hiçbir LLM çıktısına güvenmez.
 *
 * KURALLAR
 *  1. İÇTİHAT ATFI — DOGRULANDI zorunludur. BULUNAMADI/BELIRSIZ atıf HAZIR'ı bloklar.
 *     Bu kuralın istisnası, geçersiz kılma (override) yolu YOKTUR: uydurma esas
 *     numarasının mahkemeye gitmesi ürünün asla kabul edemeyeceği hatadır.
 *  2. DEMO KAYIT — "[DEMO VERİ]" işaretli bir havuz kaydıyla eşleşen atıf,
 *     teknik olarak "bulunmuş" olsa da GERÇEK KARAR DEĞİLDİR; HAZIR'ı bloklar.
 *  3. MEVZUAT ATFI — madde metni/yürürlük havuzu (Statute*) Faz 2'de yoktur,
 *     bu yüzden deterministik olarak DOGRULANDI yapılamaz. Sessizce geçirmek
 *     (1) numaralı kuralın ruhuna aykırı olurdu; sonsuza dek bloklamak ise ürünü
 *     kullanılamaz kılardı. Çözüm: AVUKATIN AÇIK BEYANI. Avukat, HAZIR isteğinde
 *     hangi mevzuat atıflarını yürürlükteki metinden teyit ettiğini tek tek
 *     bildirir; beyan AuditLog'a yazılır ve sorumluluk kayda geçer.
 *  4. TANINMAYAN BİÇİM — ayrıştırılamayan atıf da bloklar (fail-closed).
 *
 * BAYAT TEYİT YASAĞI kapıda değil, veri modelinde çözülür: teyit sonuçları
 * CitationCheck'e dilekçe kimliğiyle değil SÜRÜM kimliğiyle yazılır. İçerik
 * değişince yeni sürüm doğar ve o sürümün hiç teyidi yoktur; kapı "teyit
 * çalıştırılmamış" diyerek bloklar.
 */

import type { CitationStatus } from "@nomosos/db";

export interface GateCitation {
  raw: string;
  kind: "ICTIHAT" | "MEVZUAT" | "TANINMADI";
  status: CitationStatus;
  isDemo: boolean;
  note: string;
}

export interface ReadyGateBlock {
  raw: string;
  kind: GateCitation["kind"];
  status: CitationStatus;
  /** Neden bloklandı — kullanıcıya gösterilir. */
  reason: string;
  /** Ne yapılmalı — kullanıcıya gösterilir. */
  remedy: string;
}

export interface ReadyGateResult {
  ok: boolean;
  total: number;
  verified: number;
  blocking: ReadyGateBlock[];
  /** Avukat beyanı bekleyen mevzuat atıfları (beyan gelirse bloklamazlar). */
  statuteDeclarationsRequired: string[];
  /** Bu istekte beyan edilip kabul edilen mevzuat atıfları (denetim kaydına yazılır). */
  statuteDeclarationsAccepted: string[];
}

/** Künye karşılaştırması için boşluk/noktalama duyarsız anahtar. */
export function citationKey(raw: string): string {
  return raw.toLocaleLowerCase("tr-TR").replace(/[\s.,;:/\\-]+/g, "");
}

export function evaluateReadyGate(
  citations: readonly GateCitation[],
  options: { declaredStatutes?: readonly string[] } = {},
): ReadyGateResult {
  const declared = new Set((options.declaredStatutes ?? []).map(citationKey));
  const blocking: ReadyGateBlock[] = [];
  const statuteDeclarationsRequired: string[] = [];
  const statuteDeclarationsAccepted: string[] = [];

  for (const citation of citations) {
    if (citation.kind === "MEVZUAT") {
      if (declared.has(citationKey(citation.raw))) {
        statuteDeclarationsAccepted.push(citation.raw);
        continue;
      }
      statuteDeclarationsRequired.push(citation.raw);
      blocking.push({
        raw: citation.raw,
        kind: citation.kind,
        status: citation.status,
        reason:
          "Mevzuat atfı sistemce doğrulanamıyor: madde metni ve yürürlük havuzu henüz yok.",
        remedy:
          "Maddeyi yürürlükteki mevzuattan kontrol edip HAZIR isteğinde " +
          "`confirmedStatuteCitations` listesine ekleyin ya da atfı metinden çıkarın.",
      });
      continue;
    }

    if (citation.kind === "TANINMADI") {
      blocking.push({
        raw: citation.raw,
        kind: citation.kind,
        status: citation.status,
        reason: "Atfın biçimi tanınmadı; doğrulanamayan atıf doğrulanmış sayılmaz.",
        remedy:
          "Künyeyi standart biçime getirin (örn. \"Yargıtay 9. HD 2023/4512 E. 2023/9981 K.\") " +
          "veya metinden çıkarın.",
      });
      continue;
    }

    // ICTIHAT
    if (citation.status !== "DOGRULANDI") {
      blocking.push({
        raw: citation.raw,
        kind: citation.kind,
        status: citation.status,
        reason:
          citation.status === "BULUNAMADI"
            ? "Bu esas/karar numarasına ait karar sistemde bulunamadı; atıf hatalı veya uydurma olabilir."
            : `Atıf kesin olarak doğrulanamadı. ${citation.note}`,
        remedy:
          "Kararı künyesiyle doğrulayıp POST /caselaw ile sisteme ekleyin, doğru künyeyle " +
          "değiştirin ya da atfı metinden çıkarın.",
      });
      continue;
    }

    if (citation.isDemo) {
      blocking.push({
        raw: citation.raw,
        kind: citation.kind,
        status: citation.status,
        reason:
          "Atıf yalnızca [DEMO VERİ] işaretli örnek kayıtla eşleşiyor; bu kayıt gerçek bir " +
          "mahkeme kararı değildir.",
        remedy: "Gerçek kararı künyesiyle sisteme ekleyin veya atfı metinden çıkarın.",
      });
    }
  }

  const verified = citations.filter((c) => c.status === "DOGRULANDI" && !c.isDemo).length;

  return {
    ok: blocking.length === 0,
    total: citations.length,
    verified,
    blocking,
    statuteDeclarationsRequired,
    statuteDeclarationsAccepted,
  };
}
