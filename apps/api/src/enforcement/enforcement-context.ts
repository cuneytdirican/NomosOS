/**
 * İCRA DOSYASI BAĞLAM KURUCU — Copilot'a giden metnin tek kaynağı.
 *
 * Neden ayrı dosya: Copilot'un altı komutu da AYNI yapılandırılmış bağlamdan
 * beslenir. Bağlam serbest metin değil, etiketli satırlardır ([TAKİP], [İŞLEM],
 * [MALVARLIĞI], [TAHSİLAT], [SÜRE]); böylece modelin "kaynak göster" kuralı
 * denetlenebilir bir şeye işaret eder ve output-guard kaynaksız bulguyu eleyebilir.
 *
 * KVKK: bu dosya MASKELEME YAPMAZ. Maskeleme, dışsallık kararıyla birlikte
 * `AiRunnerService.applyPiiGate` içinde tek noktada yapılır (dış hedef + PII +
 * onay yok → 409). Burada yalnızca "hangi alan dışarı çıkabilir" seçimi vardır:
 * borçlunun serbest metin bilgisi (`debtorInfo`) ve malvarlığı açıklamaları
 * bilinçli olarak bağlama alınır — analizin konusu onlardır — ve maskeleme
 * hattından geçerler.
 */

import type {
  AssetRecord,
  CollectionRecord,
  EnforcementAction,
  EnforcementFile,
} from "@nomosos/db";
import { formatTrDate } from "../common/dates";
import type { EnforcementBalance } from "./balance.service";
import type { RuleSignal } from "./collection-score.service";
import type { DeadlineCandidate } from "./enforcement-deadlines.service";
import { STAGE_LABELS } from "./enforcement-stage";
import { requiredMoney, money } from "./enforcement.serialize";

export interface EnforcementContextParts {
  file: EnforcementFile;
  caseInfo: { title: string; fileNumber: string | null; clientName: string | null };
  actions: EnforcementAction[];
  assets: AssetRecord[];
  collections: CollectionRecord[];
  balance: EnforcementBalance;
}

/** [TAKİP] başlığı — her komutta bulunur. */
export function buildHeader(parts: EnforcementContextParts): string {
  const { file, caseInfo, balance } = parts;
  return [
    `[TAKİP] ${file.officeName} ${file.fileNumber} · ${file.trackingType} takip · ` +
      `Aşama: ${STAGE_LABELS[file.stage]}`,
    `[TAKİP] Alacaklı müvekkil: ${caseInfo.clientName ?? "belirtilmemiş"} · Dosya: ${caseInfo.fileNumber ?? caseInfo.title}`,
    `[TAKİP] Takip talebi: ${formatTrDate(file.requestDate)} · Asıl alacak: ${requiredMoney(file.principalAmount)} ${file.currency}` +
      (file.interestRate ? ` · Faiz oranı: %${money(file.interestRate)}` : " · Faiz oranı: TANIMLI DEĞİL"),
    file.paymentOrderServedAt
      ? `[TAKİP] Ödeme emri tebliğ: ${formatTrDate(file.paymentOrderServedAt)}`
      : "[TAKİP] Ödeme emri tebliğ tarihi girilmemiş.",
    file.objectionDate ? `[TAKİP] İtiraz tarihi: ${formatTrDate(file.objectionDate)}` : "[TAKİP] Kayıtlı itiraz yok.",
    file.finalizedAt ? `[TAKİP] Kesinleşme: ${formatTrDate(file.finalizedAt)}` : undefined,
    file.debtorInfo ? `[BORÇLU] ${file.debtorInfo}` : "[BORÇLU] Borçlu bilgisi girilmemiş.",
    `[BAKİYE] Toplam borç ${balance.totalDebt} · Tahsil edilen ${balance.collected} · ` +
      `Kalan ${balance.remaining} ${balance.currency} (hesap tarihi ${formatTrDate(new Date(balance.asOf))}, ` +
      "DETERMİNİSTİK hesap — bu rakamları yeniden hesaplama).",
  ]
    .filter((v): v is string => Boolean(v))
    .join("\n");
}

export function buildActionLines(actions: EnforcementAction[], limit?: number): string {
  const list = limit ? actions.slice(0, limit) : actions;
  if (list.length === 0) return "[İŞLEM] Dosyada kayıtlı işlem yok.";
  return list
    .map(
      (a) =>
        `[İŞLEM] ${formatTrDate(a.date)} ${a.type}: ${a.description}` +
        (a.amount ? ` · Tutar: ${money(a.amount)}` : "") +
        (a.resultNote ? ` · Sonuç: ${a.resultNote}` : ""),
    )
    .join("\n");
}

