import { describe, expect, it } from "vitest";
import { ACTION_LABELS, ADMIN_ROLES, PERMISSION_MATRIX, can, isReadOnly, levelOf } from "./rbac";
import { EP } from "./endpoints";
import { NAV_ITEMS } from "./nav";

describe("admin rbac matrisi", () => {
  it("her aksiyonun her rol için satırı ve etiketi var (matris eksiksiz)", () => {
    for (const action of Object.keys(PERMISSION_MATRIX) as Array<keyof typeof PERMISSION_MATRIX>) {
      for (const role of ADMIN_ROLES) expect(PERMISSION_MATRIX[action][role]).toBeDefined();
      expect(ACTION_LABELS[action]).toBeTruthy();
    }
  });

  it("analist salt-okur: tekil ödeme göremez, kurul raporunu görür; destek ajanı kupon yönetemez", () => {
    expect(can("ANALYST_READONLY", "payment.refund")).toBe(false);
    expect(can("ANALYST_READONLY", "board_report.view")).toBe(true);
    expect(can("SUPPORT_AGENT", "coupon.manage")).toBe(false);
    expect(isReadOnly("SUPPORT_AGENT", "coupon.view")).toBe(true);
    expect(can("BILLING_ADMIN", "coupon.manage")).toBe(true);
    expect(levelOf("SUPER_ADMIN", "tenant.delete")).toBe("four_eyes");
    expect(can(null, "tenant.view")).toBe(false);
  });

  it("menü öğelerinin aksiyonları matriste tanımlı; Faz 3 sayfaları menüde", () => {
    for (const item of NAV_ITEMS) expect(PERMISSION_MATRIX[item.action]).toBeDefined();
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(expect.arrayContaining(["/kuponlar", "/faturalar"]));
    expect(EP.coupons.patch("a b")).toBe("/coupons/a%20b");
    expect(EP.invoices.markPaid("x")).toBe("/invoices/x/mark-paid");
  });
});
