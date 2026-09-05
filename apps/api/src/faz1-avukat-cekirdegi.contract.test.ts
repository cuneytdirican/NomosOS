/**
 * FAZ 1 — AVUKAT ÇEKİRDEĞİ sözleşme testleri: OCR hattı, HEARING_PREP ucu, sorumlu
 * avukat/çakışma, ICS beslemesi, süre kural paketi + kural sürümü, kaynak belge bağı,
 * bildirim kanal tercihleri, web ekranları.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEADLINE_RULES_VERSION, SUPPORTED_HOLIDAY_YEARS, SYSTEM_DEADLINE_RULES } from "@nomosos/legal-core";

const root = join(process.cwd(), "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf-8");
const schema = read("packages", "db", "prisma", "schema.prisma");

describe("Faz 1 — OCR", () => {
  it("tesseract.js bağımlılığı; görsel ve taranmış PDF OCR'a gider; hat kuyruksuz da HTTP dışında koşar", () => {
    expect(JSON.parse(read("apps", "api", "package.json")).dependencies["tesseract.js"]).toBeTruthy();
    const te = read("apps", "api", "src", "pipeline", "text-extract.ts");
    expect(te).toContain("return extractFromImage(params.buffer);");
    expect(te).toContain("return ocrScannedPdf(buffer, parsed.numpages);");
    expect(te).toContain("UYDURMA METİN ÜRETİLMEDİ");
    const ds = read("apps", "api", "src", "documents", "documents.service.ts");
    expect(ds).toContain('status: "ARKA_PLAN"');
    expect(ds).not.toMatch(/pipeline = await this\.pipeline\.run\(/);
  });
});

describe("Faz 1 — duruşma", () => {
  it("şema: attendeeUserId + prepJson; uçlar: pending-results, :id/prep (kredi + throttle); çakışma + force", () => {
    expect(schema).toContain("attendeeUserId String?");
    expect(schema).toContain("prepJson    String?");
    const c = read("apps", "api", "src", "hearings", "hearings.controller.ts");
    expect(c).toContain('@Get("pending-results")');
    expect(c).toContain('@Post(":id/prep")');
    expect(c).toContain('@AiCredits("HEARING_PREP", { parentCaseId: { kind: "HEARING", param: "id" } })');
    const s = read("apps", "api", "src", "hearings", "hearings.service.ts");
    expect(s).toContain("assertNoAttendeeConflict(");
    expect(s).toContain("HearingPrepOutputSchema");
    expect(read("apps", "api", "src", "credits", "credit.service.ts")).toContain('case "HEARING": {');
    expect(read("packages", "shared", "src", "api-routes.ts")).toContain("/hearings/pending-results");
  });
});

describe("Faz 1 — süre kuralları + kaynak belge", () => {
  it("52 kural, sürüm damgası, tatiller 2032'ye kadar; Deadline.rulesVersion + sourceDocumentId yazılır", () => {
    expect(SYSTEM_DEADLINE_RULES).toHaveLength(52);
    expect(SUPPORTED_HOLIDAY_YEARS).toContain(2032);
    expect(DEADLINE_RULES_VERSION).toBe("2026.09");
    expect(schema).toContain("rulesVersion  String?");
    expect(schema).toContain("sourceDocumentId String?");
    const dl = read("apps", "api", "src", "deadlines", "deadlines.service.ts");
    expect(dl.match(/rulesVersion: DEADLINE_RULES_VERSION/g)?.length).toBe(2);
    expect(dl).toContain("sourceDocument: { select: { id: true, name: true } }");
    expect(read("apps", "api", "src", "documents", "proposals.service.ts")).toContain("sourceDocumentId: proposal.documentId");
  });
});

describe("Faz 1 — ICS + bildirim tercihleri + web", () => {
  it("agenda feed-token/feed.ics; preferredChannels; web: sorumlu avukat, hazırlık modalı, kaynak belge, vekaletname kartı, ICS", () => {
    const ac = read("apps", "api", "src", "agenda", "agenda.controller.ts");
    expect(ac).toContain('@Post("feed-token")');
    expect(ac).toContain('@Get("feed.ics")');
    expect(read("apps", "api", "src", "agenda", "agenda.service.ts")).toContain('AGENDA_ICS_AUDIENCE = "agenda-ics"');
    expect(read("apps", "api", "src", "scheduler", "notification-outbox.service.ts")).toContain("async preferredChannels(");
    expect(read("apps", "web", "src", "components", "hearing-modal.tsx")).toContain("attendeeUserId");
    expect(read("apps", "web", "src", "components", "hearing-prep-modal.tsx")).toContain("previous_minutes");
    const dp = read("apps", "web", "src", "app", "app", "durusmalar", "page.tsx");
    expect(dp).toContain("/hearings/pending-results");
    expect(dp).toContain("/prep");
    expect(read("apps", "web", "src", "app", "app", "sureler", "page.tsx")).toContain("sourceDocument");
    expect(read("apps", "web", "src", "app", "app", "dosyalar", "[id]", "page.tsx")).toContain("poa-status");
    expect(read("apps", "web", "src", "app", "app", "ajanda", "page.tsx")).toContain("/agenda/feed-token");
  });
});
