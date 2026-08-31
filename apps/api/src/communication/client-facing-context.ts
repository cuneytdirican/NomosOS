/**
 * MÜVEKKİLE DÖNÜK DOSYA BAĞLAMI — DAR VE KAPALI BİR İZDÜŞÜM.
 *
 * Modül 19 iş kuralı 8: "Simülasyon/strateji içerikleri ve iç notlar İletişim
 * Merkezi'nden gönderilemez."
 *
 * Bunu bir `if` ile değil, TİP SİSTEMİYLE sağlıyoruz. `ClientFacingCaseInput`
 * yapısında strateji, risk skoru, simülasyon, dosya notu, karşı taraf kimliği,
 * finans satırı veya belge içeriği alanı YOKTUR. Yani bu fonksiyon, taşıyamadığı
 * veriyi sızdıramaz — çağıran yanlışlıkla bile veremez, derleme hatası alır.
 *
 * Genel `buildCaseContext` (packages/legal-ai) bilinçli olarak KULLANILMAZ: o,
 * avukata dönük görevler için tasarlanmıştır ve taraf/belge bölümleri taşır.
 * Müvekkile giden bir metnin bağlamı, müvekkilin zaten bilmeye hakkı olan
 * kadarıyla sınırlıdır: dosyanın kimliği, safahatı, duruşması ve süresi.
 *
 * SAF FONKSİYON: veritabanı okumaz, saat okumaz. Metin buradan çıktıktan sonra
 * `AiRunnerService.applyPiiGate` KVKK kapısından geçer (bkz. outbound-ai.service).
 */

export interface ClientFacingTimelineRow {
  /** ISO gün (YYYY-MM-DD). */
  date: string;
  title: string;
  detail?: string | null;
}

export interface ClientFacingHearingRow {
  /** ISO tarih-saat. */
  at: string;
  type?: string | null;
}

export interface ClientFacingDeadlineRow {
  title: string;
  /** ISO gün. */
  dueDate: string;
}

export interface ClientFacingCaseInput {
  fileNumber?: string | null;
  courtName?: string | null;
  caseType?: string | null;
  status?: string | null;
  subject?: string | null;
  /** En yeniden eskiye sıralı gelmesi beklenir. */
  timeline?: readonly ClientFacingTimelineRow[];
  hearings?: readonly ClientFacingHearingRow[];
  /** Yalnızca MÜVEKKİLİ İLGİLENDİREN süreler; iç iş takibi buraya girmez. */
  deadlines?: readonly ClientFacingDeadlineRow[];
}

export interface ClientFacingContextOptions {
  maxTimeline?: number;
  maxHearings?: number;
  maxDeadlines?: number;
  /** Üretilen metnin aşamayacağı karakter sayısı. */
  maxChars?: number;
}

export interface ClientFacingContext {
  text: string;
  /** Bütçe nedeniyle bağlama alınamayan satır sayısı — çağıran raporlar. */
  droppedRows: number;
}

const DEFAULTS = { maxTimeline: 12, maxHearings: 2, maxDeadlines: 5, maxChars: 6000 };

/**
 * Bağlam metnini kurar. Satırlar ÖNCELİK SIRASINA göre yazılır; bütçe dolduğunda
 * en düşük öncelikli satırlar düşer ve sayıları raporlanır.
 *
 * Öncelik: dosya kimliği → yaklaşan duruşma → safahat (yeniden eskiye) → süreler.
 * Duruşma safahattan önce gelir çünkü müvekkilin en çok sorduğu şey odur.
 */
export function buildClientFacingCaseContext(
  input: ClientFacingCaseInput,
  options: ClientFacingContextOptions = {},
): ClientFacingContext {
  const opts = { ...DEFAULTS, ...options };
  const lines: string[] = [];
  let dropped = 0;

  const identity = [
    input.courtName?.trim(),
    input.fileNumber?.trim(),
    input.caseType?.trim(),
    input.status?.trim() ? `Durum: ${input.status.trim()}` : undefined,
  ]
    .filter((v): v is string => Boolean(v))
    .join(" · ");
  lines.push(`[DOSYA] ${identity || "(dosya künyesi eksik)"}`);
  if (input.subject?.trim()) lines.push(`[KONU] ${input.subject.trim()}`);

  const hearings = input.hearings ?? [];
  for (const h of hearings.slice(0, opts.maxHearings)) {
    lines.push(`[DURUŞMA] ${h.at}${h.type ? ` · ${h.type}` : ""}`);
  }
  dropped += Math.max(0, hearings.length - opts.maxHearings);

  const timeline = input.timeline ?? [];
  for (const t of timeline.slice(0, opts.maxTimeline)) {
    const detail = t.detail?.trim();
    lines.push(`[SAFAHAT] ${t.date} ${t.title}${detail ? ` — ${detail}` : ""}`);
  }
  dropped += Math.max(0, timeline.length - opts.maxTimeline);

  const deadlines = input.deadlines ?? [];
  for (const d of deadlines.slice(0, opts.maxDeadlines)) {
    lines.push(`[SÜRE] ${d.dueDate} · ${d.title}`);
  }
  dropped += Math.max(0, deadlines.length - opts.maxDeadlines);

  // Karakter bütçesi: sondan (en düşük öncelikli) kırp.
  let text = lines.join("\n");
  while (text.length > opts.maxChars && lines.length > 1) {
    lines.pop();
    dropped += 1;
    text = lines.join("\n");
  }

  return { text, droppedRows: dropped };
}
