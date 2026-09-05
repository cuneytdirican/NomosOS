import { describe, expect, it } from "vitest";
import { ChatCitationSchema, SourceRefSchema } from "../schemas";

describe("ChatCitationSchema — null toleransı (küçük yerel modeller)", () => {
  it("page/quote null → undefined; sayı korunur; negatif sayfa reddedilir", () => {
    expect(ChatCitationSchema.parse({ kind: "DOCUMENT", label: "x", page: null, quote: null })).toEqual({ kind: "DOCUMENT", label: "x", page: undefined, quote: undefined });
    expect(ChatCitationSchema.parse({ kind: "DOCUMENT", label: "x", page: 2, quote: "a" }).page).toBe(2);
    expect(ChatCitationSchema.safeParse({ kind: "DOCUMENT", label: "x", page: -1 }).success).toBe(false);
  });
});

describe("SourceRefSchema — null toleransı (HEARING_PREP canlı bulgusu)", () => {
  it("page/paragraph/quote/documentTitle null → undefined; geçerli değerler korunur", () => {
    expect(SourceRefSchema.parse({ documentTitle: "Fesih", page: null, paragraph: null, quote: null })).toEqual({ documentTitle: "Fesih", page: undefined, paragraph: undefined, quote: undefined, documentId: undefined });
    expect(SourceRefSchema.parse({ documentTitle: "Fesih", page: 0, quote: "x" }).page).toBe(0);
  });
});
