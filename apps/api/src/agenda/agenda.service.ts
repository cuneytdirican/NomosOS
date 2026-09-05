/**
 * BİRLEŞİK AJANDA (Modül: kurumsal takvim).
 *
 * Dört kaynağı tek zaman çizgisinde birleştirir:
 *   DURUSMA (Hearing)      — PLANLANDI duruşmalar
 *   RANDEVU (Randevu)      — büro + portal randevuları
 *   SURE    (Deadline)     — onaylanmış, gelmemiş süreler (gün hassasiyetli)
 *   GOREV   (Task)         — açık görevlerin teslim tarihleri
 *
 * Ayrıca gösterim için RESMİ TATİL ve ADLİ TATİL günlerini döndürür
 * (legal-core tatil takvimi — süre motoruyla AYNI kaynak).
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { officialHolidaysOn, isInJudicialRecess } from "@nomosos/legal-core";
import { PrismaService } from "../prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { apiPublicUrl } from "../common/public-urls";
import { buildIcs } from "./ics";
import { relatedCaseVisibilityWhere } from "../common/case-visibility";
import type { AuthUser } from "../common/types";
import { parseDateParam, parseRangeEnd } from "../common/dates";

/** UTC gün anahtarı — YYYY-AA-GG. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type AgendaEventKind = "DURUSMA" | "RANDEVU" | "SURE" | "GOREV";

export interface AgendaEvent {
  id: string;
  kind: AgendaEventKind;
  title: string;
  /** Başlangıç (DURUSMA/RANDEVU: saatli; SURE/GOREV: gün başı) */
  date: string;
  endAt?: string;
  caseId?: string | null;
  caseTitle?: string | null;
  clientName?: string | null;
  /** GÖREV: atanan kullanıcı; DURUSMA: — */
  assigneeId?: string | null;
  assigneeName?: string | null;
  location?: string | null;
  note?: string | null;
  legalBasis?: string | null;
}

export interface AgendaDay {
  date: string;
  isOfficialHoliday: boolean;
  holidayName?: string | null;
  isJudicialRecess: boolean;
  isWeekend: boolean;
}

export interface AgendaResponse {
  from: string;
  to: string;
  events: AgendaEvent[];
  days: AgendaDay[];
  /** İstatistik: tür bazında olay sayısı. */
  counts: Record<AgendaEventKind, number>;
}

const MAX_RANGE_DAYS = 62;