export function buildAssetLines(assets: AssetRecord[]): string {
  if (assets.length === 0) {
    return "[MALVARLIĞI] Dosyada hiç malvarlığı kaydı yok (sorgu yapılmamış olabilir).";
  }
  return assets
    .map(
      (a) =>
        `[MALVARLIĞI] ${formatTrDate(a.discoveredAt)} ${a.assetType} · ${a.status} · ${a.description}` +
        (a.estimatedValue ? ` · Tahmini değer: ${money(a.estimatedValue)}` : " · Değer girilmemiş") +
        (a.note ? ` · Not: ${a.note}` : ""),
    )
    .join("\n");
}

export function buildCollectionLines(collections: CollectionRecord[]): string {
  if (collections.length === 0) return "[TAHSİLAT] Dosyada tahsilat kaydı yok.";
  return collections
    .map((c) => `[TAHSİLAT] ${formatTrDate(c.date)} ${requiredMoney(c.amount)} · ${c.method}${c.note ? ` · ${c.note}` : ""}`)
    .join("\n");
}

/**
 * Deterministik süre motoru çıktısını bağlama koyar.
 *
 * Bu blok modelin HESAPLAYACAĞI değil, YORUMLAYACAĞI veridir; başlığı da bunu
 * söyler. Modelin gün sayması yasaktır (prompt kuralı 2).
 */
export function buildDeadlineLines(
  candidates: DeadlineCandidate[],
  recorded: { title: string; dueDate: Date; status: string; legalBasis: string | null }[],
): string {
  const lines: string[] = [
    "[SÜRE] Aşağıdaki süreler DETERMİNİSTİK süre motoru tarafından hesaplanmıştır. " +
      "Gün hesabı yapma, bu tarihleri değiştirme; yalnızca risk yorumu yap.",
  ];
  if (candidates.length === 0) {
    lines.push("[SÜRE] Dosyadaki tarihlerden hesaplanabilen bir İİK süresi bulunamadı.");
  }
  for (const c of candidates) {
    lines.push(
      `[SÜRE] ${c.ruleName} (${c.legalBasis}) · tetikleyici ${c.triggerLabel} ${formatTrDate(c.triggerDate)} · ` +
        `son gün ${formatTrDate(c.dueDate)} · ${c.isOverdue ? `GEÇMİŞ (${Math.abs(c.daysRemaining)} gün önce)` : `${c.daysRemaining} gün kaldı`}` +
        (c.existingDeadlineId ? ` · dosyada kayıtlı (${c.existingStatus})` : " · DOSYADA KAYITLI DEĞİL"),
    );
  }
  for (const d of recorded) {
    lines.push(
      `[SÜRE-KAYIT] ${d.title} · son gün ${formatTrDate(d.dueDate)} · durum ${d.status}` +
        (d.legalBasis ? ` · ${d.legalBasis}` : ""),
    );
  }
  return lines.join("\n");
}

/** Kural tabanlı skor sinyallerini bağlama koyar (TAHSILAT_IHTIMALI komutu). */
export function buildSignalLines(baseScore: number, signals: RuleSignal[]): string {
  const lines = [
    `[SKOR] Kural tabanlı TABAN SKOR: ${baseScore}/100. Bu skor deterministik olarak ` +
      "hesaplanmıştır; sen bu skoru yeniden hesaplamayacaksın, yalnızca sinyalleri yorumlayacaksın.",
  ];
  for (const s of signals) {
    lines.push(
      `[SİNYAL] ${s.label} — değer: ${s.value} · katkı: ${s.contribution}/${s.weight} puan`,
    );
  }
  return lines.join("\n");
}

/** İtiraz/cevap belgelerinin metinleri (ITIRAZ_KARSILASTIRMA komutu). */
export function buildDocumentLines(
  documents: { name: string; class: string; createdAt: Date; ocrText: string | null; aiSummary: string | null }[],
  perDocumentChars: number,
): string {
  if (documents.length === 0) {
    return "[BELGE] Dosyaya bağlı, metni çıkarılmış itiraz/cevap belgesi bulunamadı.";
  }
  return documents
    .map((d) => {
      const text = (d.ocrText ?? d.aiSummary ?? "").trim();
      const body = text.length > perDocumentChars ? `${text.slice(0, perDocumentChars)}…[kesildi]` : text;
      return `[BELGE] ${formatTrDate(d.createdAt)} · ${d.class} · «${d.name}»\n${body || "(metin yok)"}`;
    })
    .join("\n---\n");
}
