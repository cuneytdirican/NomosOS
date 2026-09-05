/**
 * Duruşma — Faz 1: sorumlu avukat doğrulaması, ±2 saat çakışma (409 / force),
 * sonucu girilmemiş duruşmalar, HEARING_PREP koşusu (LLM sahte) ve prepJson kaydı.
 */
import { describe, expect, it, vi } from "vitest";
import { HearingsService } from "./hearings.service";

const user = { userId: "u1", tenantId: "t1", role: "AVUKAT" as const };
const H = 3_600_000;

function build(opts: { existing?: any[]; users?: string[] } = {}) {
  const hearings: any[] = opts.existing ?? [];
  const prisma = {
    client: {
      case: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id, tenantId: "t1", title: "Dosya", fileNumber: "2026/1", responsibleUserId: null })) },
      user: { findFirst: vi.fn(async ({ where }: any) => ((opts.users ?? ["u1", "u2"]).includes(where.id) ? { id: where.id } : null)) },
      hearing: {
        findFirst: vi.fn(async ({ where, include }: any) => {
          // çakışma sorgusu (attendeeUserId + date aralığı) ya da tekil (id)
          if (where.attendeeUserId) {
            const hit = hearings.find(
              (h) =>
                h.attendeeUserId === where.attendeeUserId &&
                h.status !== "IPTAL" &&
                (!where.id || h.id !== where.id.not) &&
                h.date.getTime() >= where.date.gte.getTime() &&
                h.date.getTime() <= where.date.lte.getTime(),
            );
            return hit ? { ...hit, case: { title: "Diğer dosya", fileNumber: "2026/9", courtName: "Ankara 7. İş" } } : null;
          }
          if (where.id) {
            const h = hearings.find((x) => x.id === where.id);
            return h ? (include ? { ...h, case: { id: h.caseId, title: "Dosya", fileNumber: "2026/1", courtName: "Ankara 7. İş" } } : h) : null;
          }
          return null; // aynı gün mükerrer kontrolü
        }),
        findMany: vi.fn(async ({ where }: any) => hearings.filter((h) => h.status === where.status && h.date < where.date.lt)),
        create: vi.fn(async ({ data }: any) => {
          const h = { id: `h${hearings.length + 1}`, ...data };
          hearings.push(h);
          return { ...h, case: {}, attendee: null };
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(hearings.find((h) => h.id === where.id) ?? {}, data)),
      },
      timelineEvent: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: any) => fn(prisma.client)),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const llm = { runTask: vi.fn() };
  const contextBuilder = { buildFor: vi.fn(async () => ({ caseTitle: "Dosya", caseFileNumber: "2026/1", built: { text: "BAĞLAM", policyOverrides: [] } })) };
  const retrieval = { retrieveContext: vi.fn(async () => ({ mode: "EMBEDDING", chunks: [{ sourceLabel: "Fesih", documentId: "d1", content: "..." }] })) };
  const svc = new HearingsService(prisma as any, audit as any, llm as any, contextBuilder as any, retrieval as any);
  return { svc, prisma, audit, llm, hearings };
}

vi.mock("../common/case-denormals", () => ({ refreshCaseDenormals: vi.fn(async () => undefined) }));

const future = (h: number) => new Date(Date.now() + 10 * 24 * H + h * H);

