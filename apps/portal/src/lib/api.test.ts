import { describe, expect, it } from "vitest";
import { asList, buildUrl, toStoredUser } from "./api";
import { CASE_STATUS_PLAIN, CASE_STATUS_TONES } from "./labels";

describe("portal api yardımcıları", () => {
  it("toStoredUser: /auth/me (client nesnesi) ve giriş (düz alanlar) aynı yapıya iner", () => {
    expect(toStoredUser({ id: "p1", client: { id: "c1", name: "ABC Holding" }, officeName: "Demo Hukuk" })).toEqual({
      id: "p1",
      email: undefined,
      fullName: undefined,
      clientId: "c1",
      clientName: "ABC Holding",
      tenantName: "Demo Hukuk",
    });
    expect(toStoredUser({ clientId: "c2", clientName: "X", tenantName: "Y" })).toMatchObject({ clientId: "c2", clientName: "X", tenantName: "Y" });
  });

  it("buildUrl: portal öneki + boş sorgu parametreleri düşer", () => {
    const url = buildUrl("/cases", { page: 2, status: "", q: undefined as unknown as string });
    expect(url).toMatch(/\/portal\/cases\?page=2$/);
    expect(buildUrl("/me")).toMatch(/\/portal\/me$/);
  });

  it("asList: dizi, {items}, {data}, boş", () => {
    expect(asList([1, 2])).toEqual([1, 2]);
    expect(asList({ items: ["a"] })).toEqual(["a"]);
    expect(asList({ data: [{ x: 1 }] })).toEqual([{ x: 1 }]);
    expect(asList({ nope: 1 })).toEqual([]);
    expect(asList(null)).toEqual([]);
  });

  it("dosya durumu etiketleri sade Türkçe ve her etiketin tonu var", () => {
    for (const key of Object.keys(CASE_STATUS_PLAIN)) {
      expect(CASE_STATUS_PLAIN[key]).not.toMatch(/[A-Z_]{4,}/); // ham enum sızmaz
      expect(CASE_STATUS_TONES[key]).toBeTruthy();
    }
  });
});
