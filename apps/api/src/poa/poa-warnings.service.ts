/**
 * VEKALETNAME UYARILARI — HESAP DETERMİNİSTİKTİR, AI YOKTUR.
 *
 * Dört uyarı üretilir:
 *   1. SURE_YAKLASIYOR  — `expiresAt` eşik gün içinde (varsayılan 30).
 *   2. SURESI_DOLDU     — `expiresAt` geçmiş ama kayıt hâlâ aktif görünüyor.
 *   3. AZLEDILDI        — azil/istifa girilmiş, bağlı DERDEST dosya var.
 *   4. VEKALETSIZ_DOSYA — açık dosya var ama müvekkilin geçerli vekaletnamesi yok.
 *
 * ── NEDEN `Deadline` ÜRETİLMİYOR ────────────────────────────────────────────
 * `Deadline.caseId` ZORUNLUDUR (şema). Vekaletnamelerin çoğu bir dosyaya değil
 * MÜVEKKİLE bağlıdır; dosyasız bir vekaletname için süre kaydı açmak, kaydı
 * rastgele bir dosyaya iliştirmek demektir. Bu yüzden burada üretilen şey bir
 * UYARI LİSTESİDİR; takvimi kirletmez, hak düşürücü süre görüntüsü vermez.
 * Avukat isterse mevcut `POST /deadlines` ucundan kendi kaydını açar.
 *
 * ── GÜN HESABI ──────────────────────────────────────────────────────────────
 * Kalan gün `@nomosos/legal-core`in `diffDays` + `toUtcDate` fonksiyonlarıyla
 * UTC GÜN BAZINDA hesaplanır. Saat/zaman dilimi aritmetiği YAPILMAZ: 23:30'da
 * bakan avukatla 00:30'da bakan avukat aynı sayıyı görür.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { diffDays, formatTrDate, toUtcDate } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { startOfDay } from "../common/dates";
import type { AuthUser } from "../common/types";
import { parseScopeItems } from "./poa-scope-catalog";

/** Uyarı üretilecek varsayılan eşik (gün). */
export const DEFAULT_WARNING_WINDOW_DAYS = 30;
/** Spec'te sayılan uyarı basamakları — arayüz rozetlerinin sınırları. */
export const WARNING_STEPS = [30, 7, 1] as const;
/** Uyarı listesinde gösterilecek azami kayıt (her tür için). */
const MAX_ROWS = 200;

/** Dosyanın "hâlâ yürüyor" sayıldığı durumlar. */
const OPEN_CASE_STATUSES = [
  "ACIK",
  "DERDEST",
  "KARAR",
  "ISTINAF",
  "TEMYIZ",
  "ICRADA",
] as const;

export type PoaWarningKind =
  | "SURE_YAKLASIYOR"
  | "SURESI_DOLDU"
  | "AZLEDILDI"
  | "VEKALETSIZ_DOSYA";

export type PoaWarningSeverity = "DUSUK" | "ORTA" | "YUKSEK" | "KRITIK";

export interface PoaWarning {
  kind: PoaWarningKind;
  severity: PoaWarningSeverity;
  powerOfAttorneyId: string | null;
  clientId: string;
  clientName: string;
  /** Uyarının ilgilendirdiği dosyalar (varsa). */
  cases: { id: string; fileNumber: string | null; title: string; status: string }[];
  /** Kalan gün — negatifse süre geçmiş. Süresiz vekaletnamede `null`. */
  daysRemaining: number | null;
  expiresAt: Date | null;
  message: string;
  /** Hesabın nasıl yapıldığı — şeffaflık (AI kullanılmadığının kaydı). */
  computeNote: string;
}