/** ICS beslemesi token'ı — kiracı JWT'sinden AYRI audience; API oturumu açmaz. */
export const AGENDA_ICS_AUDIENCE = "agenda-ics";
const ICS_LOOKBACK_DAYS = 7;
/** 7 + 54 = 61 gün: `to` gün sonuna genişlediği için 62 günlük tavanın altında kalır. */
const ICS_LOOKAHEAD_DAYS = 54;

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Faz 1: kişisel ICS token'ı + abone adresi. */
  async issueFeedToken(user: AuthUser): Promise<{ token: string; url: string; expiresInDays: number }> {
    const token = await this.jwt.signAsync(
      { sub: user.userId, tenantId: user.tenantId, role: user.role },
      { audience: AGENDA_ICS_AUDIENCE, expiresIn: "365d" },
    );
    return { token, url: `${apiPublicUrl()}/api/v1/agenda/feed.ics?token=${encodeURIComponent(token)}`, expiresInDays: 365 };
  }

  /** Faz 1: token → kullanıcının ajandası (7 gün geri, 55 gün ileri) → ICS metni. */
  async feedIcs(token: string): Promise<string> {
    let payload: { sub: string; tenantId: string; role: AuthUser["role"] };
    try {
      payload = await this.jwt.verifyAsync(token, { audience: AGENDA_ICS_AUDIENCE });
    } catch {
      throw new UnauthorizedException("Takvim bağlantısı geçersiz ya da süresi dolmuş; Ajanda'dan yeni bağlantı üretin.");
    }
    const active = await this.prisma.client.user.findFirst({
      where: { id: payload.sub, tenantId: payload.tenantId, isActive: true },
      select: { id: true, role: true },
    });
    if (!active) throw new UnauthorizedException("Takvim bağlantısının sahibi artık aktif değil.");
    const user: AuthUser = { userId: active.id, tenantId: payload.tenantId, role: active.role as AuthUser["role"] };
    const now = new Date();
    const from = new Date(now.getTime() - ICS_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(now.getTime() + ICS_LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
    const agenda = await this.agenda(user, { from, to });
    return buildIcs(
      agenda.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        date: e.date,
        endAt: e.endAt,
        caseTitle: e.caseTitle ?? null,
        clientName: e.clientName ?? null,
        location: e.location ?? null,
        note: e.note ?? null,
        legalBasis: e.legalBasis ?? null,
      })),
      "NomosOS Ajanda",
      now,
    );
  }

  /**
   * GET /agenda?from=&to=&assigneeId=
   *
   * Aralık en fazla 62 gün — takvim görünümü aylık/haftalık çalışır; yıllık
   * sorgu dizilimine gerek yok, sorgu maliyeti sınırlı kalsın.
   */
  async agenda(
    user: AuthUser,
    params: { from?: string; to?: string; assigneeId?: string },
  ): Promise<AgendaResponse> {
    const from = params.from ? parseDateParam(params.from, "from") : new Date();
    const to = params.to
      ? parseRangeEnd(params.to, "to")
      : new Date(from.getTime() + 31 * 24 * 60 * 60_000);
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60_000) {
      throw new NotFoundException(`Aralık en fazla ${MAX_RANGE_DAYS} gün olabilir.`);
    }
    const tenantId = user.tenantId;
    // GİZLİ DOSYA: dosyaya bağlı ajanda kalemleri görünürlüğe tabi (AND altında).
    const visible = relatedCaseVisibilityWhere(user);
    const visibleOptional = relatedCaseVisibilityWhere(user, { optionalCase: true });

    const [hearings, randevular, deadlines, tasks] = await Promise.all([
      this.prisma.client.hearing.findMany({
        where: {
          tenantId,
          ...visible,
          date: { gte: from, lte: to },
          // Yalnız gerçekleşmemiş duruşmalar; yapılmış/iptal olanlar ajandayı şişirir.
          status: { in: ["PLANLANDI"] },
        },
        include: { case: { select: { id: true, title: true, client: { select: { name: true } } } } },
        orderBy: { date: "asc" },
        take: 500,
      }),
      this.prisma.client.randevu.findMany({
        where: {
          tenantId,
          startAt: { gte: from, lte: to },
          status: "PLANLANDI",
        },
        include: { client: { select: { name: true } } },
        orderBy: { startAt: "asc" },
        take: 500,
      }),
      this.prisma.client.deadline.findMany({
        where: {
          tenantId,
          ...visible,
          dueDate: { gte: from, lte: to },
          status: { in: ["BEKLIYOR", "ONAYLANDI"] },
        },
        include: { case: { select: { id: true, title: true, client: { select: { name: true } } } } },
        orderBy: { dueDate: "asc" },
        take: 500,
      }),
      this.prisma.client.task.findMany({
        where: {
          tenantId,
          ...visibleOptional,
          dueDate: { gte: from, lte: to },
          // tasks.service.ts ile AYNI açık görev kümesi: kontrolde / onay
          // bekliyor görevleri ajandadan düşmez (aksi hâlde incelemedeki
          // işler takvimden sessizce kayboluyordu).
          status: { in: ["ACIK", "DEVAM_EDIYOR", "KONTROLDE", "ONAY_BEKLIYOR"] },
          ...(params.assigneeId ? { assigneeId: params.assigneeId } : {}),
        },
        include: {
          assignee: { select: { id: true, fullName: true } },
          case: { select: { id: true, title: true } },
        },
        orderBy: { dueDate: "asc" },
        take: 500,
      }),
    ]);

    const events: AgendaEvent[] = [
      ...hearings.map<AgendaEvent>((h) => ({
        id: `h-${h.id}`,
        kind: "DURUSMA",
        title: h.case.title,
        date: h.date.toISOString(),
        caseId: h.caseId,
        caseTitle: h.case.title,
        clientName: h.case.client?.name ?? null,
        location: h.courtroom ?? null,
        note: h.note ?? null,
      })),
      ...randevular.map<AgendaEvent>((r) => ({
        id: `r-${r.id}`,
        kind: "RANDEVU",
        title: r.title,
        date: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        clientName: r.client?.name ?? null,
        note: r.note ?? null,
      })),
      ...deadlines.map<AgendaEvent>((d) => ({
        id: `d-${d.id}`,
        kind: "SURE",
        title: d.title,
        date: d.dueDate.toISOString(),
        caseId: d.caseId,
        caseTitle: d.case?.title ?? null,
        clientName: d.case?.client?.name ?? null,
        legalBasis: d.legalBasis ?? null,
        note: d.computeNote ?? null,
      })),
      ...tasks.map<AgendaEvent>((t) => ({
        id: `t-${t.id}`,
        kind: "GOREV",
        title: t.title,
        date: t.dueDate!.toISOString(),
        caseId: t.caseId,
        caseTitle: t.case?.title ?? null,
        assigneeId: t.assigneeId,
        assigneeName: t.assignee.fullName,
      })),
    ];
    events.sort((a, b) => a.date.localeCompare(b.date));

    // Gün meta verisi — tatil/adli tatil/hafta sonu (takvimde işaretlenir).
    const days: AgendaDay[] = [];
    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const iso = isoDay(cursor);
      const holiday = officialHolidaysOn(cursor)[0];
      days.push({
        date: iso,
        isOfficialHoliday: Boolean(holiday),
        holidayName: holiday?.name ?? null,
        isJudicialRecess: isInJudicialRecess(cursor),
        isWeekend: cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const counts: Record<AgendaEventKind, number> = {
      DURUSMA: hearings.length,
      RANDEVU: randevular.length,
      SURE: deadlines.length,
      GOREV: tasks.length,
    };

    return { from: from.toISOString(), to: to.toISOString(), events, days, counts };
  }
}
