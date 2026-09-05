import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine } from "./ics";

describe("ICS beslemesi", () => {
  it("kaçış ve katlama RFC 5545'e uygun", () => {
    expect(escapeIcsText("a;b,c\\d\nx")).toBe("a\\;b\\,c\\\\d\\nx");
    const long = "SUMMARY:" + "ğ".repeat(60);
    const folded = foldIcsLine(long);
    expect(folded.split("\r\n").every((l, i) => (i === 0 ? Buffer.byteLength(l) <= 75 : l.startsWith(" ") && Buffer.byteLength(l) <= 75))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("duruşma saatli, süre tüm gün; UID kararlı; başlık türle öneklenir", () => {
    const ics = buildIcs(
      [
        { id: "h1", kind: "DURUSMA", title: "Demir / Öz Metal", date: "2026-10-14T07:30:00.000Z", location: "Salon 3", caseTitle: "İşe iade", clientName: "M. Demir" },
        { id: "d1", kind: "SURE", title: "İstinaf süresi son günü", date: "2026-10-20T00:00:00.000Z", legalBasis: "HMK m.345 — 2 hafta" },
      ],
      "Test",
      new Date("2026-09-05T10:00:00Z"),
    );
    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
    expect(ics).toContain("UID:durusma-h1@nomosos");
    expect(ics).toContain("DTSTART:20261014T073000Z");
    expect(ics).toContain("DTEND:20261014T083000Z");
    expect(ics).toContain("SUMMARY:Duruşma: Demir / Öz Metal");
    expect(ics).toContain("LOCATION:Salon 3");
    expect(ics).toContain("DESCRIPTION:Dosya: İşe iade\\nMüvekkil: M. Demir");
    expect(ics).toContain("UID:sure-d1@nomosos");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261020");
    expect(ics).toContain("DTEND;VALUE=DATE:20261021");
    expect(ics).toContain("DTSTAMP:20260905T100000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
