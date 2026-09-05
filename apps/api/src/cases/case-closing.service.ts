/**
 * FAZ 7G — DOSYA KAPANIŞ KONTROL LİSTESİ.
 *
 * İki katman: (1) SİSTEM kalemleri veriden hesaplanır (açık süre/görev, ödenmemiş fatura,
 * faturalanmamış onaylı zaman, açık müvekkil isteği, iadesi bekleyen avans gideri, geçerli
 * vekâlet); (2) MANUEL kalemler avukat işaretler (belge iadesi tutanağı, azil/istifa bildirimi,
 * müvekkil kapanış bilgilendirmesi, arşiv). `readyToClose` ikisi de tamamsa true; kapatma kararı
 * yine avukatındır (`changeStatus` açık süre/görevi zaten engeller; `force` ONAY rolünde).
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import { caseVisibilityWhere } from "../common/case-visibility";
import type { AuthUser } from "../common/types";

export const MANUAL_CLOSING_ITEMS = [
  { key: "BELGE_IADESI", label: "Asıl belgeler müvekkile tutanakla iade edildi" },
  { key: "AZIL_ISTIFA", label: "Vekâlet ilişkisi sonlandı (azil/istifa/ibra) — gerekliyse mahkemeye bildirildi" },
  { key: "MUVEKKIL_BILGILENDIRME", label: "Müvekkile kapanış bilgilendirmesi yapıldı (sonuç, tahsilat, kalan iş)" },
  { key: "KARSI_VEKALET_UCRETI", label: "Karşı vekâlet ücreti / yargılama gideri takibi sonuçlandı" },
  { key: "ARSIV", label: "Dosya arşiv kutusuna kaldırıldı (kutu numarası yazıldı); KVKK saklama süresi not edildi" },
] as const;
export type ManualClosingKey = (typeof MANUAL_CLOSING_ITEMS)[number]["key"];

export const closingChecklistSchema = z.object({
  items: z.array(z.object({ key: z.enum(MANUAL_CLOSING_ITEMS.map((i) => i.key) as [ManualClosingKey, ...ManualClosingKey[]]), done: z.boolean(), note: z.string().trim().max(500).nullable().optional() })).max(20),
  archiveBoxNo: z.string().trim().max(60).nullable().optional(),
});
export type ClosingChecklistInput = z.infer<typeof closingChecklistSchema>;

interface ManualState {
  [key: string]: { done: boolean; note: string | null; at: string | null; by: string | null };
}

function parseManual(json: string | null): ManualState {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as ManualState;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

@Injectable()
export class CaseClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async checklist(user: AuthUser, caseId: string) {
    const c = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId, ...caseVisibilityWhere(user) },
      select: { id: true, title: true, status: true, closedAt: true, closingChecklistJson: true, archiveBoxNo: true, clientId: true },
    });
    if (!c) throw new NotFoundException("Dosya bulunamadı.");
    const tenantId = user.tenantId;
    const db = this.prisma.client;
    const [openDeadlines, openTasks, unpaidInvoices, unbilledMinutes, openTodos, refundableExpenses, usablePoa] = await Promise.all([
      db.deadline.count({ where: { tenantId, caseId, status: { in: ["BEKLIYOR", "ONAYLANDI"] } } }),
      db.task.count({ where: { tenantId, caseId, status: { notIn: ["TAMAMLANDI", "IPTAL"] } } }),
      // Fatura dosyaya değil müvekkile bağlıdır; dosyanın finans hareketleri hangi faturalara gittiyse onlar sayılır.
      db.financialEntry
        .findMany({ where: { tenantId, caseId, invoiceId: { not: null } }, select: { invoiceId: true }, distinct: ["invoiceId"] })
        .then((rows) => db.invoice.count({ where: { tenantId, id: { in: rows.map((r) => r.invoiceId as string) }, status: { notIn: ["ODENDI", "IPTAL", "TASLAK"] } } })),
      db.timeEntry.aggregate({ where: { tenantId, caseId, invoiceId: null, billable: true, status: "ONAYLANDI" }, _sum: { minutes: true } }),
      db.portalTodo.count({ where: { tenantId, caseId, status: "ACIK" } }),
      db.caseExpense.count({ where: { tenantId, caseId, refundable: true, paidAt: null } }),
      db.powerOfAttorney.count({ where: { tenantId, clientId: c.clientId, isActive: true, revokedAt: null, OR: [{ caseId }, { caseId: null }] } }),
    ]);
    const auto = [
      { key: "ACIK_SURE", label: "Açık süre yok", ok: openDeadlines === 0, count: openDeadlines, hint: "Süreler sekmesi — tamamlayın ya da iptal edin." },
      { key: "ACIK_GOREV", label: "Açık görev yok", ok: openTasks === 0, count: openTasks, hint: "Görevler sekmesi." },
      { key: "ODENMEMIS_FATURA", label: "Ödenmemiş fatura yok", ok: unpaidInvoices === 0, count: unpaidInvoices, hint: "Faturalar — tahsilat ya da iptal." },
      { key: "FATURALANMAMIS_ZAMAN", label: "Faturalanmamış onaylı zaman kaydı yok", ok: (unbilledMinutes._sum.minutes ?? 0) === 0, count: unbilledMinutes._sum.minutes ?? 0, hint: "Zaman kayıtlarından fatura oluşturun (dakika)." },
      { key: "MUVEKKIL_ISTEGI", label: "Müvekkilden bekleyen istek yok", ok: openTodos === 0, count: openTodos, hint: "Müvekkil kartı → Portal → istekler." },
      { key: "AVANS_IADESI", label: "İadesi bekleyen gider avansı yok", ok: refundableExpenses === 0, count: refundableExpenses, hint: "Giderler sekmesi — iade/ödendi işaretleyin." },
      { key: "VEKALET", label: usablePoa > 0 ? "Geçerli vekâlet kayıtlı (kapanışta azil/ibra düşünün)" : "Geçerli vekâlet yok", ok: true, count: usablePoa, hint: "Vekaletname sekmesi." },
    ];
    const manualState = parseManual(c.closingChecklistJson);
    const manual = MANUAL_CLOSING_ITEMS.map((m) => ({ key: m.key, label: m.label, done: manualState[m.key]?.done === true, note: manualState[m.key]?.note ?? null, at: manualState[m.key]?.at ?? null, by: manualState[m.key]?.by ?? null }));
    const autoOk = auto.every((a) => a.ok);
    const manualOk = manual.every((m) => m.done);
    return {
      caseId: c.id,
      status: c.status,
      closedAt: c.closedAt,
      archiveBoxNo: c.archiveBoxNo,
      auto,
      manual,
      readyToClose: autoOk && manualOk,
      summary: `${auto.filter((a) => !a.ok).length} sistem engeli · ${manual.filter((m) => !m.done).length} manuel kalem açık`,
    };
  }

  async save(user: AuthUser, caseId: string, input: ClosingChecklistInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "kapanış kontrol listesi");
    const c = await this.prisma.client.case.findFirst({ where: { id: caseId, tenantId: user.tenantId }, select: { id: true, closingChecklistJson: true } });
    if (!c) throw new NotFoundException("Dosya bulunamadı.");
    const state = parseManual(c.closingChecklistJson);
    const now = new Date().toISOString();
    for (const it of input.items) {
      const prev = state[it.key];
      state[it.key] = { done: it.done, note: it.note ?? prev?.note ?? null, at: prev?.done === it.done && prev?.at ? prev.at : now, by: user.userId };
    }
    await this.prisma.client.case.update({
      where: { id: c.id },
      data: { closingChecklistJson: JSON.stringify(state), ...(input.archiveBoxNo !== undefined ? { archiveBoxNo: input.archiveBoxNo ?? null } : {}) },
    });
    await this.audit.log({ tenantId: user.tenantId, userId: user.userId, action: "CASE_CLOSING_CHECKLIST", entity: "Case", entityId: c.id, detail: input.items.map((i) => `${i.key}=${i.done ? "✓" : "✗"}`).join(" ") + (input.archiveBoxNo ? ` · arşiv ${input.archiveBoxNo}` : "") });
    return this.checklist(user, caseId);
  }
}