describe("HearingsService — Faz 1", () => {
  it("sorumlu avukat büroda aktif olmalı; çakışma ±2 saat → 409; force ile geçer; farklı avukat serbest", async () => {
    const { svc, hearings } = build({ existing: [{ id: "h0", caseId: "c9", attendeeUserId: "u2", date: future(0), status: "PLANLANDI" }] });
    const base = { caseId: "c1", type: "DURUSMA" as const, status: "PLANLANDI" as const };
    await expect(svc.create(user, { ...base, date: future(1), attendeeUserId: "u-yok" } as any)).rejects.toThrow(/aktif bir kullanıcı/);
    await expect(svc.create(user, { ...base, date: future(1), attendeeUserId: "u2" } as any)).rejects.toThrow(/Çakışma/);
    await expect(svc.create(user, { ...base, date: future(3), attendeeUserId: "u2" } as any)).resolves.toBeTruthy();
    await expect(svc.create(user, { ...base, date: future(1), attendeeUserId: "u2", force: true } as any)).resolves.toBeTruthy();
    await expect(svc.create(user, { ...base, date: future(1), attendeeUserId: "u1" } as any)).resolves.toBeTruthy();
    expect(hearings.filter((h) => h.attendeeUserId === "u2")).toHaveLength(3);
  });

  it("update: force/attendeeUserId veri olarak yazılmaz; avukat değişince çakışma bakılır", async () => {
    const { svc, prisma } = build({
      existing: [
        { id: "h0", caseId: "c9", attendeeUserId: "u2", date: future(0), status: "PLANLANDI", preparedAt: null },
        { id: "h1", caseId: "c1", attendeeUserId: null, date: future(1), status: "PLANLANDI", preparedAt: null },
      ],
    });
    await expect(svc.update(user, "h1", { attendeeUserId: "u2" } as any)).rejects.toThrow(/Çakışma/);
    await svc.update(user, "h1", { attendeeUserId: "u2", force: true } as any);
    const data = (prisma.client.hearing.update as any).mock.calls.at(-1)[0].data;
    expect(data.attendeeUserId).toBe("u2");
    expect("force" in data).toBe(false);
  });

  it("pendingResults: tarihi geçmiş PLANLANDI kayıtlar", async () => {
    const past = new Date(Date.now() - 2 * 24 * H);
    const { svc } = build({ existing: [{ id: "a", status: "PLANLANDI", date: past }, { id: "b", status: "YAPILDI", date: past }, { id: "c", status: "PLANLANDI", date: future(1) }] });
    const r = await svc.pendingResults("t1", user);
    expect(r.items.map((i: any) => i.id)).toEqual(["a"]);
  });

  it("prepare: HEARING_PREP koşusu → prepJson + preparedAt yazılır, kaynaksız bölümler uyarı olur", async () => {
    const { svc, llm, hearings, audit } = build({ existing: [{ id: "h1", caseId: "c1", attendeeUserId: null, date: future(1), status: "PLANLANDI", type: "DURUSMA", note: "Bilirkişi raporu" }] });
    const section = (noData: boolean, refs: unknown[]) => ({ content: noData ? "" : "x", bullets: [], sourceRefs: refs, noData });
    const data = {
      sections: {
        case_summary: section(false, [{ documentTitle: "Fesih" }]),
        recent_events: section(false, []),
        opponent_last_statement: section(true, []),
        last_decision: section(false, [{ documentTitle: "Safahat" }]),
        missing_evidence: section(false, [{ documentTitle: "Delil" }]),
        questions_to_ask: section(false, [{ documentTitle: "Fesih" }]),
        points_to_raise: section(false, [{ documentTitle: "Fesih" }]),
        deadlines: section(false, [{ documentTitle: "Süre" }]),
        previous_minutes: section(true, []),
      },
    };
    llm.runTask.mockResolvedValue({ data, model: "gemma", advisory: { isAdvisory: true, notice: "n" } });
    const r = await svc.prepare(user, "h1", {});
    expect(llm.runTask).toHaveBeenCalledWith(expect.objectContaining({ logTaskType: "HEARING_PREP", routeKeys: ["HEARING_PREP", "CASE_FULL_ANALYSIS", "CASE_CHAT"] }));
    expect(r.warnings[0]).toContain("recent_events");
    expect(JSON.parse(hearings[0].prepJson).sections.case_summary.content).toBe("x");
    expect(hearings[0].preparedAt).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "HEARING_PREP" }));
    await expect(svc.prepare({ ...user, role: "SEKRETER" }, "h1", {})).rejects.toThrow();
  });
});