@Injectable()
export class PoaWarningsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /power-of-attorney/warnings
   *
   * @param windowDays Kaç gün içinde dolacaklar listelensin (1-365).
   */
  async list(user: AuthUser, windowDays = DEFAULT_WARNING_WINDOW_DAYS): Promise<{
    generatedAt: Date;
    windowDays: number;
    steps: readonly number[];
    deterministic: true;
    counts: Record<PoaWarningKind, number>;
    warnings: PoaWarning[];
  }> {
    const window = Math.min(365, Math.max(1, Math.trunc(windowDays) || DEFAULT_WARNING_WINDOW_DAYS));
    const today = startOfDay(new Date());
    const warnings: PoaWarning[] = [];

    // ── 1 + 2: süreli vekaletnameler ────────────────────────────────────────
    const dated = await this.prisma.client.powerOfAttorney.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        revokedAt: null,
        expiresAt: { not: null },
      },
      orderBy: { expiresAt: "asc" },
      take: MAX_ROWS,
      select: {
        id: true,
        clientId: true,
        expiresAt: true,
        number: true,
        notary: true,
        client: { select: { name: true } },
        case: { select: { id: true, fileNumber: true, title: true, status: true } },
      },
    });

    for (const poa of dated) {
      if (!poa.expiresAt) continue;
      const remaining = diffDays(toUtcDate(today), toUtcDate(poa.expiresAt));
      const cases = poa.case ? [poa.case] : [];
      const label = poa.number ? `${poa.notary ?? "Noter"} · yevmiye ${poa.number}` : "Vekaletname";

      if (remaining < 0) {
        warnings.push({
          kind: "SURESI_DOLDU",
          severity: "KRITIK",
          powerOfAttorneyId: poa.id,
          clientId: poa.clientId,
          clientName: poa.client.name,
          cases,
          daysRemaining: remaining,
          expiresAt: poa.expiresAt,
          message:
            `${poa.client.name} adına düzenlenen vekaletnamenin süresi ` +
            `${formatTrDate(poa.expiresAt)} tarihinde DOLDU (${Math.abs(remaining)} gün önce). ` +
            "Kayıt hâlâ aktif görünüyor; yenileme alınmadıysa bu vekaletnameye dayanan " +
            "işlem yapılmamalıdır.",
          computeNote: this.note(today, poa.expiresAt, remaining, label),
        });
        continue;
      }

      if (remaining <= window) {
        warnings.push({
          kind: "SURE_YAKLASIYOR",
          severity: remaining <= 1 ? "KRITIK" : remaining <= 7 ? "YUKSEK" : "ORTA",
          powerOfAttorneyId: poa.id,
          clientId: poa.clientId,
          clientName: poa.client.name,
          cases,
          daysRemaining: remaining,
          expiresAt: poa.expiresAt,
          message:
            `${poa.client.name} adına düzenlenen vekaletnamenin süresi ` +
            `${formatTrDate(poa.expiresAt)} tarihinde doluyor (${remaining} gün kaldı). ` +
            "Yenileme için müvekkille iletişime geçin.",
          computeNote: this.note(today, poa.expiresAt, remaining, label),
        });
      }
    }

    // ── 3: azledilmiş/istifa edilmiş vekaletnameler ─────────────────────────
    const revoked = await this.prisma.client.powerOfAttorney.findMany({
      where: { tenantId: user.tenantId, revokedAt: { not: null } },
      orderBy: { revokedAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true,
        clientId: true,
        revokedAt: true,
        revokeReason: true,
        client: { select: { name: true } },
        case: { select: { id: true, fileNumber: true, title: true, status: true } },
      },
    });

    // AÇIK DOSYALAR TEK SORGUDA ÇEKİLİR. Azil kaydı başına ayrı sorgu koşmak,
    // 200 azilli bir büroda 200 sorgu demekti (N+1).
    const openByClient = await this.openCasesByClient(
      user.tenantId,
      [...new Set(revoked.map((p) => p.clientId))],
    );

    for (const poa of revoked) {
      // Azil yalnızca AÇIK bir dosyayı etkiliyorsa uyarı üretilir; kapanmış
      // dosyada azil bir tarihsel kayıttır, eyleme çağrı değildir.
      const openCases = openByClient.get(poa.clientId) ?? [];
      if (openCases.length === 0) continue;
      warnings.push({
        kind: "AZLEDILDI",
        severity: "KRITIK",
        powerOfAttorneyId: poa.id,
        clientId: poa.clientId,
        clientName: poa.client.name,
        cases: openCases,
        daysRemaining: null,
        expiresAt: null,
        message:
          `${poa.client.name} vekaletnamesi ` +
          `${poa.revokedAt ? formatTrDate(poa.revokedAt) : "-"} tarihinde sonlandırıldı ` +
          `(${poa.revokeReason ?? "gerekçe girilmemiş"}). Müvekkilin ${openCases.length} ` +
          "açık dosyası var; geçerli bir vekaletname alınmadan işlem yapılmamalıdır.",
        computeNote:
          "Azil/istifa kaydı ile müvekkilin açık dosyaları eşleştirildi. " +
          "Hesap deterministiktir; yapay zekâ kullanılmamıştır.",
      });
    }

    // ── 4: vekaletnamesi olmayan açık dosyalar ──────────────────────────────
    warnings.push(...(await this.casesWithoutActivePoa(user)));

    const counts: Record<PoaWarningKind, number> = {
      SURE_YAKLASIYOR: 0,
      SURESI_DOLDU: 0,
      AZLEDILDI: 0,
      VEKALETSIZ_DOSYA: 0,
    };
    for (const w of warnings) counts[w.kind] += 1;

    const order: Record<PoaWarningSeverity, number> = { KRITIK: 0, YUKSEK: 1, ORTA: 2, DUSUK: 3 };
    warnings.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      generatedAt: new Date(),
      windowDays: window,
      steps: WARNING_STEPS,
      /** Bu listede AI YOKTUR — arayüz "öneri" şeridi göstermez. */
      deterministic: true,
      counts,
      warnings,
    };
  }

  /**
   * Tek bir dosyanın vekalet durumu — dosya ekranındaki uyarı bandının kaynağı.
   * GET /cases/:caseId/poa-status
   */
  async caseStatus(user: AuthUser, caseId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true, clientId: true, type: true, status: true, fileNumber: true, title: true },
    });
    // Başka kiracının dosyası da buradan 404 döner (varlık sızdırılmaz).
    if (!found) throw new NotFoundException("Dosya bulunamadı.");

    const today = startOfDay(new Date());
    const all = await this.prisma.client.powerOfAttorney.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: found.clientId,
        OR: [{ caseId }, { caseId: null }],
      },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        caseId: true,
        type: true,
        notary: true,
        number: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
        isActive: true,
        scopeItemsJson: true,
      },
    });

    const rows = all.map((p) => {
      const remaining =
        p.expiresAt === null ? null : diffDays(toUtcDate(today), toUtcDate(p.expiresAt));
      const expired = remaining !== null && remaining < 0;
      return {
        ...p,
        scopeItems: parseScopeItems(p.scopeItemsJson).items,
        daysRemaining: remaining,
        /** Kullanılabilirlik TEK YERDE hesaplanır: azil yok + süre dolmamış + aktif. */
        usable: p.isActive && p.revokedAt === null && !expired,
        /** Dosyaya doğrudan bağlı mı, yoksa müvekkil geneli mi. */
        scopedToCase: p.caseId === caseId,
      };
    });

    const usable = rows.filter((r) => r.usable);
    return {
      case: found,
      /** Dosyanın vekalet durumu: en iyi aktif bağdan türetilir. */
      hasValidPoa: usable.length > 0,
      banner:
        usable.length > 0
          ? null
          : rows.length === 0
            ? "Bu dosyada kayıtlı vekaletname yok. Vekaletname olmadan yapılan işlem usul riski doğurur."
            : "Bu dosyaya bağlanabilecek GEÇERLİ vekaletname yok (azledilmiş veya süresi dolmuş). " +
              "İşlem yapmadan önce yeni vekaletname alın.",
      powerOfAttorneys: rows,
      deterministic: true,
    };
  }

  /** Verilen müvekkillerin açık dosyaları — TEK sorgu, müvekkil bazında gruplu. */
  private async openCasesByClient(tenantId: string, clientIds: string[]) {
    const map = new Map<string, { id: string; fileNumber: string | null; title: string; status: string }[]>();
    if (clientIds.length === 0) return map;

    const rows = await this.prisma.client.case.findMany({
      where: { tenantId, clientId: { in: clientIds }, status: { in: [...OPEN_CASE_STATUSES] } },
      orderBy: { openedAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, clientId: true, fileNumber: true, title: true, status: true },
    });
    for (const r of rows) {
      const list = map.get(r.clientId) ?? [];
      // Müvekkil başına gösterilecek dosya sayısı sınırlıdır (uyarı metni
      // okunabilir kalsın).
      if (list.length < 25) {
        list.push({ id: r.id, fileNumber: r.fileNumber, title: r.title, status: r.status });
      }
      map.set(r.clientId, list);
    }
    return map;
  }

  /**
   * Açık dosyası olup GEÇERLİ vekaletnamesi bulunmayan müvekkiller.
   *
   * "Geçerli" = aktif + azledilmemiş + (süresiz veya süresi dolmamış).
   * Süre karşılaştırması SORGUDA yapılır, bellekte değil: binlerce dosyalı
   * bir büroda tüm vekaletnameleri çekip elemek kabul edilemez.
   */
  private async casesWithoutActivePoa(user: AuthUser): Promise<PoaWarning[]> {
    const today = startOfDay(new Date());

    const openCases = await this.prisma.client.case.findMany({
      where: { tenantId: user.tenantId, status: { in: [...OPEN_CASE_STATUSES] } },
      orderBy: { openedAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true,
        clientId: true,
        fileNumber: true,
        title: true,
        status: true,
        client: { select: { name: true } },
      },
    });
    if (openCases.length === 0) return [];

    const clientIds = [...new Set(openCases.map((c) => c.clientId))];
    const valid = await this.prisma.client.powerOfAttorney.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: { in: clientIds },
        isActive: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gte: today } }],
      },
      select: { clientId: true },
    });
    const covered = new Set(valid.map((p) => p.clientId));

    const byClient = new Map<string, typeof openCases>();
    for (const c of openCases) {
      if (covered.has(c.clientId)) continue;
      const list = byClient.get(c.clientId) ?? [];
      list.push(c);
      byClient.set(c.clientId, list);
    }

    return [...byClient.entries()].map(([clientId, cases]) => ({
      kind: "VEKALETSIZ_DOSYA" as const,
      severity: "YUKSEK" as const,
      powerOfAttorneyId: null,
      clientId,
      clientName: cases[0].client.name,
      cases: cases.map((c) => ({
        id: c.id,
        fileNumber: c.fileNumber,
        title: c.title,
        status: c.status,
      })),
      daysRemaining: null,
      expiresAt: null,
      message:
        `${cases[0].client.name} müvekkilinin ${cases.length} açık dosyası var ancak ` +
        "kayıtlı geçerli vekaletnamesi bulunmuyor. Vekaletnameyi tarayıp sisteme ekleyin.",
      computeNote:
        "Açık dosyalar ile aktif, azledilmemiş ve süresi dolmamış vekaletnameler " +
        "müvekkil bazında eşleştirildi. Hesap deterministiktir; yapay zekâ kullanılmamıştır.",
    }));
  }

  private note(today: Date, expiresAt: Date, remaining: number, label: string): string {
    return (
      `${label}\n` +
      `Bugün: ${formatTrDate(today)} · Bitiş: ${formatTrDate(expiresAt)}\n` +
      `Kalan gün = ${remaining} (UTC gün farkı, @nomosos/legal-core).\n` +
      `Uyarı basamakları: ${WARNING_STEPS.join("/")} gün. ` +
      "Hesap DETERMİNİSTİKTİR; yapay zekâ kullanılmamıştır."
    );
  }
}
